import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMusicStagingConfig, musicStagingFlags } from './helpers/music-staging-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'ops', 'music-staging-app.jsonc');
const outputPath = path.join(root, '.generated', 'music-staging-maintenance.jsonc');

export function maintenanceConfig(source) {
  const config = assertMusicStagingConfig(JSON.parse(source.replace(/^\s*\/\/.*$/gm, '')));
  assert.equal(config.name, 'station-cat-music-staging');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.ok(config.vars && typeof config.vars === 'object');
  for (const flag of musicStagingFlags) {
    assert.ok(Object.hasOwn(config.vars, flag), `Missing staging flag ${flag}.`);
    config.vars[flag] = 'false';
  }
  // Wrangler resolves these paths relative to the config file. Moving the
  // config from ops/ to .generated/ must preserve their original targets.
  const relocate = value => path.relative(path.dirname(outputPath),
    path.resolve(path.dirname(sourcePath), value)).replaceAll('\\', '/');
  config.main = relocate(config.main);
  config.assets.directory = relocate(config.assets.directory);
  for (const database of config.d1_databases) {
    if (database.migrations_dir) database.migrations_dir = relocate(database.migrations_dir);
  }
  return config;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = maintenanceConfig(await readFile(sourcePath, 'utf8'));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log('Prepared ignored maintenance config with all five music flags disabled.');
}
