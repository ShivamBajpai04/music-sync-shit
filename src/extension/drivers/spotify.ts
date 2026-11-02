// Source driver for Spotify Web (open.spotify.com). Page selectors live here
// and only here, so a markup change at Spotify only breaks this file.
import { runSourceDriver } from '../source-driver.ts';
import type { Track } from '../../shared/protocol.ts';

const PLAY_PAUSE = '[data-testid="control-button-playpause"]';
const NOW_PLAYING = '[data-testid="now-playing-widget"]';
const TITLE = '[data-testid="context-item-info-title"]';
const ARTIST = '[data-testid="context-item-info-artist"]';
const COVER = 'img[data-testid="cover-art-image"]';

function text(root: ParentNode, selector: string) {
  return root.querySelector(selector)?.textContent?.trim() ?? '';
}

function readTrack(): Track | null {
  // Media Session metadata is the most stable source; the DOM is a fallback.
  const meta = navigator.mediaSession?.metadata;
  if (meta?.title) {
    const art = meta.artwork.at(-1)?.src ?? null;
    return { title: meta.title, artist: meta.artist, artUrl: art };
  }
  const widget = document.querySelector(NOW_PLAYING);
  if (!widget) return null;
  const title = text(widget, TITLE);
  if (!title) return null;
  const artists = [...widget.querySelectorAll(ARTIST)].map((a) => a.textContent?.trim()).filter(Boolean);
  const cover = widget.querySelector<HTMLImageElement>(COVER)?.src ?? null;
  return { title, artist: artists.join(', '), artUrl: cover };
}

function isPlaying() {
  const state = navigator.mediaSession?.playbackState;
  if (state === 'playing') return true;
  if (state === 'paused') return false;
  // When Spotify is playing, the button's label is the action it would take.
  return document.querySelector(PLAY_PAUSE)?.getAttribute('aria-label') === 'Pause';
}

runSourceDriver({
  source: 'spotify',
  read: () => ({ track: readTrack(), playing: isPlaying() }),
  run(command) {
    const wantPlaying = command.type === 'play';
    if (isPlaying() === wantPlaying) return;
    document.querySelector<HTMLButtonElement>(PLAY_PAUSE)?.click();
  },
});
