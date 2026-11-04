import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SERVICE_LABEL = 'com.music-sync.agent';

export function servicePaths(home: string) {
  return {
    install: join(home, 'Library', 'Application Support', 'Music Sync'),
    logs: join(home, 'Library', 'Logs', 'Music Sync'),
    plist: join(home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`),
    config: join(home, '.config', 'music-sync', 'config.json'),
  };
}

function xml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

export function launchAgentPlist(home: string, node: string, tailscale: string) {
  const paths = servicePaths(home);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string><string>${xml(join(paths.install, 'agent', 'main.cjs'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(paths.install)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>MUSIC_SYNC_TAILSCALE_BIN</key><string>${xml(tailscale)}</string>
    <key>MUSIC_SYNC_REMOTE_DIR</key><string>${xml(join(paths.install, 'remote'))}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(paths.logs, 'agent.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(paths.logs, 'agent-error.log'))}</string>
</dict></plist>
`;
}

export async function checkBuild(dist: string) {
  for (const file of ['agent/main.cjs', 'remote/index.html', 'remote/remote.js', 'remote/style.css', 'remote/assets/sky-flowers.webp', 'extension/manifest.json']) {
    await access(join(dist, file));
  }
}

// Existing config and playback memory belong to the user, including on update.
export async function installServiceFiles(home: string, dist: string, node: string, tailscale: string) {
  await checkBuild(dist);
  const paths = servicePaths(home);
  await Promise.all([
    mkdir(paths.install, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(join(home, 'Library', 'LaunchAgents'), { recursive: true }),
    mkdir(join(home, '.config', 'music-sync'), { recursive: true }),
  ]);
  for (const directory of ['agent', 'remote', 'extension']) {
    await cp(join(dist, directory), join(paths.install, directory), { recursive: true });
  }
  try {
    await writeFile(paths.config, '{}\n', { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await writeFile(paths.plist, launchAgentPlist(home, node, tailscale), { mode: 0o644 });
  return paths;
}
