import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { PlayerEntry } from '../shared/protocol.ts';
import { PEER_PATH, VOICE_PATH, VOICE_MAX_BUFFER_BYTES, VOICE_MAX_DURATION_MS, VOICE_MAX_FRAME_BYTES, VOICE_SAMPLE_RATE } from '../shared/voice.ts';
import type { VoiceOutput } from './voice-output.ts';

export function startVoiceRouter({ players, ownUrl, output, idleTimeoutMs = 10_000, maxDurationMs = VOICE_MAX_DURATION_MS }: {
  players: PlayerEntry[];
  ownUrl: () => string;
  output?: () => Promise<VoiceOutput>;
  idleTimeoutMs?: number;
  maxDurationMs?: number;
}) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const upstreams = new Set<WebSocket>();
  let busy = false;
  let closed = false;

  function error(socket: WebSocket, message: string) {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'error', message }));
    socket.close(1011, message.slice(0, 100));
  }

  async function receive(socket: WebSocket) {
    if (!output) return error(socket, 'Update this Mac’s agent to enable voice output.');
    if (busy) return error(socket, 'Someone is already talking to this Mac.');
    busy = true;
    let sink: VoiceOutput | undefined;
    let ended = false;
    let idle: ReturnType<typeof setTimeout>;
    const lifetime = setTimeout(() => { error(socket, 'Voice time limit reached. Hold the button again.'); stop(); }, maxDurationMs);
    const stop = () => {
      if (ended) return;
      ended = true;
      clearTimeout(lifetime);
      clearTimeout(idle);
      sink?.stop();
      // A pending output startup still owns the slot until it settles.
      if (sink) busy = false;
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => { error(socket, 'Voice stream stopped.'); stop(); }, idleTimeoutMs);
    };
    socket.on('close', stop);
    socket.on('error', stop);
    touch();
    let bytes = 0;
    const began = Date.now();
    socket.on('message', (data, binary) => {
      if (ended) return;
      if (!binary) {
        try {
          if (JSON.parse(String(data)).type === 'stop') { stop(); socket.close(); return; }
        } catch { /* Invalid control frame. */ }
        error(socket, 'Invalid voice control.'); stop(); return;
      }
      if (!sink) { error(socket, 'Voice output is not ready.'); stop(); return; }
      const chunk = buffer(data);
      bytes += chunk.byteLength;
      if (!chunk.byteLength || chunk.byteLength % 2 || chunk.byteLength > VOICE_MAX_FRAME_BYTES || bytes > (Date.now() - began) * 48 + VOICE_MAX_BUFFER_BYTES) {
        error(socket, 'Invalid voice audio stream.'); stop(); return;
      }
      if (!sink.write(chunk)) { error(socket, 'Voice output is too slow.'); stop(); return; }
      touch();
    });
    try {
      sink = await output();
      if (ended || closed || socket.readyState !== WebSocket.OPEN) { sink.stop(); busy = false; return; }
      void sink.done.then(() => { if (!ended) { error(socket, 'Voice output stopped.'); stop(); } }, () => { error(socket, 'Could not play voice on this Mac.'); stop(); });
      socket.send(JSON.stringify({ type: 'ready', sampleRate: VOICE_SAMPLE_RATE }));
    } catch {
      busy = false;
      error(socket, 'Could not open this Mac’s audio output.');
      stop();
    }
  }

  function relay(socket: WebSocket, target: string, voice: boolean) {
    const url = new URL(target);
    if (voice) url.pathname = VOICE_PATH;
    url.search = '';
    const peer = new WebSocket(url, { maxPayload: 64 * 1024 });
    upstreams.add(peer);
    const timeout = setTimeout(() => error(socket, 'The selected Mac did not respond.'), 5_000);
    peer.on('open', () => clearTimeout(timeout));
    peer.on('message', (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > VOICE_MAX_BUFFER_BYTES) { error(socket, 'The connection is too slow.'); return; }
      socket.send(data, { binary });
    });
    socket.on('message', (data, binary) => {
      if (peer.readyState !== WebSocket.OPEN) { error(socket, 'The selected Mac is still connecting.'); return; }
      if (!voice && binary) { error(socket, 'Invalid control frame.'); return; }
      if (peer.bufferedAmount > VOICE_MAX_BUFFER_BYTES) { error(socket, 'The connection is too slow.'); return; }
      peer.send(data, { binary });
    });
    peer.on('error', () => error(socket, 'Could not connect to the selected Mac. Update its agent if needed.'));
    peer.on('close', () => { clearTimeout(timeout); upstreams.delete(peer); socket.close(); });
    socket.on('error', () => peer.terminate());
    socket.on('close', () => {
      clearTimeout(timeout);
      if (peer.readyState === WebSocket.CONNECTING) peer.terminate();
      else peer.close();
    });
  }

  return {
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      const url = new URL(req.url ?? '/', 'http://agent');
      if (url.pathname !== VOICE_PATH && url.pathname !== PEER_PATH) return false;
      const target = url.searchParams.get('target') ?? ownUrl();
      if (closed || (target !== ownUrl() && !players.some(player => player.url === target))) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return true;
      }
      server.handleUpgrade(req, socket, head, client => {
        client.on('error', () => {});
        server.emit('connection', client, req);
        if (url.pathname === VOICE_PATH && target === ownUrl()) void receive(client);
        else relay(client, target, url.pathname === VOICE_PATH);
      });
      return true;
    },
    close() {
      closed = true;
      for (const socket of [...server.clients, ...upstreams]) socket.terminate();
    },
  };
}

function buffer(data: RawData): Buffer {
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
}
