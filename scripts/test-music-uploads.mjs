import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { createAdminMusicTrack } from '../src/music/admin.js';
import { createMusicUpload, readMusicUpload, uploadReadiness, completeMusicUpload } from '../src/music/uploads.js';
import { inspectSmallAsset } from '../src/music/assetFormats.js';
import { verifyStoredMusicAsset } from '../src/music/resources.js';

const instances = [], actorId = 'upload@example.test';
afterEach(() => { for (const f of instances.splice(0)) f.sql.close(); });
const context = () => ({ actorId, key: randomUUID() });
const hash = data => createHash('sha256').update(data).digest('hex');
async function fixture(quota = 1000000) {
  const f = musicTestDatabase(); instances.push(f);
  f.sql.prepare("UPDATE music_settings SET value_json=? WHERE key='storageQuotaBytes'").run(JSON.stringify(quota));
  f.track = await createAdminMusicTrack(f.db, { slug: `upload-${randomUUID()}`, metadata: { originalLocale: 'en', title: { en: 'Fixture' },
    summary: { en: '' }, creatorName: 'Fixture', instrumental: true, language: 'instrumental', genres: [], moods: [] } }, context());
  return f;
}
const command = (f, bytes = new TextEncoder().encode('Lyrics')) => ({ trackId: f.track.trackId, kind: 'lyrics', format: 'txt', byteSize: bytes.length, sha256: hash(bytes) });
function objectBucket(a, data, customMetadata = {}) {
  let reads = 0;
  const metadata = { key: a.object_key, size: data.length, etag: 'stored', httpMetadata: { contentType: a.content_type }, customMetadata };
  return { reads: () => reads, head: async () => metadata, get: async (key, options) => {
    reads++; assert.equal(key, a.object_key); assert.equal(options.onlyIf.etagMatches, 'stored');
    let offset = 0;
    return { ...metadata, body: new ReadableStream({ type: 'bytes', pull(c) {
      if (offset === data.length) { c.close(); c.byobRequest?.respond(0); return; }
      const view = c.byobRequest.view, n = Math.min(view.length, data.length - offset);
      view.set(data.subarray(offset, offset + n)); offset += n; c.byobRequest.respond(n);
    } }) };
  } };
}

test('migration leaves quota closed and protects session identity, replacement, transitions and accounting', async () => {
  const f = await fixture(0);
  await assert.rejects(createMusicUpload(f.db, command(f), context()), { code: 'MUSIC_UPLOADS_NOT_CONFIGURED' });
  f.sql.prepare("UPDATE music_settings SET value_json='1000' WHERE key='storageQuotaBytes'").run();
  const c = command(f), first = await createMusicUpload(f.db, c, context()), u = f.sql.prepare('SELECT * FROM music_upload_sessions WHERE id=?').get(first.uploadId);
  for (const sql of [`UPDATE music_upload_sessions SET declared_bytes=1`, `UPDATE music_upload_sessions SET expected_sha256='${'a'.repeat(64)}'`,
    'DELETE FROM music_upload_sessions', `UPDATE music_upload_sessions SET status='completed',actual_bytes=declared_bytes`]) assert.throws(() => f.sql.exec(sql));
  const keys = Object.keys(u);
  assert.throws(() => f.sql.prepare(`INSERT OR REPLACE INTO music_upload_sessions(${keys.join(',')}) VALUES(${keys.map(() => '?')})`).run(...Object.values(u)));
  assert.equal((await uploadReadiness(f.db)).chargedBytes, c.byteSize);
});

