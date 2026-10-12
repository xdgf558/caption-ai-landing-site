import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { generateMusicDisplayCovers } from './generate-music-display-covers.mjs';
import { handleStationContent } from '../src/redesign/publicHttp.js';
import { handleMusicPublic } from '../src/music/publicHttp.js';
import { assetKey, assetType } from '../src/music/assetFormats.js';
import { contentFixture, base, now, approve, publishTrack } from './helpers/station-content-fixture.mjs';
import { fixtureId, insertFixture } from './helpers/station-redesign-database.mjs';

const origin = 'https://wwwstationcat.org', hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artwork = new URL('./fixtures/station-redesign/assets/gentle-station/music-cover.webp', import.meta.url);
const png = await sharp(await readFile(artwork)).resize(1024, 1024).png().toBuffer();
const changedPng = await sharp(png).flop().png().toBuffer();
async function outputDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), 'station-cover-generation-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
async function fixture(t) {
  const f = await contentFixture({ materializeAsset: async (asset, bucket) => {
    const bytes = asset.kind === 'cover' ? png : new Uint8Array(100).fill(37);
    const object = await bucket.put(asset.object_key, bytes, { httpMetadata: { contentType: asset.content_type } });
    return { byte_size: bytes.length, sha256: hash(bytes), etag: object.etag };
  } });
  t.after(() => f.close()); f.requests = [];
  f.fetch = async (url, init = {}, manifest) => {
    const request = new Request(url, { ...init, headers: { 'CF-Connecting-IP': '192.0.2.90', ...init.headers } });
    assert(['GET', 'HEAD'].includes(request.method)); assert.equal(new URL(url).origin, origin);
    assert.equal(request.headers.get('Cookie'), null); assert.equal(request.headers.get('Authorization'), null);
    f.requests.push(new URL(url));
    return new URL(url).pathname.startsWith(base)
      ? handleStationContent(request, f.env, { clock: () => now, coverManifest: manifest })
      : handleMusicPublic(request, f.env, { clock: () => now, coverManifest: manifest });
  };
  return f;
}
async function addCover(f, track, bytes, format = 'png') {
  const asset = { id: fixtureId(710), owner_track_id: track.id, kind: 'cover', format,
    content_type: assetType('cover', format), state: 'validated', byte_size: bytes.length,
    sha256: hash(bytes), created_at: now - 1000 };
  asset.object_key = assetKey(asset);
  asset.etag = (await f.r2.bucket.put(asset.object_key, bytes, { httpMetadata: { contentType: asset.content_type } })).etag;
  await insertFixture(f.music.db, 'music_assets', asset); await approve(f.music.db, asset.id, 'cover');
  await publishTrack(f.music.db, track, { cover_asset_id: asset.id }); return asset;
}
async function generate(t, f, pageSize = 2) {
  const outputRoot = await outputDirectory(t);
  const result = await generateMusicDisplayCovers({ origin, outputRoot, fetchImpl: f.fetch, pageSize });
  // Use the emitted manifest and files, not a synthetic hand-written variant.
  const { musicDisplayCoverManifest: manifest } = await import(pathToFileURL(join(outputRoot, 'src/music/displayCoverManifest.js')));
  assert.deepEqual(manifest, result.manifest);
  const files = new Map(Object.values(manifest).flatMap(row => [row, row.card].filter(item => item?.path).map(item => [item.path, item])));
  f.env.ASSETS = { fetch: async request => {
    const item = files.get(new URL(request.url).pathname);
    if (!item) return new Response(null, { status: 404 });
    const bytes = await readFile(join(outputRoot, 'public' + item.path));
    assert.equal(hash(bytes), item.sha256); assert.equal(bytes.length, item.bytes);
    return new Response(request.method === 'HEAD' ? null : bytes,
      { headers: { 'Content-Type': item.contentType, 'Content-Length': String(bytes.length) } });
  } };
  return { ...result, manifest, outputRoot };
}
async function assertCard(f, asset, manifest) {
  const url = origin + base + '/assets/' + asset.id + '?size=card';
  const response = await f.fetch(url, {}, manifest), card = manifest[asset.sha256].card;
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), card.sha256); assert.equal(bytes.length, card.bytes); assert(bytes.length < asset.byte_size);
  const dimensions = await sharp(bytes).metadata(); assert.equal(dimensions.width, 192); assert.equal(dimensions.height, 192);
  const cached = await f.fetch(url, { headers: { 'If-None-Match': response.headers.get('etag') } }, manifest);
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
}

test('generator pages through current website publications, including a song still draft in the old catalogue', async t => {
  const f = await fixture(t), track = f.content.platformTrack;
  const cover = await addCover(f, track, changedPng);
  assert.equal(f.music.sql.prepare('SELECT lifecycle FROM music_tracks WHERE id=?').get(track.id).lifecycle, 'draft');
  const legacy = await (await f.fetch(origin + '/api/music/catalog?locale=zh-Hans')).json();
  assert(!legacy.tracks.some(item => item.id === track.id));
  const { manifest, report } = await generate(t, f, 1);
  assert(report.some(item => item.publicSource === base + '/assets/' + cover.id && item.sourceSha256 === cover.sha256));
  assert(f.requests.some(url => url.pathname === base + '/tracks' && url.searchParams.has('cursor')));
  assert(f.requests.filter(url => url.pathname === base + '/tracks').length >= 7);
  await assertCard(f, cover, manifest);
});

