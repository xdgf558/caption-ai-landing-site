import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const identifier = value => '"' + value.replaceAll('"', '""') + '"';
export const releaseHash = value => createHash('sha256').update(value).digest('hex');
const userTables = "type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";

// A bounded logical export of a QUIESCENT, DISPOSABLE test database. No remote
// target option or credentials. Production must use a separately approved D1
// export and coherent reference/object inventory, not this fixture helper.
export async function exportFixtureDatabase(db) {
  const schema = (await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results;
  const tables = schema.filter(row => row.type === 'table');
  assert.ok(tables.length < 150 && tables.every(row => !/VIRTUAL TABLE/i.test(row.sql)), 'bounded fixture tables only');
  const columns = await db.batch(tables.map(row => db.prepare('PRAGMA table_info(' + identifier(row.name) + ')')));
  const queries = tables.map((row, i) => {
    const names = columns[i].results.filter(column => !column.hidden).map(column => column.name);
    const prefix = 'INSERT INTO ' + identifier(row.name) + '(' + names.map(identifier).join(',') + ') VALUES(';
    const values = names.map(name => 'quote(' + identifier(name) + ')').join(" || ',' || ");
    // SQLite quote() preserves NULL, blobs and 64-bit values as SQL text.
    return db.prepare("SELECT '" + prefix.replaceAll("'", "''") + "' || " + values + " || ');' AS statement FROM " + identifier(row.name) + ' ORDER BY rowid LIMIT 1001');
  });
  const output = await db.batch(queries);
  assert.ok(output.every(row => row.results.length <= 1000), 'fixture export cannot truncate');
  const sequence = (await db.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").all()).results.length
    ? (await db.prepare("SELECT 'INSERT INTO sqlite_sequence(name,seq) VALUES(' || quote(name) || ',' || quote(seq) || ');' AS statement FROM sqlite_sequence ORDER BY name").all()).results.map(row => row.statement) : [];
  const data = output.flatMap(row => row.results.map(item => item.statement));
  const statements = ['PRAGMA defer_foreign_keys=ON;', ...tables.map(row => row.sql), ...data,
    ...(sequence.length ? ['DELETE FROM sqlite_sequence;', ...sequence] : []),
    ...schema.filter(row => row.type !== 'table').map(row => row.sql)];
  const sql = statements.join(';\n') + ';\n';
  return { statements, sql, schema, data, sequence, sha256: releaseHash(sql), fingerprint: releaseHash(JSON.stringify({ schema, data, sequence })),
    counts: Object.fromEntries(tables.map((row, i) => [row.name, output[i].results.length])) };
}

export async function restoreFixtureClone(db, backup) {
  // Refuse even a pre-created schema. A restore can never overwrite the active
  // rehearsal database; rollback never calls this with its live handles.
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM sqlite_master WHERE ' + userTables).first()).n, 0,
    'restore requires a NEW empty clone');
  await db.batch(backup.statements.map(sql => db.prepare(sql)));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  // D1's SQL API does not expose integrity_check. Verify the same SQL export
  // separately in SQLite; label this evidence independently from native D1.
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; BEGIN;'); sqlite.exec(backup.sql); sqlite.exec('COMMIT;');
    assert.equal(sqlite.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { sqlite.close(); }
  const restored = await exportFixtureDatabase(db);
  assert.deepEqual(restored.schema, backup.schema, 'schema must match');
  assert.deepEqual(restored.data, backup.data, 'quoted rows must match');
  assert.deepEqual(restored.sequence, backup.sequence, 'generated ID high-water marks must match');
  // Keep empty sequences and deleted-ID high-water marks too. Restoring only
  // MAX(id) could reuse a historical order identifier after recovery.
  assert.equal(restored.fingerprint, backup.fingerprint, 'schema, quoted rows and sequences must match');
  return { sha256: backup.sha256, fingerprint: restored.fingerprint, sqliteIntegrity: 'ok', nativeD1ForeignKeys: 'ok', counts: restored.counts };
}

export async function exportFixtureObjects(bucket) {
  const listing = await bucket.list();
  assert.equal(listing.truncated, false, 'bounded fixture must export every object');
  const objects = [];
  for (const row of listing.objects) {
    const object = await bucket.get(row.key), bytes = new Uint8Array(await object.arrayBuffer());
    assert.equal(bytes.byteLength, row.size);
    objects.push({ key: row.key, bytes, sha256: releaseHash(bytes), httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
  }
  return objects;
}

export async function restoreFixtureObjects(bucket, objects) {
  assert.equal((await bucket.list()).objects.length, 0, 'restore requires a NEW empty bucket');
  for (const row of objects) await bucket.put(row.key, row.bytes, { httpMetadata: row.httpMetadata, customMetadata: row.customMetadata });
  const restored = await exportFixtureObjects(bucket);
  assert.deepEqual(restored.map(({ bytes, ...row }) => row), objects.map(({ bytes, ...row }) => row));
  return restored.map(({ key, bytes, sha256 }) => ({ key, byteSize: bytes.byteLength, sha256 }));
}
