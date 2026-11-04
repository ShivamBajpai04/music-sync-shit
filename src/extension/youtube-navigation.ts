// Serialized by chrome.scripting.executeScript into the page's MAIN world.
// Keep this function self-contained: it cannot close over module imports.
export async function navigateYouTube(url: string): Promise<boolean> {
  const target = new URL(url);
  if (target.origin !== 'https://music.youtube.com') return false;
  const app = document.querySelector('ytmusic-app');
  if (!app) return false;
  const videoId = target.searchParams.get('v');
  const list = target.searchParams.get('list');
  const browseId = target.pathname.startsWith('/browse/') ? target.pathname.slice('/browse/'.length) : null;
  const position = /^#music-sync-play(?:=(\d+))?$/.exec(target.hash);
  const endpoint = target.pathname === '/watch' && videoId
    ? { watchEndpoint: { videoId, playlistId: list ?? `RDAMVM${videoId}`, startTimeSeconds: Number(position?.[1] ?? 0) / 1000 } }
    : target.pathname === '/playlist' && list
      ? { browseEndpoint: { browseId: `VL${list}` } }
      : browseId ? { browseEndpoint: { browseId } } : null;
  if (!endpoint) return false;
  if (endpoint.browseEndpoint) {
    Object.assign(endpoint.browseEndpoint, {
      browseEndpointContextSupportedConfigs: {
        browseEndpointContextMusicConfig: {
          pageType: list ? 'MUSIC_PAGE_TYPE_PLAYLIST' : browseId?.startsWith('UC') ? 'MUSIC_PAGE_TYPE_ARTIST' : 'MUSIC_PAGE_TYPE_ALBUM',
        },
      },
    });
  }
  Object.assign(endpoint, { commandMetadata: { webCommandMetadata: { url: target.pathname + target.search } } });

  return new Promise<boolean>(resolve => {
    const finish = () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('yt-navigate-finish', finish);
      window.removeEventListener('ytmusic-navigate-finish', finish);
      // Album pages resolve to a playlist URL. Ask the page to play that
      // list directly instead of depending on a start-on-load hash surviving
      // the app's own redirects.
      if (!videoId && position) {
        const playlistId = list ?? new URLSearchParams(location.search).get('list');
        if (playlistId) {
          app.dispatchEvent(new CustomEvent('yt-navigate', {
            detail: { endpoint: { watchPlaylistEndpoint: { playlistId } } },
            bubbles: true, composed: true,
          }));
        } else location.hash = target.hash;
      }
      resolve(true);
    };
    const timer = setTimeout(() => {
      clearInterval(poll);
      window.removeEventListener('yt-navigate-finish', finish);
      window.removeEventListener('ytmusic-navigate-finish', finish);
      resolve(false);
    }, 15_000);
    // Music's route-completion events differ between page types. Check the
    // actual URL too, including the album-to-playlist redirect.
    const poll = setInterval(() => {
      const current = new URLSearchParams(location.search);
      const reached = videoId ? location.pathname === '/watch' && current.get('v') === videoId
        : list ? location.pathname === '/playlist' && current.get('list') === list
        : location.pathname === target.pathname || (location.pathname === '/playlist' && !!current.get('list'));
      if (reached) finish();
    }, 100);
    window.addEventListener('yt-navigate-finish', finish);
    window.addEventListener('ytmusic-navigate-finish', finish);
    app.dispatchEvent(new CustomEvent('yt-navigate', {
      detail: { endpoint }, bubbles: true, composed: true,
    }));
  });
}
