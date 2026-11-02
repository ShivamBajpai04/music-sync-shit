// Starts this Mac's agent. Config (optional) at ~/.config/music-sync/config.json:
//   { "name": "Office Mac", "host": "100.x.y.z", "port": 4848 }
// Without a host, the agent listens on the Mac's tailnet IPv4 address.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_EXTENSION_PORT, DEFAULT_REMOTE_PORT } from '../shared/protocol.ts';
import { startAgent } from './agent.ts';
import { realMac } from './mac.ts';

interface Config {
  name?: string;
  host?: string;
  port?: number;
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

const config = await readConfig();
const host = config.host ?? (await tailnetAddress());
const agent = await startAgent({
  name: config.name ?? hostname().replace(/\.local$/, ''),
  remote: { host, port: config.port ?? DEFAULT_REMOTE_PORT },
  extension: { port: DEFAULT_EXTENSION_PORT },
  staticDir: join(import.meta.dirname, '..', '..', 'dist', 'remote'),
  mac: realMac,
});
console.log(`Remote: http://${host}:${agent.remotePort}  (extension on 127.0.0.1:${agent.extensionPort})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void agent.close().then(() => process.exit(0)));
}
