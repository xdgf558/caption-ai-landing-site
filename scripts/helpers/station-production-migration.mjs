import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_ACCOUNT_ID, PRODUCTION_READER_DATABASE_ID } from '../../src/mobile/environment.js';
import { backupHash, stableBackupJson, hashBackupFile, privateBackupJson, privateBackupDirectory } from './station-production-backup.mjs';
import { readBackupPlan, checkBackupDeployment } from '../station-production-backup.mjs';
import { databaseBackupFingerprint, canonicalBackupSql } from './station-production-restore.mjs';

export const migrationRoot = fileURLToPath(new URL('../../', import.meta.url));
export const migrationBaseline = '8b8a5b3facc5decb6f1989bcf54f0096bd5b431b';
export const legacyMigrationNames = [
  '0001_music_foundation.sql', '0002_music_publication.sql', '0003_music_uploads.sql',
  '0004_music_cleanup.sql', '0005_music_rate_limits.sql', '0006_music_analytics.sql',
  '0007_music_albums.sql', '0008_music_featured.sql', '0009_music_album_covers.sql',
  '0010_music_limited_free.sql', '0011_music_share_rate_limits.sql',
];
export const stationMigrationNames = [
  '0012_station_redesign.sql', '0013_station_media_uploads.sql', '0014_station_content_operations.sql',
  '0015_station_campaign_links.sql', '0016_station_event_collection.sql', '0017_station_reports.sql',
  '0018_station_report_window_seals.sql',
];
const fail = code => { throw new Error('STATION_MIGRATION_' + code); };
const check = (value, code) => { if (!value) fail(code); };
const equal = (a, b) => stableBackupJson(a) === stableBackupJson(b);

// All filenames and hashes come from a reviewed, repository-local manifest.
// An execution packet cannot add a migration, edit SQL, or choose another DB.
export async function readMigrationSources() {
  const plan = JSON.parse(await readFile(join(migrationRoot, 'ops/station-production-migration.json')));
  check(plan.schemaVersion === 1 && plan.task === 'L03' && plan.sourceRevision === migrationBaseline &&
    plan.binding === 'MUSIC_DB' && plan.executionEnabled === false && plan.remoteMigrationExecuted === false &&
    /^[0-9a-f]{64}$/.test(plan.targetSha256 || '') &&
    equal(plan.migrations?.map(row => row.name), stationMigrationNames), 'MANIFEST');
  const sources = [];
  for (const row of plan.migrations) {
    const bytes = await readFile(join(migrationRoot, 'migrations-music', row.name));
    check(bytes.length === row.bytes && backupHash(bytes) === row.sha256, 'SQL_HASH');
    sources.push({ ...row, sql: bytes.toString('utf8') });
  }
  return { plan, sources };
}

export function checkMigrationTarget(target, plan) {
  migrationOnlyConfiguration(target);
  check(backupHash(stableBackupJson(target)) === plan.targetSha256, 'TARGET_HASH');
}

export function classifyMigrationLedger(rows) {
  check(Array.isArray(rows) && rows.every(row => typeof row.name === 'string'), 'LEDGER');
  const names = rows.map(row => row.name), expected = [...legacyMigrationNames, ...stationMigrationNames];
  check(names.length >= legacyMigrationNames.length && names.length <= expected.length &&
    equal(names, expected.slice(0, names.length)), 'LEDGER');
  const applied = names.length - legacyMigrationNames.length;
  return { applied, complete: applied === stationMigrationNames.length, pending: stationMigrationNames.slice(applied),
    resumeRequiresReview: applied > 0 && applied < stationMigrationNames.length };
}

export function migrationOnlyConfiguration(target) {
  check(target?.binding === 'MUSIC_DB' && /^[0-9a-f-]{36}$/.test(target.id || '') &&
    target.id !== PRODUCTION_READER_DATABASE_ID && /^[a-zA-Z0-9_-]{1,64}$/.test(target.name || ''), 'TARGET');
  return { name: 'station-cat-l03-migration-only', account_id: PRODUCTION_ACCOUNT_ID, compatibility_date: '2026-05-17',
    d1_databases: [{ binding: 'MUSIC_DB', database_name: target.name, database_id: target.id,
      migrations_dir: 'migrations', migrations_table: 'd1_migrations' }] };
}

