import { readFile, realpath, open } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stationReleaseCandidate, releaseRoot } from './build-station-release-candidate.mjs';
import { migrationFlags } from '../src/redesign/routeMigrationPaths.js';
import { checkFirstLaunchScope } from './helpers/station-first-launch.mjs';
import { firstLaunchAssets } from './build-station-first-launch.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function firstLaunchConfiguration(base, scope, baseDirectory = releaseRoot) {
  checkFirstLaunchScope(scope);
  const config = stationReleaseCandidate(base, baseDirectory);
  config.assets.directory = firstLaunchAssets;
  for (const key of migrationFlags) config.vars[key] = 'true';
  config.vars.STATION_LEGACY_CONTENT_CLOSED = 'true';
  // This is an offline proposal. Schema, actual content, media rights, Access,
  // backups, CI and HTTP acceptance still govern the production execution.
  return config;
}
export async function writeFirstLaunchConfiguration(basePath, expectedHash, outputPath) {
  const root = await realpath(releaseRoot), input = await realpath(basePath), parent = await realpath(dirname(resolve(outputPath)));
  const outside = value => { const path = relative(root, value); return path === '..' || path.startsWith('..' + sep); };
  if (!outside(input) || !outside(parent)) throw new Error('STATION_FIRST_LAUNCH_PRIVATE_PATH');
  const source = await readFile(input);
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || sha(source) !== expectedHash) throw new Error('STATION_FIRST_LAUNCH_BASE_HASH');
  const scope = JSON.parse(await readFile(resolve(root, 'ops/station-first-launch.json')));
  const config = firstLaunchConfiguration(JSON.parse(source), scope, dirname(input));
  const file = await open(resolve(parent, resolve(outputPath).split(sep).at(-1)), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(config, null, 2) + '\n'); } finally { await file.close(); }
  return { prepared: true, productionVerified: false, deployed: false, profile: scope.profile,
    baselineSha256: expectedHash, proposedPublicFlags: migrationFlags, legacyContentClosed: true,
    indexing: false, mediaUploads: false, contentAdmin: false, events: false };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 6 || args[0] !== '--baseline' || args[2] !== '--baseline-sha256' || args[4] !== '--output') throw new Error('STATION_FIRST_LAUNCH_ARGUMENTS');
    console.log(JSON.stringify(await writeFirstLaunchConfiguration(args[1], args[3], args[5])));
  } catch (error) {
    console.error(/^STATION_(?:FIRST_LAUNCH|RELEASE)_[A-Z_]+$/.test(error?.message || '') ? error.message : 'STATION_FIRST_LAUNCH_CONFIG');
    process.exitCode = 1;
  }
}
