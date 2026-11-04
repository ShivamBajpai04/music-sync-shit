import { startHash, type Playback } from '../shared/protocol.ts';

// Resume and Handoff reopen the same Source, preserving its Playback Context.
export function playbackUrl(playback: Playback) {
  const url = new URL(playback.link);
  if (playback.source === 'youtube-music' && playback.context) {
    const context = new URL(playback.context);
    const list = context.searchParams.get('list');
    if (context.hostname === 'music.youtube.com' && list) url.searchParams.set('list', list);
  } else if (playback.source === 'spotify' && playback.context) {
    const context = new URL(playback.context);
    const match = /^\/(playlist|album)\/([A-Za-z0-9]+)$/.exec(context.pathname);
    if (context.hostname === 'open.spotify.com' && match) {
      url.searchParams.set('context', `spotify:${match[1]}:${match[2]}`);
    }
  }
  return `${url}${startHash(playback.progress?.positionMs)}`;
}
