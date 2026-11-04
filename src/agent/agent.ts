import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import {
  EXTENSION_PATH,
  PLAYERS_PATH,
  REMOTE_PATH,
  type AgentToExtension,
  type AgentToRemote,
  type PlayerEntry,
  type ExtensionToAgent,
  advance,
  SOURCE_ORDER,
  startHash,
  type PlayerState,
  type Progress,
  type RemoteToAgent,
  type SourceCommand,
  type SourceId,
  type SourceState,
  type Track,
  type Playback,
} from '../shared/protocol.ts';
import { parseLink } from './links.ts';
import { loadLastPlayback, saveLastPlayback, type LastPlayback } from './memory.ts';
import type { Mac } from './mac.ts';
import { playbackUrl } from './playback.ts';
import { HandoffError, playbackStatus, startOnPeer } from './handoff.ts';
import { startVoiceRouter } from './voice.ts';
import type { VoiceOutput } from './voice-output.ts';

export interface AgentOptions {
  name: string;
  // The Remote listens here: the Mac's tailnet address in production.
  remote: { host: string; port: number };
  // The extension always connects over localhost.
  extension: { port: number };
  // Directory holding the built Remote page; omitted in tests.
  staticDir?: string;
  // Live Player directory; discovery updates this array in place (ADR-0004).
  players: PlayerEntry[];
  // Where the last playback is saved for Resume; kept in memory only if omitted.
  lastPlaybackPath?: string;
  // How often the remembered position is saved while playing.
  saveIntervalMs?: number;
  mac: Mac;
  pingIntervalMs?: number;
  // How often to re-read system volume, to catch changes made on the Mac.
  volumePollMs?: number;
  handoffTimeoutMs?: number;
  voiceOutput?: () => Promise<VoiceOutput>;
  // A separate loopback listener lets Tailscale Serve terminate private HTTPS.
  loopbackRemote?: boolean;
  secureRemoteUrl?: string;
}

export interface RunningAgent {
  remotePort: number;
  extensionPort: number;
  close(): Promise<void>;
}

interface SourceTab {
  socket: WebSocket;
  track: Track | null;
  playing: boolean;
  progress: Progress | null;
  link: string | null;
  context: string | null;
  receivedAt: number;
}

