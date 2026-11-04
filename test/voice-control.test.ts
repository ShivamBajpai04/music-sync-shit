import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceControl } from '../src/remote/voice.ts';
import type { PlayerConnection } from '../src/remote/players.ts';

it('stops a late microphone grant, targets the selected Mac, and cleans up on release/background', async t => {
  class Element extends EventTarget {
    children: Element[] = [];
    disabled = false;
    textContent = '';
    className = '';
    attrs = new Map<string, string>();
    classes = new Set<string>();
    classList = { add: (v: string) => this.classes.add(v), remove: (v: string) => this.classes.delete(v), contains: (v: string) => this.classes.has(v) };
    append(...children: Element[]) { this.children.push(...children); }
    setAttribute(k: string, v: string) { this.attrs.set(k, v); }
    setPointerCapture() {}
  }
  class Context {
    static all: Context[] = [];
    closed = false;
    destination = {};
    audioWorklet = { addModule: async () => {} };
    constructor() { Context.all.push(this); }
    async resume() {}
    async close() { this.closed = true; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class Socket {
    static OPEN = 1;
    static all: Socket[] = [];
    readyState = 1;
    bufferedAmount = 0;
    sent: unknown[] = [];
    onmessage?: (event: { data: string }) => void;
    url: string;
    constructor(url: string) { this.url = url; Socket.all.push(this); }
    send(data: unknown) { this.sent.push(data); }
    close() { this.readyState = 3; }
  }
  const doc = Object.assign(new EventTarget(), { createElement: () => new Element(), hidden: false });
  const win = new EventTarget();
  let grant!: (stream: unknown) => void;
  const globals = { document: doc, window: win, isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } },
    location: { origin: 'https://air.example:8443', href: 'https://air.example:8443/' },
    AudioContext: Context, WebSocket: Socket,
    AudioWorkletNode: class { port = {}; connect() {} disconnect() {} },
  };
  let control: ReturnType<typeof createVoiceControl>;
  t.after(() => control?.destroy());
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
  }
  control = createVoiceControl();
  control.update({ label: 'Pro', url: 'ws://100.94.37.34:4848/remote', online: true,
    state: { name: 'Pro', voiceAvailable: true, sources: [], volume: 50, resume: null },
    receivedAt: 0, error: null, send() {} } as PlayerConnection);
  const button = (control.element as unknown as Element).children[0];
  const hold = async () => {
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), { button: 0, pointerId: 1 });
    button.dispatchEvent(event);
    await tick();
  };
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  await hold();
  button.dispatchEvent(new Event('pointerup'));
  grant(stream);
  await tick();
  assert.equal(stopped, 1);
  assert.equal(Socket.all.length, 0, 'release during permission cannot open a channel');
  assert.ok(Context.all[0].closed);

  await hold(); grant(stream); await tick();
  const socket = Socket.all[0];
  assert.equal(new URL(socket.url).searchParams.get('target'), 'ws://100.94.37.34:4848/remote');
  socket.onmessage!({ data: JSON.stringify({ type: 'ready', sampleRate: 24000 }) });
  assert.equal(button.attrs.get('aria-pressed'), 'true');
  button.dispatchEvent(new Event('pointerup'));
  assert.equal(stopped, 2);
  assert.ok(Context.all[1].closed);
  assert.equal(socket.readyState, 3);
  assert.deepEqual(socket.sent, [JSON.stringify({ type: 'stop' })]);

  await hold(); grant(stream); await tick();
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(stopped, 3);
  assert.ok(Context.all[2].closed);
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