function queryRows(response) {
  check(response?.result?.length === 1 && response.result[0].success === true &&
    Array.isArray(response.result[0].results), 'QUERY');
  return response.result[0].results;
}
export async function readProductionMigrationState(cloud, plan) {
  await checkBackupDeployment(cloud, plan);
  const target = plan.databases.find(row => row.binding === 'MUSIC_DB');
  checkMigrationTarget(target, (await readMigrationSources()).plan);
  const info = (await cloud.json('/d1/database/' + target.id)).result;
  check(info?.uuid === target.id && info.name === target.name, 'DATABASE_IDENTITY');
  const schema = await cloud.schema(target.id);
  check(schema.some(row => row.type === 'table' && row.name === 'd1_migrations'), 'LEDGER_MISSING');
  // These are fixed SELECTs. Wrangler migrations list initializes its ledger,
  // so it is deliberately excluded from this read-only production collector.
  const ledger = queryRows(await cloud.json('/d1/database/' + target.id + '/query', {
    metadataSql: 'SELECT id,name,applied_at FROM d1_migrations ORDER BY id',
  }));
  const status = classifyMigrationLedger(ledger);
  check(status.applied === 0 && !schema.some(row => row.name.startsWith('station_')), 'NOT_FRESH_0011');
  const counts = queryRows(await cloud.json('/d1/database/' + target.id + '/query', {
    metadataSql: 'SELECT (SELECT count(*) FROM music_tracks) AS tracks,(SELECT count(*) FROM music_track_revisions) AS revisions,(SELECT count(*) FROM music_assets) AS assets',
  }));
  check(counts.length === 1 && Object.values(counts[0]).every(value => Number.isSafeInteger(value) && value >= 0), 'COUNTS');
  const version = (await cloud.json('/workers/scripts/' + plan.scriptName + '/versions/' + plan.versionId)).result;
  const bindings = version?.resources?.bindings;
  check(Array.isArray(bindings), 'BINDINGS');
  // A secret binding with a Station name is unverifiable, not an off switch.
  const switches = bindings.filter(row => /^STATION_/.test(row.name || '')).map(row => {
    check(row.type === 'plain_text' && !['true', '1'].includes(String(row.text).trim().toLowerCase()), 'STATION_SWITCH_ENABLED');
    return { name: row.name, enabled: false };
  });
  await checkBackupDeployment(cloud, plan);
  return { schemaVersion: 1, recordedAt: new Date().toISOString(), target, versionId: plan.versionId,
    deploymentId: plan.deploymentId, accountId: plan.accountId, schema, ledger, counts: counts[0], switches,
    schemaSha256: backupHash(stableBackupJson(schema)), productionWrites: 0, remoteMigrationExecuted: false };
}

export async function migrationBackupInputs(directory) {
  const { root, plan } = await readBackupPlan(directory);
  const manifestPath = join(root, 'databases/manifest.json');
  const manifestHash = await hashBackupFile(manifestPath), manifest = JSON.parse(await readFile(manifestPath));
  check(manifest.complete === true && manifest.databases?.length === 2 &&
    new Set(manifest.databases.map(row => row.binding)).size === 2, 'BACKUP_MANIFEST');
  const source = manifest.databases.find(row => row.binding === 'MUSIC_DB');
  const target = plan.databases.find(row => row.binding === 'MUSIC_DB');
  check(source?.databaseId === target?.id && source.file === 'MUSIC_DB.sql' &&
    Number.isFinite(Date.parse(source.capturedAt)), 'BACKUP_TARGET');
  const sourcePath = join(root, 'databases', source.file), actual = await hashBackupFile(sourcePath);
  check(actual.bytes === source.bytes && actual.sha256 === source.sha256, 'BACKUP_HASH');
  return { root, plan, source, sourcePath, manifestHash };
}

