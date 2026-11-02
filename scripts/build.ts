// Builds the extension (load dist/extension unpacked in Arc) and the Remote page.
import { cp, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });

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
