import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { stationMediaTestDatabase, seedStationMediaDrafts, mediaActor, mediaUploadSql } from './helpers/station-media-fixture.mjs';
import { stationVideoBytes } from './helpers/station-video-fixture.mjs';
import { createStationMediaUpload, readStationMediaUpload, stationMediaReadiness, completeStationMediaUpload,
  stationMediaOwners, listStationMediaUploads } from '../src/redesign/mediaUploads.js';
import { createMp4Inspector } from '../src/redesign/mp4Validation.js';
import { measureStationMedia } from '../src/redesign/mediaResources.js';
import { createMusicUpload, uploadReadiness } from '../src/music/uploads.js';
import { handleMusicAdmin } from '../src/music/adminHttp.js';

const active = [];
afterEach(() => { for (const f of active.splice(0)) f.sql.close(); });
const ctx = (extra = {}) => ({ actorId: mediaActor, key: randomUUID(), ...extra });
const digest = b => createHash('sha256').update(b).digest('hex');
async function fixture(options) { const f = stationMediaTestDatabase(options); active.push(f); Object.assign(f, await seedStationMediaDrafts(f.db)); return f; }
const command = (f, b, kind = 'short_video', format = kind === 'short_video' || kind === 'mv' ? 'mp4' : 'png') => ({ ownerId: f.owners[kind], kind, format, byteSize: b.length, sha256: digest(b) });
const video = () => stationVideoBytes().bytes;
function inspect(b, chunk = 65536) { const p = createMp4Inspector(b.length); for (let i = 0; i < b.length; i += chunk) p.push(b.subarray(i, i + chunk)); return p.finish(); }
async function uploaded(f, b, kind, format) {
  const r = await createStationMediaUpload(f.db, command(f, b, kind, format), ctx());
  f.sql.prepare("UPDATE station_media_upload_sessions SET status='uploading',write_token=? WHERE id=?").run(randomUUID(), r.uploadId);
  f.sql.prepare("UPDATE station_media_assets SET state='uploading' WHERE id=?").run(r.assetId);
  return { ...r, a: f.sql.prepare('SELECT * FROM station_media_assets WHERE id=?').get(r.assetId), u: f.sql.prepare('SELECT * FROM station_media_upload_sessions WHERE id=?').get(r.uploadId) };
}
function bucket(item, b, patch = {}) {
  let reads = 0, deleted = 0, cancelled = false;
  const meta = { key: item.a.object_key, size: b.length, etag: 'fixture-etag', httpMetadata: { contentType: item.a.content_type },
    customMetadata: { stationUpload: item.u.id, stationAsset: item.a.id }, ...patch };
  return { reads: () => reads, deleted: () => deleted, cancelled: () => cancelled,
    delete: async () => { deleted++; throw new Error('must not delete'); }, head: async () => meta,
    get: async (key, options) => {
      reads++; assert.equal(key, item.a.object_key); assert.equal(options.onlyIf.etagMatches, meta.etag);
      let offset = 0;
      return { ...meta, body: new ReadableStream({ type: 'bytes', pull(c) {
        if (offset === b.length) { c.close(); c.byobRequest?.respond(0); return; }
        const n = Math.min(c.byobRequest.view.byteLength, b.length - offset); c.byobRequest.view.set(b.subarray(offset, offset + n)); offset += n; c.byobRequest.respond(n);
      }, cancel() { cancelled = true; } }) };
    } };
}