export function checkMigrationSnapshot(snapshot, inputs, manifest, now) {
  const target = inputs.plan.databases.find(row => row.binding === 'MUSIC_DB');
  checkMigrationTarget(target, manifest);
  const age = now - Date.parse(snapshot.recordedAt);
  check(snapshot.schemaVersion === 1 && age >= 0 && age <= 86400000 && snapshot.accountId === inputs.plan.accountId &&
    snapshot.versionId === inputs.plan.versionId && snapshot.deploymentId === inputs.plan.deploymentId && equal(snapshot.target, target) &&
    snapshot.productionWrites === 0 && snapshot.remoteMigrationExecuted === false, 'SNAPSHOT');
  check(classifyMigrationLedger(snapshot.ledger).applied === 0 &&
    !snapshot.schema.some(row => row.name.startsWith('station_')) &&
    backupHash(stableBackupJson(snapshot.schema)) === snapshot.schemaSha256 &&
    snapshot.schemaSha256 === inputs.source.schemaSha256, 'BACKUP_SCHEMA');
  check(Array.isArray(snapshot.switches) && snapshot.switches.every(row => row.enabled === false), 'STATION_SWITCH_ENABLED');
  return target;
}

export async function prepareMigrationPacket(backupDirectory, snapshotDirectory, outputDirectory, now = Date.now()) {
  const inputs = await migrationBackupInputs(backupDirectory);
  const snapshotRoot = await privateBackupDirectory(snapshotDirectory);
  const snapshotPath = join(snapshotRoot, 'migration-readonly.json'), snapshotHash = await hashBackupFile(snapshotPath);
  const snapshot = JSON.parse(await readFile(snapshotPath));
  const { plan, sources } = await readMigrationSources();
  const target = checkMigrationSnapshot(snapshot, inputs, plan, now);
  const root = await privateBackupDirectory(outputDirectory, { create: true, fresh: true });
  const migrations = await privateBackupDirectory(join(root, 'migrations'), { create: true, fresh: true });
  const { open } = await import('node:fs/promises');
  for (const row of sources) {
    const file = await open(join(migrations, row.name), 'wx', 0o600);
    try { await file.writeFile(row.sql); } finally { await file.close(); }
  }
  const configuration = migrationOnlyConfiguration(target);
  await privateBackupJson(join(root, 'migration-only.json'), configuration);
  const packet = { ...plan, preparedAt: new Date(now).toISOString(), target,
    accountId: inputs.plan.accountId, versionId: inputs.plan.versionId, deploymentId: inputs.plan.deploymentId,
    sourceBackupDirectory: inputs.root, sourceSnapshotDirectory: snapshotRoot,
    configurationSha256: backupHash(stableBackupJson(configuration)), snapshotSha256: snapshotHash.sha256,
    backup: { sha256: inputs.source.sha256, bytes: inputs.source.bytes, capturedAt: inputs.source.capturedAt,
      schemaSha256: inputs.source.schemaSha256, manifestSha256: inputs.manifestHash.sha256,
      ageMs: now - Date.parse(inputs.source.capturedAt), dataFrozen: false, freshnessAcceptedForExecution: false },
    executionReady: false, blockingConditions: ['reviewed exact-head CI', 'current MUSIC_DB maintenance window',
      'current backup freshness and recovery decision', 'immediate read-only preflight'],
    proposedCommand: { executable: process.execPath, arguments: [inputs.plan.wranglerPath, 'd1', 'migrations', 'apply',
      target.name, '--remote', '--config', join(root, 'migration-only.json')],
      executed: false, authority: 'operator reference after separate reviewed execution and maintenance-window approval' },
    productionDeployed: false, legacyClosureVerified: false };
  await privateBackupJson(join(root, 'packet.json'), packet);
  return packet;
}