test('quota reservation is atomic under competing requests and includes failed/expired reservations', async () => {
  const f = await fixture(10), c = command(f), results = await Promise.allSettled([createMusicUpload(f.db, c, context()), createMusicUpload(f.db, c, context())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  f.sql.exec("UPDATE music_upload_sessions SET status='expired'");
  await assert.rejects(createMusicUpload(f.db, c, context()), { code: 'MUSIC_STORAGE_QUOTA' });
  assert.equal((await uploadReadiness(f.db)).chargedBytes, c.byteSize);
});

test('reserve replays lost acknowledgements once; key conflict, actor isolation and rollback are explicit', async () => {
  const f = await fixture(), c = command(f), ctx = context(); f.state.lose = true;
  const first = await createMusicUpload(f.db, c, ctx), replay = await createMusicUpload(f.db, c, ctx);
  assert.equal(first.uploadId, replay.uploadId); assert.equal(replay.replayed, true);
  await assert.rejects(createMusicUpload(f.db, { ...c, sha256: 'a'.repeat(64) }, ctx), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(readMusicUpload(f.db, first.uploadId, 'other@example.test'), { code: 'NOT_FOUND' });
  const before = f.dump(); f.state.skip = /INSERT INTO music_mutations/;
  await assert.rejects(createMusicUpload(f.db, c, context())); assert.deepEqual(f.dump(), before);
  f.state.skip = null; const view = await readMusicUpload(f.db, first.uploadId, actorId);
  assert.doesNotMatch(JSON.stringify(view), /object_key|expected_sha256|write_token/);
});

test('uploads reject wrong kinds, path injection, over-limit bodies and unbound previews before reservation', async () => {
  const f = await fixture(), c = command(f), before = f.dump();
  for (const patch of [{ kind: '__proto__' }, { format: 'html' }, { objectKey: 'private' }, { byteSize: 131073 },
    { byteSize: 0 }, { sha256: 'forged' }, { sourceAssetId: randomUUID() },
    { kind: 'preview', format: 'mp3', sourceAssetId: randomUUID(), sourceStartMs: 0, sourceEndMs: 1000 }]) {
    await assert.rejects(createMusicUpload(f.db, { ...c, ...patch }, context()));
  }
  assert.deepEqual(f.dump(), before);
});

test('same actor has at most ten live reservations; existing bytes without sessions also count', async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) await createMusicUpload(f.db, command(f), context());
  await assert.rejects(createMusicUpload(f.db, command(f), context()), { code: 'MUSIC_EDIT_CONFLICT' });
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_upload_sessions').get().n, 10);
  const oldId = randomUUID();
  f.sql.prepare(`INSERT INTO music_assets(id,owner_track_id,kind,object_key,state,content_type,format,byte_size,sha256,etag,created_at)
    VALUES(?,?,'lyrics',?,'validated','text/plain','txt',3,?,'legacy',?)`)
    .run(oldId, f.track.trackId, `music/lyrics/${f.track.trackId}/${oldId}.txt`, hash(Buffer.from('old')), Date.now());
  assert.equal((await uploadReadiness(f.db)).chargedBytes, 10 * command(f).byteSize + 3);
});

test('real PNG/JPEG/WebP headers, dimensions and static containers pass; forged/truncated/animated media fail', async () => {
  const base = sharp({ create: { width: 16, height: 12, channels: 3, background: '#278987' } });
  for (const format of ['png', 'jpeg', 'webp']) {
    const b = await base.clone().toFormat(format).toBuffer();
    assert.deepEqual(inspectSmallAsset({ kind: 'cover', format }, b), { width: 16, height: 12, animated: false });
    assert.throws(() => inspectSmallAsset({ kind: 'cover', format }, b.subarray(0, b.length - 5)));
    assert.throws(() => inspectSmallAsset({ kind: 'cover', format }, Buffer.from('<svg onload="alert(1)"/>')));
  }
  const giant = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000000' } }).png().toBuffer();
  assert.throws(() => inspectSmallAsset({ kind: 'cover', format: 'png' }, giant));
  const png = await base.clone().png().toBuffer(), corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => inspectSmallAsset({ kind: 'cover', format: 'png' }, corrupt));
  const animated = Buffer.concat([Buffer.from('RIFF'), Buffer.from([22, 0, 0, 0]), Buffer.from('WEBPVP8X'), Buffer.from([10, 0, 0, 0, 2, 0, 0, 0, 15, 0, 0, 11, 0, 0])]);
  assert.throws(() => inspectSmallAsset({ kind: 'cover', format: 'webp' }, animated));
});

