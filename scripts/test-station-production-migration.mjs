import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { PRODUCTION_ACCOUNT_ID, PRODUCTION_READER_DATABASE_ID } from '../src/mobile/environment.js';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { seedLegacyFixture, databaseRows } from './helpers/station-redesign-database.mjs';
import { backupHash, stableBackupJson } from './helpers/station-production-backup.mjs';
import { splitBackupSql, databaseBackupFingerprint } from './helpers/station-production-restore.mjs';
import { migrationRoot, migrationBaseline, legacyMigrationNames, stationMigrationNames, readMigrationSources,
  classifyMigrationLedger, migrationOnlyConfiguration, checkMigrationTarget, checkMigrationSnapshot,
  checkMigrationPacket, beforeMigration, afterMigration } from './helpers/station-production-migration.mjs';
import { localMigrationArguments } from './rehearse-station-production-migration.mjs';

const target = { binding: 'MUSIC_DB', id: '11111111-2222-4333-8444-555555555555', name: 'local-fixture-not-production' };
const ledger = legacyMigrationNames.map((name, i) => ({ id: i + 1, name, applied_at: '2026-10-11 00:00:00' }));
const clone = value => structuredClone(value);
const manifest = { schemaVersion: 1, task: 'L03', sourceRevision: migrationBaseline, binding: 'MUSIC_DB',
  targetSha256: backupHash(stableBackupJson(target)), executionEnabled: false, remoteMigrationExecuted: false, migrations: [] };
function snapshotFixture() {
  const now = Date.parse('2026-10-11T01:00:00Z'), schema = [{ type: 'table', name: 'music_tracks', sql: 'fixture' }];
  const snapshot = { schemaVersion: 1, recordedAt: new Date(now).toISOString(), target, versionId: 'version-fixture',
    deploymentId: 'deployment-fixture', accountId: PRODUCTION_ACCOUNT_ID, schema, ledger, switches: [],
    schemaSha256: backupHash(stableBackupJson(schema)), productionWrites: 0, remoteMigrationExecuted: false };
  const inputs = { plan: { databases: [target], versionId: snapshot.versionId, deploymentId: snapshot.deploymentId,
    accountId: snapshot.accountId }, source: { schemaSha256: snapshot.schemaSha256 } };
  return { now, snapshot, inputs };
}
function fixtureDatabase() {
  const fixture = musicTestDatabase();
  fixture.sql.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  for (const name of legacyMigrationNames) fixture.sql.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  return fixture;
}
function applyFile(sql, row, suffix = '') {
  sql.exec('BEGIN');
  try { sql.exec(row.sql); sql.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(row.name); if (suffix) sql.exec(suffix); sql.exec('COMMIT'); }
  catch (error) { sql.exec('ROLLBACK'); throw error; }
}

