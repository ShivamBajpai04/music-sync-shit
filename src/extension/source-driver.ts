// Runs one Source driver inside its tab: reports state changes to the
// background service worker and carries out commands it sends back.
import type { SourceCommand, SourceId, Track } from '../shared/protocol.ts';
import type { BackgroundToTab, TabToBackground } from './messages.ts';

export interface SourceDriver {
  source: SourceId;
  read(): { track: Track | null; playing: boolean };
  run(command: SourceCommand): void;
}

const POLL_MS = 1_000;
const RECONNECT_MS = 1_000;

export function runSourceDriver(driver: SourceDriver) {
  let port: chrome.runtime.Port | null = null;
  let lastSent = '';

  function report(force = false) {
    const state: TabToBackground = { type: 'state', ...driver.read() };
    const serialized = JSON.stringify(state);
    if (!port || (!force && serialized === lastSent)) return;
    lastSent = serialized;
    port.postMessage(state);
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
