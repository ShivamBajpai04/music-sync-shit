import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import type { RunningAgent } from '../src/agent/agent.ts';
import { EXTENSION_PATH } from '../src/shared/protocol.ts';
import { FakeRemote, FakeSource, OTHER_SONG, SONG, startTestAgent , first } from './harness.ts';

describe('a single Player', () => {
  let agent: RunningAgent;
  let remote: FakeRemote;

  beforeEach(async () => {
    ({ agent } = await startTestAgent('Office Mac'));
    remote = await new FakeRemote().connect(agent);
  });

  afterEach(async () => {
    remote.close();
    await agent.close();
  });

  it('shows the Player with no Source before any tab connects', async () => {
    const state = await remote.waitFor(() => true);
    assert.deepEqual(state, {
      name: 'Office Mac',
      sources: [],
      volume: 50,
      resume: null,
    });
  });

  it('streams the Source, track and playing state', async () => {
    await new FakeSource(agent, 'spotify', SONG, true).connect();
    const state = await remote.waitFor((s) => first(s)?.source === 'spotify');
    assert.equal(first(state)?.source, 'spotify');
    assert.deepEqual(first(state)?.track, SONG);
    assert.equal(!!first(state)?.playing, true);
  });

  it('sends state to a Remote that connects after the Source', async () => {
    await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    const late = await new FakeRemote().connect(agent);
    const state = await late.waitFor(() => true);
    assert.equal(first(state)?.track?.title, 'Teardrop');
    late.close();
  });

  it('plays and pauses the Source from the Remote', async () => {
    const source = await new FakeSource(agent, 'spotify', SONG, false).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify' && !first(s)?.playing);

    remote.send({ type: 'play' });
    await remote.waitFor((s) => !!first(s)?.playing);

    remote.send({ type: 'pause' });
    await remote.waitFor((s) => first(s)?.source === 'spotify' && !first(s)?.playing);
    assert.deepEqual(source.received, [{ type: 'play' }, { type: 'pause' }]);
  });

  it('reflects changes made on the Mac itself', async () => {
    const source = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.track?.title === 'Teardrop');

    source.setLocally({ track: OTHER_SONG });
    await remote.waitFor((s) => first(s)?.track?.title === 'Angel');

    source.setLocally({ playing: false });
    await remote.waitFor((s) => first(s)?.track?.title === 'Angel' && !first(s)?.playing);
  });

  it('clears the Source when its tab closes', async () => {
    const source = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    source.closeTab();
    await remote.waitFor((s) => first(s) === undefined);
  });

  it('recovers when the extension disconnects and reconnects', async () => {
    const original = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');

    original.disconnect();
    await remote.waitFor((s) => first(s) === undefined);

    const second = await new FakeSource(agent, 'spotify', SONG, true).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');

    remote.send({ type: 'pause' });
    await remote.waitFor((s) => first(s)?.source === 'spotify' && !first(s)?.playing);
    assert.deepEqual(second.received, [{ type: 'pause' }]);
  });

  it('ignores commands when no Source is connected', async () => {
    remote.send({ type: 'play' });
    const source = await new FakeSource(agent, 'spotify', SONG, false).connect();
    await remote.waitFor((s) => first(s)?.source === 'spotify');
    assert.deepEqual(source.received, []);
  });

  it('refuses Source connections that do not come from a browser extension', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${agent.extensionPort}${EXTENSION_PATH}`, {
      origin: 'https://example.com',
    });
    const error = await new Promise<Error>((resolve) => socket.once('error', resolve));
    assert.match(error.message, /403/);
  });
});
