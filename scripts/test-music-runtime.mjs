import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = new URL('../', import.meta.url), file = path => readFileSync(new URL(path, root));
const manifest = JSON.parse(file('tests/fixtures/music-mp3/manifest.json')).files;
let mf, db, bucket;

// SQLite parses complete statements (including trigger bodies); no ad-hoc semicolon splitting.
function migrationStatements() {
  const parser = new DatabaseSync(':memory:'), migrations = [];
  try {
    for (const name of ['0001_music_foundation.sql', '0002_music_publication.sql']) {
      const statements = [];
      let remaining = file(`migrations-music/${name}`).toString();
      while (remaining.trim()) {
        const statement = parser.prepare(remaining), sql = statement.sourceSQL;
        assert.ok(sql.length > 0 && remaining.startsWith(sql));
        statement.run(); statements.push(sql); remaining = remaining.slice(sql.length);
      }
      migrations.push(statements);
    }
    return migrations;
  } finally { parser.close(); }
}

before(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('scripts/helpers/music-runtime-worker.js', root))],
    bundle: true, format: 'esm', platform: 'browser', write: false });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-30',
    host: '127.0.0.1', port: 0, d1Databases: { MUSIC_DB: 'music-test-only', WAITLIST_DB: 'reader-test-only' },
    r2Buckets: { MUSIC_BUCKET: 'music-test-only' },
    outboundService: () => new Response('Network disabled in local music tests', { status: 403 }) });
  db = await mf.getD1Database('MUSIC_DB'); bucket = await mf.getR2Bucket('MUSIC_BUCKET');
}, { timeout: 30000 });
after(async () => { await mf?.dispose(); });

