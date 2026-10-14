import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import sharp from 'sharp';
import { handleStationContent } from '../src/redesign/publicHttp.js';
import { renderMusicCatalog, renderSongHero } from '../src/redesign/musicRender.js';
import { renderBrandHomeSlots } from '../src/redesign/brandHomeRender.js';
import { musicDisplayCoverManifest } from '../src/music/displayCoverManifest.js';
import { contentFixture, base, now, seedContent, homeFixture, promotionFixture, approve, publishTrack } from './helpers/station-content-fixture.mjs';
import { migrationStatements, insertFixture, fixtureId } from './helpers/station-redesign-database.mjs';

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = new Uint8Array(100).fill(37);
const card = new Uint8Array(8).fill(12), display = new Uint8Array(16).fill(21);
const variant = (bytes, type, ext) => ({ path: '/api/music/__cover-files/' + hash(bytes) + '.' + ext,
  sha256: hash(bytes), bytes: bytes.length, sourceBytes: source.length, contentType: type });
const entry = { ...variant(display, 'image/jpeg', 'jpg'), card: variant(card, 'image/webp', 'webp') };
const manifest = { [hash(source)]: entry };
const asset = request => {
  const path = new URL(request.url).pathname, row = path === entry.path ? [display, entry] : path === entry.card.path ? [card, entry.card] : null;
  return row ? new Response(request.method === 'HEAD' ? null : row[0],
    { headers: { 'Content-Type': row[1].contentType, 'Content-Length': String(row[0].length) } }) : new Response(null, { status: 404 });
};
async function fixture() {
  const f = await contentFixture(); fixtures.push(f); f.env.ASSETS = { fetch: asset }; return f;
}
const call = (f, path, input = {}, options = {}) => handleStationContent(new Request('https://wwwstationcat.org' + base + path,
  { ...input, headers: { 'CF-Connecting-IP': '192.0.2.89', ...input.headers } }), f.env,
  { clock: () => now, coverManifest: manifest, ...options });

const assertVersionedCache = response => {
  assert.equal(response.headers.get('cache-control'), 'private, max-age=86400, must-revalidate');
  assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
  assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
};

