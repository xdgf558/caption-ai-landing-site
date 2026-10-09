import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { connect } from 'node:net';
import { readFile } from 'node:fs/promises';
import { createStationMediaRuntime } from './helpers/station-media-runtime.mjs';
import { stationVideoBytes } from './helpers/station-video-fixture.mjs';

let runtime;
before(async () => { runtime = await createStationMediaRuntime(); }, { timeout: 60000 });
after(async () => { await runtime?.close(); });
const origin = 'http://media.local.test', base = '/admin/api/music/site-uploads';
async function call(path = '', { method = 'GET', body, raw = false, headers = {}, prefix = '', namespace = base } = {}) {
  const r = await runtime.mf.dispatchFetch(origin + prefix + namespace + path, { method, headers: {
    Origin: origin, 'X-Requested-With': 'StationCatMusicAdmin', 'Idempotency-Key': randomUUID(),
    'Cf-Access-Jwt-Assertion': runtime.actorToken, 'Content-Type': raw ? 'video/mp4' : 'application/json', ...headers },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }) });
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  return { status: r.status, body: method === 'HEAD' ? null : await r.json(), headers: r.headers };
}
const b = () => stationVideoBytes().bytes;
const command = (kind = 'short_video', data = b(), format = 'mp4') => ({ ownerId: runtime.content.owners[kind], kind, format,
  byteSize: data.length, sha256: createHash('sha256').update(data).digest('hex') });
async function reserve(data = b(), kind, format) {
  const r = await call('', { method: 'POST', body: command(kind, data, format) }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
test('actual Worker Access JWT checks signature, issuer, audience, expiry and allowed email before bindings', async () => {
  assert.equal((await call('/status')).status, 200);
  for (const patch of [{ exp: 0 }, { aud: ['wrong'] }, { iss: 'https://wrong.cloudflareaccess.com' }, { email: 'unlisted@example.test' }]) {
    const r = await call('/status', { headers: { 'Cf-Access-Jwt-Assertion': await runtime.token(patch) } }); assert([401,403].includes(r.status));
  }
  for (const headers of [{ 'Cf-Access-Jwt-Assertion': '' }, { 'Cf-Access-Jwt-Assertion': 'invalid', 'Cf-Access-Authenticated-User-Email': 'media-fixture@example.test' }])
    assert.equal((await call('/status', { headers })).status, 401);
  const token = runtime.actorToken.split('.'); token[2] = 'A' + token[2].slice(1);
  assert.equal((await call('/status', { headers: { 'Cf-Access-Jwt-Assertion': token.join('.') } })).status, 401);
});
test('default flags stay closed, empty/wrong bindings fail safely, and cross-origin/DELETE cannot mutate', async () => {
  for (const prefix of ['/fixture-off','/fixture-music-only','/fixture-media-only']) {
    const r = await call('/status', { prefix }); assert.equal(r.status, 503); assert.equal(r.body.code, 'STATION_MEDIA_UPLOADS_DISABLED');
  }
  for (const prefix of ['/fixture-empty','/fixture-wrong']) assert.equal((await call('/status', { prefix })).status, 503);
  assert.equal((await call('', { method: 'POST', body: command(), headers: { Origin: 'https://other.invalid' } })).status, 403);
  assert.equal((await call('', { method: 'DELETE' })).status, 405);
  assert.equal((await call('/status', { method: 'HEAD' })).status, 200);
});
test('native streaming PUT and confirmation measures MP4, uses version key, and identical body retries do not overwrite', async () => {
  const data = b(), r = await reserve(data), key = randomUUID();
  const put = await call('/' + r.uploadId + '/body', { method: 'PUT', body: data, raw: true, headers: { 'Idempotency-Key': key } });
  assert.equal(put.status, 200, JSON.stringify(put.body)); assert.equal(put.body.status, 'uploaded');
  const a = await runtime.db.prepare('SELECT * FROM station_media_assets WHERE id=?').bind(r.assetId).first();
  assert.equal(a.object_key, `station/media/short_video/${runtime.content.owners.short_video}/${r.assetId}.mp4`);
  const object = await runtime.bucket.head(a.object_key);
  const again = await call('/' + r.uploadId + '/body', { method: 'PUT', body: Buffer.alloc(data.length), raw: true, headers: { 'Idempotency-Key': key } });
  assert.equal(again.status, 200); assert.equal((await runtime.bucket.head(a.object_key)).etag, object.etag);
  const complete = await call('/' + r.uploadId + '/complete', { method: 'POST', body: {} });
  assert.equal(complete.status, 200, JSON.stringify(complete.body)); assert.equal(complete.body.phase, 'ready'); assert.equal(complete.body.durationMs, 30000); assert.equal(complete.body.width, 640); assert.equal(complete.body.height, 360);
  const replay = await call('/' + r.uploadId + '/complete', { method: 'POST', body: {} }); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal((await runtime.db.prepare('SELECT COUNT(*) n FROM station_asset_rights').first()).n, 0);
});
test('native image body and measured game screenshot dimensions use a separate owner and file', async () => {
  const data = await sharp({ create: { width: 160, height: 90, channels: 3, background: '#355a75' } }).png().toBuffer();
  const r = await reserve(data, 'game_screenshot', 'png');
  assert.equal((await call('/' + r.uploadId + '/body', { method: 'PUT', raw: true, body: data, headers: { 'Content-Type': 'image/png' } })).status, 200);
  const ready = await call('/' + r.uploadId + '/complete', { method: 'POST', body: {} }); assert.equal(ready.status, 200); assert.equal(ready.body.width, 160); assert.equal(ready.body.height, 90);
});
test('another allowed administrator cannot read/write/confirm an upload reserved by this actor', async () => {
  const r = await reserve(), token = await runtime.token({ email: 'other-media-fixture@example.test' });
  for (const [path, method, body, raw] of [['','GET'], ['/body','PUT',b(),true], ['/complete','POST',{},false]]) {
    assert.equal((await call('/' + r.uploadId + path, { method, body, raw, headers: { 'Cf-Access-Jwt-Assertion': token } })).status, 404);
  }
});
test('native interrupted short body fails without releasing charge or overwriting the next version', async () => {
  const data = b(), r = await reserve(data);
  const local = new URL(await runtime.mf.ready);
  await new Promise((resolve, reject) => {
    const socket = connect({ host: local.hostname, port: Number(local.port) });
    socket.on('error', reject); socket.on('close', resolve); socket.resume();
    socket.on('connect', () => {
      const headers = ['PUT ' + base + '/' + r.uploadId + '/body HTTP/1.1', 'Host: ' + local.host, 'Origin: ' + local.origin,
        'X-Requested-With: StationCatMusicAdmin', 'Cf-Access-Jwt-Assertion: ' + runtime.actorToken, 'Idempotency-Key: ' + randomUUID(),
        'Content-Type: video/mp4', 'Content-Length: ' + data.length, 'Connection: close', '', ''].join('\r\n');
      socket.write(headers); socket.write(data.subarray(0, 100)); socket.end();
    });
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('local interrupted upload timeout')); });
  });
  let started;
  for (let i = 0; i < 50; i++) { started = await runtime.db.prepare('SELECT write_token FROM station_media_upload_sessions WHERE id=?').bind(r.uploadId).first(); if (started.write_token) break; await new Promise(r => setTimeout(r, 10)); }
  assert(started.write_token, 'the native Worker claimed the writer before the transport ended');
  const current = await call('/' + r.uploadId); assert.notEqual(current.body.phase, 'ready');
  const charged = await runtime.db.prepare('SELECT charged_bytes FROM music_storage_charges WHERE asset_id=?').bind(r.assetId).first(); assert.equal(charged.charged_bytes, data.length);
  const next = await reserve(data); assert.notEqual(next.assetId, r.assetId);
});
test('corrupt video with its own matching digest is rejected after upload and remains private/charged', async () => {
  const data = Buffer.from('<html>not a video</html>'), r = await reserve(data);
  assert.equal((await call('/' + r.uploadId + '/body', { method: 'PUT', body: data, raw: true })).status, 200);
  const failed = await call('/' + r.uploadId + '/complete', { method: 'POST', body: {} }); assert.equal(failed.status, 422); assert.equal(failed.body.code, 'STATION_VIDEO_STRUCTURE_INVALID');
  const state = await call('/' + r.uploadId); assert.equal(state.body.phase, 'failed'); assert.equal(state.body.recovery, 'replace');
  const a = await runtime.db.prepare('SELECT * FROM station_media_assets WHERE id=?').bind(r.assetId).first();
  assert.equal(a.state, 'rejected'); assert(await runtime.bucket.head(a.object_key));
});
test('wrong MIME is refused before the writer, and a short native stream is rejected and retained', async () => {
  const r = await reserve();
  for (const [data, headers] of [[b(), { 'Content-Type': 'video/webm' }], [b().subarray(0,10), {}]]) {
    const result = await call('/' + r.uploadId + '/body', { method: 'PUT', body: data, raw: true, headers }); assert([413,415].includes(result.status), JSON.stringify(result.body));
    assert.equal((await call('/' + r.uploadId)).body.status, headers['Content-Type'] ? 'reserved' : 'rejected');
  }
});

