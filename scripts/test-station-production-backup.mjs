import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, mkdir, chmod, lstat, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { backupHash, stableBackupJson, compareObjectKeys, inventoryBackupObjects, streamBackupFile,
  privateBackupDirectory, privateBackupJson, hashBackupFile, backupProductionBucket, backupRoot } from './helpers/station-production-backup.mjs';
import { checkMaintenanceWindow, verifyProductionBackupBoundary } from './station-production-backup.mjs';

const metadata = (key, bytes = Buffer.from(key)) => ({ key, size: bytes.length, etag: backupHash(bytes),
  last_modified: '2026-10-11T00:00:00Z', custom_metadata: { fixture: 'test-only' }, http_metadata: { contentType: 'application/octet-stream' } });
async function temporary(run) {
  const directory = await mkdtemp(join(tmpdir(), 'station-backup-test-')); await chmod(directory, 0o700);
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
function cloudFixture(items) {
  const bytes = new Map(items.map(([key, content]) => [key, Buffer.from(content)]));
  const rows = items.map(([key]) => metadata(key, bytes.get(key))).sort((a, b) => compareObjectKeys(a.key, b.key));
  let requests = [];
  return {
    rows, requests, bytes,
    async json(path, { query }) {
      const result = rows.filter(row => !query.start_after || compareObjectKeys(row.key, query.start_after) > 0).slice(0, Number(query.per_page));
      return { success: true, result };
    },
    async object(bucket, key) { requests.push(key); return new Response(bytes.get(key), { headers: { ETag: '"' + backupHash(bytes.get(key)) + '"', 'Content-Length': bytes.get(key).length } }); },
  };
}
test('UTF-8 pagination keeps case and punctuation in storage order and reaches an empty page without result_info', async () => {
  const cloud = cloudFixture([['Z', 'a'], ['_', 'b'], ['a', 'c'], ['é', 'd']]);
  const snapshot = await inventoryBackupObjects(cloud, 'test-bucket', { perPage: 2 });
  assert.deepEqual(snapshot.objects.map(row => row.key), ['Z', '_', 'a', 'é']);
  assert.equal(snapshot.pages, 3); assert.equal(snapshot.complete, true); assert.equal(snapshot.bytes, 4);
  assert.equal(snapshot.metadataSha256, backupHash(stableBackupJson(cloud.rows)));
});
test('a short response without pagination metadata must be followed, not silently declared complete', async () => {
  const seen = [], rows = [metadata('a'), metadata('b')];
  const cloud = { async json(path, { query }) { seen.push(query.start_after); return { result: !query.start_after ? [rows[0]] : query.start_after === 'a' ? [rows[1]] : [] }; } };
  assert.equal((await inventoryBackupObjects(cloud, 'test-bucket')).count, 2);
  assert.deepEqual(seen, [undefined, 'a', 'b']);
});
test('documented cursor pagination requires a advancing cursor and rejects duplicate or incomplete pages', async () => {
  const seen = [], cloud = { async json(path, { query }) { seen.push(query.cursor); return query.cursor ?
    { result: [metadata('b')], result_info: { is_truncated: false } } : { result: [metadata('a')], result_info: { is_truncated: true, cursor: 'next' } }; } };
  assert.equal((await inventoryBackupObjects(cloud, 'test-bucket')).pagination, 'cursor');
  assert.deepEqual(seen, [undefined, 'next']);
  for (const bad of [
    { result: [], result_info: { is_truncated: true, cursor: 'next' } },
    { result: [metadata('a')], result_info: { is_truncated: true } },
    { result: [metadata('a')], result_info: { is_truncated: true, cursor: 'next' } },
    { result: [metadata('a')] },
  ]) await assert.rejects(inventoryBackupObjects({ async json() { return bad; } }, 'test-bucket'), /STATION_BACKUP_PAGINATION/);
});
test('unordered arrays are sorted locally; unsupported encrypted, malformed and traversal-like records fail before copying', async () => {
  const sorted = await inventoryBackupObjects({ async json() { return { result: [metadata('b'), metadata('a')], result_info: { is_truncated: false } }; } }, 'test-bucket');
  assert.deepEqual(sorted.objects.map(row => row.key), ['a','b']);
  for (const rows of [[{ ...metadata('a'), ssec: true }], [metadata('../a')],
    [{ ...metadata('a'), size: -1 }], [{ ...metadata('a'), size: Number.MAX_SAFE_INTEGER + 1 }]]) {
    await assert.rejects(inventoryBackupObjects({ async json() { return { result: rows, result_info: { is_truncated: false } }; } }, 'test-bucket'), /STATION_BACKUP/);
  }
});
test('streaming computes hashes over exact stored bytes and never leaves a truncated file eligible for backup', async () => temporary(async directory => {
  const bytes = Buffer.from([0, 255, 31, 139, 8, 0, 1, 2]), target = join(directory, 'raw.bin');
  const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close(); } });
  assert.deepEqual(await streamBackupFile(stream, target, bytes.length), { bytes: bytes.length, sha256: backupHash(bytes) });
  assert.equal((await lstat(target)).mode & 0o077, 0);
  assert.deepEqual(await hashBackupFile(target), { bytes: bytes.length, sha256: backupHash(bytes) });
  for (const size of [7, 9]) {
    const file = join(directory, 'bad-' + size);
    await assert.rejects(streamBackupFile(new Response(bytes).body, file, size), /STATION_BACKUP_BODY_SIZE/);
    await assert.rejects(access(file));
  }
}));
test('private files cannot be written inside the repository, follow symlinks or expose customer data through permissions', async () => temporary(async directory => {
  await assert.rejects(privateBackupDirectory(join(backupRoot, 'docs/private-test'), { create: true }), /STATION_BACKUP_PRIVATE_PATH/);
  const insecure = join(directory, 'public'); await mkdir(insecure, { mode: 0o755 });
  await assert.rejects(privateBackupDirectory(insecure), /STATION_BACKUP_PRIVATE_DIRECTORY/);
  const path = join(directory, 'record.json'); await privateBackupJson(path, { secret: 'fixture' });
  await assert.rejects(privateBackupJson(path, { other: true }), /EEXIST/);
  await privateBackupJson(path, { updated: true }, { replace: true });
  assert.equal((await lstat(path)).mode & 0o077, 0);
  assert.deepEqual(JSON.parse(await readFile(path)), { updated: true });
}));
test('a failed exclusive open preserves the existing backup; native streams retain exact compressed bytes', async () => temporary(async directory => {
  const target = join(directory, 'saved.bin'), bytes = Buffer.from([31, 139, 8, 0, 255]);
  await streamBackupFile(Readable.from([bytes]), target, bytes.length);
  await assert.rejects(streamBackupFile(Readable.from(['replacement']), target, 11), /EEXIST/);
  assert.deepEqual(await readFile(target), bytes);
}));
test('HTTP weak ETags match the listed opaque tag while length and byte hash remain independently checked', async () => temporary(async directory => {
  const cloud = cloudFixture([['a', 'three']]);
  cloud.object = async () => ({ headers: new Headers({ ETag: 'W/"' + backupHash('three') + '"' }), body: Readable.from([Buffer.from('three')]) });
  const result = await backupProductionBucket(cloud, 'test-bucket', directory);
  assert.equal(result.complete, true); assert.equal(result.bytes, 5);
}));
test('gateway weak gzip suffixes require exact single-part MD5; semantic tags cannot hide altered bytes', async () => temporary(async directory => {
  const etag = createHash('md5').update('three').digest('hex'), cloud = cloudFixture([['a','three']]);
  cloud.rows[0].etag = etag;
  cloud.object = async () => ({ headers: new Headers({ ETag: 'W/"' + etag + '-gzip"' }), body: Readable.from([Buffer.from('three')]) });
  assert.equal((await backupProductionBucket(cloud, 'test-bucket', directory)).complete, true);
  const corrupt = join(directory, 'corrupt'); await mkdir(corrupt, { mode: 0o700 });
  cloud.object = async () => ({ headers: new Headers({ ETag: 'W/"' + etag + '-gzip"' }), body: Readable.from([Buffer.from('other')]) });
  await assert.rejects(backupProductionBucket(cloud, 'test-bucket', corrupt), /STATION_BACKUP_BODY_MD5/);
  await assert.rejects(access(join(corrupt, 'manifest.json')));
}));
test('full object backup retains metadata, raw binary and immutable completion manifest', async () => temporary(async directory => {
  const cloud = cloudFixture([['a/b', 'raw-a'], ['z.mp3', 'raw-b']]);
  const result = await backupProductionBucket(cloud, 'test-bucket', directory);
  assert.equal(result.complete, true); assert.equal(result.objects, 2); assert.equal(result.crossResourceAtomic, false);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json')));
  assert.equal(manifest.complete, true);
  for (const row of manifest.objects) {
    assert.equal(row.file, backupHash(row.key) + '.bin');
    assert.deepEqual(row.metadata, cloud.rows.find(item => item.key === row.key));
    assert.deepEqual(await hashBackupFile(join(directory, 'objects', row.file)), { bytes: row.bytes, sha256: row.sha256 });
  }
  await assert.rejects(backupProductionBucket(cloud, 'test-bucket', directory), /EEXIST/);
}));
test('interrupted backup resumes only recorded and rehashed bytes; partial success is not a complete backup', async () => temporary(async directory => {
  const cloud = cloudFixture([['a', 'one'], ['b', 'two']]), original = cloud.object;
  cloud.object = async (bucket, key) => { if (key === 'b') throw new Error('fixture stop'); return original(bucket, key); };
  await assert.rejects(backupProductionBucket(cloud, 'test-bucket', directory), /fixture stop/);
  assert.equal(JSON.parse(await readFile(join(directory, 'progress.json'))).complete, false);
  await assert.rejects(access(join(directory, 'manifest.json')));
  cloud.object = original;
  const result = await backupProductionBucket(cloud, 'test-bucket', directory);
  assert.equal(result.complete, true); assert.deepEqual(cloud.requests, ['a', 'b']);
}));
test('changed ETag or post-copy inventory cannot produce a complete backup', async () => temporary(async directory => {
  const cloud = cloudFixture([['a', 'one']]);
  cloud.object = async () => new Response('one', { headers: { ETag: 'changed', 'Content-Length': '3' } });
  await assert.rejects(backupProductionBucket(cloud, 'test-bucket', directory), /STATION_BACKUP_OBJECT_CHANGED/);
  await assert.rejects(access(join(directory, 'manifest.json')));
  const second = join(directory, 'second'); await mkdir(second, { mode: 0o700 });
  const changing = cloudFixture([['a', 'one']]), original = changing.object;
  changing.object = async (...args) => { const response = await original(...args); changing.rows[0] = { ...changing.rows[0], last_modified: '2026-10-12T00:00:00Z' }; return response; };
  await assert.rejects(backupProductionBucket(changing, 'test-bucket', second), /STATION_BACKUP_BUCKET_CHANGED/);
  await assert.rejects(access(join(second, 'manifest.json')));
}));
test('a transient interrupted body is retried from byte zero and only its verified copy is committed', async () => temporary(async directory => {
  const cloud=cloudFixture([['a','three']]), original=cloud.object; let attempts=0;
  cloud.object=async(...args)=>{
    if(attempts++===0) return {headers:new Headers({ETag:'"'+backupHash('three')+'"'}),body:Readable.from((async function*(){yield Buffer.from('th');const error=new Error('fixture connection lost');error.code='ECONNRESET';throw error;})())};
    return original(...args);
  };
  const result=await backupProductionBucket(cloud,'test-bucket',directory);
  assert.equal(result.complete,true);assert.equal(attempts,2);
  const record=JSON.parse(await readFile(join(directory,'manifest.json'))).objects[0];assert.equal(record.bytes,5);assert.equal(record.sha256,backupHash('three'));
}));
test('D1 export requires a bounded, current, explicit request-blocking maintenance window for the exact production snapshot', () => {
  const now = Date.parse('2026-10-11T09:00:00Z'), plan = { accountId: 'test-account', versionId: 'test-version' };
  const window = { schemaVersion: 1, operation: 'full-d1-export', requestBlockingAccepted: true,
    ...plan, bindings: ['WAITLIST_DB', 'MUSIC_DB'], startsAt: '2026-10-11T08:59:00Z', endsAt: '2026-10-11T09:30:00Z' };
  assert.doesNotThrow(() => checkMaintenanceWindow(window, plan, now));
  for (const changes of [{ requestBlockingAccepted: false }, { accountId: 'other' }, { versionId: 'other' },
    { startsAt: '2026-10-11T09:01:00Z' }, { endsAt: '2026-10-11T09:00:00Z' },
    { endsAt: '2026-10-11T11:00:00Z' }, { bindings: ['WAITLIST_DB'] }]) {
    assert.throws(() => checkMaintenanceWindow({ ...window, ...changes }, plan, now), /STATION_BACKUP_MAINTENANCE_WINDOW/);
  }
});
test('the repository root itself is not a private backup directory regardless of its permissions', async () => {
  await assert.rejects(privateBackupDirectory(backupRoot),/STATION_BACKUP_PRIVATE_PATH/);
});
test('final read-only boundary check requires the exact deployment, schema and complete object metadata', async () => temporary(async directory => {
  const plan={deploymentId:'fixture-deployment',versionId:'fixture-version',databases:[{binding:'WAITLIST_DB',id:'reader'},{binding:'MUSIC_DB',id:'music'}],
    buckets:[{binding:'CONTENT_BUCKET',bucket:'content-bucket'},{binding:'DOWNLOADS_BUCKET',bucket:'downloads-bucket'},{binding:'MUSIC_BUCKET',bucket:'music-bucket'}]};
  const schema=[{type:'table',name:'fixture',sql:'CREATE TABLE fixture(id INTEGER)'}], rows=[metadata('fixture')];
  await mkdir(join(directory,'databases'),{mode:0o700});
  await privateBackupJson(join(directory,'databases','manifest.json'),{complete:true,databases:plan.databases.map(row=>({binding:row.binding,databaseId:row.id,schemaSha256:backupHash(stableBackupJson(schema))}))});
  await mkdir(join(directory,'buckets'),{mode:0o700});
  for(const target of plan.buckets){await mkdir(join(directory,'buckets',target.binding),{mode:0o700});await privateBackupJson(join(directory,'buckets',target.binding,'manifest.json'),
    {complete:true,bucket:target.bucket,objects:rows,bytes:rows[0].size,metadataSha256:backupHash(stableBackupJson(rows))});}
  let changedSchema=false,changedDeployment=false,changedObjects=false;
  const cloud={async schema(){return changedSchema?[]:schema;},async json(path,{query}={}){
    if(path.endsWith('/deployments'))return{result:[{id:changedDeployment?'changed':plan.deploymentId,created_on:'2026-10-11T00:00:00Z',versions:[{version_id:plan.versionId,percentage:100}]}]};
    if(path.includes('/versions/'))return{result:{resources:{bindings:[...plan.databases.map(row=>({type:'d1',name:row.binding,id:row.id})),...plan.buckets.map(row=>({type:'r2_bucket',name:row.binding,bucket_name:row.bucket}))]}}};
    return{result:query.start_after?[]:rows.map(row=>changedObjects?{...row,etag:'changed'}:row)};
  }};
  const result=await verifyProductionBackupBoundary(cloud,directory,plan);
  assert.equal(result.complete,true);assert.equal(result.productionWrites,0);assert.equal(result.crossResourceAtomic,false);assert.equal(result.databaseDataFrozen,false);
  changedObjects=true;await assert.rejects(verifyProductionBackupBoundary(cloud,directory,plan),/STATION_BACKUP_COMPLETED_BUCKET_CHANGED/);
  changedObjects=false;changedSchema=true;await assert.rejects(verifyProductionBackupBoundary(cloud,directory,plan),/STATION_BACKUP_SCHEMA_CHANGED/);
  changedSchema=false;changedDeployment=true;await assert.rejects(verifyProductionBackupBoundary(cloud,directory,plan),/STATION_BACKUP_DEPLOYMENT_CHANGED/);
}));