async function call(path, input = {}, headers = {}) {
  const response = await mf.dispatchFetch(`http://music.local.test${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() };
}
async function adminCall(path, method = 'GET', body, headers = {}) {
  const response = await mf.dispatchFetch(`http://music.local.test/admin/api/music${path}`, { method,
    headers: { Origin: 'http://music.local.test', 'X-Requested-With': 'StationCatMusicAdmin',
      'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return { status: response.status, body: await response.json() };
}
const adminDraft = () => ({ slug: `admin-fixture-${randomUUID()}`, metadata: { originalLocale: 'en',
  title: { en: 'Local admin fixture' }, summary: { en: '' }, creatorName: 'Fixture', language: 'instrumental',
  instrumental: true, genres: [], moods: [] } });
async function putFixture(name, kind = 'audio', owner = randomUUID()) {
  const f = manifest.find(f => f.file === name), data = file(`tests/fixtures/music-mp3/${name}`), id = randomUUID();
  const key = `music/${kind === 'audio' ? 'audio' : 'previews'}/${owner}/${id}.mp3`;
  const object = await bucket.put(key, data, { httpMetadata: { contentType: 'audio/mpeg' } });
  return { id, owner_track_id: owner, kind, object_key: key, state: 'validated', format: 'mp3',
    content_type: 'audio/mpeg', byte_size: f.bytes, duration_ms: f.packetDurationMs, sha256: f.sha256, etag: object.etag };
}
async function seed() {
  const audio = await putFixture('cbr-stereo.mp3'), preview = await putFixture('preview.mp3', 'preview', audio.owner_track_id);
  Object.assign(preview, { derived_from_asset_id: audio.id, source_start_ms: 0, source_end_ms: 1000 });
  const response = await call('/seed', { audio, preview }); assert.equal(response.status, 200, JSON.stringify(response));
  return { command: response.body, audio, preview };
}
async function dump() {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'music_%' ORDER BY name").all()).results;
  const rows = await db.batch(tables.map(t => db.prepare(`SELECT * FROM ${t.name} ORDER BY rowid`)));
  return Object.fromEntries(tables.map((t, i) => [t.name, rows[i].results]));
}

test('missing schema is 503; actual migrations on local D1 enable primary readiness', async () => {
  assert.deepEqual(await call('/database'), { status: 503, body: { code: 'MUSIC_DATABASE_UNAVAILABLE' } });
  const migrations = migrationStatements();
  assert.ok((await db.batch(migrations[0].map(sql => db.prepare(sql)))).every(r => r.success));
  assert.equal((await call('/database')).body.code, 'MUSIC_DATABASE_UNAVAILABLE');
  assert.ok((await db.batch(migrations[1].map(sql => db.prepare(sql)))).every(r => r.success));
  const probe = await call('/database'); assert.equal(probe.status, 200, JSON.stringify(probe));
  assert.equal(probe.body.catalogVersion, 0); assert.equal(probe.body.previewLimitMs, 45000);
  assert.deepEqual(probe.body.flags, { public: false, uploads: false, vipDelivery: false, analytics: false });
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});

test('admin create/save/rights HTTP lifecycle executes real D1 without changing public catalog', async () => {
  const body = adminDraft(), first = await adminCall('/tracks', 'POST', body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const id = first.body.trackId, path = `/tracks/${id}`, read = await adminCall(path);
  assert.equal(read.body.draft.policy.accessMode, 'vip');
  const saved = await adminCall(path, 'PATCH', { ...body, policy: read.body.draft.policy, revisionId: first.body.revisionId,
    reason: 'Workerd save.' }, { 'If-Match': '"edit-1"' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const review = await adminCall(`/revisions/${saved.body.revisionId}/rights-review`, 'PUT',
    { status: 'pending', review: {}, evidenceIds: [], reason: 'Workerd review.' }, { 'If-Match': '"edit-2"' });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.editVersion, 3);
  const current = await adminCall(path); assert.equal(current.body.rights.reviewer, 'fixture@example.test');
  assert.equal(current.body.draft.technicalReviewedAt, null);
  const publish = await adminCall(`${path}/publish`, 'POST', { revisionId: saved.body.revisionId, confirmedPolicyVersion: 1,
    reason: 'Must stay private.' }, { 'If-Match': '"edit-3"' });
  assert.equal(publish.status, 503);
  assert.equal((await db.prepare("SELECT value_json FROM music_settings WHERE key='catalogVersion'").first()).value_json, '0');
});

test('admin last receipt RAISE(IGNORE) rolls back all earlier real D1 writes', async () => {
  const before = await dump(), body = adminDraft(), headers = { 'Idempotency-Key': randomUUID() };
  await db.prepare(`CREATE TRIGGER music_admin_test_ignore BEFORE INSERT ON music_mutations
    BEGIN SELECT RAISE(IGNORE); END`).run();
  try {
    const result = await adminCall('/tracks', 'POST', body, headers);
    assert.equal(result.status, 409, JSON.stringify(result.body)); assert.deepEqual(await dump(), before);
  } finally { await db.prepare('DROP TRIGGER music_admin_test_ignore').run(); }
  assert.equal((await adminCall('/tracks', 'POST', body, headers)).status, 200);
});

test('four identical admin requests share one receipt and competing saves never overwrite', async () => {
  const body = adminDraft(), headers = { 'Idempotency-Key': randomUUID() };
  const results = await Promise.all(Array.from({ length: 4 }, () => adminCall('/tracks', 'POST', body, headers)));
  assert.ok(results.every(r => r.status === 200), JSON.stringify(results));
  assert.equal(new Set(results.map(r => r.body.trackId)).size, 1);
  const created = results[0].body, read = (await adminCall(`/tracks/${created.trackId}`)).body;
  const saves = await Promise.all(Array.from({ length: 4 }, (_, i) => adminCall(`/tracks/${created.trackId}`, 'PATCH', {
    ...body, policy: read.draft.policy, revisionId: created.revisionId, reason: `Writer ${i}` }, { 'If-Match': '"edit-1"' })));
  assert.equal(saves.filter(r => r.status === 200).length, 1, JSON.stringify(saves));
  assert.ok(saves.every(r => [200, 409].includes(r.status)), JSON.stringify(saves));
  assert.equal((await adminCall(`/tracks/${created.trackId}`)).body.editVersion, 2);
});

test('admin unpublish and archive retain fixture media and sealed history with all flags off', async () => {
  const { command } = await seed(); assert.equal((await call('/publish', command)).status, 200);
  const path = `/tracks/${command.trackId}`;
  const off = await adminCall(`${path}/unpublish`, 'POST', { revisionId: command.revisionId, reason: 'Local downlist.' }, { 'If-Match': '"edit-2"' });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const archived = await adminCall(`${path}/archive`, 'POST', { reason: 'Retain fixture history.' }, { 'If-Match': '"edit-3"' });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal((await adminCall(path)).body.lifecycle, 'archived');
  assert.equal((await db.prepare('SELECT state FROM music_track_revisions WHERE id=?').bind(command.revisionId).first()).state, 'sealed');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM music_assets WHERE owner_track_id=?').bind(command.trackId).first()).n, 3);
});

test('native R2 BYOB + conditional GET measures all five encoded fixtures', async () => {
  for (const f of manifest) {
    const asset = await putFixture(f.file, f.file === 'preview.mp3' ? 'preview' : 'audio');
    const response = await call('/verify', asset); assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(response.body.sha256, f.sha256); assert.equal(response.body.sampleCount, f.packetSamples);
    assert.equal(response.body.durationMs, f.packetDurationMs); assert.ok(response.body.storageRead.maxChunkBytes <= 65536);
    assert.equal(response.body.bufferCapacityBytes, 67584);
  }
});

test('real R2 missing/precondition/MIME failures prevent any publication write', async () => {
  const { command, preview } = await seed(), before = await dump();
  await bucket.delete(preview.object_key);
  assert.equal((await call('/publish', command)).body.code, 'MUSIC_STORAGE_OBJECT_MISSING');
  assert.deepEqual(await dump(), before);
  await bucket.put(preview.object_key, 'replaced', { httpMetadata: { contentType: 'audio/mpeg' } });
  assert.equal((await call('/publish', command)).body.code, 'MUSIC_STORAGE_OBJECT_CHANGED');
  assert.deepEqual(await dump(), before);
  await bucket.put(preview.object_key, file('tests/fixtures/music-mp3/preview.mp3'), { httpMetadata: { contentType: 'text/html' } });
  assert.equal((await call('/publish', command)).body.code, 'MUSIC_STORAGE_OBJECT_CHANGED');
  assert.deepEqual(await dump(), before);
});

test('full publication executes json_object guards in D1 and replays one receipt', async () => {
  const { command } = await seed(), response = await call('/publish', command);
  assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.body.replayed, false);
  const track = await db.prepare('SELECT * FROM music_tracks WHERE id=?').bind(command.trackId).first();
  assert.equal(track.published_revision_id, command.revisionId); assert.equal(track.draft_revision_id, null);
  assert.equal(track.edit_version, 2); assert.equal(track.lifecycle, 'published');
  assert.equal((await db.prepare('SELECT state FROM music_track_revisions WHERE id=?').bind(command.revisionId).first()).state, 'sealed');
  const before = await dump(), replay = await call('/publish', command);
  assert.equal(replay.body.replayed, true); assert.deepEqual(await dump(), before);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM music_publication_guards').first()).n, 0);
});

test('matching R2 hash/ETag cannot bless damaged MP3 frames into D1 publication', async () => {
  const audio = await putFixture('cbr-stereo.mp3'), preview = await putFixture('preview.mp3', 'preview', audio.owner_track_id);
  const data = file('tests/fixtures/music-mp3/preview.mp3'); data[0] = 0;
  const object = await bucket.put(preview.object_key, data, { httpMetadata: { contentType: 'audio/mpeg' } });
  Object.assign(preview, { etag: object.etag, sha256: createHash('sha256').update(data).digest('hex'),
    derived_from_asset_id: audio.id, source_start_ms: 0, source_end_ms: 1000 });
  const seeded = await call('/seed', { audio, preview }); assert.equal(seeded.status, 200);
  const before = await dump(), result = await call('/publish', seeded.body);
  assert.equal(result.status, 422); assert.equal(result.body.code, 'MUSIC_MP3_FRAME_INVALID');
  assert.deepEqual(await dump(), before);
});

test('real D1 zero-row late write triggers changes() guard and rolls back entire publish', async () => {
  const { command } = await seed(), before = await dump();
  // A real SQL trigger suppresses the last receipt INSERT, after all earlier publication writes.
  await db.prepare(`CREATE TRIGGER fixture_skip_receipt BEFORE INSERT ON music_mutations
    WHEN NEW.idempotency_key='${command.idempotencyKey}' BEGIN SELECT RAISE(IGNORE); END`).run();
  try {
    const response = await call('/publish', command);
    assert.equal(response.status, 409, JSON.stringify(response)); assert.equal(response.body.code, 'MUSIC_PUBLICATION_CONFLICT');
    assert.deepEqual(await dump(), before);
  } finally { await db.prepare('DROP TRIGGER fixture_skip_receipt').run(); }
  assert.equal((await call('/publish', command)).status, 200);
});

test('same-key concurrent runtime requests leave one audit and mutation receipt', async () => {
  const { command } = await seed();
  const results = await Promise.all(Array.from({ length: 4 }, () => call('/publish', command)));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM music_mutations WHERE idempotency_key=?').bind(command.idempotencyKey).first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM music_admin_audit_logs WHERE target_id=?').bind(command.trackId).first()).n, 1);
});

