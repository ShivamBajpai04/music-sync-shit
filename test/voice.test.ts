import { it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { WebSocket } from 'ws';
import { playerSocketUrl } from '../src/shared/voice.ts';
import { startTestAgent, playerEntry, FakeMac } from './harness.ts';
import type { VoiceOutput } from '../src/agent/voice-output.ts';
import type { PlayerEntry } from '../src/shared/protocol.ts';

function sink() {
  const chunks: Buffer[] = [];
  let stopped = false;
  const output: VoiceOutput = { write(data) { chunks.push(Buffer.from(data)); return true; }, stop() { stopped = true; }, done: new Promise(() => {}) };
  return { output, chunks, get stopped() { return stopped; } };
}
async function waitFor(test: () => boolean) {
  for (let i = 0; i < 200; i++) { if (test()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(test(), 'Condition did not become true');
}
function message(socket: WebSocket) { return once(socket, 'message').then(([data]) => JSON.parse(String(data))); }

it('uses same-origin secure sockets for HTTPS, preserving direct HTTP controls', () => {
  const target = 'ws://100.1.2.3:4848/remote';
  assert.equal(playerSocketUrl('http://100.2.3.4:4848', target), target);
  const control = new URL(playerSocketUrl('https://air.example:8443', target));
  assert.equal(control.origin, 'wss://air.example:8443');
  assert.equal(control.pathname, '/peer');
  assert.equal(control.searchParams.get('target'), target);
  assert.equal(new URL(playerSocketUrl('https://air.example:8443', target, true)).pathname, '/voice');
});

it('relays voice only to the chosen Mac, rejects a busy channel, and stops on release', async t => {
  const players: PlayerEntry[] = [];
  const airSink = sink(), proSink = sink();
  const { agent: air } = await startTestAgent('Air', new FakeMac(), { players, voiceOutput: async () => airSink.output });
  const { agent: pro } = await startTestAgent('Pro', new FakeMac(), { players, voiceOutput: async () => proSink.output });
  t.after(async () => { await Promise.all([air.close(), pro.close()]); });
  const proEntry = playerEntry('pro', pro);
  players.push(playerEntry('air', air), proEntry);
  const url = playerSocketUrl(`http://127.0.0.1:${air.remotePort}`, proEntry.url, true);
  const voice = new WebSocket(url);
  t.after(() => voice.terminate());
  assert.equal((await message(voice)).type, 'ready');
  const other = new WebSocket(url);
  t.after(() => other.terminate());
  assert.match((await message(other)).message, /already talking/);
  voice.send(Buffer.from([1, 0, 255, 127]));
  await waitFor(() => proSink.chunks.length === 1);
  assert.deepEqual(proSink.chunks[0], Buffer.from([1, 0, 255, 127]));
  assert.equal(airSink.chunks.length, 0);
  voice.send(JSON.stringify({ type: 'stop' }));
  await waitFor(() => proSink.stopped);
  assert.equal(airSink.stopped, false);
});

it('rejects malformed PCM and stops audio on disconnect', async t => {
  let current = sink();
  const { agent } = await startTestAgent('Mac', new FakeMac(), { voiceOutput: async () => current.output });
  t.after(() => agent.close());
  const url = `ws://127.0.0.1:${agent.remotePort}/voice`;
  const bad = new WebSocket(url);
  t.after(() => bad.terminate());
  await message(bad);
  const error = message(bad);
  bad.send(Buffer.from([1]));
  assert.match((await error).message, /Invalid voice/);
  await waitFor(() => current.stopped);
  current = sink();
  const good = new WebSocket(url);
  await message(good);
  good.close();
  await waitFor(() => current.stopped);
});

it('secure control relay controls only its target and refuses arbitrary proxy targets', async t => {
  const players: PlayerEntry[] = [];
  const { agent: air, mac: airMac } = await startTestAgent('Air', new FakeMac(), { players });
  const { agent: pro, mac: proMac } = await startTestAgent('Pro');
  t.after(async () => { await Promise.all([air.close(), pro.close()]); });
  players.push(playerEntry('pro', pro));
  const socket = new WebSocket(`ws://127.0.0.1:${air.remotePort}/peer?target=${encodeURIComponent(players[0].url)}`);
  t.after(() => socket.terminate());
  assert.equal((await message(socket)).state.name, 'Pro');
  socket.send(JSON.stringify({ type: 'set-volume', volume: 23 }));
  await waitFor(() => proMac.volume === 23);
  assert.equal(airMac.volume, 50);
  const denied = new WebSocket(`ws://127.0.0.1:${air.remotePort}/voice?target=ws://127.0.0.1:9/remote`);
  const [error] = await once(denied, 'error');
  assert.match(error.message, /403/);
});

it('packetizes synthetic microphone samples at 24 kHz without audio feedback', async () => {
  const packets: ArrayBuffer[] = [];
  let Capture: any;
  const code = await readFile(new URL('../src/remote/voice-capture.js', import.meta.url), 'utf8');
  runInNewContext(code, {
    AudioWorkletProcessor: class { port = { postMessage: (packet: ArrayBuffer) => packets.push(packet) }; },
    sampleRate: 48000,
    registerProcessor: (_name: string, constructor: unknown) => { Capture = constructor; },
  });
  const capture = new Capture();
  const samples = new Float32Array(960).fill(2);
  capture.process([[samples]]);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].byteLength, 960);
  assert.equal(new DataView(packets[0]).getInt16(0, true), 32767);
  capture.process([[new Float32Array(960).fill(-2)]]);
  assert.equal(new DataView(packets[1]).getInt16(0, true), -32768);
});
