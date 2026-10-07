import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';
import { stationVideoBytes } from './helpers/station-video-fixture.mjs';
import { stationClips, stationHomeClipModel } from '../src/redesign/clipView.js';
import { fixtureId } from './helpers/station-redesign-database.mjs';

let runtime;
before(async () => { runtime = await createStationMusicRuntime({ videoCases: true }); }, { timeout: 60000 });
after(async () => { await runtime?.close(); });
const call = (path, { prefix = '/fixture-pages-on', method = 'GET', headers = {} } = {}) =>
  runtime.mf.dispatchFetch('https://wwwstationcat.org' + prefix + path, { method, headers: { 'CF-Connecting-IP': '192.0.2.93', ...headers }, redirect: 'manual' });
const clips = async () => { const r = await call('/api/station/content/tracks/vip/clips?locale=en&limit=4'); assert.equal(r.status, 200); return (await r.json()).items; };
const model = html => JSON.parse(/<script id="sc-music-bootstrap" type="application\/json">([^]*?)<\/script>/.exec(html)[1]);

test('separate four-language homepage graph only binds selected T07 clip DTOs, keeps native detail fallback, and contains no video/audio', async () => {
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const html = await readFile(new URL('../.generated/station-clip-home-preview/' + locale + '/index.html', import.meta.url), 'utf8');
    const value = JSON.parse(/<script id="sc-home-clips-bootstrap" type="application\/json">([^]*?)<\/script>/.exec(html)[1]);
    assert.equal(stationHomeClipModel(value.home, value.clips).clips.length, 1);
    assert.match(html, /data-home-clip="[a-f0-9-]+" data-sc-clip="[a-f0-9-]+"/); assert.match(html, /href="[^"]+#clip-ca760000/);
    assert.match(html, /name="robots" content="noindex,nofollow"/); assert(!/<(?:audio|video|iframe)\b/.test(html));
    assert(!html.includes('object_key')); assert(!html.includes('fixture-session'));
  }
});

