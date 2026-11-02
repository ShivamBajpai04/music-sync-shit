// Holds the connection to this Mac's agent and routes commands to Source tabs.
import {
  DEFAULT_EXTENSION_PORT,
  EXTENSION_PATH,
  type AgentToExtension,
  type ExtensionToAgent,
  type SourceId,
} from '../shared/protocol.ts';
import type { BackgroundToTab, TabToBackground } from './messages.ts';

const AGENT_URL = `ws://127.0.0.1:${DEFAULT_EXTENSION_PORT}${EXTENSION_PATH}`;
const RECONNECT_MS = 2_000;

const tabs = new Map<SourceId, chrome.runtime.Port>();
const lastState = new Map<SourceId, ExtensionToAgent>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (socket && socket.readyState <= WebSocket.OPEN) return;
  socket = new WebSocket(AGENT_URL);
  socket.onopen = () => {
    for (const message of lastState.values()) send(message);
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as AgentToExtension;
    if (message.type !== 'command') return;
    const command: BackgroundToTab = { type: 'command', command: message.command };
    tabs.get(message.source)?.postMessage(command);
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
