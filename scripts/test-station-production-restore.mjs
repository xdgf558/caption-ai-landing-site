import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, chmod, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupHash, stableBackupJson, privateBackupJson, backupProductionBucket } from './helpers/station-production-backup.mjs';
import { databaseBackupFingerprint, localDatabaseRestoreArguments, restoreProductionDatabases,
  restoreProductionObjects, prepareDatabaseBackupRestore, canonicalBackupSql, splitBackupSql } from './helpers/station-production-restore.mjs';

async function temporary(run) {
  const directory = await mkdtemp(join(tmpdir(), 'station-restore-test-')); await chmod(directory, 0o700);
  try { return await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
const sql = `CREATE TABLE records(id INTEGER PRIMARY KEY AUTOINCREMENT,note TEXT,large INTEGER,data BLOB);
INSERT INTO records VALUES(1,'before',9223372036854775807,X'00FF');
DELETE FROM sqlite_sequence; INSERT INTO sqlite_sequence(name,seq) VALUES('records',99999);`;
test('full fingerprints preserve >1000 rows, 64-bit integers, blobs, NUL text, generated columns and deleted-ID high-water marks', () => {
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(sql);
    const insert = database.prepare('INSERT INTO records(note,large,data) VALUES(?,?,?)');
    for (let i = 0; i < 1207; i++) insert.run(i === 0 ? 'nul\0after' : 'row-' + i, 9007199254740993n, Buffer.from([0,255]));
    database.exec('CREATE TABLE generated(a TEXT PRIMARY KEY COLLATE NOCASE,b TEXT GENERATED ALWAYS AS (a||a)) WITHOUT ROWID; INSERT INTO generated(a) VALUES(\'A\'),(\'b\');');
    const before = databaseBackupFingerprint(database);
    assert.equal(before.tables.find(row => row.table === 'records').rows, 1208);
    const original = before.fingerprint;
    database.prepare('UPDATE records SET note=? WHERE note=?').run('nul\0different', 'nul\0after');
    assert.notEqual(databaseBackupFingerprint(database).fingerprint, original, 'text after NUL must be significant');
    database.prepare('UPDATE records SET note=? WHERE note=?').run('nul\0after', 'nul\0different');
    assert.equal(databaseBackupFingerprint(database).fingerprint, original);
    database.exec("UPDATE sqlite_sequence SET seq=200000 WHERE name='records'");
    assert.notEqual(databaseBackupFingerprint(database).fingerprint, original, 'sequence cannot be reduced to MAX(id)');
  } finally { database.close(); }
});
test('local import arguments fix the local binding and cannot include remote flags or a production account', () => {
  const args = localDatabaseRestoreArguments('/installed/wrangler', '/private/config.json', '/private/full.sql', '/private/new-clone');
  assert.equal(args.includes('--local'), true); assert.equal(args.includes('--remote'), false);
  assert.equal(args[3], 'RESTORE_DB'); assert.equal(args.includes('--account-id'), false);
});
test('schema comparison removes formatting/comments but preserves quoted text, identifiers and trigger logic', () => {
  assert.equal(canonicalBackupSql("CREATE TABLE x(a TEXT -- note\n DEFAULT 'a -- b');"),canonicalBackupSql("CREATE TABLE x ( a TEXT DEFAULT 'a -- b' )"));
  assert.notEqual(canonicalBackupSql("CREATE TABLE x(a TEXT DEFAULT 'a -- b')"),canonicalBackupSql("CREATE TABLE x(a TEXT DEFAULT 'a -- c')"));
  assert.notEqual(canonicalBackupSql('CREATE TABLE x(a INTEGER CHECK(a>0))'),canonicalBackupSql('CREATE TABLE x(a INTEGER CHECK(a>=0))'));
});
test('linear SQL framing keeps semicolons in quotes, comments and trigger CASE bodies intact', () => {
  const statements=splitBackupSql("-- start;\nCREATE TABLE x(a TEXT); INSERT INTO x VALUES('it''s; data'); CREATE TRIGGER t BEFORE INSERT ON x BEGIN SELECT CASE WHEN NEW.a='END;' THEN RAISE(ABORT,'error;') END; END; /* final; */");
  assert.equal(statements.length,3); assert.match(statements[2],/END; END;$/);
  assert.throws(()=>splitBackupSql("INSERT INTO x VALUES('unfinished)"),/STATION_RESTORE_SQL_QUOTE/);
});
test('complete SQL restore handles interleaved FK tables and triggers referencing later views without splitting quoted semicolons', () => {
  const sql = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES parent(id),note TEXT);
CREATE TRIGGER guard BEFORE INSERT ON child BEGIN SELECT CASE WHEN (SELECT COUNT(*) FROM parent_view)<0 THEN RAISE(ABORT,'bad; trigger') END; END;
INSERT INTO child VALUES(1,2,'quote; ''inside''');
CREATE TABLE parent(id INTEGER PRIMARY KEY); INSERT INTO parent VALUES(2);
CREATE VIEW parent_view AS SELECT * FROM parent; -- final comment`;
  const database = new DatabaseSync(':memory:');
  try {
    const prepared = prepareDatabaseBackupRestore(database, sql), before = databaseBackupFingerprint(database);
    assert.deepEqual(prepared.statements, { tables: 2, data: 2, schema: 2 });
    const clone = new DatabaseSync(':memory:');
    try { clone.exec('BEGIN;'); clone.exec(prepared.sql); clone.exec('COMMIT;'); assert.equal(databaseBackupFingerprint(clone).fingerprint, before.fingerprint); }
    finally { clone.close(); }
  } finally { database.close(); }
});
async function databaseFixture(directory) {
  const source = join(directory, 'databases'); await mkdir(source, { mode: 0o700 });
  const rows = ['WAITLIST_DB','MUSIC_DB'].map((binding, i) => ({ binding, databaseId: 'fixture-' + i,
    file: binding + '.sql', bytes: Buffer.byteLength(sql), sha256: backupHash(sql) }));
  for (const row of rows) await writeFile(join(source, row.file), sql, { mode: 0o600 });
  await privateBackupJson(join(source, 'manifest.json'), { complete: true, databases: rows });
  const plan = { wranglerPath: '/installed/pinned-wrangler', databases: rows.map(row => ({ binding: row.binding, id: row.databaseId })) };
  return { rows, plan };
}
test('isolated restore checks all hashes and full typed values; an existing clone or corrupted SQL is refused', async () => temporary(async directory => {
  const { plan } = await databaseFixture(directory), calls = [];
  const execute = async (node, args) => {
    calls.push(args);
    const config = JSON.parse(await readFile(args[args.indexOf('--config') + 1]));
    assert.equal(config.account_id, undefined); assert.equal(config.d1_databases[0].binding, 'RESTORE_DB');
    assert.ok(!plan.databases.some(row => row.id === config.d1_databases[0].database_id));
    const database = new DatabaseSync(join(args[args.indexOf('--persist-to') + 1], 'local.sqlite'));
    try { database.exec(await readFile(args[args.indexOf('--file') + 1], 'utf8')); } finally { database.close(); }
    const metadata = new DatabaseSync(join(args[args.indexOf('--persist-to') + 1], 'metadata.sqlite')); metadata.close();
    return { stdout: 'fixture local import', stderr: '' };
  };
  const clone = join(directory, 'clone'), result = await restoreProductionDatabases(directory, plan, clone, { execute });
  assert.equal(result.complete, true); assert.equal(calls.length, 4); assert.equal(result.productionWrites, 0);
  assert.equal(result.databases[0].tables.find(row => row.table === 'sqlite_sequence').rows, 1);
  await assert.rejects(restoreProductionDatabases(directory, plan, clone, { execute }), /EEXIST/);
  await writeFile(join(directory, 'databases/MUSIC_DB.sql'), sql + '\nDELETE FROM records;', { mode: 0o600 });
  await assert.rejects(restoreProductionDatabases(directory, plan, join(directory, 'corrupt'), { execute }), /STATION_RESTORE_DATABASE_HASH/);
}));
test('a native restore that changes a generated sequence cannot pass the complete fingerprint', async () => temporary(async directory => {
  const { plan } = await databaseFixture(directory);
  const execute = async (node, args) => {
    const database = new DatabaseSync(join(args[args.indexOf('--persist-to') + 1], 'local.sqlite'));
    try {
      database.exec(await readFile(args[args.indexOf('--file') + 1], 'utf8'));
      if (args[args.indexOf('--file') + 1].endsWith('native-data.sql')) database.exec("UPDATE sqlite_sequence SET seq=1 WHERE name='records';");
    } finally { database.close(); }
    return { stdout: '', stderr: '' };
  };
  await assert.rejects(restoreProductionDatabases(directory, plan, join(directory, 'bad'), { execute }), /STATION_RESTORE_NATIVE_D1_FINGERPRINT/);
}));
test('native local R2 restores streamed bytes and all HTTP/custom metadata into new isolated buckets', async () => temporary(async directory => {
  const bucketDirectory = join(directory, 'buckets'); await mkdir(bucketDirectory, { mode: 0o700 });
  const plan = { buckets: [{ binding: 'CONTENT_BUCKET', bucket: 'test-bucket' }] };
  const destination = join(bucketDirectory, 'CONTENT_BUCKET'); await mkdir(destination, { mode: 0o700 });
  const bytes = Buffer.alloc(8 * 1024 * 1024, 0xab), metadata = { key: 'test/大文件.bin', size: bytes.length,
    etag: createHash('md5').update(bytes).digest('hex'), http_metadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
    custom_metadata: { label: '原始资料' }, storage_class: 'Standard' };
  let count = 0;
  const saved = await backupProductionBucket({ async json() { return { result: count++ % 2 === 0 ? [metadata] : [] }; },
    async object() { return new Response(bytes, { headers: { ETag: metadata.etag } }); } }, 'test-bucket', destination);
  await privateBackupJson(join(bucketDirectory, 'summary.json'), { complete: true, buckets: [saved] });
  const report = await restoreProductionObjects(directory, plan, join(directory, 'clone'));
  assert.equal(report.complete, true); assert.equal(report.buckets[0].bytes, bytes.length);
  assert.equal(report.buckets[0].allBytesAndHttpCustomMetadataVerified, true);
  assert.equal(report.buckets[0].storageClassVerified, false);
  assert.equal(report.buckets[0].verifiedSinglePartEtags, 1);
  assert.equal(report.sourceMultipartEtagsUploadTimesAndStorageClassesNotReproduced, true);
  await assert.rejects(restoreProductionObjects(directory, plan, join(directory, 'clone')), /EEXIST/);
}));
async function objectFixture(directory, bindings = ['CONTENT_BUCKET']) {
  const root = join(directory, 'buckets'); await mkdir(root, { mode: 0o700 });
  const plan = { buckets: bindings.map((binding, i) => ({ binding, bucket: 'restore-fixture-' + i })) }, summaries = [], manifests = [];
  const bodies = new Map([['a.bin', Buffer.from('alpha')], ['b.bin', Buffer.from('bravo')]]);
  const rows = [...bodies].map(([key, body]) => ({ key, size: body.length, etag: createHash('md5').update(body).digest('hex') }));
  for (const target of plan.buckets) {
    const destination = join(root, target.binding); await mkdir(destination, { mode: 0o700 });
    summaries.push(await backupProductionBucket({ async json(path, { query }) { return { result: query.start_after ? [] : rows }; },
      async object(bucket, key) { return new Response(bodies.get(key), { headers: { ETag: rows.find(row => row.key === key).etag } }); } }, target.bucket, destination));
    manifests.push(JSON.parse(await readFile(join(destination, 'manifest.json'))));
  }
  await privateBackupJson(join(root, 'summary.json'), { complete: true, buckets: summaries });
  return { plan, manifests, summaries };
}
test('native R2 restore rejects duplicate, missing and self-consistent substituted sets before creating a clone', async t => temporary(async directory => {
  const { plan, manifests: [manifest] } = await objectFixture(directory);
  const one = [manifest.objects[0]];
  for (const [name, changed, error] of [
    ['duplicate', { ...manifest, objects: [one[0], one[0]] }, /OBJECT_MANIFEST_DUPLICATE/],
    ['missing', { ...manifest, objects: one }, /OBJECT_MANIFEST_BYTES/],
    ['missing-with-adjusted-bytes', { ...manifest, objects: one, bytes: 5 }, /OBJECT_MANIFEST_METADATA/],
    ['substituted-set', { ...manifest, objects: one, bytes: 5, metadataSha256: backupHash(stableBackupJson(one.map(row => row.metadata))) }, /OBJECT_MANIFEST_HASH/],
    ['substituted-empty-set', { ...manifest, objects: [], bytes: 0, metadataSha256: backupHash(stableBackupJson([])) }, /OBJECT_MANIFEST_HASH/],
  ]) await t.test(name, async () => {
    await privateBackupJson(join(directory, 'buckets', 'CONTENT_BUCKET', 'manifest.json'), changed, { replace: true });
    const clone = join(directory, name);
    await assert.rejects(restoreProductionObjects(directory, plan, clone), error);
    await assert.rejects(readFile(join(clone, 'manifest.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(clone), { code: 'ENOENT' });
  });
}));
test('all bucket manifests must match the completed summary before any native R2 restoration starts', async () => temporary(async directory => {
  const { plan, manifests, summaries } = await objectFixture(directory, ['CONTENT_BUCKET', 'DOWNLOADS_BUCKET']);
  const path = join(directory, 'buckets', 'DOWNLOADS_BUCKET', 'manifest.json'), clone = join(directory, 'clone');
  await privateBackupJson(path, { ...manifests[1], objects: [manifests[1].objects[0]] }, { replace: true });
  await assert.rejects(restoreProductionObjects(directory, plan, clone), /OBJECT_MANIFEST_BYTES/);
  await assert.rejects(readdir(clone), { code: 'ENOENT' });
  await privateBackupJson(path, manifests[1], { replace: true });
  for (const buckets of [[summaries[0]], [summaries[0], summaries[0]]]) {
    await privateBackupJson(join(directory, 'buckets', 'summary.json'), { complete: true, buckets }, { replace: true });
    await assert.rejects(restoreProductionObjects(directory, plan, clone), /BUCKET_SUMMARY/);
    await assert.rejects(readdir(clone), { code: 'ENOENT' });
  }
}));
