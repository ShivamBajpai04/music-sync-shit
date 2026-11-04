// Private HTTPS is required by Android's microphone API. Keep port 443 free.
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { SERVICE_LABEL, servicePaths } from './service-config.ts';
const run = promisify(execFile);
const tailscale = process.env.MUSIC_SYNC_TAILSCALE_BIN ?? 'tailscale';
const paths = servicePaths(homedir());
let config: { port?: number; secureRemoteUrl?: string } = {};
try { config = JSON.parse(await readFile(paths.config, 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const { stdout } = await run(tailscale, ['status', '--json']);
const dns = JSON.parse(stdout).Self?.DNSName?.replace(/\.$/, '');
if (!dns) throw new Error('Connect this Mac to Tailscale first.');
const target = `http://127.0.0.1:${config.port ?? 4848}`;
const current = JSON.parse((await run(tailscale, ['serve', 'status', '--json'])).stdout);
const existing = current.Web?.[`${dns}:8443`]?.Handlers;
if (current.TCP?.['8443'] && (!existing || Object.keys(existing).length !== 1 || existing['/']?.Proxy !== target)) {
  throw new Error('Tailscale port 8443 is already in use. Keep its existing service and choose another HTTPS port manually.');
}
try {
  const result = await run(tailscale, ['serve', '--bg', '--https=8443', target], { timeout: 30_000 });
  console.log(result.stdout);
} catch (error) {
  const failure = error as { stdout?: string; stderr?: string };
  console.error(failure.stdout ?? '', failure.stderr ?? '');
  throw new Error('HTTPS setup did not finish. If Tailscale printed an approval link, open it and enable HTTPS, then rerun npm run voice:setup.');
}
config.secureRemoteUrl = `https://${dns}:8443/`;
await mkdir(dirname(paths.config), { recursive: true });
await writeFile(paths.config, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await run('/bin/launchctl', ['kickstart', '-k', `gui/${process.getuid!()}/${SERVICE_LABEL}`]);
console.log(`Open on Android: ${config.secureRemoteUrl}\nHold the button under the Mac you want to talk to. Allow microphone access when asked.`);
