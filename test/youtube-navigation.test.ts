import { it } from 'node:test';
import assert from 'node:assert/strict';
import { navigateYouTube } from '../src/extension/youtube-navigation.ts';

it('routes started links inside YouTube Music without unloading the document', async t => {
  const window = new EventTarget();
  const app = new EventTarget();
  const endpoints: unknown[] = [];
  const location = { hash: '', pathname: '/', search: '' };
  // Any attempt at document navigation would trigger the reported dialog.
  Object.defineProperty(location, 'href', { set() { assert.fail('Document navigation would show Leave site'); } });
  for (const [name, value] of Object.entries({ window, location, document: { querySelector: () => app } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  app.addEventListener('yt-navigate', event => {
    const navigation = event as CustomEvent;
    assert.equal(navigation.bubbles, true);
    assert.equal(navigation.composed, true);
    const { commandMetadata, ...endpoint } = navigation.detail.endpoint;
    if (endpoint.watchPlaylistEndpoint) {
      endpoints.push(endpoint);
      return;
    }
    assert.match(commandMetadata.webCommandMetadata.url, /^\/(watch|playlist|browse)/);
    const destination = new URL(commandMetadata.webCommandMetadata.url, 'https://music.youtube.com');
    location.pathname = destination.pathname;
    location.search = destination.search;
    if (endpoint.browseEndpoint) {
      assert.match(endpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType, /^MUSIC_PAGE_TYPE_/);
      delete endpoint.browseEndpoint.browseEndpointContextSupportedConfigs;
      if (location.pathname.startsWith('/browse/')) {
        location.pathname = '/playlist';
        location.search = '?list=ALBUM_LIST';
      }
    }
    endpoints.push(endpoint);
    // Some page types don't emit a completion event: exercise the URL check.
  });

  assert.equal(await navigateYouTube('https://music.youtube.com/watch?v=song#music-sync-play'), true);
  assert.deepEqual(endpoints.pop(), { watchEndpoint: { videoId: 'song', playlistId: 'RDAMVMsong', startTimeSeconds: 0 } });
  assert.equal(await navigateYouTube('https://music.youtube.com/watch?v=song&list=PL123#music-sync-play=42000'), true);
  assert.deepEqual(endpoints.pop(), { watchEndpoint: { videoId: 'song', playlistId: 'PL123', startTimeSeconds: 42 } });
  assert.equal(await navigateYouTube('https://music.youtube.com/playlist?list=PL123#music-sync-play'), true);
  assert.deepEqual(endpoints.pop(), { watchPlaylistEndpoint: { playlistId: 'PL123' } });
  assert.deepEqual(endpoints.pop(), { browseEndpoint: { browseId: 'VLPL123' } });
  location.search = '?list=ALBUM_LIST';
  assert.equal(await navigateYouTube('https://music.youtube.com/browse/MPREalbum#music-sync-play'), true);
  assert.deepEqual(endpoints.pop(), { watchPlaylistEndpoint: { playlistId: 'ALBUM_LIST' } });
  assert.deepEqual(endpoints.pop(), { browseEndpoint: { browseId: 'MPREalbum' } });
  assert.equal(await navigateYouTube('https://example.com/watch?v=song'), false);
  assert.equal(await navigateYouTube('https://music.youtube.com/unknown'), false);
  assert.deepEqual(endpoints, []);
});
