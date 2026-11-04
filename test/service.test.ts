import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { checkBuild, installServiceFiles, launchAgentPlist, SERVICE_LABEL, servicePaths } from '../scripts/service-config.ts';

it('creates a valid login job with literal paths, crash recovery, and persistent logs', { skip: process.platform !== 'darwin' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'music-sync-service-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const plist = join(home, 'test.plist');
  await writeFile(plist, launchAgentPlist(`${home}/A & B`, '/node path/<24>/node', '/tailscale & cli'));
  const { stdout } = await promisify(execFile)('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist]);
  const job = JSON.parse(stdout);
  const paths = servicePaths(`${home}/A & B`);
  assert.equal(job.Label, SERVICE_LABEL);
  assert.deepEqual(job.ProgramArguments, ['/node path/<24>/node', join(paths.install, 'agent/main.cjs')]);
  assert.equal(job.WorkingDirectory, paths.install);
  assert.equal(job.EnvironmentVariables.MUSIC_SYNC_REMOTE_DIR, join(paths.install, 'remote'));
  assert.equal(job.EnvironmentVariables.MUSIC_SYNC_TAILSCALE_BIN, '/tailscale & cli');
  assert.equal(job.RunAtLoad, true);
  assert.equal(job.KeepAlive, true);
  assert.equal(job.ThrottleInterval, 10);
  assert.equal(job.StandardErrorPath, join(paths.logs, 'agent-error.log'));
});

it('installs a standalone Player and updates it without changing config or playback memory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'music-sync-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const dist = join(root, 'dist');
  const files = ['agent/main.cjs', 'remote/index.html', 'remote/remote.js', 'remote/style.css', 'remote/assets/sky-flowers.webp', 'extension/manifest.json'];
  for (const file of files) {
    await mkdir(dirname(join(dist, file)), { recursive: true });
    await writeFile(join(dist, file), file);
  }
  const paths = await installServiceFiles(home, dist, '/node', '/tailscale');
  assert.deepEqual(JSON.parse(await readFile(paths.config, 'utf8')), {});
  for (const file of files) assert.equal(await readFile(join(paths.install, file), 'utf8'), file);
  const config = '{"players":["office-mac","bedroom-mac"]}\n';
  const memoryPath = join(dirname(paths.config), 'last-playback.json');
  await writeFile(paths.config, config);
  await writeFile(memoryPath, '{"remembered":"track"}');
  await writeFile(join(dist, 'agent/main.cjs'), 'updated agent');
  await installServiceFiles(home, dist, '/new-node', '/tailscale');
  assert.equal(await readFile(join(paths.install, 'agent/main.cjs'), 'utf8'), 'updated agent');
  assert.equal(await readFile(paths.config, 'utf8'), config);
  assert.equal(await readFile(memoryPath, 'utf8'), '{"remembered":"track"}');
  assert.match(await readFile(paths.plist, 'utf8'), /<string>\/new-node<\/string>/);
  await assert.rejects(checkBuild(join(root, 'missing-build')));
});
