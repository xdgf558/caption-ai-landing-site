import { mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupCloudflare } from './helpers/station-backup-cloudflare.mjs';
import { privateBackupDirectory, privateBackupJson } from './helpers/station-production-backup.mjs';
import { migrationBackupInputs, readProductionMigrationState, prepareMigrationPacket, verifyMigrationPacket } from './helpers/station-production-migration.mjs';

// There is no apply/export/deploy command. Network access is fixed read-only
// metadata and SELECTs; preparing and verifying write private local files only.
export async function captureMigrationState(backupDirectory, outputDirectory) {
  process.umask(0o077);
  const inputs = await migrationBackupInputs(backupDirectory);
  await mkdir(dirname(resolve(outputDirectory)), { recursive: true, mode: 0o700 });
  const root = await privateBackupDirectory(outputDirectory, { create: true, fresh: true });
  const cloud = await backupCloudflare(inputs.plan.wranglerPath, join(root, '.wrangler-logs'));
  try {
    const snapshot = await readProductionMigrationState(cloud, inputs.plan);
    await privateBackupJson(join(root, 'migration-readonly.json'), snapshot);
    return { recordedAt: snapshot.recordedAt, productionWrites: 0, schemaMatchesBackup: snapshot.schemaSha256 === inputs.source.schemaSha256,
      ledgerEntries: snapshot.ledger.length, stationTables: 0, counts: snapshot.counts, versionId: snapshot.versionId,
      stationSwitchesEnabled: 0, remoteMigrationExecuted: false };
  } finally { await cloud.close(); }
}
async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), operation = args.shift(), options = {};
  if (!['inventory', 'prepare', 'verify'].includes(operation) || args.length % 2 !== 0) throw new Error('STATION_MIGRATION_ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--backup', '--snapshot', '--directory'].includes(args[i]) || options[args[i]]) throw new Error('STATION_MIGRATION_ARGUMENTS');
    options[args[i]] = resolve(args[i + 1]);
  }
  const keys = Object.keys(options).sort().join(',');
  let result;
  if (operation === 'inventory' && keys === '--backup,--directory') result = await captureMigrationState(options['--backup'], options['--directory']);
  else if (operation === 'prepare' && keys === '--backup,--directory,--snapshot') {
    const packet = await prepareMigrationPacket(options['--backup'], options['--snapshot'], options['--directory']);
    result = { task: packet.task, migrationCount: packet.migrations.length, executionEnabled: false, executionReady: false,
      remoteMigrationExecuted: false, backupAgeMs: packet.backup.ageMs, backupFreshnessAcceptedForExecution: false };
  } else if (operation === 'verify' && keys === '--directory') {
    const packet = await verifyMigrationPacket(options['--directory']);
    result = { task: packet.task, packetVerified: true, migrations: packet.migrations, executionReady: false, remoteMigrationExecuted: false };
  } else throw new Error('STATION_MIGRATION_ARGUMENTS');
  console.log(JSON.stringify(result));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: /^(?:STATION_MIGRATION|STATION_BACKUP)_[A-Z_0-9]+$/.test(error.message || '') ? error.message : 'STATION_MIGRATION_FAILED' }));
  process.exitCode = 1;
});
