import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningAgent } from '../src/agent/agent.ts';
import { FakeRemote, FakeSource, OTHER_SONG, SONG, startTestAgent , first } from './harness.ts';

const YT_SONG = { title: 'Windowlicker', artist: 'Aphex Twin', artUrl: 'https://lh3.googleusercontent.com/w' };
const YT_NEXT = { title: 'Xtal', artist: 'Aphex Twin', artUrl: null };

describe('YouTube Music Web as a Source', () => {
  let agent: RunningAgent;
  let remote: FakeRemote;

  beforeEach(async () => {
    ({ agent } = await startTestAgent());
    remote = await new FakeRemote().connect(agent);
  });

  afterEach(async () => {
    remote.close();
    await agent.close();
  });

  it('controls YouTube Music the same way as Spotify', async () => {
    const youtube = await new FakeSource(agent, 'youtube-music', [YT_SONG, YT_NEXT], false).connect();
    await remote.waitFor((s) => first(s)?.source === 'youtube-music' && first(s)?.track?.title === 'Windowlicker');

    remote.send({ type: 'play' });
    await remote.waitFor((s) => !!first(s)?.playing);
    remote.send({ type: 'next' });
    await remote.waitFor((s) => first(s)?.track?.title === 'Xtal');
    remote.send({ type: 'seek', positionMs: 30_000 });
    await remote.waitFor((s) => (first(s)?.progress?.positionMs ?? 0) >= 30_000);
    remote.send({ type: 'pause' });
    await remote.waitFor((s) => first(s)?.track?.title === 'Xtal' && !first(s)?.playing);

    assert.deepEqual(
      youtube.received.map((c) => c.type),
      ['play', 'next', 'seek', 'pause'],
    );
  });
});

describe('with both Source tabs open', () => {
  let agent: RunningAgent;
  let remote: FakeRemote;

  beforeEach(async () => {
    ({ agent } = await startTestAgent());
    remote = await new FakeRemote().connect(agent);
  });

  afterEach(async () => {
    remote.close();
    await agent.close();
  });

  it('keeps showing the playing Source when the paused one changes', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, false).connect();
    youtube.setLocally({ track: YT_NEXT });
    // Give the agent time to (wrongly) switch before checking.
    spotify.setLocally({ track: OTHER_SONG });
    const state = await remote.waitFor((s) => first(s)?.track?.title === 'Angel');
    assert.equal(first(state)?.source, 'spotify');
  });

  it('switches to a Source when it starts playing', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, false).connect();

    spotify.setLocally({ playing: false });
    youtube.setLocally({ playing: true });
    await remote.waitFor((s) => first(s)?.source === 'youtube-music' && !!first(s)?.playing);

    remote.send({ type: 'pause' });
    await remote.waitFor((s) => first(s)?.source === 'youtube-music' && !first(s)?.playing);
    assert.deepEqual(youtube.received, [{ type: 'pause' }]);
    assert.deepEqual(spotify.received, []);
  });

  it('switches to a newly opened tab when the current Source is paused', async () => {
    await new FakeSource(agent, 'spotify', SONG, false).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    await new FakeSource(agent, 'youtube-music', YT_SONG, false).connect();
    await remote.waitFor((s) => first(s)?.source === 'youtube-music');
  });

  it('shows a card for each Source while both are playing, Spotify first', async () => {
    await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'youtube-music');
    await new FakeSource(agent, 'spotify', SONG, true).connect();
    const state = await remote.waitFor((s) => s.sources.length === 2);
    assert.deepEqual(
      state.sources.map((card) => [card.source, card.track?.title, card.playing]),
      [
        ['spotify', 'Teardrop', true],
        ['youtube-music', 'Windowlicker', true],
      ],
    );
  });

  it('sends each card\'s commands to its own Source', async () => {
    const spotify = await new FakeSource(agent, 'spotify', [SONG, OTHER_SONG], true).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', [YT_SONG, YT_NEXT], true).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    remote.send({ type: 'next' }, 'youtube-music');
    await remote.waitFor((s) => s.sources[1]?.track?.title === 'Xtal');
    remote.send({ type: 'next' }, 'spotify');
    const state = await remote.waitFor((s) => s.sources[0]?.track?.title === 'Angel');
    assert.equal(state.sources[1]?.track?.title, 'Xtal');
    assert.deepEqual(spotify.received, [{ type: 'next' }]);
    assert.deepEqual(youtube.received, [{ type: 'next' }]);
  });

  it('goes back to one card, for the Source still playing, when either pauses', async () => {
    await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    // YouTube Music started last, but Spotify is the one still playing.
    youtube.setLocally({ playing: false });
    const state = await remote.waitFor((s) => s.sources.length === 1);
    assert.equal(first(state)?.source, 'spotify');
  });

  it('keeps the last Source playing on its card once both are paused', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    youtube.setLocally({ playing: false });
    await remote.waitFor((s) => s.sources.length === 1);
    spotify.setLocally({ playing: false });
    const state = await remote.waitFor((s) => s.sources.length === 1 && !first(s)?.playing);
    assert.equal(first(state)?.source, 'spotify');
  });

  it('falls back to the other Source when the shown tab closes', async () => {
    await new FakeSource(agent, 'spotify', SONG, false).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'youtube-music');

    youtube.closeTab();
    const state = await remote.waitFor((s) => first(s)?.source === 'spotify');
    assert.equal(first(state)?.track?.title, 'Teardrop');
  });
});
