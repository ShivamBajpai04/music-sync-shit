import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunningAgent } from '../src/agent/agent.ts';
import { FakeMac, FakeRemote, FakeSource, OTHER_SONG, SONG, first, startTestAgent } from './harness.ts';

const YT_SONG = { title: 'Windowlicker', artist: 'Aphex Twin', artUrl: null };

describe('Resume', () => {
  let directory: string;
  let lastPlaybackPath: string;
  let agent: RunningAgent;
  let mac: FakeMac;
  let remote: FakeRemote;

  async function start() {
    ({ agent, mac } = await startTestAgent('Office Mac', new FakeMac(), { lastPlaybackPath }));
    remote = await new FakeRemote().connect(agent);
    await remote.waitFor(() => true);
  }

  async function restart() {
    remote.close();
    await agent.close();
    await start();
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'music-sync-'));
    lastPlaybackPath = join(directory, 'last-playback.json');
    await start();
  });

  afterEach(async () => {
    remote.close();
    await agent.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('is unavailable with nothing remembered and no tab, and does nothing', async () => {
    assert.equal(remote.latest?.resume, null);
    remote.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(mac.opened, []);
  });

  it('unpauses a loaded tab', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, false).connect();
    const state = await remote.waitFor((s) => s.resume !== null);
    assert.deepEqual(state.resume, { source: 'spotify', track: SONG });

    remote.resume();
    await remote.waitFor((s) => !!first(s)?.playing);
    assert.deepEqual(spotify.received, [{ type: 'play' }]);
    assert.deepEqual(mac.opened, []);
  });

  it('is unavailable while the remembered Source is playing', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => !!first(s)?.playing && s.resume === null);
    spotify.setLocally({ playing: false });
    await remote.waitFor((s) => s.resume?.track.title === 'Teardrop');
  });

  it('reopens the remembered track where it got to once its tab is gone', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, false).connect();
    spotify.setLocally({ positionMs: 60_000 });
    await remote.waitFor((s) => (first(s)?.progress?.positionMs ?? 0) >= 60_000);
    spotify.closeTab();
    const state = await remote.waitFor((s) => s.sources.length === 0);
    assert.deepEqual(state.resume, { source: 'spotify', track: SONG });

    remote.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(mac.opened, ['https://open.spotify.com/track/teardrop#music-sync-play=60000']);
  });

  it('seeks after a reopened Source reports the remembered track', async () => {
    const original = await new FakeSource(agent, 'spotify', SONG, false).connect();
    original.setLocally({ positionMs: 60_000 });
    await remote.waitFor((s) => (first(s)?.progress?.positionMs ?? 0) >= 60_000);
    original.closeTab();
    await remote.waitFor((s) => s.sources.length === 0);

    let reopened: FakeSource;
    mac.onOpen = () => { void (reopened = new FakeSource(agent, 'spotify', SONG, true)).connect(); };
    remote.resume();
    const state = await remote.waitFor((s) => (first(s)?.progress?.positionMs ?? 0) >= 60_000);
    assert.equal(first(state)?.track?.title, SONG.title);
    assert.deepEqual(reopened!.received, [{ type: 'seek', positionMs: 60_000 }]);
  });

  it('remembers how far a playing track got when its tab closed', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    spotify.setLocally({ positionMs: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    spotify.closeTab();
    await remote.waitFor((s) => s.sources.length === 0);

    remote.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const position = Number(mac.opened[0]?.split('=')[1]);
    assert.ok(position >= 30_100 && position < 31_000, `resumed at ${position}`);
  });

  it('survives an agent restart', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    spotify.setLocally({ positionMs: 90_000, playing: false });
    await remote.waitFor((s) => s.resume !== null);
    await restart();

    assert.deepEqual(remote.latest?.resume, { source: 'spotify', track: SONG });
    remote.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(mac.opened, ['https://open.spotify.com/track/teardrop#music-sync-play=90000']);
  });

  it('remembers a YouTube playlist and reopens the track within it after restart', async () => {
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    youtube.setLocally({ context: 'https://music.youtube.com/playlist?list=PL123', positionMs: 45_000, playing: false });
    await remote.waitFor((s) => s.resume?.source === 'youtube-music');
    await restart();

    const saved = JSON.parse(await readFile(lastPlaybackPath, 'utf8'));
    assert.equal(saved.context, 'https://music.youtube.com/playlist?list=PL123');
    remote.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(mac.opened, ['https://music.youtube.com/watch?v=windowlicker&list=PL123#music-sync-play=45000']);
  });

  for (const kind of ['playlist', 'album']) {
    it(`restores a Spotify ${kind} context after restart`, async () => {
      const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
      const context = `https://open.spotify.com/${kind}/37i9dQ`;
      spotify.setLocally({ context, positionMs: 45_000, playing: false });
      await remote.waitFor((s) => s.resume?.source === 'spotify');
      await restart();

      const saved = JSON.parse(await readFile(lastPlaybackPath, 'utf8'));
      assert.equal(saved.context, context);
      remote.resume();
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(mac.opened, [`https://open.spotify.com/track/teardrop?context=spotify%3A${kind}%3A37i9dQ#music-sync-play=45000`]);
    });
  }

  it('reopens the remembered song when its Source tab has a different song loaded', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, false).connect();
    await remote.waitFor((s) => s.resume?.track.title === SONG.title);
    spotify.disconnect();
    await remote.waitFor((s) => s.sources.length === 0);
    const replacement = await new FakeSource(agent, 'spotify', OTHER_SONG, false).connect();
    await remote.waitFor((s) => first(s)?.track?.title === OTHER_SONG.title);

    remote.resume();
    await remote.waitFor(() => replacement.navigatedTo.length === 1);
    assert.equal(replacement.navigatedTo[0], 'https://open.spotify.com/track/teardrop#music-sync-play');
  });

  it('saves the position now and then while playing, in case the agent stops', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    spotify.setLocally({ positionMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await restart();

    remote.resume();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const position = Number(mac.opened[0]?.split('=')[1]);
    assert.ok(position >= 10_100, `resumed at ${position}`);
  });

  it('follows whichever Source played last', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, false).connect();
    spotify.setLocally({ playing: false });
    youtube.setLocally({ playing: true });
    youtube.setLocally({ playing: false });
    await remote.waitFor((s) => s.resume?.source === 'youtube-music');

    // Changes on the paused Spotify tab don't take Resume back.
    spotify.setLocally({ track: OTHER_SONG });
    const state = await remote.waitFor((s) => s.sources[0]?.track?.title === 'Angel');
    assert.deepEqual(state.resume, { source: 'youtube-music', track: YT_SONG });
  });

  it('sends the remembered Source\'s tab back to the track if it has nothing loaded', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => !!first(s)?.playing);
    spotify.setLocally({ track: null, playing: false });
    await remote.waitFor((s) => s.resume !== null && !first(s)?.track);

    remote.resume();
    await remote.waitFor(() => spotify.navigatedTo.length === 1);
    assert.match(spotify.navigatedTo[0], /^https:\/\/open\.spotify\.com\/track\/teardrop#music-sync-play/);
    assert.deepEqual(mac.opened, []);
  });

  it('starts with nothing remembered if the saved file is unreadable', async () => {
    remote.close();
    await agent.close();
    await writeFile(lastPlaybackPath, '{ not json');
    await start();
    assert.equal(remote.latest?.resume, null);
  });
});