test('fresh public cover DTO fingerprints support only strict versioned image variants and leave old URLs unchanged', async () => {
  const f = await fixture(), track = f.content.tracks[0];
  const listing = await (await call(f, '/tracks')).json();
  const dto = listing.items.find(item => item.id === track.id);
  assert.equal(dto.coverUrl, base + '/assets/' + track.cover);
  assert.equal(dto.coverCacheVersion, hash(source));
  assert.equal((await (await call(f, '/tracks/permanent-free')).json()).track.coverCacheVersion, hash(source));
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").run(track.cover);
  const revoked = (await (await call(f, '/tracks/permanent-free')).json()).track;
  assert.equal(revoked.coverUrl, null); assert.equal(revoked.coverCacheVersion, null);
  f.music.sql.prepare("UPDATE station_asset_rights SET status='approved' WHERE music_asset_id=?").run(track.cover);
  for (const query of ['v=' + hash(source), 'size=card&v=', 'size=card&v=' + hash(source).toUpperCase(),
    'size=card&v=' + 'a'.repeat(63), 'size=card&v=' + hash(source) + '&v=' + hash(source),
    'size=card&v=' + hash(source) + '&token=secret']) {
    const response = await call(f, '/assets/' + track.cover + '?' + query);
    assert.equal(response.status, 400, query); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const id of [track.lyrics, f.content.clip.poster, f.content.game.screenshot]) {
    const response = await call(f, '/assets/' + id + '?size=card&v=' + hash(source));
    assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for (const id of [track.audio, track.preview]) {
    assert.equal((await call(f, '/assets/' + id + '?size=card&v=' + hash(source))).status, 404);
  }
});

test('version-matched generated card/display images reuse private cache; 304 still reads current controlled resources', async () => {
  const f = await fixture(), track = f.content.tracks[0];
  let generatedReads = 0; f.env.ASSETS = { fetch(request) { generatedReads++; return asset(request); } };
  for (const [size, bytes] of [['card', card], ['display', display]]) {
    const path = '/assets/' + track.cover + '?size=' + size + '&v=' + hash(source);
    const response = await call(f, path), tag = response.headers.get('etag');
    assert.equal(response.status, 200); assertVersionedCache(response);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    const before = f.r2.state.reads.length, generatedBefore = generatedReads;
    const cached = await call(f, path, { headers: { 'If-None-Match': 'W/' + tag } });
    assert.equal(cached.status, 304); assertVersionedCache(cached); assert.equal(await cached.text(), '');
    assert.equal(generatedReads, generatedBefore + 1);
    const reads = f.r2.state.reads.slice(before);
    assert(reads.some(read => read.method === 'head'));
    assert(reads.some(read => read.method === 'get' && read.options.onlyIf.etagMatches));
    const head = await call(f, path, { method: 'HEAD' });
    assert.equal(head.status, 200); assertVersionedCache(head); assert.equal(await head.text(), '');
  }
  const old = await call(f, '/assets/' + track.cover + '?size=card');
  assert.equal(old.headers.get('cache-control'), 'private, max-age=0, must-revalidate'); await old.body.cancel();
  const original = await call(f, '/assets/' + track.cover);
  assert.equal(original.headers.get('cache-control'), 'no-store'); await original.body.cancel();
});

test('a new published cover has a distinct version URL and the old published image no longer resolves', async () => {
  const f = await fixture(), track = f.content.tracks[0], oldPath = '/assets/' + track.cover + '?size=card&v=' + hash(source);
  const first = await call(f, oldPath), tag = first.headers.get('etag'); await first.body.cancel();
  const old = f.music.sql.prepare('SELECT * FROM music_assets WHERE id=?').get(track.cover);
  const id = fixtureId(971), bytes = new Uint8Array(100).fill(38), sha256 = hash(bytes);
  const object_key = 'music/covers/' + track.id + '/' + id + '.' + old.format;
  const object = await f.r2.bucket.put(object_key, bytes, { httpMetadata: { contentType: old.content_type } });
  await insertFixture(f.music.db, 'music_assets', { ...old, id, object_key, sha256, etag: object.etag });
  await approve(f.music.db, id, 'cover'); await publishTrack(f.music.db, track, { cover_asset_id: id });
  const dto = (await (await call(f, '/tracks/permanent-free')).json()).track;
  assert.equal(dto.coverUrl, base + '/assets/' + id); assert.equal(dto.coverCacheVersion, sha256);
  const obsolete = await call(f, oldPath, { headers: { 'If-None-Match': tag } });
  assert.equal(obsolete.status, 404); assert.equal(obsolete.headers.get('cache-control'), 'no-store');
  const staleVersion = await call(f, '/assets/' + id + '?size=card&v=' + hash(source));
  assert.equal(staleVersion.status, 404); assert.equal(staleVersion.headers.get('cache-control'), 'no-store');
  const fresh = await call(f, '/assets/' + id + '?size=card&v=' + sha256, {}, { coverManifest: { [sha256]: entry } });
  assert.equal(fresh.status, 200); assertVersionedCache(fresh); await fresh.body.cancel();
});

test('versioned conditional images cannot bypass rights, publication, shutdown or R2 checks', async () => {
  const f = await fixture(), track = f.content.tracks[0], path = '/assets/' + track.cover + '?size=card&v=' + hash(source);
  const first = await call(f, path), tag = first.headers.get('etag'); await first.body.cancel();
  const cached = () => call(f, path, { headers: { 'If-None-Match': tag } });
  const denied = async status => { const response = await cached();
    assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store'); };
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").run(track.cover); await denied(404);
  f.music.sql.prepare("UPDATE station_asset_rights SET status='approved' WHERE music_asset_id=?").run(track.cover);
  f.music.sql.prepare("UPDATE station_track_publications SET status='archived' WHERE track_id=?").run(track.id); await denied(404);
  f.music.sql.prepare("UPDATE station_track_publications SET status='published' WHERE track_id=?").run(track.id);
  f.env.STATION_CONTENT_PUBLIC_ENABLED = false; await denied(503); f.env.STATION_CONTENT_PUBLIC_ENABLED = true;
  f.music.sql.prepare('DELETE FROM d1_migrations').run(); await denied(503);
  f.music.sql.prepare("INSERT INTO d1_migrations(name) VALUES('0012_station_redesign.sql')").run();
  f.r2.state.failGet = true; await denied(503); f.r2.state.failGet = false;
  const row = f.music.sql.prepare('SELECT object_key,content_type FROM music_assets WHERE id=?').get(track.cover);
  await f.r2.bucket.put(row.object_key, new Uint8Array(100).fill(99), { httpMetadata: { contentType: row.content_type } }); await denied(404);
});

test('versioned missing or malformed generated files, including conditional requests, never acquire reusable cache', async () => {
  const f = await fixture(), track = f.content.tracks[0], path = '/assets/' + track.cover + '?size=card&v=' + hash(source);
  const first = await call(f, path), tag = first.headers.get('etag'); await first.body.cancel();
  const services = [undefined, { fetch: () => new Response(null, { status: 404 }) },
    { fetch: () => new Response('oops', { headers: { 'Content-Type': 'text/html' } }) },
    { fetch: () => new Response(card, { headers: { 'Content-Type': 'image/webp', 'Content-Length': '99' } }) }];
  for (const service of services) {
    f.env.ASSETS = service;
    for (const headers of [{}, { 'If-None-Match': tag }]) {
      const response = await call(f, path, { headers });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
      assert.equal(response.headers.get('cloudflare-cdn-cache-control'), 'no-store');
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), source);
    }
  }
  f.env.ASSETS = { fetch: asset };
  const unknown = await call(f, path, {}, { coverManifest: {} });
  assert.equal(unknown.headers.get('cache-control'), 'no-store'); await unknown.body.cancel();
});

