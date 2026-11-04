import type { SourceId } from '../shared/protocol.ts';

const SOURCE_URLS: Record<SourceId, string> = {
  spotify: 'https://open.spotify.com/*',
  'youtube-music': 'https://music.youtube.com/*',
};

interface TabsAPI {
  query(query: { url: string[] }): Promise<{ id?: number }[]>;
  reload(tabId: number, options: { bypassCache: boolean }): Promise<void>;
}

// Query the browser, rather than the content-script ports: a hung page may
// have stopped reporting state or lost its port altogether.
export async function reloadTabs(source: SourceId | undefined, tabs: TabsAPI) {
  const urls = source ? SOURCE_URLS[source] && [SOURCE_URLS[source]] : Object.values(SOURCE_URLS);
  if (!urls) return;
  const matches = await tabs.query({ url: urls });
  await Promise.all(matches.flatMap(tab => tab.id === undefined ? [] : [tabs.reload(tab.id, { bypassCache: true })]));
}
