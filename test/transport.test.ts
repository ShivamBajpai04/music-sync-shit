import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { RunningAgent } from '../src/agent/agent.ts';
import { FakeMac, FakeRemote, FakeSource, OTHER_SONG, SONG, TRACK_LENGTH_MS, startTestAgent } from './harness.ts';

const THIRD_SONG = { title: 'Unfinished Sympathy', artist: 'Massive Attack', artUrl: null };

describe('transport', () => {
  let agent: RunningAgent;
  let mac: FakeMac;
  let remote: FakeRemote;
  let source: FakeSource;

  beforeEach(async () => {
    ({ agent, mac } = await startTestAgent());
    remote = await new FakeRemote().connect(agent);
    source = await new FakeSource(agent, 'spotify', [SONG, OTHER_SONG, THIRD_SONG], true).connect();
    await remote.waitFor((s) => s.track?.title === 'Teardrop');
  });

  afterEach(async () => {
    remote.close();
    await agent.close();
  });

  it('skips to the next track', async () => {
    remote.send({ type: 'next' });
    const state = await remote.waitFor((s) => s.track?.title === 'Angel');
    assert.equal(state.progress?.durationMs, TRACK_LENGTH_MS);
    assert.ok(state.progress!.positionMs < 1_000);
  });

  it('goes back to the previous track near the start of a track', async () => {
    remote.send({ type: 'next' });
    await remote.waitFor((s) => s.track?.title === 'Angel');
    remote.send({ type: 'previous' });
    await remote.waitFor((s) => s.track?.title === 'Teardrop');
  });

  it('restarts the track on previous once it is under way', async () => {
    remote.send({ type: 'next' });
    await remote.waitFor((s) => s.track?.title === 'Angel');
    source.setLocally({ positionMs: 60_000 });
    await remote.waitFor((s) => (s.progress?.positionMs ?? 0) >= 60_000);

    remote.send({ type: 'previous' });
    const state = await remote.waitFor((s) => (s.progress?.positionMs ?? Infinity) < 1_000);
    assert.equal(state.track?.title, 'Angel');
  });

  it('seeks to a position', async () => {
    remote.send({ type: 'seek', positionMs: 90_000 });
    const state = await remote.waitFor((s) => (s.progress?.positionMs ?? 0) >= 90_000);
    assert.ok(state.progress!.positionMs < 91_000);
    assert.deepEqual(source.received, [{ type: 'seek', positionMs: 90_000 }]);
  });

  it('advances the position between reports while playing', async () => {
    source.setLocally({ positionMs: 10_000 });
    await remote.waitFor((s) => (s.progress?.positionMs ?? 0) >= 10_000);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Any later broadcast carries the position as of when it was sent.
    mac.volume = 51;
    const state = await remote.waitFor((s) => s.volume === 51);
    assert.ok(state.progress!.positionMs >= 10_150, `position ${state.progress!.positionMs}`);
  });

  it('holds the position while paused', async () => {
    source.setLocally({ positionMs: 10_000, playing: false });
    await remote.waitFor((s) => !s.playing);
    await new Promise((resolve) => setTimeout(resolve, 100));
    mac.volume = 51;
    const state = await remote.waitFor((s) => s.volume === 51);
    assert.equal(state.progress!.positionMs, 10_000);
  });

  it('never estimates a position past the end of the track', async () => {
    source.setLocally({ positionMs: TRACK_LENGTH_MS - 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    mac.volume = 51;
    const state = await remote.waitFor((s) => s.volume === 51);
    assert.equal(state.progress!.positionMs, TRACK_LENGTH_MS);
  });
});

describe('system volume', () => {
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

  it('shows the Mac volume, even with no Source tab open', async () => {
    const state = await remote.waitFor(() => true);
    assert.equal(state.source, null);
    assert.equal(state.volume, 50);
  });

  it('sets the Mac volume from the Remote', async () => {
    remote.setVolume(30);
    await remote.waitFor((s) => s.volume === 30);
    assert.equal(mac.volume, 30);
  });

  it('clamps and rounds requested volume', async () => {
    remote.setVolume(140);
    await remote.waitFor((s) => s.volume === 100);
    remote.setVolume(-5);
    await remote.waitFor((s) => s.volume === 0);
    remote.setVolume(42.6);
    await remote.waitFor((s) => s.volume === 43);
  });

  it('reflects volume changes made on the Mac itself', async () => {
    mac.volume = 75;
    await remote.waitFor((s) => s.volume === 75);
  });

  it('reports no volume when it cannot be read', async () => {
    mac.failVolume = true;
    await remote.waitFor((s) => s.volume === null);
  });
});
