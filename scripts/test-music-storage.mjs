import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { verifyStoredMusicAudio } from '../src/music/storage.js';
import { musicRuntime, checkMusicDatabase } from '../src/music/runtime.js';

const root = new URL('../tests/fixtures/music-mp3/', import.meta.url);
const files = JSON.parse(readFileSync(new URL('manifest.json', root))).files;
function fixture(name = 'cbr-stereo.mp3', kind = 'audio') {
  const file = files.find(f => f.file === name), id = randomUUID(), owner = randomUUID();
  const asset = { id, owner_track_id: owner, kind, state: 'validated',
    object_key: `music/${kind === 'audio' ? 'audio' : 'previews'}/${owner}/${id}.mp3`,
    etag: 'fixture-etag', format: 'mp3', content_type: 'audio/mpeg',
    sha256: file.sha256, duration_ms: file.packetDurationMs, byte_size: file.bytes };
  return { asset, data: new Uint8Array(readFileSync(new URL(file.file, root))) };
}
function source(data, { chunk = 65536, hang = false, failure = false } = {}) {
  const stats = { cancelled: 0, reads: 0, views: [] }; let offset = 0;
  const body = new ReadableStream({ type: 'bytes',
    pull(controller) {
      stats.reads++;
      if (hang) return new Promise(() => {});
      if (failure) throw new Error('private backend error');
      const view = controller.byobRequest.view; stats.views.push(view.byteLength);
      if (offset === data.byteLength) { controller.close(); controller.byobRequest.respond(0); return; }
      const n = Math.min(chunk, view.byteLength, data.byteLength - offset);
      view.set(data.subarray(offset, offset + n)); offset += n; controller.byobRequest.respond(n);
    }, cancel() { stats.cancelled++; }
  });
  return { body, stats };
}
function bucketFor(asset, data, options = {}) {
  const { body, stats } = source(data, options);
  const object = { key: asset.object_key, size: data.byteLength, etag: asset.etag,
    httpMetadata: { contentType: asset.content_type }, body };
  const calls = [];
  return { stats, object, calls, bucket: { async get(key, options) { calls.push({ key, options }); return object; } } };
}
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code);

test('runtime fails closed for missing/aliased bindings; all flags default false', () => {
  const db = { withSession() {} }, bucket = { get() {} };
  for (const env of [{}, { MUSIC_DB: db }, { MUSIC_BUCKET: bucket },
    { MUSIC_DB: db, MUSIC_BUCKET: bucket, WAITLIST_DB: db }]) {
    assert.throws(() => musicRuntime(env), e => e.code === 'MUSIC_NOT_CONFIGURED');
  }
  const env = { MUSIC_DB: db, MUSIC_BUCKET: bucket };
  assert.deepEqual(musicRuntime(env).flags, { public: false, uploads: false, vipDelivery: false, analytics: false });
  for (const value of ['1', 1, 'false', 'TRUE', [], {}]) assert.equal(musicRuntime({ ...env, MUSIC_PUBLIC_ENABLED: value }).flags.public, false);
  assert.equal(musicRuntime({ ...env, MUSIC_PUBLIC_ENABLED: 'true' }).flags.public, true);
});

test('database readiness normalizes missing schema and invalid settings without writes', async () => {
  await rejects(checkMusicDatabase({}), 'MUSIC_DATABASE_UNAVAILABLE');
  for (const patch of [{ catalogVersion: '-1' }, { previewLimitMs: '45001' }, { catalogVersion: '{}' }]) {
    const db = { withSession(mode) { assert.equal(mode, 'first-primary'); return {
      prepare(sql) { assert.match(sql, /^SELECT /); return sql; },
      async batch() { return [{ success: true, results: Object.entries({ catalogVersion: '0', previewLimitMs: '45000', ...patch })
        .map(([key, value_json]) => ({ key, value_json })) }, ...Array.from({ length: 4 }, () => ({ success: true, results: [] }))]; }
    }; } };
    await rejects(checkMusicDatabase(db), 'MUSIC_DATABASE_UNAVAILABLE');
  }
});

test('five fixtures use conditional GET and bounded BYOB reads with exact measurements', async () => {
  for (const file of files) {
    const { asset, data } = fixture(file.file, file.file === 'preview.mp3' ? 'preview' : 'audio');
    const f = bucketFor(asset, data, { chunk: 1031 });
    f.object.range = { offset: 0, length: data.byteLength };
    Object.defineProperty(f.object, 'arrayBuffer', { get() { throw new Error('must never buffer object'); } });
    const result = await verifyStoredMusicAudio(f.bucket, asset);
    assert.equal(result.sha256, file.sha256); assert.equal(result.durationMs, file.packetDurationMs);
    assert.equal(result.sampleCount, file.packetSamples); assert.equal(result.byteSize, data.byteLength);
    assert.deepEqual(f.calls, [{ key: asset.object_key, options: { onlyIf: { etagMatches: asset.etag } } }]);
    assert.ok(f.stats.views.every(size => size === 65536)); assert.ok(result.storageRead.maxChunkBytes <= 1031);
    assert.equal(f.object.body.locked, false); assert.equal(f.stats.cancelled, 0);
  }
});