test('card and detail variants stay on the controlled asset route; original and Range contracts remain intact', async () => {
  const f = await fixture(), cover = '/assets/' + f.content.tracks[0].cover;
  let response = await call(f, cover + '?size=card', { headers: { Range: 'bytes=0-1' } });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), card);
  const cardTag = response.headers.get('etag');
  response = await call(f, cover + '?size=display');
  assert.equal(response.status, 200); assert.notEqual(response.headers.get('etag'), cardTag);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), display);
  response = await call(f, cover + '?size=card', { method: 'HEAD' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), '8'); assert.equal(await response.text(), '');
  response = await call(f, cover, { headers: { Range: 'bytes=0-9' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.arrayBuffer()).byteLength, 10);
});

test('conditional hits still observe rights revocation, withdrawal, gate changes and R2 replacement before returning 304', async () => {
  const f = await fixture(), track = f.content.tracks[0], path = '/assets/' + track.cover + '?size=card';
  let response = await call(f, path); const tag = response.headers.get('etag'); await response.arrayBuffer();
  const cached = () => call(f, path, { headers: { 'If-None-Match': 'W/' + tag } });
  response = await cached(); assert.equal(response.status, 304); assert.equal(await response.text(), '');
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").run(track.cover);
  response = await cached(); assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'no-store');
  f.music.sql.prepare("UPDATE station_asset_rights SET status='approved' WHERE music_asset_id=?").run(track.cover);
  f.music.sql.prepare("UPDATE station_track_publications SET status='archived' WHERE track_id=?").run(track.id);
  assert.equal((await cached()).status, 404);
  f.music.sql.prepare("UPDATE station_track_publications SET status='published' WHERE track_id=?").run(track.id);
  f.env.STATION_CONTENT_PUBLIC_ENABLED = false;
  assert.equal((await cached()).status, 503); f.env.STATION_CONTENT_PUBLIC_ENABLED = true;
  const row = f.music.sql.prepare('SELECT object_key,content_type FROM music_assets WHERE id=?').get(track.cover);
  await f.r2.bucket.put(row.object_key, new Uint8Array(100).fill(99), { httpMetadata: { contentType: row.content_type } });
  assert.equal((await cached()).status, 404);
});