test('final built four-language detail shell has associated cards, empty accessible dialog, lazy posters and no video source/iframe', async () => {
  for (const prefix of ['', '/zh-hans', '/en', '/ja']) {
    const r = await call(prefix + '/music/tracks/vip/'); assert.equal(r.status, 200); const html = await r.text(), value = model(html);
    assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.equal(stationClips(value).length, 3); assert.equal((html.match(/class="sc-clip-card"/g) || []).length, 3);
    assert.match(html, /<dialog[^>]+data-sc-clip-dialog[^>]+aria-labelledby="sc-video-title"/);
    assert.match(html, /data-sc-video-host[^>]*><\/div>/); assert.match(html, /data-sc-video-close[^>]+autofocus/);
    assert(!/<(?:video|iframe)\b/.test(html)); assert(!/<(?:audio|img)[^>]+src="[^"]+8001/.test(html));
    assert(!html.includes('undefined')); assert(!html.includes('object_key')); assert.match(html, /data-sc-clip="[a-f0-9-]+"[^>]+hidden/);
  }
});
test('native D1/R2 returns actual pinned MP4 bytes and poster via current public asset checks', async () => {
  assert.equal(runtime.content.mediaProof.videoBytesAreMetadataOnly, false);
  const items = await clips(), first = items.find(c => c.id === runtime.videoScenarios.short);
  assert.equal(first.durationMs, 30000); assert.equal(first.trackId, runtime.content.tracks[1].id);
  const expected = stationVideoBytes().bytes, r = await call(first.mediaUrl), bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /video\/mp4/); assert.deepEqual(bytes, expected);
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
  const poster = await call(first.posterUrl); assert.equal(poster.status, 200); assert.match(poster.headers.get('content-type'), /image\/png/); assert((await poster.arrayBuffer()).byteLength > 100);
  const mv = items.find(c => c.id === runtime.videoScenarios.mv); assert.equal(mv.type, 'mv');
  const response = await call(mv.mediaUrl); assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), createHash('sha256').update(expected).digest('hex'));
});
test('video range and HEAD agree with the same pinned media; invalid range never streams the full object', async () => {
  const item = (await clips()).find(c => c.id === runtime.videoScenarios.short), expected = stationVideoBytes().bytes;
  const range = await call(item.mediaUrl, { headers: { Range: 'bytes=0-31' } }); assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-31/' + expected.length); assert.deepEqual(Buffer.from(await range.arrayBuffer()), expected.subarray(0, 32));
  const head = await call(item.mediaUrl, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(expected.length)); assert.equal(await head.text(), '');
  const invalid = await call(item.mediaUrl, { headers: { Range: 'bytes=' + (expected.length + 1) + '-' } }); assert.equal(invalid.status, 416); await invalid.body?.cancel();
});
test('both ordinary flag pairs remain closed for pages, and a disabled public service never streams these videos', async () => {
  for (const prefix of ['', '/fixture-pages-only', '/fixture-content-only']) {
    const r = await call('/music/tracks/vip/', { prefix }); assert.equal(r.status, 404); assert(!(await r.text()).includes('sc-video-dialog'));
  }
  const item = (await clips())[0]; const r = await call(item.mediaUrl, { prefix: '' }); assert.equal(r.status, 503); assert(!(await r.text()).includes('ftyp'));
});
test('intentional bad codec fixture retains only a safe synthetic original link; it cannot masquerade as decoded media evidence', async () => {
  const bad = (await clips()).find(c => c.id === runtime.videoScenarios.error);
  assert.equal(bad.publications[0].href, 'https://www.youtube.com/watch?v=synthetic-fixture-error');
  const r = await call(bad.mediaUrl); assert.equal(r.status, 200); const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.length, 100); assert.notEqual(bytes.subarray(4, 8).toString(), 'ftyp');
});
test('revoked poster rights immediately remove the associated clip and deny its already-known video URL', async () => {
  const id = fixtureId(8002), item = (await clips()).find(c => c.id === runtime.videoScenarios.mv);
  await runtime.db.prepare("UPDATE station_asset_rights SET status='blocked' WHERE media_asset_id=?").bind(id).run();
  try {
    assert(!(await clips()).some(c => c.id === item.id)); const r = await call(item.mediaUrl); assert.equal(r.status, 404); await r.text();
  } finally { await runtime.db.prepare("UPDATE station_asset_rights SET status='approved' WHERE media_asset_id=?").bind(id).run(); }
});
test('missing R2 media removes the clip and refuses a stale URL without altering its publication', async () => {
  const item = (await clips()).find(c => c.id === runtime.videoScenarios.mv);
  const asset = await runtime.db.prepare('SELECT * FROM station_media_assets WHERE id=?').bind(fixtureId(8001)).first();
  await runtime.bucket.delete(asset.object_key);
  try {
    assert(!(await clips()).some(c => c.id === item.id)); const r = await call(item.mediaUrl); assert.equal(r.status, 404); await r.text();
  } finally { await runtime.bucket.put(asset.object_key, stationVideoBytes().bytes, { httpMetadata: { contentType: 'video/mp4' } }); }
});
test('unpublished parent cannot expose a clip/video, and requesting clip bytes never grants full song entitlement', async () => {
  const item = (await clips())[0], track = runtime.content.tracks[1].id;
  const full = await call('/api/station/content/tracks/vip/playback?variant=full'); assert.equal(full.status, 401); await full.text();
  await runtime.db.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").bind(track).run();
  try {
    const list = await call('/api/station/content/tracks/vip/clips'); assert.equal(list.status, 404); await list.text();
    const r = await call(item.mediaUrl); assert.equal(r.status, 404); await r.text();
  } finally { await runtime.db.prepare("UPDATE station_track_publications SET status='published' WHERE track_id=?").bind(track).run(); }
});
