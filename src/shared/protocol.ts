// Message types shared by the agent, the extension and the Remote.

export type SourceId = 'spotify' | 'youtube-music';

export const SOURCE_LABELS: Record<SourceId, string> = {
  spotify: 'Spotify Web',
  'youtube-music': 'YouTube Music Web',
};

export interface Track {
  title: string;
  artist: string;
  artUrl: string | null;
}

// Position as of when the message was sent. Receivers advance it themselves
// while playing, using their own clock.
export interface Progress {
  positionMs: number;
  durationMs: number;
}

// One Source tab on a Player, as shown on its own card.
export interface SourceState {
  source: SourceId;
  track: Track | null;
  playing: boolean;
  progress: Progress | null;
}

export interface PlayerState {
  name: string;
  // The Sources to show, one card each, in SOURCE_ORDER: every open Source
  // tab with a track loaded. Empty when no Source tab is open.
  sources: SourceState[];
  // The Mac's system volume, 0-100; null if it couldn't be read.
  volume: number | null;
  // What Resume would play, or null when Resume isn't available: nothing is
  // remembered, or the remembered Source is already playing.
  resume: { source: SourceId; track: Track } | null;
}

// Display order when several Sources are shown.
export const SOURCE_ORDER: SourceId[] = ['spotify', 'youtube-music'];

export type SourceCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number };

// Remote <-> agent, on the agent's tailnet address.
export type RemoteToAgent =
  | { type: 'command'; source: SourceId; command: SourceCommand }
  | { type: 'set-volume'; volume: number }
  // A pasted Spotify or YouTube Music link to start playing on this Player.
  | { type: 'start-link'; link: string }
  | { type: 'resume' };
export type AgentToRemote =
  | { type: 'state'; state: PlayerState }
  // Sent only to the Remote whose request failed.
  | { type: 'error'; message: string };

// Extension <-> agent, on localhost.
export type ExtensionToAgent =
  | {
      type: 'source-state';
      source: SourceId;
      track: Track | null;
      playing: boolean;
      progress: Progress | null;
      // A link that reopens the current track, when the page shows one.
      link: string | null;
      // Playback Context, when the page exposes one.
      context: string | null;
    }
  | { type: 'source-closed'; source: SourceId };
export type AgentToExtension =
  | { type: 'command'; source: SourceId; command: SourceCommand }
  // Navigate the Source's open tab to url (which carries START_MARKER).
  | { type: 'open'; source: SourceId; url: string }
  // Keeps the extension's service worker alive; it has no other meaning.
  | { type: 'ping' };

// Added as the URL hash of a link being started. A Source driver that loads
// with it presses play, seeks to the position if one is given, then removes it.
export const START_MARKER = 'music-sync-play';

export function startHash(positionMs?: number) {
  return positionMs ? `#${START_MARKER}=${Math.round(positionMs)}` : `#${START_MARKER}`;
}

// The position to start at (0 for the beginning), or null if hash isn't a start marker.
export function parseStartHash(hash: string): number | null {
  const match = new RegExp(`^#${START_MARKER}(?:=(\\d+))?$`).exec(hash);
  return match ? Number(match[1] ?? 0) : null;
}

// Where a progress estimate is after elapsedMs more time.
export function advance(progress: Progress, playing: boolean, elapsedMs: number): Progress {
  if (!playing) return progress;
  return { ...progress, positionMs: Math.min(progress.durationMs, progress.positionMs + elapsedMs) };
}

export const DEFAULT_REMOTE_PORT = 4848;
export const DEFAULT_EXTENSION_PORT = 4849;
export const EXTENSION_PATH = '/extension';
export const REMOTE_PATH = '/remote';
// Lists every Player the Remote should connect to, as PlayerEntry[].
export const PLAYERS_PATH = '/players';

export interface PlayerEntry {
  // Shown until the Player's agent reports its own name.
  label: string;
  // The Player's Remote-facing socket.
  url: string;
}