test('replacement between the readiness HEAD and conditional source GET cannot serve a cached grant', async () => {
  const f = await fixture(), track = f.content.tracks[0], path = '/assets/' + track.cover + '?size=card';
  let response = await call(f, path); const tag = response.headers.get('etag'); await response.arrayBuffer();
  const row = f.music.sql.prepare('SELECT object_key,content_type FROM music_assets WHERE id=?').get(track.cover);
  f.r2.state.beforeGet = async key => { if (key === row.object_key) await f.r2.bucket.put(key,
    new Uint8Array(100).fill(98), { httpMetadata: { contentType: row.content_type } }); };
  response = await call(f, path, { headers: { 'If-None-Match': tag } });
  assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('missing generated artwork falls back to the original without reusable cache; size only applies to covers', async () => {
  const f = await fixture(), track = f.content.tracks[0]; f.env.ASSETS = { fetch: () => new Response(null, { status: 404 }) };
  const response = await call(f, '/assets/' + track.cover + '?size=card');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  for (const id of [track.audio, track.preview]) assert.equal((await call(f, '/assets/' + id + '?size=card')).status, 404);
  assert.equal((await call(f, '/assets/' + track.lyrics + '?size=card')).status, 400);
  for (const query of ['size=other', 'size=card&size=display', 'size=card&token=secret', 'size=']) {
    assert.equal((await call(f, '/assets/' + track.cover + '?' + query)).status, 400);
  }
});

test('overlapping catalogue projections preserve order/cursor and bound each request to three active R2 reads', async () => {
  const f = await fixture(), path = '/tracks?locale=en&limit=20';
  const baseline = await (await call(f, path)).json();
  const original = f.r2.bucket.head; let active = 0, peak = 0;
  f.r2.bucket.head = async key => {
    active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 5)); return await original(key); }
    finally { active--; }
  };
  const actual = await (await call(f, path)).json();
  assert.deepEqual(actual, baseline); assert.equal(active, 0); assert.equal(peak, 3);
});

test('initial catalogue covers load eagerly with one priority image; detail uses the larger derivative', async () => {
  const tracks = Array.from({ length: 9 }, (_, index) => ({ id: 'ca790000-0000-4000-8000-' + String(index).padStart(12, '0'),
    slug: 'song-' + index, title: 'Song ' + index, artist: 'Fixture', href: '/en/music/tracks/song-' + index + '/',
    coverUrl: base + '/assets/ca790000-0000-4000-8000-' + String(index).padStart(12, '0') }));
  const html = renderMusicCatalog({ locale: 'en', query: {}, items: tracks });
  assert.equal((html.match(/loading="eager"/g) ?? []).length, 6);
  assert.equal((html.match(/loading="lazy"/g) ?? []).length, 3);
  assert.equal((html.match(/fetchpriority="high"/g) ?? []).length, 1);
  assert.equal((html.match(/\?size=card/g) ?? []).length, 9); assert(!html.includes('__cover-files'));
  const hero = renderSongHero(tracks[0], 'en', { detail: true });
  assert(hero.includes('?size=display')); assert(hero.includes('loading="eager"')); assert(!hero.includes('?size=card'));
});

test('generated card/display files match their fingerprints and source identity, with card dimensions limited to 192px', async () => {
  assert(Object.values(musicDisplayCoverManifest).length >= 11);
  for (const row of Object.values(musicDisplayCoverManifest)) {
    assert(row.path || row.card, 'at least one beneficial variant');
    for (const [size, item] of [...(row.path ? [['display', row]] : []), ...(row.card ? [['card', row.card]] : [])]) {
      assert(item); const bytes = await readFile(new URL('../public' + item.path, import.meta.url));
      assert.equal(hash(bytes), item.sha256); assert.equal(bytes.length, item.bytes); assert(item.bytes < item.sourceBytes);
      const metadata = await sharp(bytes).metadata(); assert(metadata.width <= (size === 'card' ? 192 : 768));
      assert.equal(item.sourceBytes, row.sourceBytes);
    }
  }
});