test('lyrics require bounded strict UTF-8 and line count; PDF evidence checks envelope, never renders HTML', () => {
  const a = { kind: 'lyrics', format: 'lrc' };
  assert.equal(inspectSmallAsset(a, Buffer.from('[00:01.00]Hello\nWorld')).lines, 2);
  for (const data of [Buffer.from([255]), Buffer.from('bad\0text'), Buffer.from('\n'.repeat(5000))]) assert.throws(() => inspectSmallAsset(a, data));
  const pdf = { kind: 'evidence', format: 'pdf' };
  assert.equal(inspectSmallAsset(pdf, Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF\n')).measurement, 'pdf-envelope');
  assert.throws(() => inspectSmallAsset(pdf, Buffer.from('<html>%PDF-1.7</html>')));
});

test('complete reads actual immutable bytes, not MIME/hash claims, and commits asset/audit/session atomically', async () => {
  const f = await fixture(), data = Buffer.from('Real lyric bytes'), reserved = await createMusicUpload(f.db, command(f, data), context());
  f.sql.prepare("UPDATE music_upload_sessions SET status='uploading',write_token=? WHERE id=?").run(randomUUID(), reserved.uploadId);
  f.sql.prepare("UPDATE music_assets SET state='uploading' WHERE id=?").run(reserved.assetId);
  const a = f.sql.prepare('SELECT * FROM music_assets WHERE id=?').get(reserved.assetId);
  const bucket = objectBucket(a, data, { musicUpload: reserved.uploadId, musicAsset: a.id }), ctx = context(), before = f.dump();
  f.state.skip = /INSERT INTO music_mutations/;
  await assert.rejects(completeMusicUpload(f.db, bucket, reserved.uploadId, {}, ctx)); assert.deepEqual(f.dump(), before);
  f.state.skip = null;
  const done = await completeMusicUpload(f.db, bucket, reserved.uploadId, {}, ctx);
  assert.equal(done.status, 'completed');
  const reads = bucket.reads(); assert.equal((await completeMusicUpload(f.db, bucket, reserved.uploadId, {}, ctx)).replayed, true);
  assert.equal(bucket.reads(), reads);
  assert.equal(f.sql.prepare('SELECT state FROM music_assets WHERE id=?').get(a.id).state, 'validated');
  assert.throws(() => f.sql.prepare("UPDATE music_assets SET etag='changed' WHERE id=?").run(a.id));
});

test('small resource verifier fails for wrong actual hash, bytes, identity and changed objects', async () => {
  const bytes = Buffer.from('text'), a = { id: randomUUID(), owner_track_id: randomUUID(), kind: 'lyrics', format: 'txt', state: 'uploaded',
    byte_size: bytes.length, sha256: hash(bytes), etag: 'stored', content_type: 'text/plain' };
  a.object_key = `music/lyrics/${a.owner_track_id}/${a.id}.txt`;
  assert.equal((await verifyStoredMusicAsset(objectBucket(a, bytes), a)).utf8, true);
  for (const patch of [{ sha256: 'a'.repeat(64) }, { byte_size: 5 }, { object_key: '../secret' }, { content_type: 'text/html' }]) {
    await assert.rejects(verifyStoredMusicAsset(objectBucket(a, bytes), { ...a, ...patch }));
  }
  await assert.rejects(verifyStoredMusicAsset({ get: async () => null }, a), { code: 'MUSIC_STORAGE_OBJECT_MISSING' });
});

test('expired upload cannot complete or read any R2 object; its reservation remains charged', async () => {
  const f = await fixture(), reserved = await createMusicUpload(f.db, command(f), { ...context(), clock: () => Date.now() - 86401000 });
  assert.equal((await readMusicUpload(f.db, reserved.uploadId, actorId)).expired, true);
  await assert.rejects(completeMusicUpload(f.db, { head() { assert.fail('expired session touched R2'); } }, reserved.uploadId, {}, context()), { code: 'UPLOAD_EXPIRED' });
  assert.equal((await uploadReadiness(f.db)).chargedBytes, command(f).byteSize);
});

test('invalid completed bytes are audited rejected, never selectable, without unsafe quota release', async () => {
  const f = await fixture(), bytes = Buffer.from([255]), reserved = await createMusicUpload(f.db, command(f, bytes), context());
  f.sql.prepare("UPDATE music_upload_sessions SET status='uploading',write_token=? WHERE id=?").run(randomUUID(), reserved.uploadId);
  f.sql.prepare("UPDATE music_assets SET state='uploading' WHERE id=?").run(reserved.assetId);
  const a = f.sql.prepare('SELECT * FROM music_assets WHERE id=?').get(reserved.assetId);
  const bucket = objectBucket(a, bytes, { musicUpload: reserved.uploadId, musicAsset: a.id });
  await assert.rejects(completeMusicUpload(f.db, bucket, reserved.uploadId, {}, context()), { code: 'MUSIC_FILE_STRUCTURE_INVALID' });
  assert.equal((await readMusicUpload(f.db, reserved.uploadId, actorId)).status, 'rejected');
  assert.equal(f.sql.prepare('SELECT state FROM music_assets WHERE id=?').get(a.id).state, 'rejected');
  assert.equal((await uploadReadiness(f.db)).chargedBytes, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='music.upload.reject'").get().n, 1);
});
