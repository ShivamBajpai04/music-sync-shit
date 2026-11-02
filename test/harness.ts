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
  type RemoteToAgent,
  type SourceCommand,
  type SourceId,
  type Track,
} from '../src/shared/protocol.ts';

export class FakeMac implements Mac {
  opened: string[] = [];
  async openInArc(url: string) {
    this.opened.push(url);
  }
}

export async function startTestAgent(name = 'Office Mac') {
  const mac = new FakeMac();
  const agent = await startAgent({
    name,
    remote: { host: '127.0.0.1', port: 0 },
    extension: { port: 0 },
    mac,
  });
  return { agent, mac };
}

// Stands in for the extension plus one Source tab. Behaves like a web player:
// play and pause commands change its state, which it reports back.
export class FakeSource {
  private socket!: WebSocket;
  private agent: RunningAgent;
  readonly source: SourceId;
  track: Track | null;
  playing: boolean;
  received: SourceCommand[] = [];

  constructor(agent: RunningAgent, source: SourceId, track: Track | null, playing = false) {
    this.agent = agent;
    this.source = source;
    this.track = track;
    this.playing = playing;
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
      this.playing = message.command.type === 'play';
      this.report();
    });
    this.report();
    return this;
  }

  // A change made on the Mac itself, not from the Remote.
  setLocally(change: { track?: Track | null; playing?: boolean }) {
    if (change.track !== undefined) this.track = change.track;
    if (change.playing !== undefined) this.playing = change.playing;
    this.report();
  }

  closeTab() {
    this.send({ type: 'source-closed', source: this.source });
  }

  disconnect() {
    this.socket.close();
  }

  private report() {
    this.send({ type: 'source-state', source: this.source, track: this.track, playing: this.playing });
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
    const message: RemoteToAgent = { type: 'command', command };
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

export const SONG: Track = { title: 'Teardrop', artist: 'Massive Attack', artUrl: 'https://i.scdn.co/image/teardrop' };
export const OTHER_SONG: Track = { title: 'Angel', artist: 'Massive Attack', artUrl: null };
