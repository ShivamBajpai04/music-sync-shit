// Runs one Source driver inside its tab: reports state changes to the
// background service worker and carries out commands it sends back.
import { advance, type Progress, type SourceCommand, type SourceId, type Track } from '../shared/protocol.ts';
import type { BackgroundToTab, TabToBackground } from './messages.ts';

export interface SourceDriver {
  source: SourceId;
  read(): { track: Track | null; playing: boolean; progress: Progress | null };
  run(command: SourceCommand): void;
}

const POLL_MS = 1_000;
const RECONNECT_MS = 1_000;
// Position is only reported when it strays this far from where the receiver
// would estimate it to be, i.e. after a seek or a stall.
const DRIFT_MS = 1_500;

type State = Omit<TabToBackground, 'type'>;

function needsReport(state: State, last: { state: State; at: number } | null) {
  if (!last) return true;
  const withoutPosition = (s: State) => JSON.stringify({ ...s, progress: s.progress?.durationMs ?? null });
  if (withoutPosition(state) !== withoutPosition(last.state)) return true;
  if (!state.progress || !last.state.progress) return false;
  const expected = advance(last.state.progress, last.state.playing, Date.now() - last.at);
  return Math.abs(state.progress.positionMs - expected.positionMs) > DRIFT_MS;
}

export function runSourceDriver(driver: SourceDriver) {
  let port: chrome.runtime.Port | null = null;
  let lastSent: { state: State; at: number } | null = null;

  function report(force = false) {
    const state = driver.read();
    if (!port || (!force && !needsReport(state, lastSent))) return;
    lastSent = { state, at: Date.now() };
    const message: TabToBackground = { type: 'state', ...state };
    port.postMessage(message);
  }

  function connect() {
    // After an extension reload this script is orphaned; a fresh copy has
    // been injected, so this one stops.
    if (!chrome.runtime?.id) return stop();
    port = chrome.runtime.connect({ name: driver.source });
    port.onMessage.addListener((message: BackgroundToTab) => {
      if (message.type !== 'command') return;
      driver.run(message.command);
      // The page updates asynchronously; the observer and poll catch the result.
    });
    // The port drops when the service worker is suspended or the extension reloads.
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connect, RECONNECT_MS);
    });
    report(true);
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      report();
    });
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const poll = setInterval(report, POLL_MS);

  function stop() {
    observer.disconnect();
    clearInterval(poll);
  }

  connect();
}
