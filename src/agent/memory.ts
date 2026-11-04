// The Player's last playback, kept on disk so Resume survives agent restarts.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Playback } from '../shared/protocol.ts';

export type LastPlayback = Playback;

export async function loadLastPlayback(path: string | undefined): Promise<LastPlayback | null> {
  if (!path) return null;
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LastPlayback> | null;
    if (!value || (value.source !== 'spotify' && value.source !== 'youtube-music') ||
        !value.track || typeof value.track.title !== 'string' || typeof value.link !== 'string') {
      return null;
    }
    const progress = value.progress && Number.isFinite(value.progress.positionMs) && Number.isFinite(value.progress.durationMs)
      ? value.progress : null;
    return { source: value.source, track: value.track, link: value.link, context: value.context ?? null, progress };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.error(`Ignoring unreadable ${path}:`, error);
    return null;
  }
}

export async function saveLastPlayback(path: string | undefined, playback: LastPlayback) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  // Write then rename, so a crash mid-write never leaves a broken file.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(playback, null, 2));
  await rename(temporary, path);
}
