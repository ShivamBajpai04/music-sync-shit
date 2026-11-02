// Source driver for YouTube Music Web (music.youtube.com). Page selectors live
// here and only here, so a markup change at YouTube only breaks this file.
import { runSourceDriver } from '../source-driver.ts';
import type { Progress, Track } from '../../shared/protocol.ts';

const PLAYER_BAR = 'ytmusic-player-bar';
const PLAY_PAUSE = `${PLAYER_BAR} #play-pause-button`;
const NEXT = `${PLAYER_BAR} .next-button`;
const PREVIOUS = `${PLAYER_BAR} .previous-button`;
const TITLE = `${PLAYER_BAR} .title`;
const BYLINE = `${PLAYER_BAR} .byline`;
const THUMBNAIL = `${PLAYER_BAR} img.image`;
// YouTube Music plays through a regular media element, which is more reliable
// than the player bar for position, duration and playing state.
const VIDEO = 'ytmusic-player video, video.html5-main-video';

function video() {
  return document.querySelector<HTMLVideoElement>(VIDEO);
}

function click(selector: string) {
  document.querySelector<HTMLElement>(selector)?.click();
}

function readTrack(): Track | null {
  const meta = navigator.mediaSession?.metadata;
  if (meta?.title) {
    const art = meta.artwork.at(-1)?.src ?? null;
    return { title: meta.title, artist: meta.artist, artUrl: art };
  }
  const title = document.querySelector(TITLE)?.textContent?.trim();
  if (!title) return null;
  // The byline reads "Artist • Album • Year"; the artist comes first.
  const artist = document.querySelector(BYLINE)?.textContent?.split('•')[0]?.trim() ?? '';
  const art = document.querySelector<HTMLImageElement>(THUMBNAIL)?.src ?? null;
  return { title, artist, artUrl: art };
}

function isPlaying() {
  const media = video();
  return !!media && !media.paused && !media.ended;
}

function readProgress(): Progress | null {
  const media = video();
  if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return null;
  return { positionMs: Math.round(media.currentTime * 1000), durationMs: Math.round(media.duration * 1000) };
}

runSourceDriver({
  source: 'youtube-music',
  read: () => {
    const track = readTrack();
    return { track, playing: !!track && isPlaying(), progress: track ? readProgress() : null };
  },
  run(command) {
    switch (command.type) {
      case 'play':
      case 'pause':
        if (isPlaying() !== (command.type === 'play')) click(PLAY_PAUSE);
        break;
      case 'next':
        click(NEXT);
        break;
      case 'previous':
        click(PREVIOUS);
        break;
      case 'seek': {
        const media = video();
        if (media) media.currentTime = command.positionMs / 1000;
        break;
      }
    }
  },
});
