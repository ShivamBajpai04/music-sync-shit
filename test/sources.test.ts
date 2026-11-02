import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningAgent } from '../src/agent/agent.ts';
import type { PlayerState } from '../src/shared/protocol.ts';
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

  const cards = (state: PlayerState) => state.sources.map((card) => [card.source, card.track?.title, card.playing]);

  it('shows a card for each, Spotify first, whichever opened first', async () => {
    await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'youtube-music');
    await new FakeSource(agent, 'spotify', SONG, false).connect();
    const state = await remote.waitFor((s) => s.sources.length === 2);
    assert.deepEqual(cards(state), [
      ['spotify', 'Teardrop', false],
      ['youtube-music', 'Windowlicker', true],
    ]);
  });

  it('keeps a paused Source\'s card so it can be played again', async () => {
    const spotify = await new FakeSource(agent, 'spotify', SONG, true).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    youtube.setLocally({ playing: false });
    let state = await remote.waitFor((s) => s.sources[1]?.playing === false);
    assert.deepEqual(cards(state), [
      ['spotify', 'Teardrop', true],
      ['youtube-music', 'Windowlicker', false],
    ]);

    remote.send({ type: 'play' }, 'youtube-music');
    state = await remote.waitFor((s) => s.sources[1]?.playing === true);
    assert.deepEqual(youtube.received, [{ type: 'play' }]);
    assert.deepEqual(spotify.received, []);
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

  it('leaves out a tab with nothing loaded while the other has a track', async () => {
    await new FakeSource(agent, 'spotify', null).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify' && !first(s)?.track);
    await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    const state = await remote.waitFor((s) => first(s)?.source === 'youtube-music');
    assert.deepEqual(cards(state), [['youtube-music', 'Windowlicker', true]]);
  });

  it('removes a card when its tab closes', async () => {
    await new FakeSource(agent, 'spotify', SONG, false).connect();
    const youtube = await new FakeSource(agent, 'youtube-music', YT_SONG, true).connect();
    await remote.waitFor((s) => s.sources.length === 2);

    youtube.closeTab();
    const state = await remote.waitFor((s) => s.sources.length === 1);
    assert.deepEqual(cards(state), [['spotify', 'Teardrop', false]]);
  });
});