test('reviewed manifest pins the complete seven-file set and its merged source baseline', async () => {
  const { plan, sources } = await readMigrationSources();
  assert.equal(plan.sourceRevision, migrationBaseline); assert.equal(plan.executionEnabled, false);
  assert.equal(plan.remoteMigrationExecuted, false); assert.match(plan.targetSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(sources.map(row => row.name), stationMigrationNames);
  for (const row of sources) { assert.equal(backupHash(row.sql), row.sha256); assert.equal(Buffer.byteLength(row.sql), row.bytes); }
});
test('ledger accepts only the ordered legacy prefix and classifies interruption without automatic resume', () => {
  assert.equal(classifyMigrationLedger(ledger).applied, 0);
  for (let n = 1; n <= 7; n++) {
    const status = classifyMigrationLedger([...ledger, ...stationMigrationNames.slice(0, n).map(name => ({ name }))]);
    assert.equal(status.applied, n); assert.equal(status.complete, n === 7); assert.equal(status.resumeRequiresReview, n < 7);
  }
  for (const rows of [ledger.slice(0, -1), [...ledger, ledger[0]], [...ledger].reverse(),
    [...ledger, { name: stationMigrationNames[1] }], [...ledger, { name: 'foreign.sql' }]]) assert.throws(() => classifyMigrationLedger(rows), /STATION_MIGRATION_LEDGER/);
});
test('migration-only configuration rejects reader DB and cannot carry Worker, R2, vars or routing', () => {
  const config = migrationOnlyConfiguration(target);
  assert.deepEqual(Object.keys(config).sort(), ['account_id', 'compatibility_date', 'd1_databases', 'name']);
  assert.equal(config.d1_databases.length, 1); assert.equal(config.d1_databases[0].migrations_dir, 'migrations');
  for (const bad of [{ ...target, binding: 'WAITLIST_DB' }, { ...target, id: PRODUCTION_READER_DATABASE_ID },
    { ...target, name: '../escape' }, { ...target, id: 'unknown' }]) assert.throws(() => migrationOnlyConfiguration(bad), /STATION_MIGRATION_TARGET/);
  assert.doesNotThrow(() => checkMigrationTarget(target, manifest));
  assert.throws(() => checkMigrationTarget({ ...target, name: 'other' }, manifest), /TARGET_HASH/);
});
test('snapshot requires current time, exact target, original schema and zero prior Station migrations', () => {
  const { now, snapshot, inputs } = snapshotFixture();
  assert.deepEqual(checkMigrationSnapshot(snapshot, inputs, manifest, now), target);
  for (const mutate of [s => s.recordedAt = new Date(now + 1).toISOString(), s => s.recordedAt = new Date(now - 86400001).toISOString(),
    s => s.accountId = 'other', s => s.deploymentId = 'other', s => s.target = { ...target, name: 'other' },
    s => s.schema[0].sql = 'changed', s => s.schema.push({ name: 'station_games' }),
    s => s.ledger.push({ name: stationMigrationNames[0] }), s => s.switches.push({ name: 'STATION_CONTENT_PUBLIC_ENABLED', enabled: true }),
    s => s.productionWrites = 1, s => s.remoteMigrationExecuted = true]) {
    const bad = clone(snapshot); mutate(bad); assert.throws(() => checkMigrationSnapshot(bad, inputs, manifest, now), /STATION_MIGRATION_/);
  }
});
test('packet flags, resource hash and exact minimal configuration cannot be widened by editing private JSON', () => {
  const config = migrationOnlyConfiguration(target), packet = { ...manifest, target, executionReady: false, accountId: PRODUCTION_ACCOUNT_ID,
    backup: { freshnessAcceptedForExecution: false }, productionDeployed: false, legacyClosureVerified: false,
    proposedCommand: { executable: process.execPath, arguments: ['/fixture/bin/wrangler.js','d1','migrations','apply',target.name,'--remote','--config','/fixture/migration-only.json'], executed: false },
    configurationSha256: backupHash(stableBackupJson(config)) };
  assert.doesNotThrow(() => checkMigrationPacket(packet, config, manifest, '/fixture'));
  for (const changes of [{ executionEnabled: true }, { executionReady: true }, { sourceRevision: 'other' },
    { remoteMigrationExecuted: true }, { productionDeployed: true }, { legacyClosureVerified: true },
    { migrations: [{ name: 'unreviewed.sql' }] }, { target: { ...target, name: 'other' } }, { backup: { freshnessAcceptedForExecution: true } }]) {
    assert.throws(() => checkMigrationPacket({ ...packet, ...changes }, config, manifest, '/fixture'), /STATION_MIGRATION_/);
  }
  for (const changes of [{ main: 'src/worker.js' }, { vars: { STATION_CONTENT_PUBLIC_ENABLED: 'true' } },
    { d1_databases: [...config.d1_databases, { binding: 'WAITLIST_DB' }] }, { r2_buckets: [] }]) {
    assert.throws(() => checkMigrationPacket(packet, { ...config, ...changes }, manifest, '/fixture'), /CONFIGURATION/);
  }
  const changed = clone(packet); changed.proposedCommand.arguments[4] = 'WAITLIST_DB';
  assert.throws(() => checkMigrationPacket(changed, config, manifest, '/fixture'), /PROPOSED_COMMAND/);
});
test('all seven migrations preserve seeded legacy rows, sequences and charges and backfill only drafts', async () => {
  const fixture = fixtureDatabase(), { sources } = await readMigrationSources();
  try {
    await seedLegacyFixture(fixture.db); const before = beforeMigration(fixture.sql);
    for (const row of sources) applyFile(fixture.sql, row);
    const after = afterMigration(fixture.sql, before);
    assert.equal(after.draftTracks, 8); assert.equal(after.ledgerEntries, 18); assert.equal(after.stationTables, 32);
    assert.equal(after.publishedContent, 0); assert.equal(after.legacyChargesUnchanged, true);
    assert.equal(fixture.sql.prepare('SELECT count(*) n FROM station_promotion_revisions').get().n, 0);
    assert.equal(fixture.sql.prepare("SELECT count(*) n FROM station_track_revisions WHERE site_audio_mode='existing_entitlement'").get().n, 5);
    const postflight = await readFile(join(migrationRoot, 'ops/station-production-migration-check.sql'), 'utf8');
    for (const sql of splitBackupSql(postflight)) {
      assert.match(sql.replace(/^(?:\s|--[^\n]*(?:\n|$))+/, ''), /^(?:SELECT|PRAGMA)\b/);
      fixture.sql.prepare(sql).all();
    }
  } finally { fixture.sql.close(); }
});
test('a failed file rolls back its DDL and ledger while retaining the prior successful migration', async () => {
  const fixture = fixtureDatabase(), { sources } = await readMigrationSources();
  try {
    applyFile(fixture.sql, sources[0]); const before = databaseBackupFingerprint(fixture.sql);
    assert.throws(() => applyFile(fixture.sql, sources[1], 'SELECT * FROM missing_failure_fixture'), /missing_failure_fixture/);
    assert.deepEqual(databaseBackupFingerprint(fixture.sql), before);
    assert.equal(classifyMigrationLedger(fixture.sql.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).applied, 1);
    assert.throws(() => beforeMigration(fixture.sql), /NOT_FRESH_0011/);
    applyFile(fixture.sql, sources[1]); assert.equal(fixture.sql.prepare('SELECT count(*) n FROM d1_migrations').get().n, 13);
  } finally { fixture.sql.close(); }
});
test('0018 invalidates pre-seal aggregates but retains manual platform data and its recovery receipt', async () => {
  const fixture = fixtureDatabase(), { sources } = await readMigrationSources();
  try {
    const seeded = await seedLegacyFixture(fixture.db);
    for (const row of sources.slice(0, -1)) applyFile(fixture.sql, row);
    const zero = Object.fromEntries(['track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete',
      'game_launch_request','game_ready','save_success','visit_sessions','preview_sessions','click_sessions','unlinked_previews','unlinked_clicks','memory_events','time_anomalies'].map(key => [key, 0]));
    fixture.sql.prepare('INSERT INTO station_report_snapshots VALUES(?,?,?,?,?,?,?)').run('snapshot',0,86400000,'fixture',JSON.stringify(zero),86400000,172800000);
    fixture.sql.exec("INSERT INTO station_report_jobs(window_start,window_end,keys_json,status,expires_at) VALUES(0,86400000,'[\"fixture\"]','pending',172800000);");
    for (const kind of ['aggregate_snapshot', 'external_metric']) fixture.sql.prepare('INSERT INTO station_report_operations VALUES(?,?,?,?,?,?)')
      .run('fixture', '/fixture', kind, 'hash', JSON.stringify({ kind }), 172800000);
    fixture.sql.prepare('INSERT INTO station_external_metrics VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('metric', seeded.tracks[0].id, null, null, 'platform_plays', 'spotify', 42, 'platform_export', 'fixture CSV', 0, 86400000, 86400000, 86400000, 'active', 1, 172800000);
    const figures = fixture.sql.prepare('SELECT * FROM station_external_metrics').all();
    applyFile(fixture.sql, sources.at(-1));
    assert.equal(fixture.sql.prepare('SELECT count(*) n FROM station_report_snapshots').get().n, 0);
    assert.equal(fixture.sql.prepare('SELECT count(*) n FROM station_report_jobs').get().n, 0);
    assert.deepEqual(fixture.sql.prepare('SELECT * FROM station_external_metrics').all(), figures);
    assert.deepEqual(fixture.sql.prepare('SELECT idempotency_key FROM station_report_operations').all().map(r => r.idempotency_key), ['external_metric']);
    assert.equal(fixture.sql.prepare('SELECT count(*) n FROM station_report_retention_guard').get().n, 0);
    assert.throws(() => applyFile(fixture.sql, sources.at(-1)), /STATION_REPORT_SEAL_RETAINED|already exists|UNIQUE/);
  } finally { fixture.sql.close(); }
});
test('local rehearsal command fixes --local, has no production account and rejects ordinary database names', () => {
  const args = localMigrationArguments('/fixture/wrangler.js', 'station-cat-l03-isolated-fixture', '/fixture/local.json', '/fixture/local');
  assert(args.includes('--local')); assert(!args.includes('--remote')); assert(!args.includes('--env'));
  assert.throws(() => localMigrationArguments('/cli', 'MUSIC_DB', '/config', '/data'), /LOCAL_TARGET/);
});
test('preparation CLI has no production mutation operation and uses SELECTs instead of migrations list', async () => {
  const source = await readFile(join(migrationRoot, 'scripts/station-production-migration.mjs'), 'utf8');
  assert.match(source, /\['inventory', 'prepare', 'verify'\]/); assert.doesNotMatch(source, /exportDatabase|\.export\(|'--remote'|\.deploy\(/);
});
test('native D1 rolls back a failed middle migration and preserves old readers through the complete set', async () => {
  const { sources } = await readMigrationSources();
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("isolated");}};',
    compatibilityDate: '2026-05-17', host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE),
    d1Databases: { LOCAL_MUSIC: 'station-l03-ci-fixture' }, outboundService: () => new Response('blocked', { status: 403 }) });
  try {
    const db = await mf.getD1Database('LOCAL_MUSIC');
    for (const name of legacyMigrationNames) await db.batch(splitBackupSql(await readFile(join(migrationRoot, 'migrations-music', name), 'utf8')).map(sql => db.prepare(sql)));
    await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run();
    for (const name of legacyMigrationNames) await db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(name).run();
    await seedLegacyFixture(db); const before = await databaseRows(db);
    const statements = row => [...splitBackupSql(row.sql).map(sql => db.prepare(sql)), db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(row.name)];
    await db.batch(statements(sources[0]));
    await assert.rejects(db.batch([...statements(sources[1]), db.prepare('SELECT * FROM missing_failure_fixture')]), /missing_failure_fixture/);
    assert.equal((await db.prepare('SELECT count(*) n FROM d1_migrations').first()).n, 12);
    assert.equal((await db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='station_media_upload_sessions'").first()).n, 0);
    for (const row of sources.slice(1)) await db.batch(statements(row));
    assert.deepEqual(await databaseRows(db), before);
    assert.equal((await db.prepare('SELECT count(*) n FROM d1_migrations').first()).n, 18);
    assert.equal((await db.prepare('SELECT count(*) n FROM station_track_publications WHERE published_revision IS NOT NULL').first()).n, 0);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    await assert.rejects(db.prepare('DELETE FROM station_report_window_seal').run(), /STATION_REPORT_SEAL_RETAINED/);
    await assert.rejects(db.prepare("INSERT INTO station_games(id,slug,runtime_key,created_at,updated_at) VALUES('fixture','cat-life','cat-life',0,0)").run(), /CHECK constraint/);
  } finally { await mf.dispose(); }
}, { timeout: 60000 });