test('separate local reader D1 returns INTEGER identity and stays read-only during VIP query', async () => {
  const reader = await mf.getD1Database('WAITLIST_DB'), now = Date.now(), token = 'isolated-runtime-cookie';
  await reader.batch([
    reader.prepare('CREATE TABLE reader_accounts(id INTEGER PRIMARY KEY,status TEXT)'),
    reader.prepare('CREATE TABLE reader_sessions(account_id INTEGER,session_hash TEXT,created_at TEXT,expires_at TEXT,revoked_at TEXT)'),
    reader.prepare('CREATE TABLE reader_memberships(account_id INTEGER PRIMARY KEY,membership_level TEXT,started_at TEXT,expires_at TEXT)'),
    reader.prepare("INSERT INTO reader_accounts VALUES(1,'active')"),
    reader.prepare('INSERT INTO reader_sessions VALUES(1,?,?,?,NULL)').bind(createHash('sha256').update(token).digest('hex'), new Date(now - 10000).toISOString(), new Date(now + 60000).toISOString()),
    reader.prepare("INSERT INTO reader_memberships VALUES(1,'member',?,?)").bind(new Date(now - 10000).toISOString(), new Date(now + 120000).toISOString())
  ]);
  const before = await reader.prepare('SELECT * FROM reader_memberships').all();
  const result = await call('/membership', {}, { Cookie: `station_cat_reader_session=${token}` });
  assert.equal(result.status, 200); assert.equal(result.body.membershipStatus, 'active');
  assert.equal(result.body.validUntil, new Date(now + 60000).toISOString());
  assert.deepEqual((await reader.prepare('SELECT * FROM reader_memberships').all()).results, before.results);
  assert.equal((await reader.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'music_%'").first()).n, 0);
});

test('fixture worker is not wired into site or deployment', () => {
  for (const path of ['src/worker.js', 'wrangler.toml']) assert.doesNotMatch(file(path).toString(), /music-runtime-worker|music-runtime-fixture|fixtureEvidenceProof/);
});

test('native R2 maximum sizes and concurrent reads retain bounded parser input', { timeout: 60000 }, async t => {
  const frame = Array.from(file('tests/fixtures/music-mp3/raw.mp3').subarray(0, 313));
  for (const kind of ['audio', 'preview']) {
    const seeded = await call('/stress-seed', { frame, kind }); assert.equal(seeded.status, 200, JSON.stringify(seeded));
    const asset = seeded.body;
    try {
      for (const concurrency of [1, 4]) {
        const started = performance.now();
        const results = await Promise.all(Array.from({ length: concurrency }, () => call('/verify', asset)));
        for (const result of results) {
          assert.equal(result.status, 200, JSON.stringify(result));
          assert.equal(result.body.sha256, asset.sha256); assert.equal(result.body.byteSize, asset.byte_size);
          assert.equal(result.body.bufferCapacityBytes, 67584); assert.ok(result.body.storageRead.maxChunkBytes <= 65536);
        }
        t.diagnostic(JSON.stringify({ kind, bytes: asset.byte_size, concurrency, wallMs: Math.round(performance.now() - started),
          chunkMax: Math.max(...results.map(r => r.body.storageRead.maxChunkBytes)), carryBytes: 67584,
          note: 'Local wall time, not production CPU or isolate heap measurement' }));
      }
    } finally { await bucket.delete(asset.object_key); }
  }
});
