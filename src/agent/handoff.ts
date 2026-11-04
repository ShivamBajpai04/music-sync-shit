import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { AgentToRemote, Playback, PlayerEntry, PlayerState, RemoteToAgent } from '../shared/protocol.ts';

export class HandoffError extends Error {
  targetState: PlayerState | null;
  constructor(message: string, targetState: PlayerState | null = null) {
    super(message);
    this.targetState = targetState;
  }
}

// A request id distinguishes the requested playback from the peer's initial
// state, which may already show the same track playing at a different position.
export function startOnPeer(target: PlayerEntry, playback: Playback, timeoutMs: number, signal: AbortSignal) {
  return new Promise<PlayerState>((resolve, reject) => {
    const socket = new WebSocket(target.url);
    const requestId = randomUUID();
    let settled = false;
    const finish = (error: Error | null, state?: PlayerState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else socket.close();
      if (error) reject(error);
      else resolve(state!);
    };
    const abort = () => finish(new HandoffError('The original agent is stopping.'));
    const timer = setTimeout(() => finish(new HandoffError('The target did not confirm playback in time; it may still start later.')), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    socket.on('open', () => {
      const message: RemoteToAgent = { type: 'start-playback', requestId, playback };
      socket.send(JSON.stringify(message));
    });
    socket.on('message', data => {
      let message: AgentToRemote;
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.type !== 'handoff-result' || message.requestId !== requestId) return;
      if (message.ok) finish(null, message.state);
      else finish(new HandoffError(message.message ?? 'The target could not start playback.', message.state));
    });
    socket.on('error', () => finish(new HandoffError('The target could not be reached.')));
    socket.on('close', () => finish(new HandoffError('The target disconnected before confirming playback.')));
  });
}

export function playbackStatus(name: string, state: PlayerState | null) {
  if (!state?.sources.length) return `${name}: playback unknown (no connected Source).`;
  const playing = state.sources.filter(source => source.playing);
  return playing.length ? `${name}: playing ${playing.map(source => `“${source.track?.title ?? source.source}”`).join(', ')}.` : `${name}: paused.`;
}