export function checkMigrationPacket(packet, config, plan, directory) {
  checkMigrationTarget(packet.target, plan);
  check(packet.schemaVersion === 1 && packet.task === 'L03' && packet.sourceRevision === plan.sourceRevision &&
    packet.executionEnabled === false && packet.executionReady === false && packet.remoteMigrationExecuted === false &&
    equal(packet.migrations, plan.migrations) && packet.accountId === PRODUCTION_ACCOUNT_ID &&
    packet.backup?.freshnessAcceptedForExecution === false && packet.productionDeployed === false &&
    packet.legacyClosureVerified === false, 'PACKET');
  const expected = migrationOnlyConfiguration(packet.target);
  check(equal(config, expected) && backupHash(stableBackupJson(config)) === packet.configurationSha256, 'CONFIGURATION');
  const command = packet.proposedCommand, args = command?.arguments;
  check(command?.executed === false && command.executable === process.execPath && Array.isArray(args) && args.length === 8 &&
    typeof args[0] === 'string' && args[0].startsWith('/') && args[0].endsWith('/bin/wrangler.js') &&
    equal(args.slice(1, 7), ['d1', 'migrations', 'apply', packet.target.name, '--remote', '--config']) &&
    args[7] === join(directory, 'migration-only.json'), 'PROPOSED_COMMAND');
}

export async function verifyMigrationPacket(directory) {
  const root = await privateBackupDirectory(directory);
  await hashBackupFile(join(root, 'packet.json'));
  const packet = JSON.parse(await readFile(join(root, 'packet.json'))), { plan } = await readMigrationSources();
  const configPath = join(root, 'migration-only.json'); await hashBackupFile(configPath);
  const config = JSON.parse(await readFile(configPath));
  checkMigrationPacket(packet, config, plan, root);
  const migrationDirectory = await privateBackupDirectory(join(root, 'migrations'));
  const files = (await readdir(migrationDirectory)).sort();
  check(equal(files, stationMigrationNames), 'MIGRATION_FILES');
  for (const row of plan.migrations) {
    const actual = await hashBackupFile(join(migrationDirectory, row.name));
    check(actual.sha256 === row.sha256 && actual.bytes === row.bytes, 'SQL_HASH');
  }
  const inputs = await migrationBackupInputs(packet.sourceBackupDirectory);
  check(inputs.source.sha256 === packet.backup.sha256 && inputs.manifestHash.sha256 === packet.backup.manifestSha256, 'BACKUP_PACKET');
  const snapshotRoot = await privateBackupDirectory(packet.sourceSnapshotDirectory);
  const snapshotPath = join(snapshotRoot, 'migration-readonly.json');
  check((await hashBackupFile(snapshotPath)).sha256 === packet.snapshotSha256, 'SNAPSHOT_HASH');
  checkMigrationSnapshot(JSON.parse(await readFile(snapshotPath)), inputs, plan, Date.now());
  return packet;
}

const schemaRows = database => database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()
  .map(row => ({ ...row, sql: canonicalBackupSql(row.sql) }));
