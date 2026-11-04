// Builds the standalone agent, extension and Remote page.
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

await rm('dist', { recursive: true, force: true });

// A standalone agent keeps the login service independent of this checkout
// and its node_modules. The CommonJS bundle also includes ws.
await build({
  entryPoints: ['src/agent/main.ts'],
  outfile: 'dist/agent/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  define: { 'import.meta.dirname': '__dirname' },
});
if (process.platform === 'darwin') {
  execFileSync('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O',
    '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx12.0`,
    '-module-cache-path', join(tmpdir(), 'music-sync-swift-cache'),
    'src/agent/voice-player.swift', '-o', 'dist/agent/voice-player'], { stdio: 'inherit' });
}

await build({
  entryPoints: {
    background: 'src/extension/background.ts',
    spotify: 'src/extension/drivers/spotify.ts',
    'youtube-music': 'src/extension/drivers/youtube-music.ts',
  },
  outdir: 'dist/extension',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
});
await cp('src/extension/manifest.json', 'dist/extension/manifest.json');

await build({
  entryPoints: ['src/remote/remote.ts'],
  outdir: 'dist/remote',
  bundle: true,
  format: 'esm',
  target: 'safari16',
});
await cp('src/remote/index.html', 'dist/remote/index.html');
await cp('src/remote/voice-capture.js', 'dist/remote/voice-capture.js');
await cp('src/remote/style.css', 'dist/remote/style.css');
await cp('src/remote/assets', 'dist/remote/assets', { recursive: true });