test('real pinned H.264/AAC fixture has measured duration and SPS dimensions across tiny stream boundaries', () => {
  const b = video(), expected = { durationMs: 30000, width: 640, height: 360, measurement: 'mp4-container-sps-v1', videoCodec: 'avc1', audioCodec: 'mp4a' };
  for (const chunk of [1, 7, 65536]) assert.deepEqual(inspect(b, chunk), expected);
});
test('valid tail-moov file relocates every chunk offset and keeps the same measurement', () => {
  const b = video(), moov = Buffer.from(b.subarray(32, 15068));
  for (let p = 0; (p = moov.indexOf('stco', p + 1)) !== -1;) { const n = moov.readUInt32BE(p + 8); for (let i = 0; i < n; i++) moov.writeUInt32BE(moov.readUInt32BE(p + 12 + i * 4) - moov.length, p + 12 + i * 4); }
  const tail = Buffer.concat([b.subarray(0, 32), b.subarray(15068), moov]);
  assert.deepEqual(inspect(tail), inspect(b));
});
test('forged containers, missing/truncated payloads, oversized metadata and unsupported fragmentation fail', () => {
  const b = video();
  for (const item of [Buffer.from('<html>not a video</html>'), b.subarray(0, b.length - 1), Buffer.concat([b, Buffer.from([0])])]) assert.throws(() => inspect(item));
  const fragments = Buffer.from(b); fragments.write('moof', 15080); assert.throws(() => inspect(fragments), { code: 'STATION_VIDEO_UNSUPPORTED' });
  const oversize = Buffer.alloc(24); oversize.writeUInt32BE(8, 0); oversize.write('free', 4); oversize.writeUInt32BE(3 * 1048576, 8); oversize.write('moov', 12);
  const p = createMp4Inspector(4 * 1048576); assert.throws(() => p.push(oversize), { code: 'STATION_VIDEO_METADATA_TOO_LARGE' });
});
test('duration, table counts, offsets, external data references and false pixel dimensions are rejected', () => {
  const b = video();
  const patches = [c => c.writeUInt32BE(0, 40 + 20), c => c.writeUInt32BE(0, c.indexOf('stsz') + 12),
    c => c.writeUInt32BE(1, c.indexOf('stco') + 12), c => c.writeUInt32BE(0, c.indexOf('url ') + 4),
    c => c.writeUInt16BE(639, c.indexOf('avc1', 400) + 28), c => c.writeUInt32BE(1, c.indexOf('stts') + 16),
    c => c.writeUInt32BE(0x7fffffff, c.indexOf('ctts') + 16)];
  for (const patch of patches) { const c = Buffer.from(b); patch(c); assert.throws(() => inspect(c)); }
});
test('missing 0013 schema or stale quota view closes uploads without modifying old rows', async () => {
  const f = await fixture({ migrated: false }), before = f.dump();
  await assert.rejects(stationMediaReadiness(f.db), { code: 'STATION_MEDIA_SCHEMA_UNAVAILABLE' });
  assert.deepEqual(f.dump(), before); f.sql.exec(mediaUploadSql);
  assert.equal((await stationMediaReadiness(f.db)).chargedBytes, 0);
  f.sql.exec('DROP VIEW music_storage_charges; CREATE VIEW music_storage_charges AS SELECT id AS asset_id,byte_size AS charged_bytes FROM music_assets');
  await assert.rejects(createStationMediaUpload(f.db, command(f, video()), ctx()), { code: 'STATION_MEDIA_SCHEMA_UNAVAILABLE' });
});
test('reservations require a matching editable owner and reject format/size/hash/key injection before writes', async () => {
  const f = await fixture(), c = command(f, video()), before = f.dump();
  for (const patch of [{ kind: 'audio' }, { kind: '__proto__' }, { format: 'webm' }, { ownerId: randomUUID() },
    { ownerId: f.owners.mv }, { byteSize: 268435457 }, { byteSize: 0 }, { sha256: 'bad' }, { objectKey: 'same-file.mp4' }]) await assert.rejects(createStationMediaUpload(f.db, { ...c, ...patch }, ctx()));
  assert.deepEqual(f.dump(), before);
  f.sql.prepare("UPDATE station_clips SET draft_revision=NULL WHERE id=?").run(f.owners.short_video);
  await assert.rejects(createStationMediaUpload(f.db, c, ctx()), { code: 'STATION_MEDIA_DRAFT_REQUIRED' });
});
test('reserve idempotency recovers a lost D1 acknowledgement, scopes actor, and rejects changed input', async () => {
  const f = await fixture(), c = command(f, video()), context = ctx(); f.state.lose = true;
  const a = await createStationMediaUpload(f.db, c, context), b = await createStationMediaUpload(f.db, c, context);
  assert.equal(a.assetId, b.assetId); assert.equal(b.replayed, true);
  await assert.rejects(createStationMediaUpload(f.db, { ...c, sha256: 'a'.repeat(64) }, context), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(readStationMediaUpload(f.db, a.uploadId, 'someone@example.test'), { code: 'NOT_FOUND' });
  assert.doesNotMatch(JSON.stringify(await readStationMediaUpload(f.db, a.uploadId, mediaActor)), /object_key|write_token|expected_sha256|etag|actor_id/);
});
test('shared quota counts old audio, album covers, new media and failed/unknown reservations atomically', async () => {
  const b = video(), f = await fixture({ quota: b.length + 3 });
  const lyric = Buffer.from('abc');
  await createMusicUpload(f.db, { trackId: f.track.trackId, kind: 'lyrics', format: 'txt', byteSize: 3, sha256: digest(lyric) }, ctx());
  const result = await Promise.allSettled([createStationMediaUpload(f.db, command(f, b), ctx()), createStationMediaUpload(f.db, command(f, b), ctx())]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await uploadReadiness(f.db)).chargedBytes, b.length + 3);
  f.sql.exec("UPDATE station_media_upload_sessions SET status='rejected'");
  assert.equal((await uploadReadiness(f.db)).chargedBytes, b.length + 3);
  await assert.rejects(createMusicUpload(f.db, { trackId: f.track.trackId, kind: 'lyrics', format: 'txt', byteSize: 3, sha256: digest(lyric) }, ctx()), { code: 'MUSIC_STORAGE_QUOTA' });
});
test('legacy station media without a receipt is charged once, unknown size at full limit', async () => {
  const f = await fixture();
  for (const [kind, size] of [['poster', 99], ['short_video', null]]) f.sql.prepare('INSERT INTO station_media_assets(id,owner_clip_id,kind,object_key,content_type,byte_size,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(randomUUID(), f.owners.short_video, kind, 'legacy/' + randomUUID(), kind === 'poster' ? 'image/png' : 'video/mp4', size, Date.now());
  assert.equal((await uploadReadiness(f.db)).chargedBytes, 268435456 + 99);
});
test('migration prevents identity replacement, another writer, incomplete ready state and physical deletion', async () => {
  const f = await fixture(), r = await createStationMediaUpload(f.db, command(f, video()), ctx()), u = f.sql.prepare('SELECT * FROM station_media_upload_sessions').get();
  for (const sql of ['UPDATE station_media_upload_sessions SET declared_bytes=1', 'DELETE FROM station_media_upload_sessions',
    "UPDATE station_media_upload_sessions SET status='completed'", 'DELETE FROM station_media_assets']) assert.throws(() => f.sql.exec(sql));
  const keys = Object.keys(u); assert.throws(() => f.sql.prepare(`INSERT OR REPLACE INTO station_media_upload_sessions(${keys.join(',')}) VALUES(${keys.map(() => '?')})`).run(...Object.values(u)));
  f.sql.prepare("UPDATE station_media_upload_sessions SET status='uploading',write_token=? WHERE id=?").run(randomUUID(), r.uploadId);
  assert.throws(() => f.sql.prepare('UPDATE station_media_upload_sessions SET write_token=?').run(randomUUID()));
});
test('complete measures immutable R2 bytes, reports validating during I/O, stores audit once and never approves or publishes', async () => {
  const f = await fixture(), b = video(), u = await uploaded(f, b), storage = bucket(u, b); let release;
  const original = storage.head; storage.head = async (...args) => { await new Promise(r => { release = r; }); return original(...args); };
  const pending = completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx());
  while (!release) await new Promise(r => setTimeout(r, 1));
  assert.equal((await readStationMediaUpload(f.db, u.uploadId, mediaActor)).phase, 'validating'); release();
  const ready = await pending; assert.equal(ready.phase, 'ready'); assert.equal(ready.durationMs, 30000); assert.equal(ready.width, 640);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_asset_rights').get().n, 0);
  assert.equal(f.sql.prepare('SELECT media_asset_id FROM station_clip_revisions WHERE id=?').get(f.owners.short_video).media_asset_id, null);
  assert.equal(f.sql.prepare('SELECT status FROM station_clips WHERE id=?').get(f.owners.short_video).status, 'draft');
  assert.equal((await completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx())).replayed, true);
  assert.equal(storage.reads(), 1); assert.equal(storage.deleted(), 0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='station.media.complete'").get().n, 1);
});
test('two concurrent confirmations with distinct keys produce one ready asset and one completion audit', async () => {
  const f = await fixture(), b = video(), u = await uploaded(f, b), storage = bucket(u, b);
  const results = await Promise.all([completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx()), completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx())]);
  assert(results.every(r => r.assetId === u.assetId && r.phase === 'ready'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_media_assets').get().n, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='station.media.complete'").get().n, 1);
});
test('real JPEG/PNG/WebP images measure dimensions for posters and game screenshots', async () => {
  const f = await fixture();
  for (const format of ['jpeg','png','webp']) {
    const b = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#345783' } }).toFormat(format).toBuffer();
    const u = await uploaded(f, b, format === 'webp' ? 'game_screenshot' : 'poster', format), ready = await completeStationMediaUpload(f.db, bucket(u, b), u.uploadId, {}, ctx());
    assert.equal(ready.width, 120); assert.equal(ready.height, 80); assert.equal(ready.durationMs, null);
  }
});
test('wrong hash, corrupt structure and stored identity reject, remain charged and never delete', async () => {
  const f = await fixture();
  for (const mode of ['hash','structure','identity']) {
    const b = mode === 'structure' ? Buffer.from('not a real mp4') : video(), u = await uploaded(f, b);
    const storage = bucket(u, mode === 'hash' ? Buffer.alloc(b.length) : b, mode === 'identity' ? { customMetadata: { stationUpload: randomUUID() } } : {});
    await assert.rejects(completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx()), { status: 422 });
    assert.equal((await readStationMediaUpload(f.db, u.uploadId, mediaActor)).phase, 'failed'); assert.equal(storage.deleted(), 0);
  }
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM station_media_assets WHERE state='validated'").get().n, 0);
  assert.equal((await uploadReadiness(f.db)).chargedBytes, 2 * video().length + 14);
});
test('a storage outage leaves recoverable validating state, and retry completes the same object', async () => {
  const f = await fixture(), b = video(), u = await uploaded(f, b), storage = bucket(u, b), real = storage.head;
  storage.head = async () => { throw new Error('private storage outage'); };
  await assert.rejects(completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx()), { code: 'STATION_MEDIA_STORAGE_UNAVAILABLE' });
  const state = await readStationMediaUpload(f.db, u.uploadId, mediaActor); assert.equal(state.phase, 'failed'); assert.equal(state.recovery, 'confirm');
  storage.head = real; assert.equal((await completeStationMediaUpload(f.db, storage, u.uploadId, {}, ctx())).phase, 'ready');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_media_assets').get().n, 1);
});
test('timeout disposes a late R2 body and never commits ready state', async () => {
  const f = await fixture(), b = video(), u = await uploaded(f, b), storage = bucket(u, b); let resolve;
  storage.get = async () => new Promise(r => { resolve = r; });
  await assert.rejects(measureStationMedia(storage, u.a, u.u, { timeoutMs: 20 }), { code: 'STATION_MEDIA_STORAGE_TIMEOUT' });
  let cancelled = false; resolve({ body: new ReadableStream({ cancel() { cancelled = true; } }) });
  await new Promise(r => setTimeout(r, 2)); assert.equal(cancelled, true);
  assert.equal((await readStationMediaUpload(f.db, u.uploadId, mediaActor)).status, 'uploading');
});
test('historical sealed revisions retain ready assets and their reserved charge', async () => {
  const f = await fixture(), b = video(), u = await uploaded(f, b); await completeStationMediaUpload(f.db, bucket(u, b), u.uploadId, {}, ctx());
  f.sql.prepare("UPDATE station_clip_revisions SET media_asset_id=?,state='sealed' WHERE id=?").run(u.assetId, f.owners.short_video);
  f.sql.prepare('UPDATE station_clips SET draft_revision=NULL WHERE id=?').run(f.owners.short_video);
  assert.throws(() => f.sql.prepare('DELETE FROM station_media_assets WHERE id=?').run(u.assetId));
  assert.throws(() => f.sql.prepare('DELETE FROM station_clip_revisions WHERE id=?').run(f.owners.short_video));
  assert.equal((await uploadReadiness(f.db)).chargedBytes, b.length);
});
test('disabled flag combinations return before touching bindings, and writes require same origin', async () => {
  const path = 'https://station.local.test/admin/api/music/site-uploads/status';
  for (const env of [{}, { MUSIC_UPLOADS_ENABLED: true }, { STATION_MEDIA_UPLOADS_ENABLED: true }]) {
    const r = await handleMusicAdmin(new Request(path), env, async () => mediaActor); assert.equal(r.status, 503); assert.equal((await r.json()).code, 'STATION_MEDIA_UPLOADS_DISABLED');
  }
  const r = await handleMusicAdmin(new Request(path.replace('/status',''), { method: 'POST', headers: { Origin: 'https://evil.invalid' } }), {}, async () => mediaActor); assert.equal(r.status, 403);
  assert.equal((await handleMusicAdmin(new Request(path), {}, async () => { throw Object.assign(new Error('ADMIN_FORBIDDEN'), { code: 'ADMIN_FORBIDDEN', status: 403 }); })).status, 403);
});
test('owners and sessions paginate equal timestamps without skipping ties or exposing another actor', async () => {
  const f = await fixture(), created = Date.now();
  for (let i = 0; i < 31; i++) {
    const id = randomUUID(); f.sql.prepare('INSERT INTO station_clips(id,track_id,type,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, f.track.trackId, 'mv', created, created);
    f.sql.prepare('INSERT INTO station_clip_revisions(id,revision,created_at) VALUES(?,1,?)').run(id, created);
    f.sql.prepare('UPDATE station_clips SET draft_revision=1 WHERE id=?').run(id);
  }
  const page = await stationMediaOwners(f.db, { kind: 'mv' }), rest = await stationMediaOwners(f.db, { kind: 'mv', cursor: page.nextCursor });
  assert.equal(new Set([...page.items, ...rest.items].map(r => r.id)).size, 32);
  const b = video();
  for (let i = 0; i < 22; i++) { const u = await createStationMediaUpload(f.db, command(f, b), ctx({ clock: () => created })); f.sql.prepare("UPDATE station_media_upload_sessions SET status='rejected' WHERE id=?").run(u.uploadId); }
  const first = await listStationMediaUploads(f.db, mediaActor, {}), next = await listStationMediaUploads(f.db, mediaActor, { cursor: first.nextCursor });
  assert.equal(new Set([...first.items, ...next.items].map(r => r.uploadId)).size, 22);
  assert.deepEqual((await listStationMediaUploads(f.db, 'other@example.test', {})).items, []);
});