test('website-only cover replacement is generated while legacy track and collection covers remain available', async t => {
  const f = await fixture(t), track = f.content.tracks[0], cover = await addCover(f, track, changedPng);
  assert.equal(f.music.sql.prepare('SELECT cover_asset_id FROM music_track_revisions WHERE id=?').get(track.revision).cover_asset_id, track.cover);
  const collectionId = fixtureId(721), album = { id: fixtureId(720), owner_collection_id: collectionId,
    kind: 'cover', format: 'png', content_type: 'image/png', state: 'validated', byte_size: png.length,
    sha256: hash(png), created_at: now - 1000 };
  await insertFixture(f.music.db, 'music_collections', { id: collectionId, slug: 'legacy-album', collection_type: 'album',
    original_locale: 'en', title_json: '{"en":"Legacy album"}', description_json: '{"en":""}', status: 'draft',
    created_at: now - 1000, updated_at: now - 1000 });
  await insertFixture(f.music.db, 'music_collection_tracks', { collection_id: collectionId, track_id: track.id, position: 0 });
  album.object_key = assetKey(album);
  album.etag = (await f.r2.bucket.put(album.object_key, png, { httpMetadata: { contentType: album.content_type } })).etag;
  await insertFixture(f.music.db, 'music_collection_assets', album);
  f.music.sql.prepare("UPDATE music_collections SET cover_asset_id=?,status='published' WHERE id=?").run(album.id, collectionId);
  const { manifest, report } = await generate(t, f);
  assert(report.some(item => item.publicSource === base + '/assets/' + cover.id && item.sourceSha256 === cover.sha256));
  const legacySource = report.find(item => item.publicSource.startsWith('/api/music/tracks/' + track.id + '/cover?v='));
  assert.equal(legacySource?.sourceSha256, hash(png));
  assert(report.some(item => item.publicSource.startsWith('/api/music/collections/legacy-album/cover?v=')));
  assert.equal(Object.keys(manifest).length, 2, 'identical source artwork is deduplicated across public aliases');
  await assertCard(f, cover, manifest);
  for (const item of report.filter(item => item.publicSource.startsWith('/api/music/'))) {
    const response = await f.fetch(origin + item.publicSource + '&size=display', {}, manifest);
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), manifest[item.sourceSha256].sha256);
  }
});

test('a beneficial card survives an oversized display encoding and detail requests retain the original fallback', async t => {
  const f = await fixture(t), original = await sharp(await readFile(artwork)).resize(1440, 1440).jpeg({ quality: 20 }).toBuffer();
  const display = await sharp(original).resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  const card = await sharp(original).resize(192, 192, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  assert(display.length >= original.length); assert(card.length < original.length);
  const cover = await addCover(f, f.content.platformTrack, original, 'jpeg');
  const { manifest, report } = await generate(t, f), entry = manifest[cover.sha256];
  assert(entry.card); assert.equal(entry.path, undefined); assert.equal(entry.card.bytes, card.length);
  assert.equal(report.find(item => item.sourceSha256 === cover.sha256).displayBytes, null);
  await assertCard(f, cover, manifest);
  const response = await f.fetch(origin + base + '/assets/' + cover.id + '?size=display', {}, manifest);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
});

test('an empty filtered website page still advances to the next page', async t => {
  const outputRoot = await outputDirectory(t), calls = [], path = base + '/assets/' + fixtureId(730);
  const { manifest, report } = await generateMusicDisplayCovers({ outputRoot, fetchImpl: async url => {
    const parsed = new URL(url); calls.push(parsed.pathname + parsed.search);
    if (parsed.pathname === base + '/tracks') return Response.json({ schemaVersion: 1,
      items: parsed.searchParams.has('cursor') ? [{ coverUrl: path }] : [], nextCursor: parsed.searchParams.has('cursor') ? null : 'source_page_2' });
    if (parsed.pathname === '/api/music/catalog') return Response.json({ schemaVersion: 2, tracks: [], collections: [] });
    assert.equal(parsed.pathname, path); return new Response(changedPng);
  } });
  assert(calls.some(url => url.includes('cursor=source_page_2')));
  assert.equal(report.length, 1); assert(manifest[hash(changedPng)].card);
});

test('pagination loops fail instead of replacing the manifest with a partial catalogue', async t => {
  const outputRoot = await outputDirectory(t), target = join(outputRoot, 'src/music/displayCoverManifest.js');
  await mkdir(join(outputRoot, 'src/music'), { recursive: true }); await writeFile(target, 'previous reviewed manifest');
  let calls = 0;
  await assert.rejects(generateMusicDisplayCovers({ outputRoot, fetchImpl: async () => {
    calls++; return Response.json({ schemaVersion: 1, items: [], nextCursor: 'same_cursor' });
  } }), /cursor did not advance/);
  assert.equal(calls, 2); assert.equal(await readFile(target, 'utf8'), 'previous reviewed manifest');
});

test('unexpected website cover URLs fail before downloading unapproved sources', async t => {
  const outputRoot = await outputDirectory(t); let calls = 0;
  await assert.rejects(generateMusicDisplayCovers({ outputRoot, fetchImpl: async url => {
    calls++; assert.equal(new URL(url).pathname, base + '/tracks');
    return Response.json({ schemaVersion: 1, items: [{ coverUrl: 'https://example.invalid/private-cover' }], nextCursor: null });
  } }));
  assert.equal(calls, 1);
});
