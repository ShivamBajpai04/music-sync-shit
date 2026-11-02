// Test seam: a real agent driven through its Remote-facing protocol, with the
// extension replaced by FakeSource and the OS replaced by FakeMac.
import { WebSocket } from 'ws';
import { startAgent, type RunningAgent } from '../src/agent/agent.ts';
import type { Mac } from '../src/agent/mac.ts';
import {
  EXTENSION_PATH,
  REMOTE_PATH,
  type AgentToExtension,
  type AgentToRemote,
  type ExtensionToAgent,
  type PlayerState,
  type Progress,
  type RemoteToAgent,
  type SourceCommand,
  type SourceId,
  type Track,
} from '../src/shared/protocol.ts';

export class FakeMac implements Mac {
  opened: string[] = [];
  volume = 50;
  failVolume = false;
  async openInArc(url: string) {
    this.opened.push(url);
  }
  async getVolume() {
    if (this.failVolume) throw new Error('osascript failed');
    return this.volume;
  }
  async setVolume(volume: number) {
    this.volume = volume;
  }
}

export async function startTestAgent(name = 'Office Mac', mac = new FakeMac()) {
  const agent = await startAgent({
    name,
    remote: { host: '127.0.0.1', port: 0 },
    extension: { port: 0 },
    mac,
    volumePollMs: 20,
  });
  return { agent, mac };
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
  received: SourceCommand[] = [];

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
      if (message.type !== 'command' || message.source !== this.source) return;
      this.received.push(message.command);
      this.run(message.command);
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

  private goTo(index: number) {
    this.index = Math.max(0, Math.min(this.playlist.length - 1, index));
    this.track = this.playlist[this.index] ?? null;
    this.progress = this.track ? { positionMs: 0, durationMs: TRACK_LENGTH_MS } : null;
  }

  // A change made on the Mac itself, not from the Remote.
  setLocally(change: { track?: Track | null; playing?: boolean; positionMs?: number }) {
    if (change.track !== undefined) this.track = change.track;
    if (change.playing !== undefined) this.playing = change.playing;
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

  async connect(agent: RunningAgent) {
    this.socket = new WebSocket(`ws://127.0.0.1:${agent.remotePort}${REMOTE_PATH}`);
    this.socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as AgentToRemote;
      if (message.type === 'state') this.states.push(message.state);
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

  send(command: SourceCommand) {
    this.sendMessage({ type: 'command', command });
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

export const TRACK_LENGTH_MS = 240_000;
export const SONG: Track = { title: 'Teardrop', artist: 'Massive Attack', artUrl: 'https://i.scdn.co/image/teardrop' };
export const OTHER_SONG: Track = { title: 'Angel', artist: 'Massive Attack', artUrl: null };