test('0013 preserves native legacy full MP3 and separate derived preview uploads without granting promotion or rights', async () => {
  const namespace = '/admin/api/music/uploads';
  const mp3 = await readFile(new URL('../tests/fixtures/music-mp3/cbr-stereo.mp3', import.meta.url));
  const preview = await readFile(new URL('../tests/fixtures/music-mp3/preview.mp3', import.meta.url));
  async function upload(data, kind, source = {}) {
    const reserved = await call('', { namespace, method: 'POST', body: { trackId: runtime.content.track.trackId,
      kind, format: 'mp3', byteSize: data.length, sha256: createHash('sha256').update(data).digest('hex'), ...source } });
    assert.equal(reserved.status, 200, JSON.stringify(reserved.body));
    const id = reserved.body.uploadId;
    assert.equal((await call('/' + id + '/body', { namespace, method: 'PUT', raw: true, body: data, headers: { 'Content-Type': 'audio/mpeg' } })).status, 200);
    const done = await call('/' + id + '/complete', { namespace, method: 'POST', body: {} });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    return runtime.db.prepare('SELECT * FROM music_assets WHERE id=?').bind(reserved.body.assetId).first();
  }
  const full = await upload(mp3, 'audio'), excerpt = await upload(preview, 'preview', { sourceAssetId: full.id, sourceStartMs: 0, sourceEndMs: 1000 });
  assert.equal(full.state, 'validated'); assert.equal(excerpt.state, 'validated');
  assert.notEqual(full.id, excerpt.id); assert.notEqual(full.object_key, excerpt.object_key);
  assert.equal(excerpt.derived_from_asset_id, full.id); assert(excerpt.duration_ms < full.duration_ms / 2 + 250);
  assert.equal((await runtime.db.prepare('SELECT COUNT(*) n FROM station_promotion_revisions').first()).n, 0);
  assert.equal((await runtime.db.prepare('SELECT COUNT(*) n FROM station_asset_rights').first()).n, 0);
});
