import type { SourceCommand, Track } from '../shared/protocol.ts';

// Between a Source tab's content script and the background service worker.
// The port name is the Source id.
export type TabToBackground = { type: 'state'; track: Track | null; playing: boolean };
export type BackgroundToTab = { type: 'command'; command: SourceCommand };
