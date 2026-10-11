import { readFile, mkdir, open, unlink, rename, chmod, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupCloudflare } from './helpers/station-backup-cloudflare.mjs';
import { backupHash, backupSinglePartMd5, stableBackupJson, privateBackupDirectory, privateBackupJson,
  hashBackupFile, backupProductionBucket, inventoryBackupObjects, readBackupBucketSummary,
  readCompletedBucketBackup, readCompletedBucketBackups } from './helpers/station-production-backup.mjs';
import { PRODUCTION_ACCOUNT_ID, PRODUCTION_READER_DATABASE_ID, PRODUCTION_MUSIC_BUCKET } from '../src/mobile/environment.js';

const fail = code => { throw new Error('STATION_BACKUP_' + code); };
const check = (value, code) => { if (!value) fail(code); };
const scriptName = 'caption-ai-landing-site';
const scriptApi = '/workers/scripts/' + scriptName;
export async function discoverProductionBackup(cloud, directory, wranglerPath) {
  const root = await privateBackupDirectory(directory, { create: true, fresh: true });
  const deployments = (await cloud.json(scriptApi + '/deployments')).result;
  const all = Array.isArray(deployments) ? deployments : deployments?.deployments;
  check(Array.isArray(all) && all.length > 0, 'DEPLOYMENTS');
  const latest = [...all].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  check(latest.versions?.length === 1 && latest.versions[0].percentage === 100, 'ACTIVE_VERSION');
  const versionId = latest.versions[0].version_id;
  const version = (await cloud.json(scriptApi + '/versions/' + versionId)).result;
  const bindings = version?.resources?.bindings;
  check(Array.isArray(bindings), 'VERSION_BINDINGS');
  const databases = bindings.filter(row => row.type === 'd1'), buckets = bindings.filter(row => row.type === 'r2_bucket');
  check(databases.length === 2 && buckets.length === 3 &&
    databases.find(row => row.name === 'WAITLIST_DB')?.id === PRODUCTION_READER_DATABASE_ID &&
    /^[0-9a-f-]{36}$/.test(databases.find(row => row.name === 'MUSIC_DB')?.id || '') &&
    buckets.find(row => row.name === 'MUSIC_BUCKET')?.bucket_name === PRODUCTION_MUSIC_BUCKET &&
    buckets.find(row => row.name === 'CONTENT_BUCKET')?.bucket_name === 'station-cat-content' &&
    buckets.find(row => row.name === 'DOWNLOADS_BUCKET')?.bucket_name === 'station-cat-downloads', 'RESOURCE_BOUNDARY');
  const details = [];
  for (const row of databases) {
    const info = (await cloud.json('/d1/database/' + row.id)).result;
    const schema = await cloud.schema(row.id);
    details.push({ binding: row.name, id: row.id, name: info.name, info, schema,
      virtualTables: schema.filter(item => /CREATE\s+VIRTUAL\s+TABLE/i.test(item.sql || '')).map(item => item.name) });
  }
  await privateBackupJson(join(root, 'production-snapshot.json'), { latest, version, databases: details, buckets });
  await privateBackupJson(join(root, 'd1-export-config.json'), { name: scriptName, account_id: PRODUCTION_ACCOUNT_ID,
    compatibility_date: '2026-05-17', d1_databases: details.map(row => ({ binding: row.binding, database_name: row.name, database_id: row.id })) });
  const plan = { schemaVersion: 1, accountId: PRODUCTION_ACCOUNT_ID, scriptName, versionId,
    deploymentId: latest.id, recordedAt: new Date().toISOString(), wranglerPath: resolve(wranglerPath),
    databases: details.map(({ binding, id, name, virtualTables }) => ({ binding, id, name, virtualTables })),
    buckets: buckets.map(({ name, bucket_name, jurisdiction }) => ({ binding: name, bucket: bucket_name, ...(jurisdiction ? { jurisdiction } : {}) })),
    productionDeployed: false, remoteMigrationExecuted: false, productionDataModified: false,
    crossResourceAtomic: false, backupComplete: false };
  check(plan.buckets.every(row => !row.jurisdiction || row.jurisdiction === 'default'), 'JURISDICTION');
  await privateBackupJson(join(root, 'plan.json'), plan);
  return { task: 'L02', inventoryComplete: true, versionId, databases: details.map(row => ({ binding: row.binding,
    bytes: row.info.file_size, tables: row.schema.filter(item => item.type === 'table').length,
    virtualTables: row.virtualTables.length })), buckets: plan.buckets.map(row => row.binding), backupComplete: false };
}
export async function readBackupPlan(directory) {
  const root = await privateBackupDirectory(directory);
  await hashBackupFile(join(root, 'plan.json'));
  const plan = JSON.parse(await readFile(join(root, 'plan.json'), 'utf8'));
  check(plan.schemaVersion === 1 && plan.accountId === PRODUCTION_ACCOUNT_ID && plan.scriptName === scriptName &&
    /^[0-9a-f-]{36}$/.test(plan.versionId || '') && plan.databases?.length === 2 && plan.buckets?.length === 3,
  'PLAN');
  await hashBackupFile(join(root, 'd1-export-config.json'));
  const config = JSON.parse(await readFile(join(root, 'd1-export-config.json'), 'utf8'));
  check(config.account_id === plan.accountId && stableBackupJson(config.d1_databases) === stableBackupJson(plan.databases.map(row =>
    ({ binding: row.binding, database_name: row.name, database_id: row.id }))), 'PLAN_DATABASES');
  return { root, plan };
}
export async function verifyProductionBackupBoundary(cloud, root, plan) {
  await checkBackupDeployment(cloud, plan);
  const databaseManifestPath = join(root, 'databases', 'manifest.json');
  await hashBackupFile(databaseManifestPath);
  const databases = JSON.parse(await readFile(databaseManifestPath));
  check(databases.complete === true && databases.databases.length === 2, 'DATABASE_MANIFEST');
  const databaseResults = [];
  for (const target of plan.databases) {
    const saved = databases.databases.find(row => row.binding === target.binding && row.databaseId === target.id);
    check(saved && backupHash(stableBackupJson(await cloud.schema(target.id))) === saved.schemaSha256, 'SCHEMA_CHANGED');
    databaseResults.push({ binding: target.binding, schemaUnchanged: true });
  }
  const savedBuckets = await readCompletedBucketBackups(root, plan), buckets = [];
  for (const { target, manifest: saved } of savedBuckets.buckets) {
    const current = await inventoryBackupObjects(cloud, target.bucket);
    check(saved.complete === true && saved.bucket === target.bucket && saved.objects.length === current.count &&
      saved.bytes === current.bytes && saved.metadataSha256 === current.metadataSha256, 'COMPLETED_BUCKET_CHANGED');
    buckets.push({ binding: target.binding, objects: current.count, bytes: current.bytes, metadataUnchanged: true });
  }
  await checkBackupDeployment(cloud, plan);
  const result = { complete: true, versionId: plan.versionId, databases: databaseResults, buckets,
    checkedAt: new Date().toISOString(), productionWrites: 0, crossResourceAtomic: false,
    databaseDataFrozen: false, sourceSummarySha256: savedBuckets.summarySha256,
    authority: 'read-only resource/schema/list comparison; not a cutover authorization' };
  await privateBackupJson(join(root, 'final-boundary-' + Date.now() + '.json'), result);
  return result;
}
export async function checkBackupDeployment(cloud, plan) {
  const data = (await cloud.json(scriptApi + '/deployments')).result;
  const deployments = Array.isArray(data) ? data : data?.deployments;
  check(Array.isArray(deployments) && deployments.length > 0, 'DEPLOYMENTS');
  const latest = [...deployments].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  check(latest.id === plan.deploymentId && latest.versions?.length === 1 && latest.versions[0].version_id === plan.versionId &&
    latest.versions[0].percentage === 100, 'DEPLOYMENT_CHANGED');
  const bindings = (await cloud.json(scriptApi + '/versions/' + plan.versionId)).result?.resources?.bindings;
  check(Array.isArray(bindings), 'VERSION_BINDINGS');
  const sort = rows => rows.sort((a, b) => a.binding.localeCompare(b.binding));
  const databases = sort(bindings.filter(row => row.type === 'd1').map(row => ({ binding: row.name, id: row.id })));
  const buckets = sort(bindings.filter(row => row.type === 'r2_bucket').map(row => ({ binding: row.name, bucket: row.bucket_name })));
  check(stableBackupJson(databases) === stableBackupJson(sort(plan.databases.map(({ binding, id }) => ({ binding, id })))) &&
    stableBackupJson(buckets) === stableBackupJson(sort(plan.buckets.map(({ binding, bucket }) => ({ binding, bucket })))), 'RESOURCE_CHANGED');
}
export function checkMaintenanceWindow(window, plan, now = Date.now()) {
  check(window?.schemaVersion === 1 && window.operation === 'full-d1-export' && window.requestBlockingAccepted === true &&
    window.accountId === plan.accountId && window.versionId === plan.versionId &&
    stableBackupJson(window.bindings) === stableBackupJson(['WAITLIST_DB', 'MUSIC_DB']) &&
    Number.isFinite(Date.parse(window.startsAt)) && Number.isFinite(Date.parse(window.endsAt)) &&
    Date.parse(window.startsAt) <= now && now < Date.parse(window.endsAt) &&
    Date.parse(window.endsAt) - Date.parse(window.startsAt) <= 3600000, 'MAINTENANCE_WINDOW');
}
export async function exportProductionDatabases(cloud, root, plan, windowPath, expectedHash) {
  const source = await readFile(windowPath);
  check(/^[0-9a-f]{64}$/.test(expectedHash || '') && backupHash(source) === expectedHash, 'WINDOW_HASH');
  const window = JSON.parse(source);
  checkMaintenanceWindow(window, plan);
  check(plan.databases.every(row => row.virtualTables.length === 0), 'VIRTUAL_TABLES_UNSUPPORTED');
  await checkBackupDeployment(cloud, plan);
  const directory = join(root, 'databases'); await privateBackupDirectory(directory, { create: true, fresh: true });
  const results = [];
  for (const binding of window.bindings) {
    checkMaintenanceWindow(window, plan);
    const target = plan.databases.find(row => row.binding === binding);
    const actualSchema = await cloud.schema(target.id);
    check(!actualSchema.some(row => /CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql || '')), 'VIRTUAL_TABLES_UNSUPPORTED');
    const output = join(directory, binding + '.sql.partial');
    const placeholder = await open(output, 'wx', 0o600); await placeholder.close();
    await cloud.exportDatabase(join(root, 'd1-export-config.json'), binding, output, join(directory, binding + '.private.log'));
    await chmod(output, 0o600);
    const verified = await hashBackupFile(output); check(verified.bytes > 0, 'EXPORT_EMPTY');
    const file = binding + '.sql'; await rename(output, join(directory, file));
    results.push({ binding, databaseId: target.id, file, ...verified, capturedAt: new Date().toISOString(),
      export: 'wrangler-full-schema-and-data', schemaSha256: backupHash(stableBackupJson(actualSchema)) });
    await privateBackupJson(join(directory, 'progress.json'), { complete: false, databases: results }, { replace: true });
  }
  await checkBackupDeployment(cloud, plan);
  await privateBackupJson(join(directory, 'manifest.json'), { schemaVersion: 1, complete: true, databases: results,
    maintenanceWindowSha256: expectedHash, crossResourceAtomic: false });
  return { databases: results.map(({ binding, bytes, sha256, capturedAt }) => ({ binding, bytes, sha256, capturedAt })), databaseBackupsComplete: true };
}
export async function backupAllProductionBuckets(cloud, root, plan, progress = () => {}) {
  await checkBackupDeployment(cloud, plan);
  const directory = join(root, 'buckets'); await privateBackupDirectory(directory, { create: true });
  const summary = await readBackupBucketSummary(root, plan, { required: false });
  const results = [];
  for (const target of plan.buckets) {
    const destination = join(directory, target.binding); await privateBackupDirectory(destination, { create: true });
    const completed = await readCompletedBucketBackup(root, target, summary?.entries.get(target.bucket)).catch(error => {
      if (!summary && error.code === 'ENOENT') return null;
      throw error;
    });
    if (completed) {
      const previous = completed.manifest;
      const inventory = await inventoryBackupObjects(cloud, target.bucket);
      check(previous.complete === true && previous.bucket === target.bucket && previous.objects.length === inventory.count &&
        previous.metadataSha256 === inventory.metadataSha256, 'COMPLETED_BUCKET_CHANGED');
      for (const item of previous.objects) {
        check(item.file === backupHash(item.key) + '.bin', 'OBJECT_FILE');
        const actual = await hashBackupFile(join(destination, 'objects', item.file), { expectedMd5: backupSinglePartMd5(item.metadata.etag) });
        check(actual.bytes === item.bytes && actual.sha256 === item.sha256, 'COMPLETED_BUCKET_HASH');
      }
      results.push({ bucket: target.bucket, complete: true, objects: inventory.count, bytes: inventory.bytes,
        metadataSha256: inventory.metadataSha256, manifestSha256: completed.manifestSha256 });
    } else results.push(await backupProductionBucket(cloud, target.bucket, destination, progress));
  }
  await checkBackupDeployment(cloud, plan);
  await privateBackupJson(join(directory, 'summary.json'), { complete: true, buckets: results, crossResourceAtomic: false }, { replace: true });
  return { objectBackupsComplete: true, buckets: results, crossResourceAtomic: false };
}
async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2), operation = args.shift(), options = {};
  check(args.length % 2 === 0, 'ARGUMENTS');
  for (let i = 0; i < args.length; i += 2) { check(['--directory', '--wrangler', '--window', '--window-sha256'].includes(args[i]) && !options[args[i]], 'ARGUMENTS'); options[args[i]] = args[i + 1]; }
  check(['inventory', 'objects', 'export', 'verify'].includes(operation) && options['--directory'], 'ARGUMENTS');
  const directory = resolve(options['--directory']);
  let cloud, lock, lockPath;
  try {
    if (operation === 'inventory') {
      check(options['--wrangler'], 'ARGUMENTS');
      const logDirectory = join(await privateBackupDirectory(join(directory, '..'), { create: true }), '.wrangler-logs');
      cloud = await backupCloudflare(options['--wrangler'], logDirectory);
      console.log(JSON.stringify(await discoverProductionBackup(cloud, directory, options['--wrangler'])));
    } else {
      const { root, plan } = await readBackupPlan(directory);
      // Independent D1 and R2 reads may run together. Only a second writer to
      // the same local backup area is excluded; this is not a cross-store lock.
      lockPath = join(root, '.' + operation + '.lock');
      lock = await open(lockPath, 'wx', 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() }));
      cloud = await backupCloudflare(plan.wranglerPath, join(root, '.wrangler-logs'));
      const result = operation === 'verify' ? await verifyProductionBackupBoundary(cloud, root, plan) : operation === 'objects' ? await backupAllProductionBuckets(cloud, root, plan, progress => {
        // Object keys and customer fields never go to shared console output.
        console.log(JSON.stringify({ stage: 'objects', ...progress }));
      }) : await exportProductionDatabases(cloud, root, plan, options['--window'], options['--window-sha256']);
      console.log(JSON.stringify(result));
    }
  } finally { try { await cloud?.close(); } finally { if (lock) { await lock.close(); await unlink(lockPath); } } }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ error: /^STATION_BACKUP_[A-Z_0-9]+$/.test(error.message || '') ? error.message : 'STATION_BACKUP_FAILED',
    ...(typeof error.code === 'string' && /^[A-Z_0-9]+$/.test(error.code) ? { causeCode: error.code } : {}) })); process.exitCode = 1; });
}
