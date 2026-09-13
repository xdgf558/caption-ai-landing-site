import { createHash } from 'node:crypto';
import { readFile, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';

export const productionRoot = fileURLToPath(new URL('../', import.meta.url));
// Re-review the complete production baseline if it changes; never silently
// inherit a changed Access boundary, routes, bindings, build, env or cron.
const sourceDigest = 'f0aac5afb8a02d7445912d2add5a25c060f2afa2b7d8eb77629bf1663b3cec4f';
const productionAccount = '3f5394e0ef5a531c63c0ceaa74262e0d';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stagingDatabases = ['8fe1a3e1-7325-4d87-a7e6-2c51338b9158', 'cb7bbad3-bfbb-457d-b2f2-6fd3b02df651'];
export const closedMusicVariables = Object.freeze(Object.fromEntries([
  'MUSIC_PUBLIC_ENABLED', 'MUSIC_UPLOADS_ENABLED', 'MUSIC_VIP_DELIVERY_ENABLED',
  'MUSIC_ANALYTICS_ENABLED', 'MUSIC_CLEANUP_ENABLED', 'MUSIC_SHARE_CARDS_ENABLED',
  'MUSIC_ANALYTICS_RETENTION_ENABLED'
].map(key => [key, 'false'])));
const requireCondition = (condition, code) => { if (!condition) throw new Error(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
const hash = value => createHash('sha256').update(value).digest('hex');

export function musicProductionCandidate(source, resources, root = productionRoot) {
  requireCondition(typeof source === 'string' && hash(source) === sourceDigest, 'MUSIC_PRODUCTION_BASELINE_CHANGED');
  const config = parse(source);
  requireCondition(keys(resources, ['account_id', 'compatibility_date', 'd1_databases', 'r2_buckets']), 'MUSIC_PRODUCTION_RESOURCE_FIELDS');
  requireCondition(resources.account_id === productionAccount, 'MUSIC_PRODUCTION_ACCOUNT');
  requireCondition(typeof resources.compatibility_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(resources.compatibility_date), 'MUSIC_PRODUCTION_RESOURCE_DATE');
  requireCondition(Array.isArray(resources.d1_databases) && resources.d1_databases.length === 1, 'MUSIC_PRODUCTION_DATABASES');
  const db = resources.d1_databases[0];
  requireCondition(keys(db, ['binding', 'database_name', 'database_id', 'migrations_dir']), 'MUSIC_PRODUCTION_DATABASE_FIELDS');
  requireCondition(db.binding === 'MUSIC_DB' && db.database_name === 'station-cat-music-production', 'MUSIC_PRODUCTION_DATABASE_NAME');
  requireCondition(typeof db.database_id === 'string' && uuid.test(db.database_id)
    && !stagingDatabases.includes(db.database_id)
    && !config.d1_databases.some(existing => existing.database_id === db.database_id), 'MUSIC_PRODUCTION_DATABASE_ID');
  requireCondition(db.migrations_dir === path.resolve(root, 'migrations-music'), 'MUSIC_PRODUCTION_MIGRATIONS');
  requireCondition(isDeepStrictEqual(resources.r2_buckets,
    [{ binding: 'MUSIC_BUCKET', bucket_name: 'station-cat-music-production-private' }]), 'MUSIC_PRODUCTION_BUCKET');
  // This validates local shape/isolation, not Cloudflare ownership. The operator
  // must match the private ID to fresh cloud inventory before approving deploy.
  config.account_id = resources.account_id;
  config.main = path.resolve(root, config.main);
  config.assets.directory = path.resolve(root, config.assets.directory);
  config.d1_databases = config.d1_databases.map(existing => ({ ...existing,
    migrations_dir: path.resolve(root, existing.migrations_dir || 'migrations') }));
  config.d1_databases.push(structuredClone(db));
  config.r2_buckets.push(structuredClone(resources.r2_buckets[0]));
  Object.assign(config.vars, closedMusicVariables);
  return config;
}

export function assertMusicProductionCandidate(candidate, source, resources, root = productionRoot) {
  requireCondition(isDeepStrictEqual(candidate, musicProductionCandidate(source, resources, root)), 'MUSIC_PRODUCTION_CANDIDATE_CHANGED');
  return candidate;
}

export async function writeMusicProductionCandidate(resourcesPath, outputPath) {
  // Require an existing private directory outside the checkout. Resolve symlinks
  // before the containment check and never overwrite a prior config or symlink.
  const root = await realpath(productionRoot), resourceFile = await realpath(resourcesPath);
  const output = path.resolve(outputPath), parent = await realpath(path.dirname(output));
  const outside = value => { const rel = path.relative(root, value); return rel === '..' || rel.startsWith(`..${path.sep}`); };
  requireCondition(outside(resourceFile) && outside(parent), 'MUSIC_PRODUCTION_PRIVATE_PATH_REQUIRED');
  const source = await readFile(path.join(root, 'wrangler.toml'), 'utf8');
  let resources;
  try { resources = JSON.parse(await readFile(resourceFile, 'utf8')); }
  catch { throw new Error('MUSIC_PRODUCTION_RESOURCE_READ'); }
  const candidate = musicProductionCandidate(source, resources, root);
  const file = await open(path.join(parent, path.basename(output)), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(candidate, null, 2) + '\n'); }
  finally { await file.close(); }
  return candidate;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireCondition(args.length === 4 && args[0] === '--resources' && args[2] === '--output', 'MUSIC_PRODUCTION_ARGUMENTS');
    await writeMusicProductionCandidate(args[1], args[3]);
    console.log('Prepared private closed candidate; no remote operation performed.');
  } catch (error) {
    // Filesystem/parser errors can contain private paths or source values.
    const safe = /^MUSIC_PRODUCTION_[A-Z_]+$/.test(error?.message || '') ? error.message : 'MUSIC_PRODUCTION_PREPARATION_FAILED';
    console.error(safe); process.exitCode = 1;
  }
}
