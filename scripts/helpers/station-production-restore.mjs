import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, open, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { backupHash, backupSinglePartMd5, stableBackupJson, hashBackupFile, privateBackupDirectory,
  privateBackupJson, readCompletedBucketBackups } from './station-production-backup.mjs';

const run = promisify(execFile);
const fail = code => { throw new Error('STATION_RESTORE_' + code); };
const check = (value, code) => { if (!value) fail(code); };
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
export function canonicalBackupSql(sql) {
  const tokens = []; let i = 0;
  while (i < sql.length) {
    if (/\s/.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--', i)) { const next = sql.indexOf('\n', i + 2); i = next < 0 ? sql.length : next + 1; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); check(end >= 0, 'SQL_COMMENT'); i = end + 2; continue; }
    const start = i, quote = sql[i];
    if (["'", '"', '`', '['].includes(quote)) {
      const closing = quote === '[' ? ']' : quote; i++; let closed = false;
      while (i < sql.length) {
        if (sql[i++] === closing) {
          if (quote !== '[' && sql[i] === closing) { i++; continue; }
          closed = true; break;
        }
      }
      check(closed, 'SQL_QUOTE'); tokens.push(sql.slice(start, i)); continue;
    }
    if (/[\w$\u0080-\uffff]/.test(sql[i])) { while (i < sql.length && /[\w$\u0080-\uffff]/.test(sql[i])) i++; }
    else i++;
    tokens.push(sql.slice(start, i));
  }
  while (tokens.at(-1) === ';') tokens.pop();
  return JSON.stringify(tokens);
}
export function splitBackupSql(sql) {
  // Linear framing only; SQLite still parses every framed statement below.
  // Avoid preparing a shrinking 20 MB string once for every exported row.
  const statements = []; let start = 0, i = 0, words = [], trigger = false, begins = 0, cases = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); check(end >= 0, 'SQL_COMMENT'); i = end + 2; continue; }
    if (["'", '"', '`', '['].includes(sql[i])) {
      const quote = sql[i++], closing = quote === '[' ? ']' : quote; let closed = false;
      while (i < sql.length) if (sql[i++] === closing) {
        if (quote !== '[' && sql[i] === closing) { i++; continue; } closed = true; break;
      }
      check(closed, 'SQL_QUOTE'); continue;
    }
    if (/[A-Za-z_]/.test(sql[i])) {
      const begin = i++; while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      const word = sql.slice(begin, i).toUpperCase(); if (words.length < 4) words.push(word);
      if (words[0] === 'CREATE' && words.includes('TRIGGER')) trigger = true;
      if (trigger) {
        if (word === 'BEGIN') begins++; else if (word === 'CASE') cases++;
        else if (word === 'END') { if (cases) cases--; else begins--; }
      }
      continue;
    }
    if (sql[i] === ';' && (!trigger || (begins === 0 && cases === 0))) {
      statements.push(sql.slice(start, ++i)); start = i; words = []; trigger = false; begins = 0; cases = 0;
    } else i++;
  }
  const tail = sql.slice(start);
  if (!/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*$/.test(tail)) { check(begins === 0 && cases === 0, 'SQL_TRIGGER'); statements.push(tail); }
  return statements;
}

