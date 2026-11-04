// Starts this Mac's agent and discovers Music Sync peers on its tailnet.
// Optional config: ~/.config/music-sync/config.json, with name/host overrides,
// port (default 4848), players (manual seeds), or discoverPlayers: false.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_EXTENSION_PORT, DEFAULT_REMOTE_PORT, REMOTE_PATH, type PlayerEntry } from '../shared/protocol.ts';
import { startAgent } from './agent.ts';
import { realMac } from './mac.ts';
import { readTailnetNodes, startPlayerDiscovery } from './discovery.ts';

interface Config {
  players?: string[];
  port?: number;
  name?: string;
  host?: string;
  discoverPlayers?: boolean;
}

const CONFIG_PATH = join(homedir(), '.config', 'music-sync', 'config.json');

async function readConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as Config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

async function tailnetAddress() {
  const { stdout } = await promisify(execFile)(process.env.MUSIC_SYNC_TAILSCALE_BIN ?? 'tailscale', ['ip', '-4']);
  const address = stdout.trim().split('\n')[0];
  if (!address) throw new Error('`tailscale ip -4` returned no address; is Tailscale connected?');
  return address;
}

function playerEntry(spec: string, defaultPort: number): PlayerEntry {
  const [host, port = String(defaultPort)] = spec.split(':');
  return { label: host, url: `ws://${host}:${port}${REMOTE_PATH}` };
}

async function main() {
  const config = await readConfig();
  const host = config.host ?? (await tailnetAddress());
  const port = config.port ?? DEFAULT_REMOTE_PORT;
  const name = config.name ?? hostname().replace(/\.local$/, '');
  const self = playerEntry(port === DEFAULT_REMOTE_PORT ? host : `${host}:${port}`, port);
  const players = config.players?.length
    ? config.players.map((spec) => playerEntry(spec, port))
    : [self];

  const agent = await startAgent({
    name,
    remote: { host, port },
    extension: { port: DEFAULT_EXTENSION_PORT },
    staticDir: process.env.MUSIC_SYNC_REMOTE_DIR ?? join(import.meta.dirname, '..', '..', 'dist', 'remote'),
    players,
    lastPlaybackPath: join(homedir(), '.config', 'music-sync', 'last-playback.json'),
    mac: realMac,
  });
  const discovery = config.discoverPlayers === false ? null : startPlayerDiscovery({
    players, self,
    candidates: () => readTailnetNodes(process.env.MUSIC_SYNC_TAILSCALE_BIN ?? 'tailscale'),
    cachePath: join(homedir(), '.config', 'music-sync', 'discovered-players.json'),
    onError: error => console.error('Player discovery failed; keeping known Players:', error),
  });
  console.log(`Remote: http://${host}:${agent.remotePort}  (extension on 127.0.0.1:${agent.extensionPort})`);
  console.log(`Players: ${players.map((player) => player.label).join(', ')}`);
  void discovery?.ready.then(() => console.log(`Discovered Players: ${players.map(player => player.label).join(', ')}`));

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void Promise.all([discovery?.close(), agent.close()]).then(() => process.exit(0)));
  }
}

void main().catch(error => {
  console.error('Music Sync agent could not start:', error);
  // Startup can fail after timers/sockets are created. Exit so launchd can
  // retry rather than retaining a partially initialized, unavailable Player.
  process.exit(1);
});
