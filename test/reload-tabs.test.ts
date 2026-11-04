import { it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { reloadTabs } from '../src/extension/reload-tabs.ts';
import { EXTENSION_PATH } from '../src/shared/protocol.ts';
import { FakeRemote, startTestAgent } from './harness.ts';

it('reloads matching tabs through the browser API, including tabs with no content-script port', async () => {
  const queries: string[][] = [];
  const reloaded: number[] = [];
  const tabs = {
    async query({ url }: { url: string[] }) {
      queries.push(url);
      return [{ id: 3 }, { id: 7 }, {}];
    },
    async reload(id: number, options: { bypassCache: boolean }) {
      assert.equal(options.bypassCache, true);
      reloaded.push(id);
    },
  };
  await reloadTabs('spotify', tabs);
  assert.deepEqual(queries[0], ['https://open.spotify.com/*']);
  assert.deepEqual(reloaded, [3, 7]);
  await reloadTabs(undefined, tabs);
  assert.deepEqual(queries[1], ['https://open.spotify.com/*', 'https://music.youtube.com/*']);
});

it('forwards recovery requests even when the extension has no registered Sources', async () => {
  const { agent } = await startTestAgent();
  const extension = new WebSocket(`ws://127.0.0.1:${agent.extensionPort}${EXTENSION_PATH}`, { origin: 'chrome-extension://fake' });
  let remote: FakeRemote | undefined;
  try {
    await once(extension, 'open');
    remote = await new FakeRemote().connect(agent);
    for (const source of ['spotify', undefined] as const) {
      const message = once(extension, 'message');
      remote.reloadTabs(source);
      const [data] = await message;
      assert.deepEqual(JSON.parse(String(data)), source ? { type: 'reload-tabs', source } : { type: 'reload-tabs' });
    }
  } finally {
    remote?.close();
    extension.close();
    await agent.close();
  }
});

it('reports a disconnected extension to the requesting Remote', async () => {
  const { agent } = await startTestAgent();
  const remote = await new FakeRemote().connect(agent);
  try {
    remote.reloadTabs();
    assert.match(await remote.waitForError(), /extension is disconnected/);
  } finally {
    remote.close();
    await agent.close();
  }
});
