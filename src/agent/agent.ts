import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  EXTENSION_PATH,
  REMOTE_PATH,
  type AgentToExtension,
  type AgentToRemote,
  type ExtensionToAgent,
  type PlayerState,
  type RemoteToAgent,
  type SourceCommand,
  type SourceId,
  type Track,
} from '../shared/protocol.ts';
import type { Mac } from './mac.ts';

export interface AgentOptions {
  name: string;
  // The Remote listens here: the Mac's tailnet address in production.
  remote: { host: string; port: number };
  // The extension always connects over localhost.
  extension: { port: number };
  // Directory holding the built Remote page; omitted in tests.
  staticDir?: string;
  mac: Mac;
  pingIntervalMs?: number;
}

export interface RunningAgent {
  remotePort: number;
  extensionPort: number;
  close(): Promise<void>;
}

interface SourceTab {
  socket: WebSocket;
  track: Track | null;
  playing: boolean;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export async function startAgent(options: AgentOptions): Promise<RunningAgent> {
  const sources = new Map<SourceId, SourceTab>();
  // The Source the Player card shows: the one that most recently reported state.
  let activeSource: SourceId | null = null;
  const remotes = new Set<WebSocket>();

  function playerState(): PlayerState {
    const tab = activeSource ? sources.get(activeSource) : undefined;
    return {
      name: options.name,
      source: tab ? activeSource : null,
      track: tab?.track ?? null,
      playing: tab?.playing ?? false,
    };
  }

  function broadcast() {
    const message: AgentToRemote = { type: 'state', state: playerState() };
    const data = JSON.stringify(message);
    for (const remote of remotes) remote.send(data);
  }

  function sendCommand(command: SourceCommand) {
    if (!activeSource) return;
    const tab = sources.get(activeSource);
    if (!tab) return;
    const message: AgentToExtension = { type: 'command', source: activeSource, command };
    tab.socket.send(JSON.stringify(message));
  }

  function dropSource(source: SourceId) {
    sources.delete(source);
    if (activeSource === source) activeSource = sources.keys().next().value ?? null;
  }

  // Extension side: localhost only, and only from a browser extension, so a
  // web page open in any browser on this Mac can't pose as a Source.
  const extensionServer = createServer((_req, res) => res.writeHead(404).end());
  const extensionSockets = new WebSocketServer({ noServer: true });
  extensionServer.on('upgrade', (req, socket, head) => {
    const fromExtension = req.headers.origin?.startsWith('chrome-extension://') ?? false;
    if (req.url !== EXTENSION_PATH || !fromExtension) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    extensionSockets.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as ExtensionToAgent;
        if (message.type === 'source-state') {
          sources.set(message.source, { socket: ws, track: message.track, playing: message.playing });
          activeSource = message.source;
        } else {
          dropSource(message.source);
        }
        broadcast();
      });
      ws.on('close', () => {
        for (const [source, tab] of sources) if (tab.socket === ws) dropSource(source);
        broadcast();
      });
    });
  });

  // Remote side: the page and its live connection. No auth (ADR-0002).
  const remoteServer = createServer((req, res) => serveStatic(options.staticDir, req, res));
  const remoteSockets = new WebSocketServer({ noServer: true });
  remoteServer.on('upgrade', (req, socket, head) => {
    if (req.url !== REMOTE_PATH) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    remoteSockets.handleUpgrade(req, socket, head, (ws) => {
      remotes.add(ws);
      const hello: AgentToRemote = { type: 'state', state: playerState() };
      ws.send(JSON.stringify(hello));
      ws.on('message', (data) => {
        const message = JSON.parse(String(data)) as RemoteToAgent;
        if (message.type === 'command') sendCommand(message.command);
      });
      ws.on('close', () => remotes.delete(ws));
    });
  });

  const ping = setInterval(() => {
    const message: AgentToExtension = { type: 'ping' };
    for (const ws of extensionSockets.clients) ws.send(JSON.stringify(message));
  }, options.pingIntervalMs ?? 20_000);

  await listen(extensionServer, options.extension.port, '127.0.0.1');
  await listen(remoteServer, options.remote.port, options.remote.host);

  return {
    remotePort: (remoteServer.address() as AddressInfo).port,
    extensionPort: (extensionServer.address() as AddressInfo).port,
    async close() {
      clearInterval(ping);
      for (const ws of [...extensionSockets.clients, ...remoteSockets.clients]) ws.terminate();
      await Promise.all([closeServer(extensionServer), closeServer(remoteServer)]);
    },
  };
}

async function serveStatic(dir: string | undefined, req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? '/', 'http://agent').pathname;
  const relative = normalize(path === '/' ? 'index.html' : path.slice(1));
  if (!dir || relative.startsWith('..')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(join(dir, relative));
    res.writeHead(200, { 'content-type': CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}

function listen(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}
