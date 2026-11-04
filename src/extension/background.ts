// Holds the connection to this Mac's agent and routes commands to Source tabs.
import {
  DEFAULT_EXTENSION_PORT,
  EXTENSION_PATH,
  type AgentToExtension,
  type ExtensionToAgent,
  type SourceId,
} from '../shared/protocol.ts';
import type { BackgroundToTab, TabToBackground } from './messages.ts';
import { reloadTabs } from './reload-tabs.ts';

const AGENT_URL = `ws://127.0.0.1:${DEFAULT_EXTENSION_PORT}${EXTENSION_PATH}`;
const RECONNECT_MS = 2_000;

const tabs = new Map<SourceId, chrome.runtime.Port>();
const lastState = new Map<SourceId, ExtensionToAgent>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// Spotify's current now-playing links lead to the album. Its own Copy link to
// Song action has the track URL, so capture that action in the page's world
// without letting it replace the user's clipboard.
async function captureSpotifySongLink(expectedTitle: string): Promise<{ link: string; context: string | null } | null> {
  const clipboard = navigator.clipboard;
  if (!clipboard?.write) return null;
  // Media Session metadata can change before Spotify redraws its song menu.
  for (let attempt = 0; attempt < 30; attempt++) {
    const label = document.querySelector('[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]')?.getAttribute('aria-label');
    if (label?.startsWith(`Now playing: ${expectedTitle} by `)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const label = document.querySelector('[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]')?.getAttribute('aria-label');
  if (!label?.startsWith(`Now playing: ${expectedTitle} by `)) return null;
  const originalWrite = clipboard.write;
  const cover = document.querySelector<HTMLButtonElement>('button[data-testid="cover-art-button"]');
  let copy = document.querySelector<HTMLButtonElement>('button[aria-label="Copy link to Song"]');
  const openedView = !copy;
  if (!copy) {
    cover?.click();
    for (let attempt = 0; attempt < 20 && !copy; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      copy = document.querySelector<HTMLButtonElement>('button[aria-label="Copy link to Song"]');
    }
  }
  if (!copy) return null;

  // The details panel can lag the now-playing bar by a render.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const contextHref = document.querySelector<HTMLAnchorElement>('aside[aria-label="Now playing view"] a[href^="/playlist/"], aside[aria-label="Now playing view"] a[href^="/album/"]')?.href;
  const contextMatch = contextHref && /\/(playlist|album)\/([A-Za-z0-9]+)/.exec(contextHref);
  const context = contextMatch ? `https://open.spotify.com/${contextMatch[1]}/${contextMatch[2]}` : null;

  let finish!: (link: string | null) => void;
  const captured = new Promise<string | null>((resolve) => { finish = resolve; });
  clipboard.write = async function (items: ClipboardItems) {
    for (const item of items) {
      if (!item.types.includes('text/plain')) continue;
      const text = await (await item.getType('text/plain')).text();
      if (/^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]+/.test(text)) {
        finish(text);
        return;
      }
    }
    return originalWrite.call(clipboard, items);
  };
  try {
    copy.click();
    const link = await Promise.race([
      captured,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
    ]);
    return link ? { link, context } : null;
  } finally {
    clipboard.write = originalWrite;
    if (openedView) cover?.click();
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string; title?: string }, sender, respond) => {
  if (message.type !== 'spotify-song-link' || !message.title || sender.tab?.id === undefined) return;
  void chrome.scripting.executeScript({
    target: { tabId: sender.tab.id },
    world: 'MAIN',
    func: captureSpotifySongLink,
    args: [message.title],
  }).then((results) => respond(results[0]?.result ?? null), () => respond(null));
  return true;
});

function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  socket = new WebSocket(AGENT_URL);
  socket.onopen = () => {
    for (const message of lastState.values()) send(message);
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as AgentToExtension;
    if (message.type === 'reload-tabs') {
      void reloadTabs(message.source, chrome.tabs).catch(error => console.error('Reloading Source tabs failed:', error));
    } else if (message.type === 'command') {
      const command: BackgroundToTab = { type: 'command', command: message.command };
      tabs.get(message.source)?.postMessage(command);
    } else if (message.type === 'open') {
      const tabId = tabs.get(message.source)?.sender?.tab?.id;
      if (tabId !== undefined) void chrome.tabs.update(tabId, { url: message.url });
    }
  };
  socket.onclose = () => {
    socket = null;
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_MS);
    }
  };
}

function send(message: ExtensionToAgent) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

chrome.runtime.onConnect.addListener((port) => {
  const source = port.name as SourceId;
  tabs.set(source, port);
  port.onMessage.addListener((message: TabToBackground) => {
    const state: ExtensionToAgent = {
      type: 'source-state',
      source,
      track: message.track,
      playing: message.playing,
      progress: message.progress,
      link: message.link,
      context: message.context,
    };
    lastState.set(source, state);
    send(state);
  });
  port.onDisconnect.addListener(() => {
    // A newer tab for the same Source may already have replaced this one.
    if (tabs.get(source) !== port) return;
    tabs.delete(source);
    lastState.delete(source);
    send({ type: 'source-closed', source });
  });
});

// The service worker can be suspended, which drops its timers. The alarm
// wakes it so it can reconnect after the agent restarts.
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);

// Content scripts only load on page navigation, so after the extension is
// installed or reloaded, inject the drivers into Source tabs already open.
chrome.runtime.onInstalled.addListener(async () => {
  for (const { js: files, matches } of chrome.runtime.getManifest().content_scripts ?? []) {
    for (const tab of await chrome.tabs.query({ url: matches })) {
      if (tab.id !== undefined && files) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    }
  }
});

connect();
