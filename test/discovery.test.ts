import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { probePlayer, startPlayerDiscovery, tailnetNodes, type TailnetNode } from '../src/agent/discovery.ts';
import { watchPlayers, type PlayerConnection } from '../src/remote/players.ts';
import type { PlayerEntry } from '../src/shared/protocol.ts';
import { FakeSource, SONG, playerEntry, startTestAgent } from './harness.ts';

async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 2500;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Player directory did not reach the expected state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

it('takes candidates only from Tailscale IPv4 addresses, preserving offline peers and DNS aliases', () => {
  const nodes = tailnetNodes({
    Self: { TailscaleIPs: ['fd7a::1', '100.64.0.1'], HostName: 'Office Mac', DNSName: 'office.tail.ts.net.', Online: true },
    Peer: {
      bedroom: { TailscaleIPs: ['100.94.37.34'], DNSName: 'Bedroom.tail.ts.net.', Online: false },
      outside: { TailscaleIPs: ['8.8.8.8', '192.168.1.1'] },
    },
  });
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].address, '100.64.0.1');
  assert.ok(nodes[0].aliases.includes('office.tail.ts.net'));
  assert.ok(nodes[1].aliases.includes('bedroom'));
  assert.equal(nodes[1].online, false);
  assert.equal(tailnetNodes({ Self: { TailscaleIPs: ['100.64.0.1'] } }).length, 1);
  assert.throws(() => tailnetNodes({}));
});

it('recognizes an existing Music Sync agent even with no Source tabs and rejects another WebSocket service', async t => {
  const { agent } = await startTestAgent();
  t.after(() => agent.close());
  assert.equal(await probePlayer(playerEntry('office', agent), 300, new AbortController().signal), true);
  const unrelated = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => unrelated.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => unrelated.close(() => resolve())));
  unrelated.on('connection', socket => socket.send(JSON.stringify({ type: 'state', state: { name: 'Not Music Sync' } })));
  const port = (unrelated.address() as { port: number }).port;
  assert.equal(await probePlayer({ label: 'unrelated', url: `ws://127.0.0.1:${port}/remote` }, 300, new AbortController().signal), false);
});

it('adds a late Player to an already-open Remote without losing connections, and retains it offline', async t => {
  const players: PlayerEntry[] = [];
  const { agent: office } = await startTestAgent('Office Mac', undefined, { players });
  const { agent: bedroom } = await startTestAgent('Bedroom Mac');
  t.after(async () => { await office.close(); await bedroom.close(); });
  await new FakeSource(office, 'spotify', SONG, true).connect();
  const self = playerEntry('office', office);
  let candidates: TailnetNode[] = [];
  const discovery = startPlayerDiscovery({ players, self, candidates: async () => candidates, ports: [bedroom.remotePort], intervalMs: 60_000 });
  t.after(() => discovery.close());
  await discovery.ready;
  let shown: PlayerConnection[] = [];
  const remote = watchPlayers(`http://127.0.0.1:${office.remotePort}`, value => { shown = value; }, { refreshMs: 20, reconnectMs: 20 });
  t.after(() => remote.close());
  await waitFor(() => shown.length === 1 && shown[0].online);
  const connection = shown[0];
  connection.send({ type: 'start-link', link: 'https://example.com' });
  await waitFor(() => !!connection.error);

  candidates = [{ address: '127.0.0.1', aliases: ['127.0.0.1', 'bedroom'], online: true }];
  await discovery.refresh();
  await waitFor(() => shown.length === 2 && shown.every(player => player.online));
  assert.equal(shown[1].state?.name, 'Bedroom Mac');
  assert.strictEqual(shown[0], connection);
  assert.match(connection.error!, /Not a Spotify/);
  assert.equal(players[1].url, playerEntry('bedroom', bedroom).url);

  await bedroom.close();
  candidates[0].online = false;
  await discovery.refresh();
  await waitFor(() => shown.length === 2 && !shown[1].online);
  assert.equal(shown[1].state?.name, 'Bedroom Mac');
  assert.strictEqual(shown[0], connection);
  connection.send({ type: 'command', source: 'spotify', command: { type: 'pause' } });
  await waitFor(() => connection.state?.sources[0]?.playing === false);
});

it('deduplicates configured DNS aliases against discovered addresses', async t => {
  const { agent } = await startTestAgent();
  t.after(() => agent.close());
  const self = { label: 'self', url: 'ws://100.64.0.1:4848/remote' };
  const players = [{ label: 'bedroom', url: `ws://bedroom:${agent.remotePort}/remote` }];
  const discovery = startPlayerDiscovery({
    players, self, ports: [agent.remotePort], intervalMs: 60_000,
    candidates: async () => [{ address: '127.0.0.1', aliases: ['127.0.0.1', 'bedroom'], online: true }],
  });
  t.after(() => discovery.close());
  await discovery.ready;
  assert.equal(players.length, 2);
  assert.equal(players[1].url, playerEntry('bedroom', agent).url);
  assert.equal(players[1].label, `127.0.0.1:${agent.remotePort}`);
});

it('restores known offline Players after restart and preserves them if Tailscale is temporarily unavailable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'music-sync-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cachePath = join(root, 'discovered.json');
  const peer = { label: '100.94.37.34', url: 'ws://100.94.37.34:4848/remote' };
  await writeFile(cachePath, JSON.stringify([peer, { label: 'outside', url: 'ws://8.8.8.8:4848/remote' }]));
  const self = { label: '100.64.0.1', url: 'ws://100.64.0.1:4848/remote' };
  const players: PlayerEntry[] = [];
  const errors: unknown[] = [];
  const discovery = startPlayerDiscovery({ players, self, cachePath, candidates: async () => { throw new Error('Tailscale unavailable'); }, intervalMs: 60_000, onError: error => errors.push(error) });
  await discovery.ready;
  await discovery.refresh();
  assert.deepEqual(players, [self, peer]);
  assert.equal(errors.length, 1);
  await discovery.close();

  const next: PlayerEntry[] = [];
  const restarted = startPlayerDiscovery({ players: next, self, cachePath, intervalMs: 60_000, candidates: async () => [{ address: '100.94.37.34', aliases: ['100.94.37.34', 'bedroom'], online: false }] });
  t.after(() => restarted.close());
  await restarted.ready;
  assert.deepEqual(next, [self, peer]);
  assert.deepEqual(JSON.parse(await readFile(cachePath, 'utf8')), [peer]);
});
