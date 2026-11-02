import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningAgent } from '../src/agent/agent.ts';
import { FakeMac, FakeRemote, FakeSource, OTHER_SONG, SONG, first, startTestAgent } from './harness.ts';

const YT_SONG = { title: 'Windowlicker', artist: 'Aphex Twin', artUrl: null };

describe('starting a link', () => {
  let agent: RunningAgent;
  let mac: FakeMac;
  let remote: FakeRemote;

  beforeEach(async () => {
    ({ agent, mac } = await startTestAgent());
    remote = await new FakeRemote().connect(agent);
    await remote.waitFor(() => true);
  });

  afterEach(async () => {
    remote.close();
    await agent.close();
  });

  it('opens Arc on the link when no tab for its Source is open', async () => {
    mac.onOpen = () => void new FakeSource(agent, 'spotify', SONG, true).connect();
    remote.startLink('https://open.spotify.com/track/4Q3N8?si=abc123');
    await remote.waitFor((s) => first(s)?.source === 'spotify' && !!first(s)?.playing);
    assert.deepEqual(mac.opened, ['https://open.spotify.com/track/4Q3N8#music-sync-play']);
  });

  it('reuses the open tab for the link\'s Source instead of opening another', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, false).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');

    remote.startLink('https://open.spotify.com/album/1bt6q?si=xyz');
    await remote.waitFor((s) => !!first(s)?.playing);
    assert.deepEqual(spotify.navigatedTo, ['https://open.spotify.com/album/1bt6q#music-sync-play']);
    assert.deepEqual(mac.opened, []);
  });

  it('picks the Source from the link', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, false).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, false).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    remote.startLink('https://music.youtube.com/watch?v=UBS4Gi1y_nc&list=RDAMVM&si=q');
    await remote.waitFor((s) => !!s.sources.find((card) => card.source === 'youtube-music')?.playing);
    assert.deepEqual(youtube.navigatedTo, ['https://music.youtube.com/watch?v=UBS4Gi1y_nc&list=RDAMVM#music-sync-play']);
    assert.deepEqual(spotify.navigatedTo, []);
  });

  it('pauses the other Source if it is playing, without closing it', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, false).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    remote.startLink('https://youtu.be/UBS4Gi1y_nc');
    const state = await remote.waitFor((s) => !s.sources[0]?.playing && !!s.sources[1]?.playing);
    assert.deepEqual(
      state.sources.map((card) => [card.source, card.playing]),
      [
        ['spotify', false],
        ['youtube-music', true],
      ],
    );
    assert.deepEqual(spotify.received, [{ type: 'pause' }]);
    assert.deepEqual(youtube.navigatedTo, ['https://music.youtube.com/watch?v=UBS4Gi1y_nc#music-sync-play']);
  });

  it('leaves the Source alone when starting another link on it', async () => {
    const spotify = await new FakeSource(agent, 'spotify', [SONG, OTHER_SONG], true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    remote.startLink('spotify:playlist:37i9dQ');
    await remote.waitFor(() => spotify.navigatedTo.length === 1);
    assert.deepEqual(spotify.received, []);
    assert.deepEqual(spotify.navigatedTo, ['https://open.spotify.com/playlist/37i9dQ#music-sync-play']);
  });

  for (const [link, expected] of [
    ['spotify:track:4Q3N8', 'https://open.spotify.com/track/4Q3N8'],
    ['https://open.spotify.com/intl-de/artist/0OdUW', 'https://open.spotify.com/artist/0OdUW'],
    ['  https://open.spotify.com/episode/7makk  ', 'https://open.spotify.com/episode/7makk'],
    ['https://www.youtube.com/watch?v=UBS4Gi1y_nc&t=42', 'https://music.youtube.com/watch?v=UBS4Gi1y_nc'],
    ['https://music.youtube.com/playlist?list=PL123&si=x', 'https://music.youtube.com/playlist?list=PL123'],
    ['https://music.youtube.com/browse/MPREb_abc', 'https://music.youtube.com/browse/MPREb_abc'],
  ]) {
    it(`opens ${link.trim()} as ${expected}`, async () => {
      remote.startLink(link);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.deepEqual(mac.opened, [`${expected}#music-sync-play`]);
    });
  }

  for (const [link, message] of [
    ['https://example.com/song', /Not a Spotify or YouTube Music link/],
    ['not a link', /Not a Spotify or YouTube Music link/],
    ['https://open.spotify.com/search/teardrop', /Spotify link is not a track/],
    ['https://spotify.link/AbCdEf', /Short Spotify links/],
    ['https://music.youtube.com/', /YouTube link is not a song/],
  ] as const) {
    it(`rejects ${link} with an error to the requesting Remote only`, async () => {
      const bystander = await new FakeRemote().connect(agent);
      remote.startLink(link);
      assert.match(await remote.waitForError(), message);
      assert.deepEqual(mac.opened, []);
      assert.deepEqual(bystander.errors, []);
      bystander.close();
    });
  }

  it('reports an error if Arc cannot be opened', async () => {
    mac.failOpen = true;
    remote.startLink('https://open.spotify.com/track/4Q3N8');
    assert.match(await remote.waitForError(), /Couldn’t open Arc/);
  });
});