// Fingerprint every typed value, without SELECT limits, JSON number rounding,
// or quote(TEXT)'s truncation at embedded NUL. No customer values are returned.
function hashValue(hash, value, sqlType) {
  let type, bytes;
  if (value === null) { type = 'null'; bytes = Buffer.alloc(0); }
  else if (typeof value === 'bigint') { type = 'integer'; bytes = Buffer.from(value.toString()); }
  else if (typeof value === 'number') { type = 'real'; bytes = Buffer.alloc(8); bytes.writeDoubleBE(value); }
  else if (typeof value === 'string') { type = 'text'; bytes = Buffer.from(value); }
  else if (value instanceof Uint8Array) { type = sqlType === 'text' ? 'text' : 'blob'; bytes = Buffer.from(value); }
  else fail('SQL_VALUE');
  hash.update(type + ':' + bytes.length + ':'); hash.update(bytes); hash.update(';');
}
export function databaseBackupFingerprint(database) {
  const rawSchema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all();
  const schema = rawSchema.map(row => ({ ...row, sql: canonicalBackupSql(row.sql) }));
  check(rawSchema.every(row => !/CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql)), 'VIRTUAL_TABLE');
  const tables = schema.filter(row => row.type === 'table').map(row => row.name);
  if (database.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get()) tables.push('sqlite_sequence');
  const data = [], structure = [];
  for (const table of tables.sort()) {
    const tableColumns = database.prepare('PRAGMA table_xinfo(' + identifier(table) + ')').all();
    const columns = tableColumns.map(row => row.name);
    structure.push({ table, columns: tableColumns.map(row => ({ ...row, dflt_value: row.dflt_value === null ? null : canonicalBackupSql(row.dflt_value) })),
      foreignKeys: database.prepare('PRAGMA foreign_key_list(' + identifier(table) + ')').all() });
    check(columns.length > 0, 'SQL_COLUMNS');
    // Node's SQLite TEXT decoding also truncates at NUL. Read TEXT as a BLOB
    // and keep typeof() alongside it to preserve its original storage type.
    const projections = columns.flatMap((name, index) => ['typeof(' + identifier(name) + ') AS type_' + index,
      'CASE WHEN typeof(' + identifier(name) + ")='text' THEN CAST(" + identifier(name) + ' AS BLOB) ELSE ' + identifier(name) + ' END AS value_' + index]);
    const statement = database.prepare('SELECT ' + projections.join(',') + ' FROM ' + identifier(table) +
      ' ORDER BY ' + columns.map(name => identifier(name) + ' COLLATE BINARY').join(','));
    statement.setReadBigInts(true);
    const hash = createHash('sha256'); let rows = 0;
    for (const row of statement.iterate()) { for (let i = 0; i < columns.length; i++) hashValue(hash, row['value_' + i], row['type_' + i]); hash.update('\n'); rows++; }
    data.push({ table, columns, rows, sha256: hash.digest('hex') });
  }
  const integrity = database.prepare('PRAGMA integrity_check').all();
  check(integrity.length === 1 && Object.values(integrity[0])[0] === 'ok', 'INTEGRITY');
  check(database.prepare('PRAGMA foreign_key_check').all().length === 0, 'FOREIGN_KEYS');
  return { schemaSha256: backupHash(stableBackupJson({ schema, structure })), tables: data,
    schemaComparison: 'SQLite tokens excluding format/comments plus table columns and FK definitions',
    rows: data.reduce((n, row) => n + row.rows, 0), tableCount: schema.filter(row => row.type === 'table').length,
    fingerprint: backupHash(stableBackupJson({ schema, structure, data })), integrity: 'ok', foreignKeys: 'ok' };
}
async function sqliteFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    check(!entry.isSymbolicLink(), 'LOCAL_SYMLINK');
    if (entry.isDirectory()) files.push(...await sqliteFiles(join(directory, entry.name)));
    // Wrangler/Miniflare creates separate empty cache/object metadata stores.
    // They are not imported D1 databases and must not be mistaken for them.
    else if (entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite') files.push(join(directory, entry.name));
  }
  return files;
}
export function prepareDatabaseBackupRestore(database, sql) {
  // Cloudflare's dump can interleave a table, its triggers and its data before
  // another referenced table/view exists. Restore all tables first, all data
  // next, then views/indexes/triggers, as a logical dump restore. SQLite itself
  // parses each complete statement, including quoted semicolons and triggers.
  database.exec('PRAGMA foreign_keys=OFF;');
  const tables = [], data = [], schema = [];
  for (const framed of splitBackupSql(sql)) {
    const statement = database.prepare(framed), source = statement.sourceSQL;
    check(typeof source === 'string' && source.length > 0, 'SQL_STATEMENT');
    check(source.trim() === framed.trim(), 'SQL_FRAME');
    const leading = source.replace(/^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
    if (/^CREATE\s+TABLE\b/i.test(leading)) { statement.run(); tables.push(source); }
    else if (/^CREATE\s+(?:(?:UNIQUE\s+)?INDEX|VIEW|TRIGGER)\b/i.test(leading)) schema.push(source);
    else if (/^INSERT\s+(?:OR\s+[A-Z]+\s+)?INTO\b/i.test(leading) || /^DELETE\s+FROM\s+["`\[]?sqlite_sequence\b/i.test(leading)) data.push(source);
    else check(/^PRAGMA\s+(?:defer_foreign_keys|foreign_keys)\s*=\s*(?:TRUE|FALSE|ON|OFF|0|1)\s*;?\s*$/i.test(leading) ||
      /^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END)\s*;?\s*$/i.test(leading), 'SQL_UNSUPPORTED_STATEMENT');
  }
  database.exec('BEGIN;');
  for (const source of data) database.exec(source);
  for (const source of schema) database.exec(source);
  database.exec('COMMIT; PRAGMA foreign_keys=ON;');
  const output = ['PRAGMA defer_foreign_keys=ON;', ...tables, ...data, ...schema].join('\n') + '\n';
  const stages = [{ file: 'native-tables.sql', sql: tables.join('\n') + '\n' },
    { file: 'native-data.sql', sql: ['PRAGMA defer_foreign_keys=ON;', ...data].join('\n') + '\n' },
    ...schema.map((sql, index) => ({ file: 'native-schema-' + index + '.sql', sql }))];
  // Wrangler treats scripts containing triggers as one exec request. Keep each
  // trigger/index/view separate so the complete dump is not a single oversized
  // D1 statement. Table/data files retain every statement and every row.
  check(schema.every(source => Buffer.byteLength(source) < 90000), 'SQL_SCHEMA_STATEMENT_SIZE');
  return { sql: output, stages, sha256: backupHash(output), statements: { tables: tables.length, data: data.length, schema: schema.length } };
}
export function localDatabaseRestoreArguments(cli, config, sql, directory) {
  // No account id, real binding/UUID or remote option can be supplied here.
  return [cli, 'd1', 'execute', 'RESTORE_DB', '--local', '--config', config, '--file', sql, '--persist-to', directory];
}
export async function restoreProductionDatabases(root, plan, cloneDirectory, { execute = run } = {}) {
  const clone = await privateBackupDirectory(cloneDirectory, { create: true, fresh: true });
  const manifestPath = join(root, 'databases', 'manifest.json'); await hashBackupFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath));
  check(manifest.complete === true && manifest.databases?.length === 2 &&
    new Set(manifest.databases.map(row => row.binding)).size === 2, 'DATABASE_MANIFEST');
  const results = [];
  for (const row of manifest.databases) {
    const target = plan.databases.find(item => item.binding === row.binding && item.id === row.databaseId);
    check(target && ['WAITLIST_DB', 'MUSIC_DB'].includes(row.binding) && row.file === row.binding + '.sql', 'DATABASE_TARGET');
    const sourcePath = join(root, 'databases', row.file), actual = await hashBackupFile(sourcePath);
    check(actual.bytes === row.bytes && actual.sha256 === row.sha256, 'DATABASE_HASH');
    const directory = await privateBackupDirectory(join(clone, row.binding), { create: true, fresh: true });
    const referencePath = join(directory, 'reference.sqlite'), file = await open(referencePath, 'wx', 0o600); await file.close();
    const reference = new DatabaseSync(referencePath);
    let before, prepared;
    try {
      prepared = prepareDatabaseBackupRestore(reference, await readFile(sourcePath, 'utf8'));
      check(reference.prepare('PRAGMA database_list').all().length === 1, 'SQL_ATTACHED_DATABASE');
      before = databaseBackupFingerprint(reference);
    } finally { reference.close(); }
    const restorePath = join(directory, 'restore.sql'); await writeFile(restorePath, prepared.sql, { flag: 'wx', mode: 0o600 });
    const localId = randomUUID(), configPath = join(directory, 'local-only.json');
    await privateBackupJson(configPath, { name: 'station-cat-l02-local-restore', compatibility_date: '2026-05-17',
      d1_databases: [{ binding: 'RESTORE_DB', database_name: 'station-cat-l02-isolated-' + row.binding.toLowerCase(), database_id: localId }] });
    check(!plan.databases.some(item => item.id === localId), 'LOCAL_ID');
    const persistence = await privateBackupDirectory(join(directory, 'native-d1'), { create: true, fresh: true });
    const logs = await privateBackupDirectory(join(directory, 'logs'), { create: true, fresh: true });
    const options = { cwd: directory, env: { ...process.env, WRANGLER_LOG_PATH: logs, WRANGLER_SEND_METRICS: 'false' },
      timeout: 1200000, maxBuffer: 16 * 1024 * 1024 };
    const imported = [];
    for (const stage of prepared.stages) {
      const stagePath = join(directory, stage.file); await writeFile(stagePath, stage.sql, { flag: 'wx', mode: 0o600 });
      const result = await execute(process.execPath, localDatabaseRestoreArguments(plan.wranglerPath, configPath, stagePath, persistence), options)
        .catch(async error => { await writeFile(join(logs, stage.file + '.private.log'), (error.stdout || '') + (error.stderr || ''), { mode: 0o600 }); fail('NATIVE_D1_IMPORT'); });
      await writeFile(join(logs, stage.file + '.private.log'), result.stdout + result.stderr, { mode: 0o600 });
      imported.push({ file: stage.file, bytes: Buffer.byteLength(stage.sql), sha256: backupHash(stage.sql) });
    }
    const files = await sqliteFiles(persistence); check(files.length === 1, 'NATIVE_D1_FILES');
    const restored = new DatabaseSync(files[0], { readOnly: true });
    let after; try { after = databaseBackupFingerprint(restored); } finally { restored.close(); }
    check(stableBackupJson(after) === stableBackupJson(before), 'NATIVE_D1_FINGERPRINT');
    const verified = { binding: row.binding, backupSha256: actual.sha256, sqlBytes: actual.bytes,
      nativeLocalD1: true, isolated: true, overwrittenProduction: false,
      restoreSqlSha256: prepared.sha256, statementGroups: prepared.statements, importedStages: imported, ...after };
    await privateBackupJson(join(directory, 'verification.json'), verified); results.push(verified);
  }
  const report = { schemaVersion: 1, complete: true, productionWrites: 0, databases: results,
    verifiedAt: new Date().toISOString(), sourceManifestSha256: (await hashBackupFile(manifestPath)).sha256 };
  await privateBackupJson(join(clone, 'manifest.json'), report); return report;
}
export async function verifyProductionDatabaseClones(root, plan, cloneDirectory) {
  const clone = await privateBackupDirectory(cloneDirectory);
  const manifestPath = join(root, 'databases', 'manifest.json'); await hashBackupFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath));
  check(manifest.complete === true && manifest.databases.length === 2, 'DATABASE_MANIFEST');
  const results = [];
  for (const row of manifest.databases) {
    check(['WAITLIST_DB','MUSIC_DB'].includes(row.binding) && row.file === row.binding + '.sql' &&
      plan.databases.some(item => item.binding === row.binding && item.id === row.databaseId), 'DATABASE_TARGET');
    const actual = await hashBackupFile(join(root, 'databases', row.file));
    check(actual.bytes === row.bytes && actual.sha256 === row.sha256, 'DATABASE_HASH');
    const expected = new DatabaseSync(':memory:'); let before, prepared;
    try { prepared = prepareDatabaseBackupRestore(expected, await readFile(join(root, 'databases', row.file), 'utf8')); before = databaseBackupFingerprint(expected); }
    finally { expected.close(); }
    const directory = await privateBackupDirectory(join(clone, row.binding));
    for (const stage of prepared.stages) {
      const stageHash = await hashBackupFile(join(directory, stage.file));
      check(stageHash.sha256 === backupHash(stage.sql), 'NATIVE_D1_STAGE_HASH');
    }
    const files = await sqliteFiles(join(directory, 'native-d1')); check(files.length === 1, 'NATIVE_D1_FILES');
    const database = new DatabaseSync(files[0], { readOnly: true }); let after;
    try { after = databaseBackupFingerprint(database); } finally { database.close(); }
    check(stableBackupJson(before) === stableBackupJson(after), 'NATIVE_D1_FINGERPRINT');
    results.push({ binding: row.binding, backupSha256: actual.sha256, sqlBytes: actual.bytes,
      restoreSqlSha256: prepared.sha256, statementGroups: prepared.statements,
      nativeLocalD1: true, isolated: true, overwrittenProduction: false, ...after });
  }
  check(new Set(results.map(row => row.binding)).size === 2, 'DATABASE_MANIFEST');
  const result = { complete: true, productionWrites: 0, databases: results, verifiedAt: new Date().toISOString(),
    reportFile: 'final-verification-' + Date.now() + '.json',
    sourceManifestSha256: (await hashBackupFile(manifestPath)).sha256 };
  await privateBackupJson(join(clone, result.reportFile), result); return result;
}