test('invalid source identities and options are rejected before touching the bucket', async () => {
  const { asset } = fixture(); let calls = 0;
  const bucket = { get() { calls++; throw new Error('unexpected'); } };
  for (const patch of [{ object_key: 'https://evil.test/a.mp3' }, { object_key: '../a.mp3' },
    { owner_track_id: randomUUID() }, { kind: 'evidence' }, { state: 'uploaded' }, { byte_size: 33554433 },
    { sha256: 'invalid' }, { etag: '"quoted"' }, { etag: 'bad\nheader' }, { duration_ms: 0 }]) {
    await rejects(verifyStoredMusicAudio(bucket, { ...asset, ...patch }), 'MUSIC_STORAGE_ASSET_INVALID');
  }
  for (const options of [{ timeoutMs: 10001 }, { timeoutMs: NaN }, { signal: {} }]) {
    await rejects(verifyStoredMusicAudio(bucket, asset, options), 'MUSIC_STORAGE_OPTIONS_INVALID');
  }
  const controller = new AbortController(); controller.abort();
  await rejects(verifyStoredMusicAudio(bucket, asset, { signal: controller.signal }), 'MUSIC_STORAGE_ABORTED');
  assert.equal(calls, 0);
});

test('missing object and failed ETag precondition never yield a proof', async () => {
  const { asset } = fixture();
  await rejects(verifyStoredMusicAudio({ get: async () => null }, asset), 'MUSIC_STORAGE_OBJECT_MISSING');
  await rejects(verifyStoredMusicAudio({ get: async () => ({ etag: 'new' }) }, asset), 'MUSIC_STORAGE_OBJECT_CHANGED');
});

test('size, MIME, key, ETag and unexpected ranged bodies are cancelled unread', async () => {
  for (const patch of [{ size: 1 }, { httpMetadata: { contentType: 'text/html' } },
    { key: 'other' }, { etag: 'new' }, { range: { offset: 0, length: 1 } }]) {
    const { asset, data } = fixture(), f = bucketFor(asset, data); Object.assign(f.object, patch);
    await rejects(verifyStoredMusicAudio(f.bucket, asset), 'MUSIC_STORAGE_OBJECT_CHANGED');
    assert.equal(f.stats.reads, 0); assert.equal(f.stats.cancelled, 1);
  }
});

test('default-only streams are rejected, never silently buffered or rechunked', async () => {
  const { asset, data } = fixture(), f = bucketFor(asset, data); let cancelled = false;
  f.object.body = new ReadableStream({ cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await rejects(verifyStoredMusicAudio(f.bucket, asset), 'MUSIC_STORAGE_STREAM_UNSUPPORTED');
  assert.equal(cancelled, true);
});

test('corruption, truncated actual body and forged hash/duration fail closed', async () => {
  for (const kind of ['corrupt', 'truncated', 'hash', 'duration']) {
    const { asset, data } = fixture();
    if (kind === 'corrupt') data[0] = 0;
    if (kind === 'hash') asset.sha256 = 'b'.repeat(64);
    if (kind === 'duration') asset.duration_ms++;
    const f = bucketFor(asset, kind === 'truncated' ? data.subarray(0, -3) : data); f.object.size = asset.byte_size;
    await assert.rejects(verifyStoredMusicAudio(f.bucket, asset), e => e.status === 422);
    assert.equal(f.object.body.locked, false);
  }
});

test('deadline includes pending GET and disposes late bodies/rejections', async () => {
  const { asset, data } = fixture(), f = bucketFor(asset, data); let resolve;
  await rejects(verifyStoredMusicAudio({ get: () => new Promise(r => { resolve = r; }) }, asset, { timeoutMs: 10 }), 'MUSIC_STORAGE_TIMEOUT');
  resolve(f.object); await new Promise(r => setTimeout(r, 0)); assert.equal(f.stats.cancelled, 1);
  let reject;
  await rejects(verifyStoredMusicAudio({ get: () => new Promise((_, r) => { reject = r; }) }, asset, { timeoutMs: 10 }), 'MUSIC_STORAGE_TIMEOUT');
  reject(new Error('late secret backend error')); await new Promise(r => setTimeout(r, 0));
});

test('abort and stalled/read-error bodies release their reader', async () => {
  for (const mode of ['timeout', 'abort', 'error']) {
    const { asset, data } = fixture(), f = bucketFor(asset, data, { hang: mode !== 'error', failure: mode === 'error' });
    const controller = new AbortController();
    const task = verifyStoredMusicAudio(f.bucket, asset, { timeoutMs: mode === 'timeout' ? 10 : 1000, signal: controller.signal });
    if (mode === 'abort') setTimeout(() => controller.abort(), 10);
    await assert.rejects(task, e => ['MUSIC_STORAGE_TIMEOUT', 'MUSIC_STORAGE_ABORTED', 'MUSIC_MP3_READ_FAILED'].includes(e.code));
    assert.equal(f.object.body.locked, false);
  }
});

test('parser resource ceilings cannot be loosened; budget failure cleans up storage', async () => {
  const { asset, data } = fixture();
  for (const limits of [{ frames: 1 }, { frames: 150001 }]) {
    const f = bucketFor(asset, data);
    await assert.rejects(verifyStoredMusicAudio(f.bucket, asset, { limits }), e => /^MUSIC_MP3_/.test(e.code));
    assert.equal(f.object.body.locked, false); assert.equal(f.stats.cancelled, 1);
  }
});

test('bucket errors expose only stable codes, never private keys or backend messages', async () => {
  const { asset } = fixture();
  await assert.rejects(verifyStoredMusicAudio({ get() { throw new Error(asset.object_key); } }, asset),
    e => e.code === 'MUSIC_STORAGE_UNAVAILABLE' && e.message === e.code && e.status === 503);
});
