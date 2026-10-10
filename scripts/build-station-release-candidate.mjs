import { readFile, realpath, open } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectMigrationRouting } from '../src/redesign/routeMigrationProfile.js';
import { closedStationVariables } from './helpers/station-release-flags.mjs';
import { PRODUCTION_ACCOUNT_ID, PRODUCTION_READER_DATABASE_ID, PRODUCTION_MUSIC_BUCKET, NONPRODUCTION_DATABASE_IDS } from '../src/mobile/environment.js';

export const releaseRoot = fileURLToPath(new URL('../', import.meta.url));
export { closedStationVariables };
const check = (value, code) => { if (!value) throw new Error(code); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

// Overlay an explicitly supplied, hashed, operator-reviewed full deployment
// config. Repository wrangler.toml is NOT a verified live configuration.
// Shape checks cannot establish resource ownership, schema or release approval.
export function stationReleaseCandidate(base, baseDirectory = releaseRoot, root = releaseRoot) {
  check(base && typeof base === 'object' && !Array.isArray(base), 'STATION_RELEASE_BASE');
  check(base.name === 'caption-ai-landing-site' && base.account_id === PRODUCTION_ACCOUNT_ID,
    'STATION_RELEASE_TARGET');
  check(base.workers_dev === false && base.preview_urls === false && !base.env, 'STATION_RELEASE_PUBLIC_BOUNDARY');
  check(base.routes?.some(row => row.pattern === 'wwwstationcat.org' && row.custom_domain === true), 'STATION_RELEASE_DOMAIN');
  check(typeof base.main === 'string' && resolve(baseDirectory, base.main) === resolve(root, 'src/worker.js'), 'STATION_RELEASE_ENTRYPOINT');
  check(base.assets?.binding === 'ASSETS' && typeof base.assets.directory === 'string' &&
    resolve(baseDirectory, base.assets.directory) === resolve(root, 'dist') &&
    base.assets.not_found_handling === '404-page', 'STATION_RELEASE_ASSETS');
  check(base.vars && typeof base.vars === 'object' && !Array.isArray(base.vars), 'STATION_RELEASE_VARIABLES');
  const databases = base.d1_databases, buckets = base.r2_buckets;
  check(Array.isArray(databases) && new Set(databases.map(row => row.binding)).size === databases.length,
    'STATION_RELEASE_DATABASES');
  const reader = databases.find(row => row.binding === 'WAITLIST_DB'), music = databases.find(row => row.binding === 'MUSIC_DB');
  check(reader?.database_id === PRODUCTION_READER_DATABASE_ID && uuid(music?.database_id) &&
    !NONPRODUCTION_DATABASE_IDS.includes(music.database_id) && music.database_id !== reader.database_id &&
    typeof music.migrations_dir === 'string' && resolve(baseDirectory, music.migrations_dir) === resolve(root, 'migrations-music'),
    'STATION_RELEASE_DATABASE_BOUNDARY');
  check(Array.isArray(buckets) && new Set(buckets.map(row => row.binding)).size === buckets.length &&
    buckets.find(row => row.binding === 'MUSIC_BUCKET')?.bucket_name === PRODUCTION_MUSIC_BUCKET &&
    buckets.find(row => row.binding === 'CONTENT_BUCKET')?.bucket_name === 'station-cat-content' &&
    buckets.find(row => row.binding === 'DOWNLOADS_BUCKET')?.bucket_name === 'station-cat-downloads',
    'STATION_RELEASE_BUCKET_BOUNDARY');
  const config = structuredClone(base);
  config.main = resolve(baseDirectory, config.main);
  config.assets.directory = resolve(baseDirectory, config.assets.directory);
  config.d1_databases = databases.map(row => ({ ...row, migrations_dir: resolve(baseDirectory, row.migrations_dir || 'migrations') }));
  // Cover root, aliases, descendants, encoded paths, robots and all sitemap
  // shards. No negative pattern can accidentally bypass the retirement layer.
  config.assets.run_worker_first = true;
  Object.assign(config.vars, closedStationVariables);
  check(inspectMigrationRouting(config.assets.run_worker_first).satisfied, 'STATION_RELEASE_ROUTING');
  return config;
}

export async function writeStationReleaseCandidate(basePath, expectedHash, outputPath) {
  const root = await realpath(releaseRoot), input = await realpath(basePath), parent = await realpath(dirname(resolve(outputPath)));
  const outside = value => { const path = relative(root, value); return path === '..' || path.startsWith('..' + sep); };
  check(outside(input) && outside(parent), 'STATION_RELEASE_PRIVATE_PATH_REQUIRED');
  const source = await readFile(input, 'utf8');
  check(/^[0-9a-f]{64}$/.test(expectedHash) && createHash('sha256').update(source).digest('hex') === expectedHash,
    'STATION_RELEASE_BASE_HASH');
  // JSON only: no executable imports, network lookup or implicit config search.
  let base;
  try { base = JSON.parse(source); } catch { throw new Error('STATION_RELEASE_BASE_JSON'); }
  const config = stationReleaseCandidate(base, dirname(input), root);
  const file = await open(resolve(parent, resolve(outputPath).split(sep).at(-1)), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(config, null, 2) + '\n'); } finally { await file.close(); }
  return { prepared: true, productionVerified: false, deployed: false, baselineSha256: expectedHash,
    routing: inspectMigrationRouting(config.assets.run_worker_first), closedFlags: Object.keys(closedStationVariables) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    check(args.length === 6 && args[0] === '--baseline' && args[2] === '--baseline-sha256' && args[4] === '--output', 'STATION_RELEASE_ARGUMENTS');
    console.log(JSON.stringify(await writeStationReleaseCandidate(args[1], args[3], args[5])));
  } catch (error) {
    console.error(/^STATION_RELEASE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'STATION_RELEASE_PREPARATION_FAILED');
    process.exitCode = 1;
  }
}
