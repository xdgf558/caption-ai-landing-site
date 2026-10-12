import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { musicDisplayCoverManifest } from '../src/music/displayCoverManifest.js';
import { createContentAdminRuntime } from './helpers/station-content-admin-runtime.mjs';
import { fixtureId, seedLegacyFixture, insertFixture } from './helpers/station-redesign-database.mjs';
import { adminScriptFixture } from './helpers/station-admin-dom.mjs';

test('admin card delivery authenticates every response, checks current D1/R2 and never exposes the original as a thumbnail', async t => {
  const [sourceHash, variant] = Object.entries(musicDisplayCoverManifest).find(([,v]) => v.card);
  const card = await readFile(new URL('../public' + variant.card.path, import.meta.url));
  const original = new Uint8Array(variant.sourceBytes);
  let assetReads = 0, assetsAvailable = true;
  const f = await createContentAdminRuntime({ seed: (db, bucket) => seedLegacyFixture(db, { materializeAsset: async a => {
    const optimized = a.id === fixtureId(14), bytes = optimized ? original : new Uint8Array(100);
    const stored = await bucket.put(a.object_key, bytes, { httpMetadata: { contentType: a.content_type } });
    return { etag: stored.etag, ...(optimized ? { sha256: sourceHash, byte_size: original.length } : {}) };
  } }), assets: request => {
    assetReads++;
    assert.equal(new URL(request.url).pathname, variant.card.path);
    return assetsAvailable ? new Response(request.method === 'HEAD' ? null : card, { headers: {
      'Content-Type': variant.card.contentType, 'Content-Length': String(card.length)
    } }) : new Response(null, { status: 404 });
  } });
  t.after(() => f.close());
  const track = f.content.tracks[0];
  const asset = await f.db.prepare('SELECT * FROM music_assets WHERE id=?').bind(track.cover).first();
  // Opaque synthetic storage stands in for an already-validated source identity.
  // No production object or credentials are used by this runtime regression.
  const path = '/admin/api/music/site-content/assets/' + asset.id + '/thumbnail';
  const get = (target = path, options = {}) => f.mf.dispatchFetch('http://content.local.test' + target, {
    ...options, headers: { 'Cf-Access-Jwt-Assertion': f.actorToken, 'CF-Connecting-IP': '192.0.2.62', ...options.headers }
  });
  let etag;
  await t.test('GET and HEAD return only the card, with private revalidation and no public capability', async () => {
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, max-age=0, must-revalidate');
    assert.equal(response.headers.get('Vary'), 'Cookie, Cf-Access-Jwt-Assertion');
    assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
    assert.equal(response.headers.get('Content-Type'), 'image/webp');
    assert.equal(Number(response.headers.get('Content-Length')), card.length);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), card);
    etag = response.headers.get('ETag'); assert.ok(etag);
    const head = await get(path, { method: 'HEAD', headers: { Range: 'bytes=0-1' } });
    assert.equal(head.status, 200); assert.equal(head.headers.get('Accept-Ranges'), 'none');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal((await get(variant.card.path)).status, 404);
    assert.equal((await get('/api/station/content/assets/' + asset.id)).status, 404);
  });
  await t.test('304 revalidates Access and the closed content flag, without serving stored bytes to an expired session', async () => {
    const response = await get(path, { headers: { 'If-None-Match': etag } });
    assert.equal(response.status, 304); assert.equal((await response.arrayBuffer()).byteLength, 0);
    const reads = assetReads;
    for (const [token, status] of [['forged', 401], [await f.token({ exp: 1 }), 401], [await f.token({ email: 'outsider@example.test' }), 403]]) {
      assert.equal((await get(path, { headers: { 'Cf-Access-Jwt-Assertion': token, 'If-None-Match': etag } })).status, status);
    }
    assert.equal((await get('/fixture-off' + path, { headers: { 'If-None-Match': etag } })).status, 503);
    assert.equal((await get('/fixture-empty' + path)).status, 503);
    assert.equal(assetReads, reads);
  });
  await t.test('private editors can inspect pending artwork without publishing it; query and media-kind widening are refused', async () => {
    const response = await get('/fixture-editor' + path); assert.equal(response.status, 200); await response.body.cancel();
    assert.equal((await get(path + '?size=original')).status, 400);
    assert.equal((await get(path + '?size=card&size=card')).status, 400);
    assert.equal((await get('/admin/api/music/site-content/assets/' + track.audio + '/thumbnail')).status, 404);
    assert.equal((await get(path, { method: 'POST', headers: { Origin: 'http://content.local.test', 'X-Requested-With': 'StationCatMusicAdmin', 'Idempotency-Key': crypto.randomUUID() } })).status, 405);
  });
  await t.test('missing generated file or unknown source uses an error placeholder, while the separate original route stays available', async () => {
    assetsAvailable = false;
    const missing = await get(); assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'MUSIC_THUMBNAIL_UNAVAILABLE');
    assetsAvailable = true;
    const unknown = '/admin/api/music/site-content/assets/' + f.content.tracks[1].cover + '/thumbnail';
    assert.equal((await get(unknown, { headers: { 'If-None-Match': etag } })).status, 404);
    const full = await get('/admin/api/music/assets/' + asset.id);
    assert.equal(full.status, 200); assert.equal(full.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(Number(full.headers.get('Content-Length')), original.length); await full.body.cancel();
  });
  await t.test('an unvalidated asset or replaced/deleted R2 source cannot use an old card ETag', async () => {
    const pendingId = fixtureId(961);
    await insertFixture(f.db, 'music_assets', { ...asset, id: pendingId, state: 'uploaded', object_key: 'music/covers/' + asset.owner_track_id + '/' + pendingId + '.png' });
    assert.equal((await get('/admin/api/music/site-content/assets/' + pendingId + '/thumbnail', { headers: { 'If-None-Match': etag } })).status, 404);
    await f.bucket.put(asset.object_key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: asset.content_type } });
    assert.equal((await get(path, { headers: { 'If-None-Match': etag } })).status, 409);
    await f.bucket.delete(asset.object_key);
    assert.ok((await get(path, { headers: { 'If-None-Match': etag } })).status >= 400);
  });
});