test('published homepage artwork uses controlled derivatives and revalidates before honoring a cached image', async () => {
  const f = await fixture(), featured = f.content.tracks[1], selected = f.content.tracks[0];
  await promotionFixture(f.music.db, selected);
  await homeFixture(f.music.db, { track: featured.id, tracks: [selected.id], game: f.content.game.id });
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const { home } = await (await call(f, '/home?locale=' + locale)).json();
    const slots = renderBrandHomeSlots(home);
    const featuredSrc = slots.music.match(/<img[^>]+src="([^"]+)"/)?.[1];
    const selectedSrc = slots.selected.match(/<img[^>]+src="([^"]+)"/)?.[1];
    assert.equal(featuredSrc, base + '/assets/' + featured.cover + '?size=display');
    assert.equal(selectedSrc, base + '/assets/' + selected.cover + '?size=card');
    assert.match(slots.music, /loading="eager" decoding="async"/);
    assert.match(slots.selected, /loading="lazy" decoding="async"/);
    assert(slots.game.includes('src="' + home.game.screenshotUrl + '"'), 'game screenshots retain their own asset contract');
    for (const [src, bytes] of [[featuredSrc, display], [selectedSrc, card]]) {
      const path = src.slice(base.length), response = await call(f, path), tag = response.headers.get('etag');
      assert.equal(response.status, 200); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
      const cached = await call(f, path, { headers: { 'If-None-Match': tag } });
      assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
    }
  }
  const path = '/assets/' + featured.cover + '?size=display';
  const response = await call(f, path), tag = response.headers.get('etag'); await response.arrayBuffer();
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").run(featured.cover);
  assert.equal((await call(f, path, { headers: { 'If-None-Match': tag } })).status, 404);
  const { home } = await (await call(f, '/home')).json();
  assert.equal(home.music, null); assert.doesNotMatch(renderBrandHomeSlots(home).music, /<img/);
});

test('native Worker, D1 and R2 return versioned private cache and 304 only while publication/rights remain live; raw files stay blocked', async () => {
  const output = await build({ entryPoints: [fileURLToPath(new URL('../src/worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' },
    plugins: [{ name: 'local-cover-manifest-only', setup(b) { b.onLoad({ filter: /displayCoverManifest\.js$/ }, () =>
      ({ contents: 'export const musicDisplayCoverManifest=' + JSON.stringify(manifest), loader: 'js' })); } }] });
  const mf = new Miniflare({ modules: true, script: output.outputFiles[0].text, compatibilityDate: '2026-05-17',
    host: '127.0.0.1', port: 0, d1Databases: { MUSIC_DB: 'cover-test-only' }, r2Buckets: { MUSIC_BUCKET: 'cover-test-only' },
    bindings: { MUSIC_PUBLIC_ENABLED: 'true', STATION_CONTENT_PUBLIC_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 'station-cover-local-test-secret-no-production' },
    serviceBindings: { ASSETS: asset }, outboundService: () => new Response(null, { status: 403 }) });
  try {
    const db = await mf.getD1Database('MUSIC_DB'), bucket = await mf.getR2Bucket('MUSIC_BUCKET');
    for (const group of migrationStatements().slice(0, -1)) await db.batch(group.statements.map(sql => db.prepare(sql)));
    const content = await seedContent(db, bucket), track = content.tracks[0];
    const native = (path, headers) => mf.dispatchFetch('https://wwwstationcat.org' + path, { headers: { 'CF-Connecting-IP': '192.0.2.88', ...headers } });
    const path = base + '/assets/' + track.cover + '?size=card&v=' + hash(source);
    let response = await native(path);
    assert.equal(response.status, 200, await response.clone().text()); const tag = response.headers.get('etag');
    assertVersionedCache(response);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), card);
    response = await native(path, { 'If-None-Match': tag });
    assert.equal(response.status, 304); assertVersionedCache(response); assert.equal(await response.text(), '');
    assert.equal((await native(entry.card.path)).status, 404);
    await db.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").bind(track.cover).run();
    response = await native(path, { 'If-None-Match': tag });
    assert.equal(response.status, 404); assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { await mf.dispose(); }
});
