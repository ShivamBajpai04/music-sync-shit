// Builds the standalone agent, extension and Remote page.
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

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
await cp('src/remote/style.css', 'dist/remote/style.css');
await cp('src/remote/assets', 'dist/remote/assets', { recursive: true });