// The last playback, with its position as of `at` (agent clock).
interface Remembered extends LastPlayback {
  playing: boolean;
  at: number;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export async function startAgent(options: AgentOptions): Promise<RunningAgent> {
  const sources = new Map<SourceId, SourceTab>();
  const remotes = new Set<WebSocket>();
  let volume = await readVolume(options.mac);
  const saved = await loadLastPlayback(options.lastPlaybackPath);
  let remembered: Remembered | null = saved && { ...saved, playing: false, at: Date.now() };
  let pendingResume: { source: SourceId; link: string; positionMs: number; playRequested: boolean } | null = null;
  let outgoingHandoff: { source: SourceId; target: string } | undefined;
  let incomingHandoff = false;
  const stopping = new AbortController();
  const handoffTimeoutMs = options.handoffTimeoutMs ?? 25_000;

  function playerState(): PlayerState {
    // A card per open Source tab with a track loaded, playing or paused. If
    // none has a track, the open tabs still get (empty) cards.
    const open = SOURCE_ORDER.filter((source) => sources.has(source));
    const loaded = open.filter((source) => sources.get(source)!.track);
    const shown = loaded.length > 0 ? loaded : open;
    const resumable = remembered && !sources.get(remembered.source)?.playing;
    return {
      name: options.name,
      voiceAvailable: !!options.voiceOutput,
      ...(options.secureRemoteUrl ? { secureRemoteUrl: options.secureRemoteUrl } : {}),
      ...(outgoingHandoff ? { handoff: outgoingHandoff } : {}),
      sources: shown.map(sourceState),
      volume,
      resume: resumable ? { source: remembered!.source, track: remembered!.track } : null,
    };
  }

  function rememberedProgress(memory: Remembered) {
    return memory.progress && advance(memory.progress, memory.playing, Date.now() - memory.at);
  }

  // The last playback follows whichever Source is playing, and the remembered
  // Source's own changes, as long as the page gives a link to reopen it.
  function remember(source: SourceId) {
    const tab = sources.get(source)!;
    if (!tab.track || !tab.link) return;
    if (!tab.playing && remembered && (remembered.source !== source || remembered.link !== tab.link)) return;
    const changed = remembered?.link !== tab.link || remembered?.context !== tab.context || remembered.playing !== tab.playing;
    remembered = { source, track: tab.track, link: tab.link, context: tab.context, progress: tab.progress, playing: tab.playing, at: Date.now() };
    if (changed || !tab.playing) void save();
  }

  // When the remembered Source's tab goes away, keep where it got to.
  function forget(source: SourceId) {
    sources.delete(source);
    if (remembered?.source !== source) return;
    remembered = { ...remembered, progress: rememberedProgress(remembered), playing: false, at: Date.now() };
    void save();
  }

  // Saves run one at a time, each writing the memory as it is by then.
  let saving = Promise.resolve();
  let closed = false;
  function save() {
    saving = saving.then(async () => {
      if (!remembered || closed) return;
      const { playing, at, ...playback } = remembered;
      try {
        await saveLastPlayback(options.lastPlaybackPath, { ...playback, progress: rememberedProgress(remembered) });
      } catch (error) {
        console.error('Saving last playback failed:', error);
      }
    });
    return saving;
  }

  function sourceState(source: SourceId): SourceState {
    const tab = sources.get(source)!;
    return {
      source,
      track: tab.track,
      playing: tab.playing,
      progress: tab.progress ? advance(tab.progress, tab.playing, Date.now() - tab.receivedAt) : null,
      context: tab.context,
      canHandoff: !!tab.track && !!tab.link,
    };
  }

  function broadcast() {
    const message: AgentToRemote = { type: 'state', state: playerState() };
    const data = JSON.stringify(message);
    for (const remote of remotes) remote.send(data);
  }

  function sendCommand(source: SourceId, command: SourceCommand) {
    const tab = sources.get(source);
    if (!tab) return;
    const message: AgentToExtension = { type: 'command', source, command };
    tab.socket.send(JSON.stringify(message));
  }


  // Extension side: localhost only, and only from a browser extension, so a
  // web page open in any browser on this Mac can't pose as a Source.
  const extensionServer = createServer((_req, res) => res.writeHead(404).end());
  const extensionSockets = new WebSocketServer({ noServer: true });
  extensionServer.on('upgrade', (req, socket, head) => {
    const fromExtension = req.headers.origin?.startsWith('chrome-extension://') ?? false;
    if (req.url !== EXTENSION_PATH || !fromExtension) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    extensionSockets.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as ExtensionToAgent;
        if (message.type === 'source-state') {
          sources.set(message.source, {
            socket: ws,
            track: message.track,
            playing: message.playing,
            progress: message.progress,
            link: message.link,
            context: message.context,
            receivedAt: Date.now(),
          });
          const wasResuming = pendingResume?.source === message.source;
          if (wasResuming && message.link === pendingResume?.link) {
            if (!message.playing) {
              if (!pendingResume.playRequested) {
                pendingResume.playRequested = true;
                sendCommand(message.source, { type: 'play' });
              }
            } else if (message.progress || pendingResume.positionMs === 0) {
              if (message.progress && Math.abs(message.progress.positionMs - pendingResume.positionMs) > 1_500) {
                sendCommand(message.source, { type: 'seek', positionMs: pendingResume.positionMs });
              }
              pendingResume = null;
            }
          }
          if (!wasResuming) remember(message.source);
        } else {
          forget(message.source);
        }
        broadcast();
      });
      ws.on('close', () => {
        for (const [source, tab] of sources) if (tab.socket === ws) forget(source);
        broadcast();
      });
    });
  });

  // Remote side: the page and its live connection. No auth (ADR-0002).
  const handleRemoteRequest = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === PLAYERS_PATH) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(options.players));
      return;
    }
    void serveStatic(options.staticDir, req, res);
  };
  const remoteServer = createServer(handleRemoteRequest);
  const localRemoteServer = options.loopbackRemote && options.remote.host !== '127.0.0.1' ? createServer(handleRemoteRequest) : null;
  const remoteSockets = new WebSocketServer({ noServer: true });
  const voiceRouter = startVoiceRouter({
    players: options.players,
    ownUrl: () => `ws://${options.remote.host}:${(remoteServer.address() as AddressInfo).port}${REMOTE_PATH}`,
    output: options.voiceOutput,
  });
  const attachUpgrade = (server: Server) => server.on('upgrade', (req, socket, head) => {
    if (voiceRouter.upgrade(req, socket, head)) return;
    if (req.url !== REMOTE_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    remoteSockets.handleUpgrade(req, socket, head, (ws) => {
      remotes.add(ws);
      const hello: AgentToRemote = { type: 'state', state: playerState() };
      ws.send(JSON.stringify(hello));
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as RemoteToAgent;
        if (message.type === 'handoff') void handoff(message.source, message.target, ws);
        else if (message.type === 'start-playback') void receiveHandoff(message, ws);
        else if (message.type === 'reload-tabs') {
          if (!extensionSockets.clients.size) {
            const error: AgentToRemote = { type: 'error', message: 'The browser extension is disconnected. Reconnect it to reload tabs.' };
            ws.send(JSON.stringify(error));
            return;
          }
          // Recovery must work even when a Source's content script has disconnected.
          const reload: AgentToExtension = { type: 'reload-tabs', source: message.source };
          for (const extension of extensionSockets.clients) extension.send(JSON.stringify(reload));
        }
        else if (message.type === 'command') sendCommand(message.source, message.command);
        else if (message.type === 'set-volume') void setVolume(message.volume);
        else if (message.type === 'start-link') void startLink(message.link, ws);
        else void resume(ws);
      });
      ws.on('close', () => remotes.delete(ws));
    });
  });
  attachUpgrade(remoteServer);
  if (localRemoteServer) attachUpgrade(localRemoteServer);

  async function startLink(link: string, requester: WebSocket) {
    if (incomingHandoff || outgoingHandoff) return reportError(requester, 'A Handoff is already in progress on this Player.');
    const parsed = parseLink(link);
    if ('error' in parsed) {
      const message: AgentToRemote = { type: 'error', message: parsed.error };
      requester.send(JSON.stringify(message));
      return;
    }
    await open(parsed.source, `${parsed.url}${startHash()}`, requester);
  }

  // Plays what's loaded in the remembered Source's tab, or reopens the
  // remembered track where it got to.
  async function resume(requester: WebSocket) {
    if (incomingHandoff || outgoingHandoff) return reportError(requester, 'A Handoff is already in progress on this Player.');
    if (!remembered) return;
    const tab = sources.get(remembered.source);
    if (tab?.track && tab.link === remembered.link) {
      pauseOthers(remembered.source);
      sendCommand(remembered.source, { type: 'play' });
      return;
    }
    const positionMs = rememberedProgress(remembered)?.positionMs;
    pendingResume = { source: remembered.source, link: remembered.link, positionMs: positionMs ?? 0, playRequested: false };
    if (!await open(remembered.source, playbackUrl({ ...remembered, progress: rememberedProgress(remembered) }), requester)) pendingResume = null;
  }

  function reportError(requester: WebSocket, message: string) {
    if (requester.readyState === WebSocket.OPEN) requester.send(JSON.stringify({ type: 'error', message } satisfies AgentToRemote));
  }

  async function waitForPlayback(check: () => boolean, requester: WebSocket) {
    const deadline = Date.now() + handoffTimeoutMs;
    while (!stopping.signal.aborted && requester.readyState === WebSocket.OPEN) {
      if (check()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return false;
  }

  async function receiveHandoff(message: Extract<RemoteToAgent, { type: 'start-playback' }>, requester: WebSocket) {
    const reply = (ok: boolean, reason?: string) => {
      if (requester.readyState === WebSocket.OPEN) requester.send(JSON.stringify({
        type: 'handoff-result', requestId: message.requestId, ok, state: playerState(), message: reason,
      } satisfies AgentToRemote));
    };
    if (incomingHandoff || outgoingHandoff || pendingResume) return reply(false, 'A Handoff or Resume is already in progress on the target.');
    incomingHandoff = true;
    try {
      const playback = message.playback;
      const parsed = parseLink(playback.link);
      if ('error' in parsed || parsed.source !== playback.source || !playback.track) throw new Error('The playback link is invalid.');
      const positionMs = playback.progress?.positionMs ?? 0;
      if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error('The playback position is invalid.');
      const loaded = sources.get(playback.source);
      if (loaded?.link === parsed.url && loaded.context === playback.context) {
        pauseOthers(playback.source);
        sendCommand(playback.source, { type: 'play' });
        sendCommand(playback.source, { type: 'seek', positionMs });
      } else if (!await open(playback.source, playbackUrl(playback), requester)) {
        throw new Error('Could not open the target Source in Arc.');
      }
      let seekRequested = false;
      const started = await waitForPlayback(() => {
        const tab = sources.get(playback.source);
        if (!tab?.playing || tab.link !== parsed.url) return false;
        if ([...sources].some(([source, other]) => source !== playback.source && other.playing)) return false;
        if (!tab.progress) return positionMs === 0;
        const position = advance(tab.progress, tab.playing, Date.now() - tab.receivedAt).positionMs;
        if (Math.abs(position - positionMs) <= 2_000) return true;
        if (!seekRequested) {
          seekRequested = true;
          sendCommand(playback.source, { type: 'seek', positionMs });
        }
        return false;
      }, requester);
      if (!started) throw new Error('The target did not confirm the requested track and position.');
      reply(true);
    } catch (error) {
      reply(false, error instanceof Error ? error.message : 'Could not start playback.');
    } finally {
      incomingHandoff = false;
    }
  }

  async function handoff(source: SourceId, targetLabel: string, requester: WebSocket) {
    const target = options.players.find(player => player.label === targetLabel);
    const tab = sources.get(source);
    if (incomingHandoff || outgoingHandoff || pendingResume) return reportError(requester, 'A Handoff or Resume is already in progress on this Player.');
    if (!target) return reportError(requester, 'The target Player is not configured on this Mac.');
    const ownPort = (remoteServer.address() as AddressInfo).port;
    if (target.url === `ws://${options.remote.host}:${ownPort}${REMOTE_PATH}`) return reportError(requester, 'Choose another Player for Handoff.');
    if (!tab?.playing || !tab.track || !tab.link) return reportError(requester, 'The playing Source does not have a track link available for Handoff yet.');
    const playback: Playback = {
      source, track: tab.track, link: tab.link, context: tab.context,
      progress: tab.progress ? advance(tab.progress, tab.playing, Date.now() - tab.receivedAt) : null,
    };
    outgoingHandoff = { source, target: target.label };
    broadcast();
    let targetState: PlayerState | null = null;
    try {
      targetState = await startOnPeer(target, playback, handoffTimeoutMs + 2_000, stopping.signal);
      const original = sources.get(source);
      if (!original || original.link !== playback.link) throw new Error('The original Source disconnected or changed tracks.');
      // Spotify may have already paused the original due to its session rule.
      if (original.playing) sendCommand(source, { type: 'pause' });
      const paused = await waitForPlayback(() => {
        const current = sources.get(source);
        return !!current && current.link === playback.link && !current.playing;
      }, requester);
      if (!paused) throw new Error('The target started, but the original did not confirm pausing.');
    } catch (error) {
      if (error instanceof HandoffError) targetState = error.targetState;
      const reason = error instanceof Error ? error.message : 'Handoff failed.';
      reportError(requester, `Handoff failed: ${reason} ${playbackStatus(options.name, playerState())} ${playbackStatus(targetState?.name ?? target.label, targetState)}`);
    } finally {
      outgoingHandoff = undefined;
      broadcast();
    }
  }

  // Only one Source plays at a time when starting something; the other is
  // paused, not closed, so it can be resumed.
  function pauseOthers(source: SourceId) {
    for (const [other, tab] of sources) {
      if (other !== source && tab.playing) sendCommand(other, { type: 'pause' });
    }
  }

  // Starts url (carrying a start marker) on source: in its open tab, or in a
  // new Arc tab, launching Arc if needed.
  async function open(source: SourceId, url: string, requester: WebSocket) {
    pauseOthers(source);
    const tab = sources.get(source);
    if (tab) {
      const message: AgentToExtension = { type: 'open', source, url };
      tab.socket.send(JSON.stringify(message));
      return true;
    }
    try {
      await options.mac.openInArc(url);
      return true;
    } catch (error) {
      console.error('Opening Arc failed:', error);
      const message: AgentToRemote = { type: 'error', message: 'Couldn’t open Arc on this Mac' };
      requester.send(JSON.stringify(message));
      return false;
    }
  }

  async function setVolume(requested: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(requested)));
    try {
      await options.mac.setVolume(clamped);
    } catch (error) {
      console.error('Setting volume failed:', error);
    }
    volume = await readVolume(options.mac);
    broadcast();
  }

  // Position is only reported when it jumps, so save it now and then.
  const savePoll = setInterval(() => {
    if (remembered?.playing) void save();
  }, options.saveIntervalMs ?? 5_000);

  const volumePoll = setInterval(async () => {
    const current = await readVolume(options.mac);
    if (current === volume) return;
    volume = current;
    broadcast();
  }, options.volumePollMs ?? 2_000);

  const ping = setInterval(() => {
    const message: AgentToExtension = { type: 'ping' };
    for (const ws of extensionSockets.clients) ws.send(JSON.stringify(message));
  }, options.pingIntervalMs ?? 20_000);

  await listen(extensionServer, options.extension.port, '127.0.0.1');
  await listen(remoteServer, options.remote.port, options.remote.host);
  if (localRemoteServer) await listen(localRemoteServer, (remoteServer.address() as AddressInfo).port, '127.0.0.1');

  return {
    remotePort: (remoteServer.address() as AddressInfo).port,
    extensionPort: (extensionServer.address() as AddressInfo).port,
    async close() {
      stopping.abort();
      voiceRouter.close();
      clearInterval(ping);
      clearInterval(volumePoll);
      clearInterval(savePoll);
      for (const ws of [...extensionSockets.clients, ...remoteSockets.clients]) ws.terminate();
      await Promise.all([closeServer(extensionServer), closeServer(remoteServer), ...(localRemoteServer ? [closeServer(localRemoteServer)] : [])]);
      await save();
      closed = true;
    },
  };
}

async function readVolume(mac: Mac) {
  try {
    return await mac.getVolume();
  } catch {
    return null;
  }
}

async function serveStatic(dir: string | undefined, req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? '/', 'http://agent').pathname;
  const relative = normalize(path === '/' ? 'index.html' : path.slice(1));
  if (!dir || relative.startsWith('..')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(join(dir, relative));
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}

function listen(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
