// Test seam: a real agent driven through its Remote-facing protocol, with the
// extension replaced by FakeSource and the OS replaced by FakeMac.
import { WebSocket } from 'ws';
import { startAgent, type RunningAgent } from '../src/agent/agent.ts';
import type { Mac } from '../src/agent/mac.ts';
import {
  EXTENSION_PATH,
  REMOTE_PATH,
  parseStartHash,
  type AgentToExtension,
  type AgentToRemote,
  type PlayerEntry,
  type ExtensionToAgent,
  type PlayerState,
  type Progress,
  type RemoteToAgent,
  type SourceCommand,
  type SourceId,
  type SourceState,
  type Track,
} from '../src/shared/protocol.ts';

export class FakeMac implements Mac {
  opened: string[] = [];
  volume = 50;
  failVolume = false;
  failOpen = false;
  // Lets a test make the opened tab appear, as Arc would.
  onOpen: (url: string) => void = () => {};
  async openInArc(url: string) {
    if (this.failOpen) throw new Error('open failed');
    this.opened.push(url);
    this.onOpen(url);
  }
  async getVolume() {
    if (this.failVolume) throw new Error('osascript failed');
    return this.volume;
  }
  async setVolume(volume: number) {
    this.volume = volume;
  }
}

export async function startTestAgent(
  name = 'Office Mac',
  mac = new FakeMac(),
  {
    players = [],
    port = 0,
    lastPlaybackPath,
    handoffTimeoutMs,
  }: { players?: PlayerEntry[]; port?: number; lastPlaybackPath?: string; handoffTimeoutMs?: number } = {},
) {
  const agent = await startAgent({
    name,
    remote: { host: '127.0.0.1', port },
    extension: { port: 0 },
    players,
    lastPlaybackPath,
    saveIntervalMs: 20,
    mac,
    volumePollMs: 20,
    handoffTimeoutMs,
  });
  return { agent, mac };
}

export function playerEntry(label: string, agent: RunningAgent): PlayerEntry {
  return { label, url: `ws://127.0.0.1:${agent.remotePort}${REMOTE_PATH}` };
}

// Stands in for the extension plus one Source tab. Behaves like a web player
// working through a playlist: commands change its state, which it reports
// back. Position doesn't advance by itself; set it with setLocally.
export class FakeSource {
  private socket!: WebSocket;
  private agent: RunningAgent;
  readonly source: SourceId;
  playlist: Track[];
  index = 0;
  track: Track | null;
  playing: boolean;
  progress: Progress | null;
  context: string | null = null;
  received: SourceCommand[] = [];
  navigatedTo: string[] = [];
  reloads = 0;
  simulateNavigation = false;
  ignoreCommands = new Set<SourceCommand['type']>();
  onCommand: (command: SourceCommand) => void = () => {};
  onNavigate: (url: string) => void = () => {};

  constructor(agent: RunningAgent, source: SourceId, tracks: Track | Track[] | null, playing = false) {
    this.agent = agent;
    this.source = source;
    this.playlist = tracks === null ? [] : [tracks].flat();
    this.track = this.playlist[0] ?? null;
    this.playing = playing;
    this.progress = this.track ? { positionMs: 0, durationMs: TRACK_LENGTH_MS } : null;
  }

