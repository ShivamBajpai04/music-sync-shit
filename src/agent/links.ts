// Works out which Source a pasted link belongs to, and the web player URL to
// open for it.
import type { SourceId } from '../shared/protocol.ts';

export type ParsedLink = { source: SourceId; url: string } | { error: string };

const SPOTIFY_TYPES = new Set(['track', 'album', 'playlist', 'artist', 'episode', 'show']);
const UNSUPPORTED = 'Not a Spotify or YouTube Music link';

export function parseLink(input: string): ParsedLink {
  const text = input.trim();

  // spotify:track:ID, as copied from the desktop app.
  const uri = /^spotify:([a-z]+):([A-Za-z0-9]+)$/.exec(text);
  if (uri && SPOTIFY_TYPES.has(uri[1])) return spotify(uri[1], uri[2]);

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { error: UNSUPPORTED };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: UNSUPPORTED };
  const host = url.hostname.replace(/^(www|m)\./, '');

  if (host === 'open.spotify.com') {
    // Paths look like /track/ID, or /intl-de/track/ID for localized links.
    const parts = url.pathname.split('/').filter(Boolean).filter((part) => !part.startsWith('intl-'));
    if (parts.length === 2 && SPOTIFY_TYPES.has(parts[0])) return spotify(parts[0], parts[1]);
    return { error: 'Spotify link is not a track, album, playlist, artist or podcast' };
  }
  if (host === 'spotify.link') {
    return { error: 'Short Spotify links aren’t supported; open it and copy the full open.spotify.com link' };
  }

  if (host === 'music.youtube.com' || host === 'youtube.com' || host === 'youtu.be') {
    const video = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
    const list = url.searchParams.get('list');
    const music = new URL('https://music.youtube.com');
    if (video && (host === 'youtu.be' || url.pathname === '/watch')) {
      music.pathname = '/watch';
      music.searchParams.set('v', video);
      if (list) music.searchParams.set('list', list);
    } else if (list && url.pathname === '/playlist') {
      music.pathname = '/playlist';
      music.searchParams.set('list', list);
    } else if (host === 'music.youtube.com' && url.pathname.startsWith('/browse/')) {
      // Albums and artists.
      music.pathname = url.pathname;
    } else {
      return { error: 'YouTube link is not a song, playlist, album or artist' };
    }
    return { source: 'youtube-music', url: music.toString() };
  }

  return { error: UNSUPPORTED };
}

function spotify(type: string, id: string): ParsedLink {
  return { source: 'spotify', url: `https://open.spotify.com/${type}/${id}` };
}
