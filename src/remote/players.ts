// The Remote's connections: one per Player listed by the agent that served
// the page, each independent so an offline Player only affects itself
// (ADR-0003). Uses only fetch and WebSocket, so tests run it in Node.
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
}

export function watchPlayers(
  origin: string,
  onChange: (players: PlayerConnection[]) => void,
  { reconnectMs = 2_000 }: WatchOptions = {},
) {
  let closed = false;
  const sockets = new Set<WebSocket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let players: PlayerConnection[] = [];

  function later(run: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!closed) run();
    }, reconnectMs);
    timers.add(timer);
  }

  async function start() {
    let entries: PlayerEntry[];
    try {
      const response = await fetch(new URL(PLAYERS_PATH, origin));
      entries = (await response.json()) as PlayerEntry[];
    } catch {
      later(start);
      return;
    }
    if (closed) return;
    players = entries.map((entry) => connect(entry));
    onChange(players);
  }

  function connect(entry: PlayerEntry): PlayerConnection {
    let socket: WebSocket | null = null;
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
      socket = new WebSocket(entry.url);
      sockets.add(socket);
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as AgentToRemote;
        if (message.type === 'error') {
          player.error = message.message;
        } else {
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
        later(open);
      };
    }

    open();
    return player;
  }

  void start();
  return {
    close() {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.close();
    },
  };
}
