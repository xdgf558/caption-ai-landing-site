import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackupPlan } from './station-production-backup.mjs';
import { restoreProductionDatabases, restoreProductionObjects, verifyProductionDatabaseClones } from './helpers/station-production-restore.mjs';

export async function runProductionBackupRestore(operation, directory, output) {
  process.umask(0o077);
  const { root, plan } = await readBackupPlan(directory);
  if (operation === 'databases') {
    const result = await restoreProductionDatabases(root, plan, output || join(root, 'isolated-d1-restore'));
    return { complete: result.complete, productionWrites: 0, databases: result.databases.map(({ tables, ...row }) => row) };
  }
  if (operation === 'verify-databases' && output) {
    const result = await verifyProductionDatabaseClones(root, plan, output);
    return { complete: result.complete, productionWrites: 0, databases: result.databases.map(({ tables, ...row }) => row) };
  }
  if (operation === 'objects') return restoreProductionObjects(root, plan, output || join(root, 'isolated-r2-restore'), row => console.log(JSON.stringify(row)));
  throw new Error('STATION_RESTORE_ARGUMENTS');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (![3,5].includes(args.length) || args[1] !== '--directory' || (args.length === 5 && args[3] !== '--clone-directory')) { console.error('STATION_RESTORE_ARGUMENTS'); process.exitCode = 1; }
  else runProductionBackupRestore(args[0], resolve(args[2]), args[4] && resolve(args[4])).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(/^STATION_(?:BACKUP|RESTORE)_[A-Z_0-9]+$/.test(error.message || '') ? error.message : 'STATION_RESTORE_FAILED'); process.exitCode = 1;
  });
}
