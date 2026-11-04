import { execFile } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { checkBuild, installServiceFiles, SERVICE_LABEL, servicePaths } from './service-config.ts';
import { DEFAULT_EXTENSION_PORT } from '../src/shared/protocol.ts';

const run = promisify(execFile);
const action = process.argv[2];
if (process.platform !== 'darwin') throw new Error('The login agent requires macOS.');
if (!['install', 'status', 'restart', 'uninstall'].includes(action)) {
  throw new Error('Usage: node scripts/service.ts install|status|restart|uninstall');
}
const home = homedir();
const paths = servicePaths(home);
const domain = `gui/${process.getuid!()}`;
const service = `${domain}/${SERVICE_LABEL}`;
const launchctl = (...args: string[]) => run('/bin/launchctl', args);

async function isLoaded() {
  try {
    await launchctl('print', service);
    return true;
  } catch (error) {
    if ((error as { code?: number }).code === 113) return false;
    // launchctl uses 3 on some macOS versions when the service isn't present.
    if ((error as { code?: number }).code === 3) return false;
    throw error;
  }
}

function extensionPortInUse() {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: DEFAULT_EXTENSION_PORT });
    socket.setTimeout(2_000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Could not check the existing agent.')); });
    socket.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
  });
}

if (action === 'status') {
  if (await isLoaded()) console.log((await launchctl('print', service)).stdout);
  else console.log('Music Sync login agent is not loaded. Run npm run service:install.');
} else if (action === 'restart') {
  await launchctl('kickstart', '-k', service);
  console.log('Music Sync agent restarted.');
} else if (action === 'uninstall') {
  if (await isLoaded()) await launchctl('bootout', service);
  try { await unlink(paths.plist); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  console.log('Login agent removed. Installed files, config, playback memory and logs were kept.');
} else {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Install Node.js 24 or later, then retry.');
  const dist = join(import.meta.dirname, '..', 'dist');
  await checkBuild(dist).catch(() => { throw new Error('Build the project first: npm ci && npm run build'); });
  const tailscale = (await run('/usr/bin/which', ['tailscale'])).stdout.trim();
  await run(tailscale, ['version']);
  // Check existing config before stopping a working service.
  try { JSON.parse(await readFile(paths.config, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const loaded = await isLoaded();
  if (!loaded && await extensionPortInUse()) {
    throw new Error('An agent is already running outside launchd. Stop npm run agent (Ctrl+C), then retry installation.');
  }
  if (loaded) await launchctl('bootout', service);
  await installServiceFiles(home, dist, process.execPath, tailscale);
  await run('/usr/bin/plutil', ['-lint', paths.plist]);
  await launchctl('enable', service);
  await launchctl('bootstrap', domain, paths.plist);
  console.log(`Music Sync now starts at login and restarts after crashes.\nConfig: ${paths.config}\nLogs: ${paths.logs}\nArc extension: ${join(paths.install, 'extension')}\nRun npm run service:status to check the process.`);
}
