export const VOICE_PATH = '/voice';
export const PEER_PATH = '/peer';
export const VOICE_SAMPLE_RATE = 24_000;
export const VOICE_MAX_FRAME_BYTES = 4_800;
export const VOICE_MAX_BUFFER_BYTES = 48_000;
export const VOICE_MAX_DURATION_MS = 60_000;

// HTTPS pages must use a same-origin WSS connection. The serving agent relays
// it to the selected, configured Player over the tailnet.
export function playerSocketUrl(origin: string, target: string, voice = false) {
  const base = new URL(origin);
  if (!voice && base.protocol !== 'https:') return target;
  base.pathname = voice ? VOICE_PATH : PEER_PATH;
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.search = '';
  base.hash = '';
  base.searchParams.set('target', target);
  return base.href;
}