function listApi() {
  const first = fixtureId(941), second = fixtureId(942), third = fixtureId(943);
  const item = (id, cover, title) => ({ id, type: 'tracks', title, status: 'published', imageId: cover, expectedAssetCount: 1,
    assetDetails: [{ id: cover, kind: 'cover', state: 'validated', rightsStatus: 'approved' }] });
  let items = [item(first, fixtureId(951), '第一首'), item(second, fixtureId(952), '第二首')];
  const calls = [];
  const request = async path => {
    calls.push(path); const url = new URL(path, 'http://fixture.test');
    if (path === '/status') return { actorId: 'fixture@example.test', role: 'publisher' };
    if (url.pathname === '/tracks') return { items: structuredClone(url.searchParams.has('before') ? [item(third, fixtureId(953), '第三首')] : items), nextBefore: url.searchParams.has('before') ? null : 1 };
    if (url.pathname === '/platforms') return { items: [] };
    throw new Error('Unexpected request ' + path);
  };
  return { request, calls, first, second, update(patch) { items = [patch(items[0]), items[1]]; } };
}
const imageIn = row => row.children[0].children[0].children[0];
test('audit rows without publication status preserve their record label after list reconciliation', async () => {
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=audit', request: async path => {
    if (path === '/status') return { actorId: 'fixture@example.test', role: 'publisher' };
    if (path === '/audit') return { items: [{ id: fixtureId(940), targetId: fixtureId(941), action: 'save', actorId: 'fixture@example.test', createdAt: Date.now(), summary: {} }], nextBefore: null };
    throw new Error('Unexpected request ' + path);
  } });
  assert.equal(f.node('content-list').children[0].children[0].children[2].textContent, '记录');
});
test('actual admin entry preserves image nodes across selection, metadata refresh and appended pages, and uses the latest row data', async () => {
  const api = listApi(), f = await adminScriptFixture('adminStationContent.js', { search: '?view=platforms', request: api.request });
  const list = f.node('content-list'), rows = [...list.children], images = rows.map(imageIn);
  assert.equal(images[0].src, '/admin/api/music/site-content/assets/' + fixtureId(951) + '/thumbnail');
  await rows[1].children[0].click(); await f.idle();
  assert.equal(f.state().current.id, api.second);
  assert.equal(list.children[0], rows[0]); assert.equal(list.children[1], rows[1]);
  assert.equal(imageIn(rows[0]), images[0]); assert.equal(imageIn(rows[1]), images[1]);
  api.update(item => ({ ...item, title: '更新后的第一首', status: 'draft', assetDetails: item.assetDetails.map(a => ({ ...a, rightsStatus: 'pending' })) }));
  await f.node('content-search-submit').click(); await f.idle();
  assert.equal(imageIn(rows[0]), images[0]); assert.equal(imageIn(rows[1]), images[1]);
  await rows[0].children[0].click(); await f.idle();
  assert.equal(f.node('content-editor-heading').textContent, '更新后的第一首');
  await f.node('content-more').click(); await f.idle();
  assert.equal(list.children.length, 3); assert.equal(imageIn(rows[0]), images[0]); assert.equal(imageIn(rows[1]), images[1]);
});
test('changing one cover replaces only that image and a late error cannot overwrite its replacement', async () => {
  const api = listApi(), f = await adminScriptFixture('adminStationContent.js', { search: '?view=platforms', request: api.request });
  const list = f.node('content-list'), rows = [...list.children], images = rows.map(imageIn), replacement = fixtureId(959);
  api.update(item => ({ ...item, imageId: replacement, assetDetails: [{ ...item.assetDetails[0], id: replacement }] }));
  await f.node('content-search-submit').click(); await f.idle();
  const fresh = imageIn(rows[0]); assert.notEqual(fresh, images[0]); assert.equal(imageIn(rows[1]), images[1]);
  assert.match(fresh.src, /\/thumbnail$/); assert.ok(fresh.src.includes(replacement));
  await images[0].fire('error'); assert.equal(imageIn(rows[0]), fresh);
  await fresh.fire('error'); const placeholder = imageIn(rows[0]);
  assert.equal(placeholder.tagName, 'SPAN'); assert.equal(placeholder.textContent, '预览暂不可用');
  await rows[1].children[0].click(); await f.idle();
  assert.equal(imageIn(rows[0]), placeholder); assert.equal(imageIn(rows[1]), images[1]);
});
