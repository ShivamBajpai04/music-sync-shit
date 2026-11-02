// Two Players with no hub (ADR-0003), driven through the Remote page's own
// connection code.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningAgent } from '../src/agent/agent.ts';
import type { PlayerEntry } from '../src/shared/protocol.ts';
import { watchPlayers, type PlayerConnection } from '../src/remote/players.ts';
import { FakeMac, FakeSource, OTHER_SONG, SONG, playerEntry, startTestAgent } from './harness.ts';

interface Summary {
  label: string;
  online: boolean;
  name: string | undefined;
  title: string | undefined;
}

// Opens the Remote as if loaded from the given agent, recording what it shows.
function openRemote(servedBy: RunningAgent) {
  let latest: PlayerConnection[] = [];
  const watcher = watchPlayers(`http://127.0.0.1:${servedBy.remotePort}`, (players) => (latest = players), {
    reconnectMs: 20,
  });
  const summary = (): Summary[] =>
    latest.map((p) => ({
      label: p.label,
      online: p.online,
      name: p.state?.name,
      title: p.state?.sources[0]?.track?.title,
    }));
  return {
    players: () => latest,
    summary,
    waitFor(predicate: (players: Summary[]) => boolean, timeoutMs = 2000) {
      return new Promise<Summary[]>((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          const current = summary();
          if (current.length && predicate(current)) return resolve(current);
          if (Date.now() - started > timeoutMs) return reject(new Error(`Remote shows ${JSON.stringify(current)}`));
          setTimeout(check, 5);
        };
        check();
      });
    },
    close: () => watcher.close(),
  };
}

describe('two Players', () => {
  const players: PlayerEntry[] = [];
  let office: RunningAgent;
  let bedroom: RunningAgent;
  let bedroomMac: FakeMac;
  let remote: ReturnType<typeof openRemote> | null;

  beforeEach(async () => {
    // Both agents share one list, as both Macs share one config file.
    players.length = 0;
    ({ agent: office } = await startTestAgent('Office Mac', new FakeMac(), { players }));
    ({ agent: bedroom, mac: bedroomMac } = await startTestAgent('Bedroom Mac', new FakeMac(), { players }));
    players.push(playerEntry('office-mac', office), playerEntry('bedroom-mac', bedroom));
    remote = null;
  });

  afterEach(async () => {
    remote?.close();
    await Promise.all([office.close(), bedroom.close()]);
  });

  for (const servedBy of ['office', 'bedroom'] as const) {
    it(`shows both Players when the Remote is served by the ${servedBy} Mac`, async () => {
      await new FakeSource(office, 'spotify', SONG, true).connect();
      await new FakeSource(bedroom, 'youtube-music', OTHER_SONG, false).connect();
      remote = openRemote(servedBy === 'office' ? office : bedroom);
      await remote.waitFor((p) =>
        p[0]?.title === 'Teardrop' && p[1]?.title === 'Angel',
      );
      assert.deepEqual(remote.summary(), [
        { label: 'office-mac', online: true, name: 'Office Mac', title: 'Teardrop' },
        { label: 'bedroom-mac', online: true, name: 'Bedroom Mac', title: 'Angel' },
      ]);
    });
  }

  it('sends each Player\'s commands to that Player only', async () => {
    const officeSpotify = await new FakeSource(office, 'spotify', SONG, true).connect();
    const bedroomSpotify = await new FakeSource(bedroom, 'spotify', OTHER_SONG, true).connect();
    remote = openRemote(office);
    await remote.waitFor((p) => p.every((player) => player.title));

    remote.players()[1].send({ type: 'command', source: 'spotify', command: { type: 'pause' } });
    remote.players()[1].send({ type: 'set-volume', volume: 20 });
    await remote.waitFor(() => remote!.players()[1].state?.volume === 20);
    assert.deepEqual(bedroomSpotify.received, [{ type: 'pause' }]);
    assert.deepEqual(officeSpotify.received, []);
    assert.equal(bedroomMac.volume, 20);
  });

  it('shows a Player as unavailable while its agent is down, leaving the other working', async () => {
    const officeSpotify = await new FakeSource(office, 'spotify', SONG, true).connect();
    remote = openRemote(office);
    await remote.waitFor((p) => p.every((player) => player.online));

    await bedroom.close();
    const shown = await remote.waitFor((p) => !p[1].online);
    assert.deepEqual(shown[0], { label: 'office-mac', online: true, name: 'Office Mac', title: 'Teardrop' });

    remote.players()[0].send({ type: 'command', source: 'spotify', command: { type: 'pause' } });
    await remote.waitFor(() => remote!.players()[0].state?.sources[0]?.playing === false);
    assert.deepEqual(officeSpotify.received, [{ type: 'pause' }]);
  });

  it('brings a Player back when its agent restarts', async () => {
    remote = openRemote(office);
    await remote.waitFor((p) => p.every((player) => player.online));

    const port = bedroom.remotePort;
    await bedroom.close();
    await remote.waitFor((p) => !p[1].online);

    ({ agent: bedroom } = await startTestAgent('Bedroom Mac', new FakeMac(), { players, port }));
    await new FakeSource(bedroom, 'spotify', OTHER_SONG, true).connect();
    await remote.waitFor((p) => p[1].online && p[1].title === 'Angel');
  });

  it('shows a Player that is down when the Remote opens as unavailable, under its label', async () => {
    await bedroom.close();
    remote = openRemote(office);
    const shown = await remote.waitFor((p) => p[0].online);
    assert.deepEqual(shown[1], { label: 'bedroom-mac', online: false, name: undefined, title: undefined });
  });
});
