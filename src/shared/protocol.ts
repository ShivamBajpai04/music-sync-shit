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

export interface PlayerState {
  name: string;
  source: SourceId | null;
  track: Track | null;
  playing: boolean;
}

export type SourceCommand = { type: 'play' } | { type: 'pause' };

// Remote <-> agent, on the agent's tailnet address.
export type RemoteToAgent = { type: 'command'; command: SourceCommand };
export type AgentToRemote = { type: 'state'; state: PlayerState };

// Extension <-> agent, on localhost.
export type ExtensionToAgent =
  | { type: 'source-state'; source: SourceId; track: Track | null; playing: boolean }
  | { type: 'source-closed'; source: SourceId };
export type AgentToExtension =
  | { type: 'command'; source: SourceId; command: SourceCommand }
  // Keeps the extension's service worker alive; it has no other meaning.
  | { type: 'ping' };

export const DEFAULT_REMOTE_PORT = 4848;
export const DEFAULT_EXTENSION_PORT = 4849;
export const EXTENSION_PATH = '/extension';
export const REMOTE_PATH = '/remote';