export function beforeMigration(database) {
  check(!schemaRows(database).some(row => row.name.startsWith('station_')), 'NOT_FRESH_0011');
  const ledger = database.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all();
  check(classifyMigrationLedger(ledger).applied === 0, 'NOT_FRESH_0011');
  return { fingerprint: databaseBackupFingerprint(database), schema: schemaRows(database), ledger,
    sequence: database.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all(),
    storageChargesSha256: backupHash(stableBackupJson(database.prepare('SELECT * FROM music_storage_charges ORDER BY asset_id,charged_bytes').all())) };
}
export function afterMigration(database, before) {
  const after = databaseBackupFingerprint(database), rows = database.prepare('SELECT id,name,applied_at FROM d1_migrations ORDER BY id').all();
  check(classifyMigrationLedger(rows).complete && equal(rows.slice(0, 11), before.ledger), 'FINAL_LEDGER');
  const schema = schemaRows(database), preserved = before.fingerprint.tables.filter(row => !['d1_migrations', 'sqlite_sequence'].includes(row.table));
  for (const row of preserved) check(equal(row, after.tables.find(item => item.table === row.table)), 'LEGACY_DATA_CHANGED');
  // 0012 expands cleanup references; 0013 adds Station upload charges. These
  // are the only existing schema objects intentionally replaced by the set.
  for (const row of before.schema) if (!['music_asset_references', 'music_storage_charges'].includes(row.name)) {
    check(equal(row, schema.find(item => item.type === row.type && item.name === row.name)), 'LEGACY_SCHEMA_CHANGED');
  }
  const sequence = database.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all();
  for (const row of before.sequence.filter(row => row.name !== 'd1_migrations')) {
    check(equal(row, sequence.find(item => item.name === row.name)), 'LEGACY_SEQUENCE_CHANGED');
  }
  const count = table => database.prepare('SELECT count(*) AS n FROM ' + table).get().n;
  const tracks = count('music_tracks');
  check(count('station_track_publications') === tracks && count('station_track_routes') === tracks &&
    count('station_track_revisions') === tracks, 'BACKFILL');
  check(database.prepare("SELECT count(*) AS n FROM station_track_publications WHERE status<>'draft' OR published_revision IS NOT NULL OR draft_revision IS NOT 1").get().n === 0, 'PUBLICATION');
  check(database.prepare("SELECT count(*) AS n FROM station_home_configs WHERE status<>'draft' OR published_revision IS NOT NULL OR draft_revision IS NOT 1").get().n === 0 && count('station_home_configs') === 1, 'HOME');
  check(database.prepare("SELECT count(*) AS n FROM station_home_revisions WHERE featured_track_id IS NOT NULL OR featured_game_id IS NOT NULL OR selected_track_ids_json<>'[]' OR selected_clip_ids_json<>'[]' OR selected_update_ids_json<>'[]'").get().n === 0 && count('station_home_revisions') === 1, 'HOME');
  for (const table of ['station_promotions', 'station_platform_links', 'station_games', 'station_clips', 'station_asset_rights',
    'station_media_assets', 'station_analytics_events', 'station_report_snapshots', 'station_report_jobs', 'station_event_inflight']) {
    check(count(table) === 0, 'UNEXPECTED_PUBLIC_CONTENT');
  }
  const view = database.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='music_asset_references'").get()?.sql;
  check(['station_track_revisions', 'station_asset_rights'].every(name => view?.includes(name)), 'CLEANUP_VIEW');
  const storageView = database.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='music_storage_charges'").get()?.sql;
  check(['station_media_upload_sessions', 'station_media_assets'].every(name => storageView?.includes(name)) &&
    backupHash(stableBackupJson(database.prepare('SELECT * FROM music_storage_charges ORDER BY asset_id,charged_bytes').all())) === before.storageChargesSha256, 'STORAGE_VIEW');
  check(equal(database.prepare('SELECT sealed_before,updated_at FROM station_report_window_seal WHERE singleton=1').get(), { sealed_before: 0, updated_at: 0 }) &&
    count('station_report_window_seal') === 1 && count('station_report_retention_guard') === 0, 'SEAL');
  check(schema.filter(row => row.type === 'table' && row.name.startsWith('station_')).length === 32, 'STATION_SCHEMA');
  return { complete: true, legacyTablesPreserved: preserved.length, legacyRowsPreserved: preserved.reduce((n, row) => n + row.rows, 0),
    legacyDataSha256: backupHash(stableBackupJson(preserved)), ledgerEntries: rows.length,
    stationTables: schema.filter(row => row.type === 'table' && row.name.startsWith('station_')).length,
    draftTracks: tracks, homeDrafts: 1, publishedContent: 0, promotions: 0, platformLinks: 0,
    integrity: after.integrity, foreignKeys: after.foreignKeys, schemaSha256: after.schemaSha256,
    finalFingerprint: after.fingerprint, cleanupViewExpanded: true, storageViewExpanded: true, legacyChargesUnchanged: true };
}
