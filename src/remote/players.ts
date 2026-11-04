// The Remote's connections: one per Player listed by the agent that served
// the page, refreshed as discovery finds peers (ADR-0004). Existing sockets
// stay independent so an offline Player only affects itself.
import { PLAYERS_PATH, type AgentToRemote, type PlayerEntry, type PlayerState, type RemoteToAgent } from '../shared/protocol.ts';

export interface PlayerConnection {
  label: string;
  online: boolean;
  // The last state received; kept while offline, but stale.
  state: PlayerState | null;
  receivedAt: number;
  // The last error this Remote's own request caused, until the next request.
  error: string | null;
  send(message: RemoteToAgent): void;
}

export interface WatchOptions {
  reconnectMs?: number;
  refreshMs?: number;
  requestTimeoutMs?: number;
}

export function handoffTargets(player: PlayerConnection, players: PlayerConnection[]) {
  return players.filter(peer => peer !== player).map(peer => ({
    label: peer.label,
    name: peer.state?.name ?? peer.label,
    available: player.online && peer.online && !player.state?.handoff && !peer.state?.handoff,
  }));
}

export function watchPlayers(
  origin: string,
  onChange: (players: PlayerConnection[]) => void,
  { reconnectMs = 2_000, refreshMs = 5_000, requestTimeoutMs = 4_000 }: WatchOptions = {},
) {
  let closed = false;
  const sockets = new Set<WebSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let players: PlayerConnection[] = [];
  const connections = new Map<string, ReturnType<typeof connect>>();
  let directoryRequest: AbortController | null = null;

  function later(run: () => void, delayMs = reconnectMs) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!closed) run();
    }, delayMs);
    timers.add(timer);
  }

  async function start() {
    let entries: PlayerEntry[];
    const controller = new AbortController();
    directoryRequest = controller;
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(new URL(PLAYERS_PATH, origin), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Could not read the Player directory');
      entries = (await response.json()) as PlayerEntry[];
      if (!Array.isArray(entries) || entries.some(entry => {
        if (!entry || typeof entry.label !== 'string' || typeof entry.url !== 'string') return true;
        try {
          const url = new URL(entry.url);
          return !['ws:', 'wss:'].includes(url.protocol) || !!url.username || !!url.password;
        } catch { return true; }
      })) throw new Error('Invalid Player directory');
    } catch {
      if (!closed) later(start);
      return;
    } finally {
      clearTimeout(timeout);
      directoryRequest = null;
    }
    if (closed) return;
    const listed = new Set(entries.map(entry => entry.url));
    for (const [url, connection] of connections) {
      if (!listed.has(url)) {
        connection.close();
        connections.delete(url);
      }
    }
    entries = entries.filter((entry, index) => entries.findIndex(other => other.url === entry.url) === index);
    players = entries.map(entry => {
      let connection = connections.get(entry.url);
      if (!connection) {
        connection = connect(entry);
        connections.set(entry.url, connection);
      }
      connection.player.label = entry.label;
      return connection.player;
    });
    onChange(players);
    later(start, refreshMs);
  }

  function connect(entry: PlayerEntry) {
    let socket: WebSocket | null = null;
    let disposed = false;
    const player: PlayerConnection = {
      label: entry.label,
      online: false,
      state: null,
      receivedAt: 0,
      error: null,
      send(message) {
        if (socket?.readyState !== WebSocket.OPEN) return;
        if (player.error) {
          player.error = null;
          onChange(players);
        }
        socket.send(JSON.stringify(message));
      },
    };

    function open() {
      if (disposed || closed) return;
      socket = new WebSocket(entry.url);
      sockets.add(socket);
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as AgentToRemote;
        if (message.type === 'error') {
          player.error = message.message;
        } else if (message.type === 'state') {
          player.state = message.state;
          player.receivedAt = Date.now();
          player.online = true;
        }
        onChange(players);
      };
      socket.onclose = () => {
        sockets.delete(socket!);
        socket = null;
        if (player.online) {
          player.online = false;
          onChange(players);
        }
        if (!disposed && !closed) later(open);
      };
    }

    open();
    return { player, close() { disposed = true; socket?.close(); } };
  }

  void start();
  return {
    close() {
      closed = true;
      directoryRequest?.abort();
      for (const connection of connections.values()) connection.close();
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.close();
    },
  };
}
