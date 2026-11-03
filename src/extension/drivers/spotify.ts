// Source driver for Spotify Web (open.spotify.com). Page selectors live here
// and only here, so a markup change at Spotify only breaks this file.
import { runSourceDriver } from '../source-driver.ts';
import type { Progress, Track } from '../../shared/protocol.ts';

const PLAY_PAUSE = '[data-testid="control-button-playpause"]';
const NEXT = '[data-testid="control-button-skip-forward"]';
const PREVIOUS = '[data-testid="control-button-skip-back"]';
const NOW_PLAYING = '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]';
const TITLE = '[data-testid="context-item-info-title"]';
const ARTIST = '[data-testid="context-item-info-artist"]';
const COVER = 'img[data-testid="cover-art-image"]';
const PROGRESS_BAR = '[data-testid="playback-progressbar"]';
const POSITION = '[data-testid="playback-position"]';
const DURATION = '[data-testid="playback-duration"]';
// The big play button at the top of a track, album, playlist or artist page.
const PAGE_PLAY = '[data-testid="action-bar-row"] [data-testid="play-button"]';
// The now-playing title links to the track (or to its album, with the track
// in the query).
const TITLE_LINK = '[data-testid="now-playing-widget-v2"] a[href*="/track/"], [data-testid="now-playing-widget"] a[href*="/track/"]';

let capturedKey = '';
let capturedLink: string | null = null;
let capturedContext: string | null = null;
let previousLink: string | null = null;
let capturePending = false;
let lastCaptureAt = 0;

function text(root: ParentNode, selector: string) {
  return root.querySelector(selector)?.textContent?.trim() ?? '';
}

function click(selector: string) {
  document.querySelector<HTMLButtonElement>(selector)?.click();
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

function readLink(track: Track | null): string | null {
  if (!track) return null;
  const label = document.querySelector(NOW_PLAYING)?.getAttribute('aria-label');
  const href = document.querySelector<HTMLAnchorElement>(TITLE_LINK)?.href;
  const id = label?.startsWith(`Now playing: ${track.title} by `) && href && /\/track\/([A-Za-z0-9]+)/.exec(href)?.[1];
  if (id) return `https://open.spotify.com/track/${id}`;

  const key = `${track.title}\u0000${track.artist}\u0000${track.artUrl}`;
  if (key !== capturedKey) {
    previousLink = capturedLink;
    capturedKey = key;
    capturedLink = null;
    capturedContext = null;
    lastCaptureAt = 0;
  }
  if (!capturePending && !capturedLink && Date.now() - lastCaptureAt > 5_000) {
    capturePending = true;
    lastCaptureAt = Date.now();
    void chrome.runtime.sendMessage({ type: 'spotify-song-link', title: track.title }).then((result: { link: string; context: string | null } | null) => {
      if (capturedKey !== key || !result) return;
      const match = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(result.link);
      if (match) {
        const next = `https://open.spotify.com/track/${match[1]}`;
        if (next !== previousLink) {
          capturedLink = next;
          capturedContext = result.context;
        }
      }
    }).catch(() => {}).finally(() => { capturePending = false; });
  }
  return capturedLink;
}

function readContext(): string | null {
  const titleHref = document.querySelector<HTMLAnchorElement>(TITLE_LINK)?.href;
  const contextUri = titleHref ? new URL(titleHref, location.href).searchParams.get('context') : null;
  const uri = /^spotify:(playlist|album):([A-Za-z0-9]+)$/.exec(contextUri ?? '');
  if (uri) return `https://open.spotify.com/${uri[1]}/${uri[2]}`;

  // Spotify may show the playback context separately from the track link.
  const href = document.querySelector<HTMLAnchorElement>('[data-testid="now-playing-context"] a[href], [data-testid="context-link"][href]')?.href;
  const path = href ? /\/(playlist|album)\/([A-Za-z0-9]+)/.exec(href) : null;
  return path ? `https://open.spotify.com/${path[1]}/${path[2]}` : capturedContext;
}

function isPlaying() {
  const state = navigator.mediaSession?.playbackState;
  if (state === 'playing') return true;
  if (state === 'paused') return false;
  // When Spotify is playing, the button's label is the action it would take.
  return document.querySelector(PLAY_PAUSE)?.getAttribute('aria-label') === 'Pause';
}

function rangeInput() {
  return document.querySelector<HTMLInputElement>(`${PROGRESS_BAR} input[type="range"]`);
}

// "1:02:03" or "3:25" -> ms
function parseClock(value: string) {
  if (!/^\d+(:\d{2})+$/.test(value)) return null;
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0) * 1000;
}

function readProgress(): Progress | null {
  // The progress bar's range input holds position and duration in ms.
  const input = rangeInput();
  if (input && Number(input.max) > 0) {
    return { positionMs: Number(input.value), durationMs: Number(input.max) };
  }
  // Fallback: the clock labels, which only have whole seconds.
  const positionMs = parseClock(text(document, POSITION));
  const durationMs = parseClock(text(document, DURATION));
  if (positionMs === null || durationMs === null || durationMs === 0) return null;
  return { positionMs, durationMs };
}

function seek(positionMs: number) {
  const input = rangeInput();
  if (input && Number(input.max) > 0) {
    // React tracks the input's value itself, so set it through the native
    // setter for React to see the change, then fire the events it listens for.
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(input, String(Math.round(positionMs)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  // Fallback: press the bar at the matching horizontal point.
  const bar = document.querySelector<HTMLElement>(PROGRESS_BAR);
  const progress = readProgress();
  if (!bar || !progress) return;
  const rect = bar.getBoundingClientRect();
  const x = rect.left + (rect.width * positionMs) / progress.durationMs;
  const point = { bubbles: true, clientX: x, clientY: rect.top + rect.height / 2, pointerId: 1, isPrimary: true };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    bar.dispatchEvent(new EventType(type, point));
  }
}

function startLinked() {
  const button = document.querySelector<HTMLButtonElement>(PAGE_PLAY);
  if (!button) return 'waiting';
  // Its label reads "Pause …" when this page's item is already playing.
  if (!button.getAttribute('aria-label')?.startsWith('Pause')) button.click();
  return 'started';
}

runSourceDriver({
  source: 'spotify',
  startLinked,
  read: () => {
    const track = readTrack();
    return { track, playing: isPlaying(), progress: readProgress(), link: readLink(track), context: readContext() };
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
      case 'seek':
        seek(command.positionMs);
        break;
    }
  },
});
