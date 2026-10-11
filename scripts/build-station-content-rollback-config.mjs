import { readFile, open, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { stationReleaseCandidate, releaseRoot } from './build-station-release-candidate.mjs';
import { firstLaunchAssets } from './build-station-first-launch.mjs';
import { privateBackupDirectory, hashBackupFile } from './helpers/station-production-backup.mjs';

export function contentRollbackConfiguration(base, baseDirectory = releaseRoot) {
  const config = stationReleaseCandidate(base, baseDirectory);
  config.main = resolve(releaseRoot, 'src/stationContentRollback.js');
  config.assets.directory = firstLaunchAssets;
  config.vars.STATION_LEGACY_CONTENT_CLOSED = 'true';
  return config;
}
export async function writeContentRollbackConfiguration(basePath, expectedHash, outputPath) {
  const root = await realpath(releaseRoot), input = await realpath(basePath), parent = await realpath(dirname(resolve(outputPath)));
  const outside = value => { const path = relative(root, value); return path === '..' || path.startsWith('..' + sep); };
  if (!outside(input) || !outside(parent)) throw new Error('STATION_ROLLBACK_PRIVATE_PATH');
  await privateBackupDirectory(dirname(input)); await privateBackupDirectory(parent);
  await hashBackupFile(input);
  const source = await readFile(input);
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || createHash('sha256').update(source).digest('hex') !== expectedHash) throw new Error('STATION_ROLLBACK_BASE_HASH');
  const config = contentRollbackConfiguration(JSON.parse(source), dirname(input));
  const file = await open(resolve(parent, resolve(outputPath).split(sep).at(-1)), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(config, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  return { prepared: true, productionVerified: false, deployed: false, profile: 'maintenance-legacy-closed',
    baselineSha256: expectedHash, legacyClosureIndependentOfPageFlags: true, independentStationFeaturesEnabled: false };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--baseline' || args[2] !== '--baseline-sha256' || args[4] !== '--output') {
    console.error('STATION_ROLLBACK_ARGUMENTS'); process.exitCode = 1;
  } else writeContentRollbackConfiguration(args[1], args[3], args[5]).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^STATION_(?:ROLLBACK|RELEASE)_[A-Z_]+$/.test(error.message || '') ? error.message : 'STATION_ROLLBACK_CONFIG'); process.exitCode = 1;
  });
}
