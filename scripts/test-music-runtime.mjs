import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import sharp from 'sharp';

const root = new URL('../', import.meta.url), file = path => readFileSync(new URL(path, root));
const manifest = JSON.parse(file('tests/fixtures/music-mp3/manifest.json')).files;
let mf, db, bucket;

// SQLite parses complete statements (including trigger bodies); no ad-hoc semicolon splitting.
function migrationStatements() {
  const parser = new DatabaseSync(':memory:'), migrations = [];
  try {
    for (const name of ['0001_music_foundation.sql', '0002_music_publication.sql', '0003_music_uploads.sql']) {
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
async function mediaCall(trackId, variant, { method = 'GET', headers = {}, version = 1 } = {}) {
  return mf.dispatchFetch(`http://music.local.test/fixture-media/api/music/tracks/${trackId}/audio?v=${version}&variant=${variant}`,
    { method, headers });
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
  assert.equal((await adminCall('/status')).body.storage, null);
  assert.ok((await db.batch(migrations[2].map(sql => db.prepare(sql)))).every(r => r.success));
  assert.equal((await adminCall('/status')).body.storage.quotaBytes, 0);
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
  assert.equal(publish.status, 422);
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

test('collection lifecycle and exact order execute through native D1 JSON guards', async () => {
  const published = await seed();
  assert.equal((await call('/publish', published.command)).status, 200);
  const draft = await adminCall('/tracks', 'POST', adminDraft());
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const body = { slug: `runtime-list-${randomUUID()}`, originalLocale: 'en', title: { en: 'Runtime playlist' },
    description: { en: 'Native D1 collection transaction.' } };
  const created = await adminCall('/collections', 'POST', body);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  let result = await adminCall(`/collections/${created.body.collectionId}/tracks`, 'PUT',
    { trackIds: [draft.body.trackId, published.command.trackId], reason: 'Native order.' }, { 'If-Match': '"edit-1"' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  let collection = (await adminCall(`/collections/${created.body.collectionId}`)).body;
  assert.deepEqual(collection.tracks.map(track => track.id), [draft.body.trackId, published.command.trackId]);
  result = await adminCall(`/collections/${collection.id}`, 'PATCH', { slug: collection.slug,
    originalLocale: collection.originalLocale, title: collection.title, description: collection.description,
    status: 'published', reason: 'Publish native playlist.' }, { 'If-Match': '"edit-2"' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const catalogAfterPublish = result.body.catalogVersion;
  result = await adminCall(`/collections/${collection.id}/tracks`, 'PUT',
    { trackIds: [published.command.trackId, draft.body.trackId], reason: 'Native reorder.' }, { 'If-Match': '"edit-3"' });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.catalogVersion, catalogAfterPublish + 1);
  collection = (await adminCall(`/collections/${collection.id}`)).body;
  assert.deepEqual(collection.tracks.map(track => track.id), [published.command.trackId, draft.body.trackId]);
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

test('native D1 publication and R2 object serve exact preview/full Range bytes behind the shared guard', async () => {
  const { command, audio, preview } = await seed();
  assert.equal((await call('/publish', command)).status, 200);
  const previewFile = file('tests/fixtures/music-mp3/preview.mp3');
  let response = await mediaCall(command.trackId, 'preview', { headers: { Range: 'bytes=0-1' } });
  assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), previewFile.subarray(0, 2));
  assert.equal(response.headers.get('content-range'), `bytes 0-1/${preview.byte_size}`);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  response = await mediaCall(command.trackId, 'full');
  assert.equal(response.status, 401); assert.equal(response.headers.get('etag'), null);

  const reader = await mf.getD1Database('WAITLIST_DB'), token = `media-${randomUUID()}`, time = Date.now();
  await reader.batch([
    reader.prepare('INSERT OR REPLACE INTO reader_accounts(id,status) VALUES(77,\'active\')'),
    reader.prepare(`INSERT INTO reader_sessions(account_id,session_hash,created_at,expires_at,revoked_at)
      VALUES(77,?,?,?,NULL)`).bind(createHash('sha256').update(token).digest('hex'),
      new Date(time - 10000).toISOString(), new Date(time + 60000).toISOString()),
    reader.prepare(`INSERT OR REPLACE INTO reader_memberships(account_id,membership_level,started_at,expires_at)
      VALUES(77,'member',?,?)`).bind(new Date(time - 10000).toISOString(), new Date(time + 120000).toISOString())
  ]);
  const audioFile = file('tests/fixtures/music-mp3/cbr-stereo.mp3'), auth = { Cookie: `station_cat_reader_session=${token}` };
  response = await mediaCall(command.trackId, 'full', { headers: { ...auth, Range: 'bytes=-3' } });
  assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), audioFile.subarray(-3));
  assert.equal(response.headers.get('content-range'), `bytes ${audio.byte_size - 3}-${audio.byte_size - 1}/${audio.byte_size}`);
  response = await mediaCall(command.trackId, 'preview', { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), String(preview.byte_size));
  assert.equal(response.headers.get('content-range'), null); assert.equal(await response.text(), '');
  response = await mediaCall(command.trackId, 'preview', { headers: { Range: `bytes=${preview.byte_size}-` } });
  assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), `bytes */${preview.byte_size}`);
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

async function uploadApi(path, method = 'GET', input, headers = {}, raw = false) {
  const response = await mf.dispatchFetch(`http://music.local.test/fixture-uploads/admin/api/music${path}`, { method, duplex: 'half',
    headers: { Origin: 'http://music.local.test', 'X-Requested-With': 'StationCatMusicAdmin',
      'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...headers },
    ...(input === undefined ? {} : { body: raw ? input : JSON.stringify(input) }) });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return response;
}
async function uploadJson(...args) {
  const r = await uploadApi(...args); return { status: r.status, body: await r.json() };
}
async function uploadFile(trackId, kind, format, bytes, source = {}) {
  const reserved = await uploadJson('/uploads', 'POST', { trackId, kind, format, byteSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), ...source });
  assert.equal(reserved.status, 200, JSON.stringify(reserved));
  const id = reserved.body.uploadId, type = kind === 'audio' || kind === 'preview' ? 'audio/mpeg' : format === 'png' ? 'image/png' : 'text/plain';
  const put = await uploadJson(`/uploads/${id}/body`, 'PUT', bytes, { 'Content-Type': type }, true);
  assert.equal(put.status, 200, JSON.stringify(put)); assert.equal(put.body.readyToComplete, true);
  const done = await uploadJson(`/uploads/${id}/complete`, 'POST', {});
  assert.equal(done.status, 200, JSON.stringify(done));
  return { ...done.body, bytes, type };
}

test('real protected upload, review and publish HTTP chain uses actual MP3/cover/lyrics/evidence bytes', { timeout: 30000 }, async () => {
  assert.equal((await uploadJson('/uploads', 'POST', {})).status, 400);
  await db.prepare("UPDATE music_settings SET value_json='200000000' WHERE key='storageQuotaBytes'").run();
  const draft = adminDraft(), created = await adminCall('/tracks', 'POST', draft), trackId = created.body.trackId;
  const audio = await uploadFile(trackId, 'audio', 'mp3', file('tests/fixtures/music-mp3/cbr-stereo.mp3'));
  const preview = await uploadFile(trackId, 'preview', 'mp3', file('tests/fixtures/music-mp3/preview.mp3'),
    { sourceAssetId: audio.assetId, sourceStartMs: 0, sourceEndMs: 1000 });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#278987' } }).png().toBuffer();
  const cover = await uploadFile(trackId, 'cover', 'png', png), evidence = await uploadFile(trackId, 'evidence', 'png', png);
  const lyrics = await uploadFile(trackId, 'lyrics', 'lrc', Buffer.from('[00:00.00]Local fixture only\n[00:01.00]Not a licensed song'));
  const assets = { audio: audio.assetId, preview: preview.assetId, cover: cover.assetId, lyrics: lyrics.assetId };
  const policy = (await adminCall(`/tracks/${trackId}`)).body.draft.policy;
  const saved = await adminCall(`/tracks/${trackId}`, 'PATCH', { ...draft, assets, policy,
    revisionId: created.body.revisionId, reason: 'Attach only real validated fixture bytes.' }, { 'If-Match': '"edit-1"' });
  assert.equal(saved.status, 200, JSON.stringify(saved)); const revisionId = saved.body.revisionId;
  const review = { sourcePlatform: 'suno', sourceSongUrl: null, sourceSongId: 'SYNTHETIC-NOT-A-LICENSE',
    generatedAt: '2026-01-01T00:00:00.000Z', downloadedAt: '2026-01-02T00:00:00.000Z', termsCheckedAt: '2026-01-03T00:00:00.000Z',
    planAtGeneration: 'pro', planAtDownload: 'pro', outputKind: 'standard', downloadMethod: 'official', permittedUse: 'commercial',
    authorizationBasis: 'Synthetic local fixture, not real authorization.', lyricsRightsNotes: 'Fixture only.',
    coverRightsNotes: 'Fixture only.', audioInputRightsNotes: 'Fixture only.' };
  const rights = await adminCall(`/revisions/${revisionId}/rights-review`, 'PUT',
    { status: 'approved', review, evidenceIds: [evidence.assetId], reason: 'Synthetic local rights review.' }, { 'If-Match': '"edit-2"' });
  assert.equal(rights.status, 200, JSON.stringify(rights));
  const publishInput = { revisionId, reason: 'Local API verification, not actual music release.', confirmedPolicyVersion: 1 };
  assert.equal((await adminCall(`/tracks/${trackId}/publish`, 'POST', publishInput, { 'If-Match': '"edit-3"' })).status, 422);
  const checklist = { audioListened: true, previewListened: true, previewSourceConfirmed: true, artworkChecked: true, reason: 'Synthetic technical checklist for API tests.' };
  const before = await dump();
  assert.equal((await adminCall(`/revisions/${revisionId}/technical-review`, 'PUT', { ...checklist, previewSourceConfirmed: false }, { 'If-Match': '"edit-3"' })).body.code, 'MUSIC_LISTENING_REVIEW_REQUIRED');
  assert.deepEqual(await dump(), before);
  const checked = await adminCall(`/revisions/${revisionId}/technical-review`, 'PUT', checklist, { 'If-Match': '"edit-3"' });
  assert.equal(checked.status, 200, JSON.stringify(checked));
  const receiptKey = randomUUID(), published = await adminCall(`/tracks/${trackId}/publish`, 'POST', publishInput,
    { 'If-Match': '"edit-4"', 'Idempotency-Key': receiptKey });
  assert.equal(published.status, 200, JSON.stringify(published));
  assert.equal((await adminCall(`/tracks/${trackId}`)).body.lifecycle, 'published');
  assert.equal((await adminCall(`/tracks/${trackId}/publish`, 'POST', publishInput,
    { 'If-Match': '"edit-4"', 'Idempotency-Key': receiptKey })).body.replayed, true);
  for (const asset of [audio, preview, cover, lyrics, evidence]) {
    const response = await uploadApi(`/assets/${asset.assetId}`, 'GET', undefined, { Range: 'bytes=0-1', 'If-None-Match': '*' });
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), asset.bytes);
    assert.equal(response.headers.get('content-type'), asset.type);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    if (asset === evidence || asset === lyrics) assert.match(response.headers.get('content-disposition'), /^attachment/);
    const head = await uploadApi(`/assets/${asset.assetId}`, 'HEAD'); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const replayPut = await uploadJson(`/uploads/${asset.uploadId}/body`, 'PUT', Buffer.from('must not replace'), { 'Content-Type': asset.type }, true);
    assert.equal(replayPut.status, 200); assert.equal(replayPut.body.status, 'completed');
  }
  const mediaOff = (await adminCall('/status')).body;
  assert.equal(mediaOff.flags.public, false); assert.equal(mediaOff.flags.vipDelivery, false); assert.equal(mediaOff.capabilities.media, false);
  const replacement = await adminCall(`/tracks/${trackId}`, 'PATCH', { ...draft, assets, policy,
    revisionId, reason: 'Replacement must not disturb the published revision.' }, { 'If-Match': '"edit-5"' });
  assert.equal(replacement.status, 200, JSON.stringify(replacement)); const next = replacement.body.revisionId;
  assert.equal((await adminCall(`/tracks/${trackId}/publish`, 'POST', { ...publishInput, revisionId: next }, { 'If-Match': '"edit-6"' })).status, 422);
  assert.equal((await adminCall(`/revisions/${next}/rights-review`, 'PUT',
    { status: 'approved', review, evidenceIds: [evidence.assetId], reason: 'Review replacement.' }, { 'If-Match': '"edit-6"' })).status, 200);
  const original = await dump();
  await db.prepare(`CREATE TRIGGER music_technical_test_ignore BEFORE INSERT ON music_mutations
    WHEN NEW.route LIKE '%/technical-review' BEGIN SELECT RAISE(IGNORE); END`).run();
  try {
    assert.equal((await adminCall(`/revisions/${next}/technical-review`, 'PUT', checklist, { 'If-Match': '"edit-7"' })).status, 409);
    assert.deepEqual(await dump(), original);
  } finally { await db.prepare('DROP TRIGGER music_technical_test_ignore').run(); }
  assert.equal((await adminCall(`/revisions/${next}/technical-review`, 'PUT', checklist, { 'If-Match': '"edit-7"' })).status, 200);
  const coverRow = await db.prepare('SELECT object_key FROM music_assets WHERE id=?').bind(cover.assetId).first();
  await bucket.delete(coverRow.object_key);
  assert.equal((await adminCall(`/tracks/${trackId}/publish`, 'POST', { ...publishInput, revisionId: next }, { 'If-Match': '"edit-8"' })).body.code, 'MUSIC_STORAGE_OBJECT_MISSING');
  assert.equal((await adminCall(`/tracks/${trackId}`)).body.published.id, revisionId);
});

test('native PUT concurrent writers cannot overwrite; lost response recovers and hash/size failures stay private', { timeout: 30000 }, async () => {
  const draft = (await adminCall('/tracks', 'POST', adminDraft())).body, data = Buffer.from('Native streaming text');
  const reserve = async (overrides = {}) => (await uploadJson('/uploads', 'POST', { trackId: draft.trackId, kind: 'lyrics', format: 'txt',
    byteSize: data.length, sha256: createHash('sha256').update(data).digest('hex'), ...overrides })).body;
  const u = await reserve(), path = `/uploads/${u.uploadId}/body`;
  const competing = await Promise.all(Array.from({ length: 4 }, () => uploadJson(path, 'PUT', data, { 'Content-Type': 'text/plain' }, true)));
  assert.equal(competing.filter(r => r.status === 200).length, 1, JSON.stringify(competing));
  assert.ok(competing.every(r => [200, 409].includes(r.status)), JSON.stringify(competing));
  // Discard PUT success and recover solely through session query and complete.
  assert.equal((await uploadJson(`/uploads/${u.uploadId}`)).body.status, 'uploading');
  const key = randomUUID(), done = await uploadJson(`/uploads/${u.uploadId}/complete`, 'POST', {}, { 'Idempotency-Key': key });
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal((await uploadJson(`/uploads/${u.uploadId}/complete`, 'POST', {}, { 'Idempotency-Key': key })).body.replayed, true);
  for (const [patch, body] of [[{ sha256: 'a'.repeat(64) }, data], [{}, data.subarray(1)], [{}, Buffer.concat([data, data])]]) {
    const bad = await reserve(patch), write = await uploadJson(`/uploads/${bad.uploadId}/body`, 'PUT', body, { 'Content-Type': 'text/plain' }, true);
    assert.ok([413, 503].includes(write.status), JSON.stringify(write));
    assert.notEqual((await uploadJson(`/uploads/${bad.uploadId}/complete`, 'POST', {})).status, 200);
    assert.equal((await uploadApi(`/assets/${bad.assetId}`)).status, 404);
  }
  const disabled = await adminCall('/uploads', 'POST', { trackId: draft.trackId }); assert.equal(disabled.body.code, 'MUSIC_UPLOADS_DISABLED');
  const blocked = await reserve();
  assert.equal((await uploadApi(`/uploads/${blocked.uploadId}/body`, 'PUT', data, { Origin: 'https://evil.example', 'Content-Type': 'text/plain' }, true)).status, 403);
  assert.equal((await uploadJson(`/uploads/${blocked.uploadId}`)).body.status, 'reserved');
  const preexisting = await reserve();
  const row = await db.prepare('SELECT object_key FROM music_assets WHERE id=?').bind(preexisting.assetId).first();
  const original = await bucket.put(row.object_key, 'Preexisting object must survive', { httpMetadata: { contentType: 'text/plain' } });
  const refused = await uploadJson(`/uploads/${preexisting.uploadId}/body`, 'PUT', data, { 'Content-Type': 'text/plain' }, true);
  assert.equal(refused.body.code, 'UPLOAD_OBJECT_EXISTS'); assert.equal(refused.status, 409);
  assert.equal((await bucket.head(row.object_key)).etag, original.etag);
});

test('native unknown-length 32 MiB input streams to R2; actual overrun and truncated bodies cannot complete', { timeout: 30000 }, async () => {
  const trackId = (await adminCall('/tracks', 'POST', adminDraft())).body.trackId;
  const frame = Array.from(file('tests/fixtures/music-mp3/raw.mp3').subarray(0, 313));
  const seeded = await call('/stress-seed', { frame, kind: 'audio' }); assert.equal(seeded.status, 200);
  const a = seeded.body;
  const reserved = await uploadJson('/uploads', 'POST', { trackId, kind: 'audio', format: 'mp3', byteSize: a.byte_size, sha256: a.sha256 });
  assert.equal(reserved.status, 200, JSON.stringify(reserved));
  try {
    const original = await bucket.get(a.object_key);
    const put = await uploadJson(`/uploads/${reserved.body.uploadId}/body`, 'PUT', original.body, { 'Content-Type': 'audio/mpeg' }, true);
    assert.equal(put.status, 200, JSON.stringify(put));
    const done = await uploadJson(`/uploads/${reserved.body.uploadId}/complete`, 'POST', {});
    assert.equal(done.status, 200, JSON.stringify(done)); assert.equal(done.body.durationMs, a.duration_ms);
  } finally { await bucket.delete(a.object_key); }
  for (const size of [3, 5]) {
    const data = new Uint8Array(size), expected = new Uint8Array(4);
    const u = await uploadJson('/uploads', 'POST', { trackId, kind: 'lyrics', format: 'txt', byteSize: 4,
      sha256: createHash('sha256').update(expected).digest('hex') });
    const body = new ReadableStream({ start(c) { c.enqueue(data); c.close(); } });
    const put = await uploadJson(`/uploads/${u.body.uploadId}/body`, 'PUT', body, { 'Content-Type': 'text/plain' }, true);
    assert.equal(put.status, 413, JSON.stringify(put));
    assert.notEqual((await uploadJson(`/uploads/${u.body.uploadId}/complete`, 'POST', {})).status, 200);
  }
});
