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
  | { type: 'set-volume'; volume: number };
export type AgentToRemote = { type: 'state'; state: PlayerState };

// Extension <-> agent, on localhost.
export type ExtensionToAgent =
  | { type: 'source-state'; source: SourceId; track: Track | null; playing: boolean; progress: Progress | null }
  | { type: 'source-closed'; source: SourceId };
export type AgentToExtension =
  | { type: 'command'; source: SourceId; command: SourceCommand }
  // Keeps the extension's service worker alive; it has no other meaning.
  | { type: 'ping' };

// Where a progress estimate is after elapsedMs more time.
export function advance(progress: Progress, playing: boolean, elapsedMs: number): Progress {
  if (!playing) return progress;
  return { ...progress, positionMs: Math.min(progress.durationMs, progress.positionMs + elapsedMs) };
}

export const DEFAULT_REMOTE_PORT = 4848;
export const DEFAULT_EXTENSION_PORT = 4849;
export const EXTENSION_PATH = '/extension';
export const REMOTE_PATH = '/remote';
