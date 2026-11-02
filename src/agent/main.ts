// Starts this Mac's agent. Config at ~/.config/music-sync/config.json, the
// same file on every Mac:
//   { "players": ["office-mac", "bedroom-mac"] }
// Optional: "port" (default 4848, used by every Player unless an entry says
// "host:port"), and per-Mac "name" and "host" overrides. Without a host, the
// agent listens on the Mac's tailnet IPv4 address.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_EXTENSION_PORT, DEFAULT_REMOTE_PORT, REMOTE_PATH, type PlayerEntry } from '../shared/protocol.ts';
import { startAgent } from './agent.ts';
import { realMac } from './mac.ts';

interface Config {
  players?: string[];
  port?: number;
  name?: string;
  host?: string;
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
  const { stdout } = await promisify(execFile)('tailscale', ['ip', '-4']);
  const address = stdout.trim().split('\n')[0];
  if (!address) throw new Error('`tailscale ip -4` returned no address; is Tailscale connected?');
  return address;
}

function playerEntry(spec: string, defaultPort: number): PlayerEntry {
  const [host, port = String(defaultPort)] = spec.split(':');
  return { label: host, url: `ws://${host}:${port}${REMOTE_PATH}` };
}

const config = await readConfig();
const host = config.host ?? (await tailnetAddress());
const port = config.port ?? DEFAULT_REMOTE_PORT;
const name = config.name ?? hostname().replace(/\.local$/, '');
const players = config.players?.length
  ? config.players.map((spec) => playerEntry(spec, port))
  : [playerEntry(`${host}:${port}`, port)];

const agent = await startAgent({
  name,
  remote: { host, port },
  extension: { port: DEFAULT_EXTENSION_PORT },
  staticDir: join(import.meta.dirname, '..', '..', 'dist', 'remote'),
  players,
  mac: realMac,
});
console.log(`Remote: http://${host}:${agent.remotePort}  (extension on 127.0.0.1:${agent.extensionPort})`);
console.log(`Players: ${players.map((player) => player.label).join(', ')}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void agent.close().then(() => process.exit(0)));
}
