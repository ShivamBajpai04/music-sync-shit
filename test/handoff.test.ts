import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningAgent } from '../src/agent/agent.ts';
import type { PlayerEntry, SourceId } from '../src/shared/protocol.ts';
import { handoffTargets, watchPlayers, type PlayerConnection } from '../src/remote/players.ts';
import { FakeMac, FakeRemote, FakeSource, OTHER_SONG, SONG, playerEntry, startTestAgent } from './harness.ts';

describe('Handoff between Players', () => {
  let office: RunningAgent;
  let bedroom: RunningAgent;
  let bedroomMac: FakeMac;
  let remote: FakeRemote;
  let targetRemote: FakeRemote;
  const players: PlayerEntry[] = [];

  beforeEach(async () => {
    players.length = 0;
    ({ agent: office } = await startTestAgent('Office Mac', new FakeMac(), { players, handoffTimeoutMs: 250 }));
    ({ agent: bedroom, mac: bedroomMac } = await startTestAgent('Bedroom Mac', new FakeMac(), { players, handoffTimeoutMs: 200 }));
    players.push(playerEntry('office-mac', office), playerEntry('bedroom-mac', bedroom));
    remote = await new FakeRemote().connect(office);
    targetRemote = await new FakeRemote().connect(bedroom);
  });

  afterEach(async () => {
    remote.close();
    targetRemote.close();
    await Promise.all([office.close(), bedroom.close()]);
  });

  async function original(source: SourceId, context: string | null = null) {
    const tab = await new FakeSource(office, source, SONG, true).connect();
    tab.setLocally({ context, positionMs: 45_000 });
    await remote.waitFor(state => state.sources[0]?.context === context && (state.sources[0]?.progress?.positionMs ?? 0) >= 45_000);
    return tab;
  }

  async function target(source: SourceId) {
    const tab = new FakeSource(bedroom, source, [OTHER_SONG, SONG], false);
    tab.simulateNavigation = true;
    await tab.connect();
    await targetRemote.waitFor(state => state.sources.some(card => card.source === source && card.track?.title === OTHER_SONG.title));
    return tab;
  }

  for (const [source, context] of [
    ['spotify', 'https://open.spotify.com/playlist/PL123'],
    ['spotify', 'https://open.spotify.com/album/AL123'],
    ['youtube-music', 'https://music.youtube.com/playlist?list=PL123'],
    ['youtube-music', null],
  ] as const) {
    it(`moves ${source} track, position and ${context ?? 'no context'} before pausing the original`, async () => {
      const sourceTab = await original(source, context);
      const targetTab = await target(source);
      let checkedOrder = false;
      sourceTab.onCommand = command => {
        if (command.type !== 'pause') return;
        assert.equal(targetTab.playing, true);
        assert.equal(targetTab.track?.title, SONG.title);
        assert.ok((targetTab.progress?.positionMs ?? 0) >= 45_000);
        checkedOrder = true;
      };
      remote.handoff(source, 'bedroom-mac');
      await remote.waitFor(state => !state.handoff && state.sources[0]?.playing === false);
      const moved = await targetRemote.waitFor(state => state.sources[0]?.track?.title === SONG.title && state.sources[0]?.playing === true);
      assert.equal(moved.sources[0].source, source);
      assert.equal(moved.sources[0].context, context);
      assert.ok(moved.sources[0].progress!.positionMs >= 45_000 && moved.sources[0].progress!.positionMs < 47_000);
      assert.equal(checkedOrder, true);
      assert.deepEqual(remote.errors, []);
    });
  }

  it('restores context when the target already has the same track in another context', async () => {
    await original('spotify', 'https://open.spotify.com/album/AL123');
    const tab = await new FakeSource(bedroom, 'spotify', SONG, false).connect();
    tab.simulateNavigation = true;
    await targetRemote.waitFor(state => !!state.sources.length);
    remote.handoff('spotify', 'bedroom-mac');
    await remote.waitFor(state => !state.handoff && !state.sources[0]?.playing);
    assert.match(tab.navigatedTo[0], /context=spotify%3Aalbum%3AAL123/);
    assert.deepEqual(remote.errors, []);
  });

  it('reuses the target’s loaded track and seeks before confirming playback', async () => {
    await original('spotify');
    const tab = await new FakeSource(bedroom, 'spotify', SONG, false).connect();
    await targetRemote.waitFor(state => !!state.sources.length);
    remote.handoff('spotify', 'bedroom-mac');
    await remote.waitFor(state => !state.handoff && !state.sources[0]?.playing);
    const state = await targetRemote.waitFor(state => state.sources[0]?.playing === true);
    assert.ok(state.sources[0].progress!.positionMs >= 45_000);
    assert.deepEqual(tab.navigatedTo, []);
    assert.deepEqual(bedroomMac.opened, []);
    assert.deepEqual(remote.errors, []);
  });

  it('opens Arc on the target if its Source tab is missing', async () => {
    await original('youtube-music', 'https://music.youtube.com/playlist?list=PL123');
    bedroomMac.onOpen = url => {
      const tab = new FakeSource(bedroom, 'youtube-music', SONG, true);
      tab.loadStartedLink(url);
      void tab.connect();
    };
    remote.handoff('youtube-music', 'bedroom-mac');
    await remote.waitFor(state => !state.handoff && !state.sources[0]?.playing);
    assert.equal(bedroomMac.opened.length, 1);
    assert.match(bedroomMac.opened[0], /list=PL123#music-sync-play=45\d+/);
    assert.equal(targetRemote.latest?.sources[0].source, 'youtube-music');
    assert.deepEqual(remote.errors, []);
  });

  it('pauses the target’s other Source without closing its tab', async () => {
    const sourceTab = await original('youtube-music');
    const spotify = await new FakeSource(bedroom, 'spotify', OTHER_SONG, true).connect();
    await target('youtube-music');
    sourceTab.onCommand = command => {
      if (command.type === 'pause') assert.equal(spotify.playing, false);
    };
    remote.handoff('youtube-music', 'bedroom-mac');
    await remote.waitFor(state => !state.handoff && !state.sources[0]?.playing);
    const state = await targetRemote.waitFor(state => state.sources.length === 2 && state.sources[1].playing);
    assert.equal(state.sources[0].playing, false);
    assert.equal(state.sources[0].track?.title, OTHER_SONG.title);
    assert.deepEqual(spotify.received, [{ type: 'pause' }]);
    assert.deepEqual(remote.errors, []);
  });

  it('accepts Spotify automatically pausing the original while the target starts', async () => {
    const source = await original('spotify');
    const peer = await target('spotify');
    peer.onNavigate = () => source.setLocally({ playing: false });
    remote.handoff('spotify', 'bedroom-mac');
    await remote.waitFor(state => !state.handoff && !state.sources[0]?.playing);
    await targetRemote.waitFor(state => state.sources[0]?.track?.title === SONG.title && state.sources[0].playing);
    assert.equal(source.received.some(command => command.type === 'pause'), false);
    assert.deepEqual(remote.errors, []);
  });

  it('keeps the original playing if the target cannot open Arc', async () => {
    await original('spotify');
    bedroomMac.failOpen = true;
    remote.handoff('spotify', 'bedroom-mac');
    const error = await remote.waitForError();
    assert.match(error, /Office Mac: playing/);
    assert.match(error, /Bedroom Mac: playback unknown/);
    assert.equal(remote.latest?.sources[0].playing, true);
  });

  it('does not confuse the target’s initial playing state with confirmation at the requested position', async () => {
    await original('spotify');
    const peer = await new FakeSource(bedroom, 'spotify', SONG, true).connect();
    peer.ignoreCommands.add('seek');
    peer.setLocally({ positionMs: 100_000 });
    await targetRemote.waitFor(state => (state.sources[0]?.progress?.positionMs ?? 0) >= 100_000);
    remote.handoff('spotify', 'bedroom-mac');
    const error = await remote.waitForError();
    assert.match(error, /did not confirm/);
    assert.match(error, /Office Mac: playing/);
    assert.match(error, /Bedroom Mac: playing/);
    assert.equal(remote.latest?.sources[0].playing, true);
  });

  it('reports both Players when the target starts but the original refuses to pause', async () => {
    const source = await original('youtube-music');
    source.ignoreCommands.add('pause');
    await target('youtube-music');
    remote.handoff('youtube-music', 'bedroom-mac');
    const error = await remote.waitForError();
    assert.match(error, /target started.*original did not confirm pausing/);
    assert.match(error, /Office Mac: playing/);
    assert.match(error, /Bedroom Mac: playing/);
  });

  it('reports an offline target and leaves the original playing', async () => {
    await original('spotify');
    await bedroom.close();
    remote.handoff('spotify', 'bedroom-mac');
    const error = await remote.waitForError();
    assert.match(error, /target could not be reached/);
    assert.match(error, /Office Mac: playing/);
    assert.match(error, /bedroom-mac: playback unknown/);
    assert.equal(remote.latest?.sources[0].playing, true);
  });

  it('reports target playback as unknown if its agent disconnects during Handoff', async () => {
    await original('youtube-music');
    const peer = await target('youtube-music');
    peer.onNavigate = () => { void bedroom.close(); };
    remote.handoff('youtube-music', 'bedroom-mac');
    const error = await remote.waitForError();
    assert.match(error, /disconnected before confirming/);
    assert.match(error, /Office Mac: playing/);
    assert.match(error, /bedroom-mac: playback unknown/);
  });

  it('does not pause a different track selected on the original while the target starts', async () => {
    const source = await original('youtube-music');
    const peer = await target('youtube-music');
    peer.onNavigate = () => source.setLocally({ track: OTHER_SONG });
    remote.handoff('youtube-music', 'bedroom-mac');
    const error = await remote.waitForError();
    assert.match(error, /original Source disconnected or changed tracks/);
    assert.match(error, /Office Mac: playing “Angel”/);
    assert.match(error, /Bedroom Mac: playing “Teardrop”/);
    assert.equal(source.received.some(command => command.type === 'pause'), false);
  });

  it('makes the Remote’s Handoff target unavailable when its peer is offline', async () => {
    let latest: PlayerConnection[] = [];
    const watcher = watchPlayers(`http://127.0.0.1:${office.remotePort}`, value => { latest = value; }, { reconnectMs: 20 });
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 2000;
      while (!condition()) {
        if (Date.now() > deadline) assert.fail('Remote availability did not update');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    };
    try {
      await wait(() => latest.length === 2 && latest.every(player => player.online));
      assert.equal(handoffTargets(latest[0], latest)[0].available, true);
      await bedroom.close();
      await wait(() => !latest[1].online);
      assert.equal(handoffTargets(latest[0], latest)[0].available, false);
      assert.equal(handoffTargets(latest[0], latest)[0].name, 'Bedroom Mac');
    } finally { watcher.close(); }
  });
});
