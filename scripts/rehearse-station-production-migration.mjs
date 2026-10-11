import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { privateBackupDirectory, privateBackupJson, hashBackupFile, backupHash, stableBackupJson } from './helpers/station-production-backup.mjs';
import { prepareDatabaseBackupRestore, splitBackupSql, databaseBackupFingerprint } from './helpers/station-production-restore.mjs';
import { migrationBackupInputs, readMigrationSources, verifyMigrationPacket, beforeMigration, afterMigration } from './helpers/station-production-migration.mjs';

const run = promisify(execFile);
const fail = code => { throw new Error('STATION_MIGRATION_' + code); };
const check = (value, code) => { if (!value) fail(code); };
async function sqliteFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    check(!entry.isSymbolicLink(), 'LOCAL_SYMLINK');
    if (entry.isDirectory()) files.push(...await sqliteFiles(join(directory, entry.name)));
    else if (entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') files.push(join(directory, entry.name));
  }
  return files;
}
export function localMigrationArguments(cli, name, config, persistence) {
  check(name.startsWith('station-cat-l03-isolated-'), 'LOCAL_TARGET');
  return [cli, 'd1', 'migrations', 'apply', name, '--local', '--config', config, '--persist-to', persistence];
}
export async function rehearseProductionMigration(backupDirectory, packetDirectory, outputDirectory) {
  process.umask(0o077);
  const packet = await verifyMigrationPacket(packetDirectory), inputs = await migrationBackupInputs(backupDirectory);
  check(packet.backup.sha256 === inputs.source.sha256 && packet.backup.manifestSha256 === inputs.manifestHash.sha256 &&
    packet.target.id === inputs.source.databaseId, 'BACKUP_PACKET');
  const require = createRequire(inputs.plan.wranglerPath);
  check(JSON.parse(await readFile(require.resolve('wrangler/package.json'))).version === '4.131.1', 'WRANGLER_VERSION');
  const { sources } = await readMigrationSources();
  const root = await privateBackupDirectory(outputDirectory, { create: true, fresh: true });
  const referencePath = join(root, 'reference.sqlite'), file = await open(referencePath, 'wx', 0o600); await file.close();
  const reference = new DatabaseSync(referencePath);
  let before, prepared, sqlite;
  try {
    prepared = prepareDatabaseBackupRestore(reference, await readFile(inputs.sourcePath, 'utf8'));
    before = beforeMigration(reference);
    // Each file and its ledger insertion commits independently. A failed file
    // cannot leave a misleading ledger row; earlier files remain committed.
    for (const row of sources) {
      reference.exec('BEGIN');
      try { reference.exec(row.sql); reference.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(row.name); reference.exec('COMMIT'); }
      catch { reference.exec('ROLLBACK'); fail('SQLITE_APPLY'); }
    }
    sqlite = afterMigration(reference, before);
  } finally { reference.close(); }

  const localId = randomUUID(), name = 'station-cat-l03-isolated-' + localId;
  check(!inputs.plan.databases.some(row => row.id === localId), 'LOCAL_TARGET');
  const persistence = await privateBackupDirectory(join(root, 'native-d1'), { create: true, fresh: true });
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("local migration rehearsal"); } };',
    compatibilityDate: '2026-05-17', host: '127.0.0.1', port: 0, log: new Log(LogLevel.NONE),
    d1Databases: { LOCAL_MUSIC: localId }, d1Persist: join(persistence, 'v3/d1'),
    outboundService: () => new Response('Network disabled', { status: 403 }) });
  try {
    const database = await mf.getD1Database('LOCAL_MUSIC');
    for (const stage of prepared.stages) {
      const statements = splitBackupSql(stage.sql);
      // Keep the data stage in one local transaction: deferred FK checks can
      // reference rows later in that stage. This is not a production importer.
      await database.batch(statements.map(sql => database.prepare(sql)));
    }
  } catch { fail('NATIVE_IMPORT'); } finally { await mf.dispose(); }
  const imported = await sqliteFiles(persistence); check(imported.length === 1, 'NATIVE_FILES');
  const importedDb = new DatabaseSync(imported[0], { readOnly: true });
  try { check(stableBackupJson(databaseBackupFingerprint(importedDb)) === stableBackupJson(before.fingerprint), 'NATIVE_IMPORT_FINGERPRINT'); }
  finally { importedDb.close(); }

  const config = join(root, 'local-only.json');
  await privateBackupJson(config, { name: 'station-cat-l03-local-rehearsal', compatibility_date: '2026-05-17',
    d1_databases: [{ binding: 'LOCAL_MUSIC', database_name: name, database_id: localId,
      migrations_dir: resolve(packetDirectory, 'migrations'), migrations_table: 'd1_migrations' }] });
  const logs = await privateBackupDirectory(join(root, 'logs'), { create: true, fresh: true });
  const options = { cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: logs, WRANGLER_SEND_METRICS: 'false' },
    timeout: 600000, maxBuffer: 16 * 1024 * 1024 };
  const args = localMigrationArguments(inputs.plan.wranglerPath, name, config, persistence);
  async function apply(logName) {
    const result = await run(process.execPath, args, options).catch(async error => {
      await writeFile(join(logs, logName), (error.stdout || '') + (error.stderr || ''), { mode: 0o600 }); fail('NATIVE_APPLY');
    });
    await writeFile(join(logs, logName), result.stdout + result.stderr, { mode: 0o600 });
  }
  await apply('first-apply.private.log');
  const migrated = new DatabaseSync(imported[0], { readOnly: true }); let native, fingerprint;
  try { native = afterMigration(migrated, before); fingerprint = databaseBackupFingerprint(migrated); } finally { migrated.close(); }
  check(native.schemaSha256 === sqlite.schemaSha256 && native.legacyDataSha256 === sqlite.legacyDataSha256, 'ENGINES_DIFFER');
  await apply('second-apply.private.log');
  const repeated = new DatabaseSync(imported[0], { readOnly: true });
  try { check(stableBackupJson(databaseBackupFingerprint(repeated)) === stableBackupJson(fingerprint), 'LEDGER_REPLAY'); }
  finally { repeated.close(); }
  check((await hashBackupFile(inputs.sourcePath)).sha256 === inputs.source.sha256, 'SOURCE_BACKUP_CHANGED');
  await verifyMigrationPacket(packetDirectory);
  const result = { schemaVersion: 1, task: 'L03', complete: true, rehearsedAt: new Date().toISOString(),
    scope: 'real MUSIC_DB backup in new local SQLite and native D1; no production mutation',
    backupSha256: inputs.source.sha256, migrationSetSha256: backupHash(stableBackupJson(packet.migrations)),
    sqlite, nativeD1: { ...native, wranglerVersion: '4.131.1', exactLocalCommand: true, ledgerReplayUnchanged: true },
    productionWrites: 0, remoteMigrationExecuted: false, sourceBackupUnchanged: true,
    productionDeployed: false, legacyClosureVerified: false, dataFrozen: false };
  await privateBackupJson(join(root, 'rehearsal.json'), result);
  return result;
}
async function main() {
  const args = process.argv.slice(2), options = {};
  if (args.length !== 6) fail('ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    check(['--backup', '--packet', '--directory'].includes(args[i]) && !options[args[i]], 'ARGUMENTS'); options[args[i]] = resolve(args[i + 1]);
  }
  check(Object.keys(options).length === 3, 'ARGUMENTS');
  console.log(JSON.stringify(await rehearseProductionMigration(options['--backup'], options['--packet'], options['--directory'])));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: /^(?:STATION_MIGRATION|STATION_BACKUP|STATION_RESTORE)_[A-Z_0-9]+$/.test(error.message || '') ? error.message : 'STATION_MIGRATION_FAILED' })); process.exitCode = 1;
});
