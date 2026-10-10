import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stationReleaseCandidate, writeStationReleaseCandidate, closedStationVariables, releaseRoot } from './build-station-release-candidate.mjs';
import { musicProductionCandidate } from './build-music-production-candidate.mjs';
import { PRODUCTION_ACCOUNT_ID, NONPRODUCTION_DATABASE_IDS } from '../src/mobile/environment.js';
import { inspectMigrationRouting } from '../src/redesign/routeMigrationProfile.js';
import { rehearseStationRelease } from './helpers/station-release-rehearsal.mjs';
import { assessReleaseReadiness } from './verify-station-release-readiness.mjs';

const source = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const base = musicProductionCandidate(source, { account_id: PRODUCTION_ACCOUNT_ID, compatibility_date: '2026-05-17',
  d1_databases: [{ binding: 'MUSIC_DB', database_name: 'station-cat-music-production', database_id: 'ca220000-0000-4000-8000-000000000001', migrations_dir: join(releaseRoot, 'migrations-music') }],
  r2_buckets: [{ binding: 'MUSIC_BUCKET', bucket_name: 'station-cat-music-production-private' }] });
// Explicit synthetic baseline values test preserving existing services.
Object.assign(base.vars, { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true', MOBILE_AUTH_ENABLED: 'true',
  MOBILE_BINDING_MANIFEST_JSON: 'synthetic-test-only', CREEM_MODE: 'production', STATION_EVENTS_ENABLED: 'true' });

test('candidate closes every Station flag and covers the complete routing contract without altering its source', () => {
  const original = structuredClone(base), config = stationReleaseCandidate(base);
  assert.deepEqual(base, original); assert.ok(inspectMigrationRouting(config.assets.run_worker_first).satisfied);
  for (const [key, value] of Object.entries(closedStationVariables)) assert.equal(config.vars[key], value);
  const expected = structuredClone(base); expected.assets.run_worker_first = true; Object.assign(expected.vars, closedStationVariables);
  assert.deepEqual(config, expected);
  for (const key of ['MUSIC_PUBLIC_ENABLED', 'MUSIC_VIP_DELIVERY_ENABLED', 'MOBILE_AUTH_ENABLED', 'MOBILE_BINDING_MANIFEST_JSON', 'CREEM_MODE']) assert.equal(config.vars[key], base.vars[key]);
});
for (const [label, mutate, code] of [
  ['wrong worker', x => x.name = 'another-worker', 'TARGET'],
  ['wrong account', x => x.account_id = 'unverified', 'TARGET'],
  ['preview exposure', x => x.preview_urls = true, 'PUBLIC_BOUNDARY'],
  ['hidden environment overrides', x => x.env = { production: { vars: { STATION_EVENTS_ENABLED: 'true' } } }, 'PUBLIC_BOUNDARY'],
  ['wrong assets', x => x.assets.directory = '/tmp/unreviewed-assets', 'ASSETS'],
  ['missing music binding', x => x.d1_databases.pop(), 'DATABASE_BOUNDARY'],
  ['staging database', x => x.d1_databases[1].database_id = NONPRODUCTION_DATABASE_IDS[0], 'DATABASE_BOUNDARY'],
  ['duplicate bindings', x => x.d1_databases.push(x.d1_databases[1]), 'DATABASES'],
  ['reader mistaken for music', x => x.d1_databases[1].database_id = x.d1_databases[0].database_id, 'DATABASE_BOUNDARY'],
  ['wrong bucket', x => x.r2_buckets.find(row => row.binding === 'MUSIC_BUCKET').bucket_name = 'station-cat-music-staging-private', 'BUCKET_BOUNDARY'],
  ['missing existing content bucket', x => x.r2_buckets = x.r2_buckets.filter(row => row.binding !== 'CONTENT_BUCKET'), 'BUCKET_BOUNDARY'],
  ['missing existing downloads bucket', x => x.r2_buckets = x.r2_buckets.filter(row => row.binding !== 'DOWNLOADS_BUCKET'), 'BUCKET_BOUNDARY'],
]) test('candidate rejects ' + label, () => {
  const config = structuredClone(base); mutate(config); assert.throws(() => stationReleaseCandidate(config), new RegExp('STATION_RELEASE_' + code));
});
test('private writer requires the exact baseline, never overwrites and does not follow an output symlink', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'station-t22-config-test-')); t.after(() => rm(folder, { recursive: true, force: true }));
  const input = join(folder, 'baseline.json'), output = join(folder, 'closed.json'), source = JSON.stringify(base);
  await writeFile(input, source, { mode: 0o600 }); const hash = createHash('sha256').update(source).digest('hex');
  await assert.rejects(writeStationReleaseCandidate(input, '0'.repeat(64), output), /BASE_HASH/);
  const report = await writeStationReleaseCandidate(input, hash, output); assert.equal(report.deployed, false); assert.equal(report.productionVerified, false);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  await assert.rejects(writeStationReleaseCandidate(input, hash, output), { code: 'EEXIST' });
  const link = join(folder, 'link.json'); await symlink(input, link);
  await assert.rejects(writeStationReleaseCandidate(input, hash, link), { code: 'EEXIST' });
  assert.equal(await readFile(input, 'utf8'), source);
  await assert.rejects(writeStationReleaseCandidate(input, hash, join(releaseRoot, 'ops', 'unsafe.json')), /PRIVATE_PATH_REQUIRED/);
});
test('release readiness keeps preparation, deployment and closure separate and refuses missing gates', async () => {
  const status = JSON.parse(await readFile(new URL('../ops/station-release-readiness.json', import.meta.url)));
  const result = assessReleaseReadiness(status);
  assert.equal(result.launchReady, false); assert.equal(result.productionDeployed, false); assert.equal(result.legacyClosureVerified, false);
  assert.ok(result.unsatisfied.includes('performance')); assert.ok(result.unsatisfied.includes('production-schema'));
  const incomplete = structuredClone(status); incomplete.gates.pop(); assert.throws(() => assessReleaseReadiness(incomplete), /GATE_SET/);
  const forged = structuredClone(status); forged.gates[0].status = 'passed'; forged.gates[0].evidence = []; assert.throws(() => assessReleaseReadiness(forged), /EVIDENCE/);
});
test('native release rehearsal restores into clones and retains post-migration orders, saves and revisions', async t => {
  const { report } = await rehearseStationRelease();
  assert.equal(report.production, false); assert.equal(report.remoteOperations, 0);
  assert.deepEqual(report.appliedMigrations.map(row => row.name.slice(0, 4)), ['0012','0013','0014','0015','0016','0017','0018']);
  for (const [name, passed] of Object.entries(report.checks)) await t.test(name, () => assert.equal(passed, true));
  assert.equal(report.observations.activeDatabaseWasRestored, false);
});