  async connect(origin = 'chrome-extension://fake') {
    this.socket = new WebSocket(`ws://127.0.0.1:${this.agent.extensionPort}${EXTENSION_PATH}`, { origin });
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as AgentToExtension;
      if (message.type === 'reload-tabs') {
        if (!message.source || message.source === this.source) this.reloads++;
        return;
      }
      if (message.type === 'ping' || message.source !== this.source) return;
      if (message.type === 'open') {
        // Like the real driver after loading a started link.
        this.navigatedTo.push(message.url);
        if (this.simulateNavigation) this.loadStartedLink(message.url);
        this.playing = true;
        this.onNavigate(message.url);
      } else {
        this.received.push(message.command);
        this.onCommand(message.command);
        if (!this.ignoreCommands.has(message.command.type)) this.run(message.command);
      }
      this.report();
    });
    this.report();
    return this;
  }

  private run(command: SourceCommand) {
    switch (command.type) {
      case 'play':
      case 'pause':
        this.playing = command.type === 'play';
        break;
      case 'next':
        this.goTo(this.index + 1);
        break;
      case 'previous':
        // Like the real players: restart the track unless it's near the start.
        if ((this.progress?.positionMs ?? 0) > 3_000) this.goTo(this.index);
        else this.goTo(this.index - 1);
        break;
      case 'seek':
        if (this.progress) this.progress = { ...this.progress, positionMs: command.positionMs };
        break;
    }
  }

  loadStartedLink(link: string) {
    const url = new URL(link);
    const index = this.playlist.findIndex(track => trackLink(this.source, track) === url.origin + url.pathname + (this.source === 'youtube-music' ? `?v=${url.searchParams.get('v')}` : ''));
    if (index >= 0) this.goTo(index);
    const positionMs = parseStartHash(url.hash) ?? 0;
    if (this.progress) this.progress.positionMs = positionMs;
    const list = url.searchParams.get('list');
    const context = /^spotify:(playlist|album):(.+)$/.exec(url.searchParams.get('context') ?? '');
    this.context = this.source === 'youtube-music'
      ? list ? `https://music.youtube.com/playlist?list=${list}` : null
      : context ? `https://open.spotify.com/${context[1]}/${context[2]}` : null;
  }

  private goTo(index: number) {
    this.index = Math.max(0, Math.min(this.playlist.length - 1, index));
    this.track = this.playlist[this.index] ?? null;
    this.progress = this.track ? { positionMs: 0, durationMs: TRACK_LENGTH_MS } : null;
  }

  // A change made on the Mac itself, not from the Remote.
  setLocally(change: { track?: Track | null; playing?: boolean; positionMs?: number; context?: string | null }) {
    if (change.track !== undefined) this.track = change.track;
    if (change.playing !== undefined) this.playing = change.playing;
    if (change.context !== undefined) this.context = change.context;
    if (change.positionMs !== undefined && this.progress) {
      this.progress = { ...this.progress, positionMs: change.positionMs };
    }
    this.report();
  }

  closeTab() {
    this.send({ type: 'source-closed', source: this.source });
  }

  disconnect() {
    this.socket.close();
  }

  private report() {
    this.send({
      type: 'source-state',
      source: this.source,
      track: this.track,
      playing: this.playing,
      progress: this.progress,
      link: this.track ? trackLink(this.source, this.track) : null,
      context: this.context,
    });
  }

  private send(message: ExtensionToAgent) {
    this.socket.send(JSON.stringify(message));
  }
}

// Speaks the protocol the Remote page speaks.
export class FakeRemote {
  private socket!: WebSocket;
  states: PlayerState[] = [];
  errors: string[] = [];

  async connect(agent: RunningAgent) {
    this.socket = new WebSocket(`ws://127.0.0.1:${agent.remotePort}${REMOTE_PATH}`);
    this.socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as AgentToRemote;
      if (message.type === 'state') this.states.push(message.state);
      else if (message.type === 'error') this.errors.push(message.message);
    });
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    return this;
  }

  get latest() {
    return this.states.at(-1);
  }

  // Sends to the given Source, or to the first card's Source like a
  // single-card Remote would.
  send(command: SourceCommand, source?: SourceId) {
    const target = source ?? this.latest?.sources[0]?.source ?? 'spotify';
    this.sendMessage({ type: 'command', source: target, command });
  }

  resume() {
    this.sendMessage({ type: 'resume' });
  }

  reloadTabs(source?: SourceId) {
    this.sendMessage({ type: 'reload-tabs', source });
  }

  handoff(source: SourceId, target: string) {
    this.sendMessage({ type: 'handoff', source, target });
  }

  startLink(link: string) {
    this.sendMessage({ type: 'start-link', link });
  }

  waitForError(timeoutMs = 1000) {
    return new Promise<string>((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (this.errors.length) return resolve(this.errors.at(-1)!);
        if (Date.now() - started > timeoutMs) return reject(new Error('No error received'));
        setTimeout(check, 5);
      };
      check();
    });
  }

  setVolume(volume: number) {
    this.sendMessage({ type: 'set-volume', volume });
  }

  private sendMessage(message: RemoteToAgent) {
    this.socket.send(JSON.stringify(message));
  }

  waitFor(predicate: (state: PlayerState) => boolean, timeoutMs = 1000) {
    return new Promise<PlayerState>((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        const match = this.states.findLast(predicate);
        if (match && match === this.latest) return resolve(match);
        if (Date.now() - started > timeoutMs) {
          return reject(new Error(`No matching state; latest: ${JSON.stringify(this.latest)}`));
        }
        setTimeout(check, 5);
      };
      check();
    });
  }

  close() {
    this.socket.close();
  }
}

// The link a fake Source reports for a track, as the real pages would.
export function trackLink(source: SourceId, track: Track) {
  const id = track.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return source === 'spotify' ? `https://open.spotify.com/track/${id}` : `https://music.youtube.com/watch?v=${id}`;
}

// The first card's Source, which is the only one unless several are playing.
export function first(state: PlayerState): SourceState | undefined {
  return state.sources[0];
}

export const TRACK_LENGTH_MS = 240_000;
export const SONG: Track = { title: 'Teardrop', artist: 'Massive Attack', artUrl: 'https://i.scdn.co/image/teardrop' };
export const OTHER_SONG: Track = { title: 'Angel', artist: 'Massive Attack', artUrl: null };