const objectRestoreWorker = `
export default { async fetch(request, env) {
  if (request.headers.get('X-Recovery-Secret') !== env.RECOVERY_SECRET) return new Response(null,{status:403});
  const name=request.headers.get('X-Recovery-Binding');
  if (!['CONTENT_BUCKET','DOWNLOADS_BUCKET','MUSIC_BUCKET'].includes(name)) return new Response(null,{status:400});
  const bucket=env[name], key=decodeURIComponent(request.headers.get('X-Recovery-Key') || '');
  if (!key) return new Response(null,{status:400});
  if (request.method==='PUT') {
    const options=JSON.parse(decodeURIComponent(request.headers.get('X-Recovery-Metadata') || '{}'));
    if (options.httpMetadata?.cacheExpiry) options.httpMetadata.cacheExpiry=new Date(options.httpMetadata.cacheExpiry);
    await bucket.put(key, request.body || new Uint8Array(), options); return new Response(null,{status:201});
  }
  if (request.method==='GET') {
    const object=await bucket.get(key); if(!object) return new Response(null,{status:404});
    return new Response(object.body,{headers:{'Content-Length':String(object.size),
      'X-Recovery-Bytes':String(object.size),
      'X-Recovery-Etag':object.etag,
      'X-Recovery-Metadata':encodeURIComponent(JSON.stringify({httpMetadata:object.httpMetadata,customMetadata:object.customMetadata,storageClass:object.storageClass}))}});
  }
  return new Response(null,{status:405});
}};`;
export async function hashBackupBody(body, expectedBytes) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of body) { bytes += chunk.length; check(bytes <= expectedBytes, 'OBJECT_SIZE'); hash.update(chunk); }
  check(bytes === expectedBytes, 'OBJECT_SIZE'); return { bytes, sha256: hash.digest('hex') };
}
export async function restoreProductionObjects(root, plan, cloneDirectory, progress = () => {}) {
  // Validate every bucket and the recorded completion hashes before creating a
  // clone. A valid subset or repeated object cannot become a complete restore.
  const backups = await readCompletedBucketBackups(root, plan);
  const clone = await privateBackupDirectory(cloneDirectory, { create: true, fresh: true });
  const persistence = await privateBackupDirectory(join(clone, 'native-r2'), { create: true, fresh: true });
  const secret = randomUUID();
  const mf = new Miniflare({ modules: true, script: objectRestoreWorker, compatibilityDate: '2026-05-17',
    host: '127.0.0.1', port: 0, log: new Log(LogLevel.ERROR), r2Persist: persistence,
    r2Buckets: Object.fromEntries(plan.buckets.map(row => [row.binding, 'l02-local-' + randomUUID()])),
    bindings: { RECOVERY_SECRET: secret }, outboundService: () => new Response(null, { status: 403 }) });
  try {
    const results = [];
    for (const { target, manifest, manifestSha256: manifestHash } of backups.buckets) {
      const sourceDirectory = join(root, 'buckets', target.binding);
      check((await (await mf.getR2Bucket(target.binding)).list()).objects.length === 0, 'LOCAL_BUCKET_NOT_EMPTY');
      let bytes = 0, verifiedSinglePartEtags = 0; const verifiedObjects = [];
      for (const row of manifest.objects) {
        check(row.file === backupHash(row.key) + '.bin' && basename(row.file) === row.file, 'OBJECT_FILE');
        const path = join(sourceDirectory, 'objects', row.file), source = await hashBackupFile(path, { expectedMd5: backupSinglePartMd5(row.metadata.etag) });
        check(source.bytes === row.bytes && source.sha256 === row.sha256 && row.bytes === row.metadata.size, 'OBJECT_HASH');
        const options = { httpMetadata: row.metadata.http_metadata || {}, customMetadata: row.metadata.custom_metadata || {},
          ...(row.metadata.storage_class ? { storageClass: row.metadata.storage_class } : {}) };
        const headers = { 'X-Recovery-Secret': secret, 'X-Recovery-Binding': target.binding,
          'X-Recovery-Key': encodeURIComponent(row.key), 'X-Recovery-Metadata': encodeURIComponent(JSON.stringify(options)), 'Content-Length': String(row.bytes) };
        const response = await mf.dispatchFetch('http://127.0.0.1/__l02_restore', { method: 'PUT', headers,
          body: Readable.toWeb(createReadStream(path)), duplex: 'half' });
        check(response.status === 201, 'NATIVE_R2_PUT'); await response.body?.cancel();
        const getHeaders = { ...headers }; delete getHeaders['Content-Length']; delete getHeaders['X-Recovery-Metadata'];
        const restored = await mf.dispatchFetch('http://127.0.0.1/__l02_restore', { headers: getHeaders });
        check(restored.status === 200 && Number(restored.headers.get('X-Recovery-Bytes')) === row.bytes, 'NATIVE_R2_GET');
        const actual = await hashBackupBody(restored.body, row.bytes);
        check(actual.sha256 === source.sha256, 'NATIVE_R2_HASH');
        const expectedEtag = backupSinglePartMd5(row.metadata.etag);
        if (expectedEtag) { check(restored.headers.get('X-Recovery-Etag') === expectedEtag, 'NATIVE_R2_ETAG'); verifiedSinglePartEtags++; }
        const metadata = JSON.parse(decodeURIComponent(restored.headers.get('X-Recovery-Metadata')));
        check(stableBackupJson(metadata.httpMetadata) === stableBackupJson(options.httpMetadata) &&
          stableBackupJson(metadata.customMetadata) === stableBackupJson(options.customMetadata), 'NATIVE_R2_METADATA');
        verifiedObjects.push({ key: row.key, ...actual }); bytes += actual.bytes;
        progress({ binding: target.binding, completed: verifiedObjects.length, total: manifest.objects.length, bytes });
      }
      check(verifiedObjects.length === manifest.objects.length && bytes === manifest.bytes, 'NATIVE_R2_TOTAL');
      const result = { binding: target.binding, objects: verifiedObjects.length, bytes, nativeLocalR2: true,
        allBytesAndHttpCustomMetadataVerified: true, verifiedSinglePartEtags, storageClassVerified: false, sourceManifestSha256: manifestHash,
        restoredObjectsSha256: backupHash(stableBackupJson(verifiedObjects)) };
      results.push(result);
      await privateBackupJson(join(clone, target.binding + '.json'), { ...result, objects: verifiedObjects });
    }
    const result = { complete: true, productionWrites: 0, buckets: results, verifiedAt: new Date().toISOString(),
      crossResourceAtomic: false, sourceSummarySha256: backups.summarySha256,
      sourceMultipartEtagsUploadTimesAndStorageClassesNotReproduced: true };
    await privateBackupJson(join(clone, 'manifest.json'), result); return result;
  } finally { await mf.dispose(); }
}
