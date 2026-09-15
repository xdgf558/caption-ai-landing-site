import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import sharp from 'sharp';
import { isMusicDisplayAssetPath } from '../src/music/coverDisplay.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleMusicPublic, isMusicPublicPath } from '../src/music/publicHttp.js';

const now = Date.parse('2026-09-11T00:00:00Z');
const migrations = ['0001_music_foundation.sql', '0002_music_publication.sql', '0003_music_uploads.sql', '0004_music_cleanup.sql', '0005_music_rate_limits.sql', '0006_music_analytics.sql', '0007_music_albums.sql', '0008_music_featured.sql', '0009_music_album_covers.sql', '0010_music_limited_free.sql']
  .map(name => readFileSync(new URL(`../migrations-music/${name}`, import.meta.url), 'utf8'));
const dbs = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function insert(db, table, values) {
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
    .run(...Object.values(values));
}

function fixture() {
  const sql = new DatabaseSync(':memory:'); dbs.push(sql);
  sql.exec('PRAGMA foreign_keys=ON'); migrations.forEach(value => sql.exec(value));
  const state = { reads: 0, r2: [], cancels: 0, failDatabase: false, objectPatch: null };
  class Statement {
    constructor(query, params = []) { Object.assign(this, { query, params }); }
    bind(...params) { return new Statement(this.query, params); }
  }
  const db = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return { prepare: query => {
      if (/^(DELETE FROM music_rate_|INSERT INTO music_rate_sources)/.test(query.trim())) return new Statement(query);
      assert.match(query.trim(), /^SELECT\s/i);
      assert.doesNotMatch(query, /rights|audit|mutation|upload|email|membership|account/i);
      return new Statement(query);
    }, async batch(statements) {
      if (statements.every(s => /^(DELETE FROM music_rate_|INSERT INTO music_rate_sources)/.test(s.query.trim()))) {
        sql.exec('BEGIN');
        try {
          const results = statements.map(s => ({ success: true, results: sql.prepare(s.query).all(...s.params) }));
          sql.exec('COMMIT'); return results;
        } catch (e) { sql.exec('ROLLBACK'); throw e; }
      }
      state.reads++;
      if (state.failDatabase) throw new Error('private database failure');
      return statements.map(statement => ({ success: true,
        results: sql.prepare(statement.query).all(...statement.params) }));
    } };
  } };
  const objects = new Map();
  const bucket = { async get(key, options) {
    state.r2.push({ key, options: structuredClone(options) });
    const item = objects.get(key);
    if (!item) return null;
    const object = { key, size: item.bytes.length, etag: item.asset.etag,
      httpMetadata: { contentType: item.asset.content_type },
      body: new ReadableStream({ type: 'bytes', start(controller) { controller.enqueue(Uint8Array.from(item.bytes)); controller.close(); },
        cancel() { state.cancels++; } }) };
    return state.objectPatch ? state.objectPatch(object) : object;
  } };
  const env = { MUSIC_DB: db, MUSIC_BUCKET: bucket, WAITLIST_DB: {}, MUSIC_PUBLIC_ENABLED: 'true',
    MUSIC_VIP_DELIVERY_ENABLED: 'true', MUSIC_RATE_LIMIT_SECRET: 'public-unit-fixture-secret-not-for-deployment' };

  function seedTrack({ slug, title, accessMode = 'vip', publishedAt = now - 10000, bad = false,
    coverBytes = null, badStorage = false, lifecycle = 'published', earlyAccessUntil = null, postEarlyAccessMode = null } = {}) {
    const id = randomUUID(), revision = randomUUID(), audio = randomUUID(), preview = randomUUID();
    const cover = randomUUID(), lyrics = randomUUID();
    insert(sql, 'music_tracks', { id, slug, lifecycle: 'draft', created_at: now - 30000, updated_at: now - 10000 });
    const bytes = { audio: Uint8Array.of(1, 2, 3), preview: Uint8Array.of(4, 5),
      cover: coverBytes || Uint8Array.of(137, 80, 78, 71), lyrics: new TextEncoder().encode('[00:00.00]Fixture lyric') };
    const base = { owner_track_id: id, state: 'validated', sha256: 'a'.repeat(64), created_at: now - 20000 };
    const assets = [
      { ...base, id: audio, kind: 'audio', object_key: badStorage ? `private/${audio}.mp3` : `music/audio/${id}/${audio}.mp3`, content_type: 'audio/mpeg',
        format: 'mp3', byte_size: bytes.audio.length, duration_ms: 120000, etag: `audio-${id}` },
      { ...base, id: preview, kind: 'preview', object_key: `music/previews/${id}/${preview}.mp3`, content_type: 'audio/mpeg',
        format: 'mp3', byte_size: bytes.preview.length, duration_ms: 30000, derived_from_asset_id: audio,
        source_start_ms: 10000, source_end_ms: 40000, etag: `preview-${id}` },
      { ...base, id: cover, kind: 'cover', object_key: `music/covers/${id}/${cover}.png`, content_type: 'image/png',
        format: 'png', byte_size: bytes.cover.length, sha256: createHash('sha256').update(bytes.cover).digest('hex'), etag: `cover-${id}` },
      { ...base, id: lyrics, kind: 'lyrics', object_key: `music/lyrics/${id}/${lyrics}.lrc`, content_type: 'text/plain',
        format: 'lrc', byte_size: bytes.lyrics.length, etag: `lyrics-${id}` }
    ];
    for (const asset of assets) {
      insert(sql, 'music_assets', asset);
      objects.set(asset.object_key, { asset, bytes: bytes[asset.kind] });
    }
    const metadata = { originalLocale: 'en', title: { en: bad ? '' : title, 'zh-Hant': `繁中 ${title}` },
      summary: { en: 'Public summary.' }, creatorName: 'Station Cat', instrumental: false, language: 'en',
      genres: ['ambient'], moods: ['calm'], story: `Story for ${title}.\nSecond line.` };
    insert(sql, 'music_track_revisions', { id: revision, track_id: id, revision_no: 1, state: 'sealed',
      metadata_json: JSON.stringify(metadata), audio_asset_id: audio, preview_asset_id: preview, cover_asset_id: cover,
      lyrics_asset_id: lyrics, access_mode: accessMode, early_access_until: earlyAccessUntil,
      post_early_access_mode: postEarlyAccessMode, policy_version: 1, technical_reviewed_at: publishedAt - 1000,
      technical_fingerprint: 'b'.repeat(64), created_at: publishedAt - 2000 });
    sql.prepare(`UPDATE music_tracks SET lifecycle=?,published_revision_id=?,first_published_at=?,published_at=?,updated_at=? WHERE id=?`)
      .run(lifecycle, revision, publishedAt, publishedAt, publishedAt, id);
    return { id, revision, audio, preview, cover, lyrics, slug, assets, metadata };
  }

  function seedCollection(slug, trackIds, type = 'playlist') {
    const id = randomUUID();
    insert(sql, 'music_collections', { id, slug, collection_type: type, original_locale: 'en', title_json: JSON.stringify({ en: `List ${slug}` }),
      description_json: JSON.stringify({ en: 'Public collection.' }), status: 'published', version: 1,
      created_at: now - 5000, updated_at: now - 5000 });
    trackIds.forEach((trackId, position) => insert(sql, 'music_collection_tracks', { collection_id: id, track_id: trackId, position }));
    return { id, slug };
  }

  return { sql, state, db, bucket, objects, env, seedTrack, seedCollection };
}

function request(path, options = {}) {
  return new Request(`https://wwwstationcat.org${path}`, { ...options,
    headers: { 'CF-Connecting-IP': '192.0.2.1', ...options.headers } });
}

async function json(response, status, code = null) {
  assert.equal(response.status, status);
  const body = await response.json();
  if (code) assert.equal(body.error.code, code);
  return body;
}

test('route matching, methods, inputs and the public flag fail before database or storage access', async () => {
  const paths = ['/api/music/catalog', '/api/music/me/capabilities', `/api/music/tracks/${randomUUID()}`,
    `/api/music/tracks/${randomUUID()}/cover`, `/api/music/tracks/${randomUUID()}/lyrics`,
    `/api/music/tracks/${randomUUID()}/access`, '/api/music/collections/focus-time'];
  for (const path of paths) assert.equal(isMusicPublicPath(path), true, path);
  assert.equal(isMusicPublicPath(`/api/music/tracks/${randomUUID()}/audio`), false);
  assert.equal(isMusicPublicPath('/api/music/catalog/'), false);

  const f = fixture(); f.env.MUSIC_PUBLIC_ENABLED = 'false';
  await json(await handleMusicPublic(request('/api/music/catalog?locale=en'), f.env), 503, 'MUSIC_PUBLIC_DISABLED');
  assert.equal(f.state.reads, 0); assert.equal(f.state.r2.length, 0);
  f.env.MUSIC_PUBLIC_ENABLED = 'true';
  let response = await handleMusicPublic(request('/api/music/catalog?locale=en', { method: 'POST' }), f.env);
  await json(response, 405, 'METHOD_NOT_ALLOWED'); assert.equal(response.headers.get('allow'), 'GET, HEAD');
  for (const path of ['/api/music/catalog', '/api/music/catalog?locale=fr', '/api/music/catalog?locale=en&extra=1',
    '/api/music/tracks/not-an-id?locale=en', `/api/music/tracks/${randomUUID()}/cover?v=0`,
    `/api/music/tracks/${randomUUID()}/access?v=1&variant=full`, '/api/music/collections/Bad_Slug?locale=en']) {
    await json(await handleMusicPublic(request(path), f.env), 400, 'INVALID_INPUT');
  }
  assert.equal(f.state.reads, 0); assert.equal(f.state.r2.length, 0);
  await json(await handleMusicPublic(request('/api/music/catalog?locale=en'), { MUSIC_PUBLIC_ENABLED: 'true' }), 503, 'MUSIC_NOT_CONFIGURED');
});

test('catalog is anonymous, localized and conditional while hiding corrupt tracks and empty collections', async () => {
  const f = fixture();
  const first = f.seedTrack({ slug: 'first-song', title: 'First', accessMode: 'free', publishedAt: now - 1000 });
  const second = f.seedTrack({ slug: 'second-song', title: 'Second', accessMode: 'vip', publishedAt: now - 2000 });
  const fallback = f.seedTrack({ slug: 'fallback-song', title: 'Fallback', accessMode: 'free', publishedAt: now - 2500 });
  const corrupt = f.seedTrack({ slug: 'broken-song', title: 'Broken', bad: true, publishedAt: now - 3000 });
  const invalidStorage = f.seedTrack({ slug: 'wrong-storage', title: 'Wrong storage', badStorage: true, publishedAt: now - 4000 });
  const ordered = f.seedCollection('ordered-list', [second.id, corrupt.id, first.id]);
  f.seedCollection('empty-list', [corrupt.id]);
  insert(f.sql,'music_featured_items',{slot_kind:'primary',position:0,track_id:first.id});
  insert(f.sql,'music_featured_items',{slot_kind:'secondary',position:0,track_id:second.id});
  insert(f.sql,'music_featured_items',{slot_kind:'secondary',position:1,track_id:fallback.id});
  insert(f.sql,'music_featured_items',{slot_kind:'collection',position:0,collection_id:ordered.id});
  f.sql.prepare("UPDATE music_settings SET value_json='7' WHERE key='catalogVersion'").run();

  const response = await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant'), f.env, { clock: () => now });
  const body = await json(response, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(response.headers.get('content-language'), 'zh-Hant');
  assert.match(response.headers.get('etag'), /^"music-[a-f0-9]{64}"$/);
  assert.deepEqual(body.tracks.map(track => track.id), [first.id, second.id, fallback.id]);
  assert.ok(!body.tracks.some(track => track.id === invalidStorage.id));
  assert.equal(body.tracks[0].title, '繁中 First');
  assert.equal(body.catalogVersion, 7);
  assert.deepEqual(body.collections.map(item => item.slug), ['ordered-list']);
  assert.deepEqual(body.collections[0].trackIds, [second.id, first.id]);
  assert.deepEqual(body.featured,{version:1,primaryTrackId:first.id,primarySource:'primary',secondaryTrackIds:[second.id,fallback.id],collectionIds:[ordered.id]});
  assert.doesNotMatch(JSON.stringify(body), /Story for|object_key|sha256|canPlayFull|validUntil|technical_fingerprint/);

  const cached = await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant', {
    headers: { 'If-None-Match': `W/${response.headers.get('etag')}` } }), f.env, { clock: () => now });
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  const head = await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant', { method: 'HEAD' }), f.env, { clock: () => now });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(head.headers.get('etag'), response.headers.get('etag'));

  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(first.id);
  const changed = await json(await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant'), f.env, { clock: () => now }), 200);
  assert.equal(changed.featured.primaryTrackId,fallback.id);
  assert.equal(changed.featured.primarySource,'secondary');
  assert.deepEqual(changed.featured.secondaryTrackIds,[second.id]);
  f.sql.prepare("DELETE FROM music_featured_items WHERE track_id=?").run(fallback.id);
  const latest = await json(await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant'), f.env, { clock: () => now }), 200);
  assert.equal(latest.featured.primaryTrackId,fallback.id);
  assert.equal(latest.featured.primarySource,'latest');
});

test('natural policy expiry changes the catalog projection and ETag without a catalogVersion write', async () => {
  const f = fixture(), until = now + 1000;
  const track = f.seedTrack({ slug: 'early-song', title: 'Early', accessMode: 'early_access',
    earlyAccessUntil: until, postEarlyAccessMode: 'free' });
  const before = await handleMusicPublic(request('/api/music/catalog?locale=en'), f.env, { clock: () => now });
  const beforeBody = await before.json(); assert.equal(beforeBody.tracks.find(item => item.id === track.id).effectiveAccess, 'vip');
  assert.equal(beforeBody.nextPolicyChangeAt, new Date(until).toISOString());
  const after = await handleMusicPublic(request('/api/music/catalog?locale=en'), f.env, { clock: () => until });
  const afterBody = await after.json(); assert.equal(afterBody.tracks.find(item => item.id === track.id).effectiveAccess, 'free');
  assert.equal(afterBody.nextPolicyChangeAt, null); assert.notEqual(after.headers.get('etag'), before.headers.get('etag'));
});

test('track detail adds the public story and collection detail preserves order without changing access', async () => {
  const f = fixture();
  const free = f.seedTrack({ slug: 'free-song', title: 'Free', accessMode: 'free' });
  const vip = f.seedTrack({ slug: 'vip-song', title: 'VIP', accessMode: 'vip', publishedAt: now - 20000 });
  const collection = f.seedCollection('mixed-access', [vip.id, free.id]);
  let body = await json(await handleMusicPublic(request(`/api/music/tracks/${free.id}?locale=en`), f.env, { clock: () => now }), 200);
  assert.equal(body.track.story, 'Story for Free.\nSecond line.');
  assert.equal(body.track.effectiveAccess, 'free');
  assert.doesNotMatch(JSON.stringify(body), /object_key|sha256|technical_fingerprint/);
  body = await json(await handleMusicPublic(request(`/api/music/collections/${collection.slug}?locale=en`), f.env, { clock: () => now }), 200);
  assert.deepEqual(body.tracks.map(track => track.id), [vip.id, free.id]);
  assert.deepEqual(body.tracks.map(track => track.effectiveAccess), ['vip', 'free']);
  assert.deepEqual(body.collection.trackIds, [vip.id, free.id]);

  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(free.id);
  await json(await handleMusicPublic(request(`/api/music/tracks/${free.id}?locale=en`), f.env, { clock: () => now }), 410, 'TRACK_UNAVAILABLE');
  await json(await handleMusicPublic(request('/api/music/collections/missing?locale=en'), f.env, { clock: () => now }), 404, 'NOT_FOUND');
});

test('direct collection lookup is not limited by the 500-item catalog window', async () => {
  const f = fixture(), track = f.seedTrack({ slug: 'window-song', title: 'Window' });
  for (let index = 0; index < 500; index++) f.seedCollection(`list-${String(index).padStart(3, '0')}`, [track.id]);
  const last = f.seedCollection('zzzz-last-list', [track.id]);
  const catalog = await json(await handleMusicPublic(request('/api/music/catalog?locale=en'), f.env, { clock: () => now }), 200);
  assert.equal(catalog.collections.length, 500);
  assert.ok(!catalog.collections.some(item => item.id === last.id));
  const detail = await json(await handleMusicPublic(request(`/api/music/collections/${last.slug}?locale=en`), f.env, { clock: () => now }), 200);
  assert.equal(detail.collection.id, last.id); assert.deepEqual(detail.collection.trackIds, [track.id]);
});

test('VIP cover and lyrics stay anonymous while full audio access remains protected', async () => {
  const f = fixture(), track = f.seedTrack({ slug: 'asset-song', title: 'Assets' });
  let response = await handleMusicPublic(request(`/api/music/tracks/${track.id}/access?v=1`), f.env, { clock: () => now });
  await json(response, 401, 'AUTH_REQUIRED');
  assert.equal(f.state.r2.length, 0);

  response = await handleMusicPublic(request(`/api/music/tracks/${track.id}/cover?v=1`), f.env, { clock: () => now });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
  assert.equal(f.state.r2[0].key, `music/covers/${track.id}/${track.cover}.png`);
  assert.deepEqual(f.state.r2[0].options, { onlyIf: { etagMatches: `cover-${track.id}` } });

  response = await handleMusicPublic(request(`/api/music/tracks/${track.id}/lyrics?v=1`), f.env, { clock: () => now });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(await response.text(), '[00:00.00]Fixture lyric');
  response = await handleMusicPublic(request(`/api/music/tracks/${track.id}/cover?v=1`, { method: 'HEAD' }), f.env, { clock: () => now });
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.state.cancels, 1);

  const reads = f.state.r2.length;
  await json(await handleMusicPublic(request(`/api/music/tracks/${track.id}/cover?v=2`), f.env, { clock: () => now }), 409, 'VERSION_CONFLICT');
  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(track.id);
  await json(await handleMusicPublic(request(`/api/music/tracks/${track.id}/lyrics?v=1`), f.env, { clock: () => now }), 410, 'TRACK_UNAVAILABLE');
  assert.equal(f.state.r2.length, reads);
});

test('changed storage and database failures stay generic and never disclose private identifiers', async () => {
  const f = fixture(), track = f.seedTrack({ slug: 'failure-song', title: 'Failure' });
  f.state.objectPatch = object => ({ ...object, key: 'private/wrong-object' });
  let response = await handleMusicPublic(request(`/api/music/tracks/${track.id}/cover?v=1`), f.env, { clock: () => now });
  const body = await json(response, 503, 'MEDIA_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(body), /private|music\/covers|etag|sha256/);
  for (const header of ['etag', 'content-length', 'last-modified']) assert.equal(response.headers.get(header), null);
  f.state.failDatabase = true;
  response = await handleMusicPublic(request('/api/music/catalog?locale=en'), f.env, { clock: () => now });
  await json(response, 503, 'MUSIC_DATABASE_UNAVAILABLE');
});

test('capabilities and access are wired as private UI hints and never act as media grants', async () => {
  const f = fixture(), vip = f.seedTrack({ slug: 'private-song', title: 'Private', accessMode: 'vip' });
  let response = await handleMusicPublic(request('/api/music/me/capabilities?locale=en'), f.env, { clock: () => now });
  let body = await json(response, 200);
  assert.equal(body.authenticated, false); assert.equal(body.canPlayVipFull, false);
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('vary'), 'Cookie');
  response = await handleMusicPublic(request(`/api/music/tracks/${vip.id}/access?v=1`), f.env, { clock: () => now });
  body = await json(response, 401, 'AUTH_REQUIRED');
  assert.equal(body.canPlayFull, false); assert.equal(body.canPreview, true);
  assert.equal(f.state.r2.length, 0);

  const free = f.seedTrack({ slug: 'public-song', title: 'Public', accessMode: 'free' });
  response = await handleMusicPublic(request(`/api/music/tracks/${free.id}/access?v=1`), f.env, { clock: () => now });
  body = await json(response, 200); assert.equal(body.canPlayFull, true); assert.equal(f.state.r2.length, 0);
});

test('production worker wiring keeps public content separate from the versioned audio handler', () => {
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /if \(isMusicMediaPath\(url\.pathname\)\) return handleMusicMedia\(request, env\)/);
  assert.match(worker, /if \(isMusicPublicPath\(url\.pathname\)\) return handleMusicPublic\(request, env\)/);
  assert.doesNotMatch(worker, /api\/music[^\n]+(?:object_key|\?key=)/);
});

async function displayFixture() {
  const f = fixture();
  // An uncompressed opaque raster makes the bandwidth regression measurable.
  const bytes = await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#527668' } }).png({ compressionLevel: 0 }).toBuffer();
  const track = f.seedTrack({ slug: 'display-cover', title: 'Display', coverBytes: bytes });
  const displayBytes = await sharp(bytes).resize({ width: 768, height: 768, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
  const sha256 = createHash('sha256').update(displayBytes).digest('hex');
  const variant = { sha256, bytes: displayBytes.length, sourceBytes: bytes.length, contentType: 'image/jpeg', path: `/api/music/__cover-files/${sha256}.jpg` };
  const counts = { hits: 0 };
  f.env.ASSETS = { async fetch(req) { counts.hits++; assert.equal(new URL(req.url).pathname, variant.path);
    return new Response(req.method === 'HEAD' ? null : displayBytes, { headers: { 'Content-Type': variant.contentType, 'Content-Length': String(variant.bytes) } }); } };
  return { ...f, track, bytes, displayBytes, counts, variant,
    options: { clock: () => now, coverManifest: { [createHash('sha256').update(bytes).digest('hex')]: variant } },
    path: `/api/music/tracks/${track.id}/cover?v=1&size=display` };
}

test('display cover is small, shares cached encoding, and revalidates browser bytes without a body', async () => {
  const f = await displayFixture();
  const first = await handleMusicPublic(request(f.path), f.env, f.options);
  assert.equal(first.status, 200); assert.equal(first.headers.get('content-type'), 'image/jpeg');
  assert.equal(first.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  const bytes = Buffer.from(await first.arrayBuffer()), image = await sharp(bytes).metadata();
  assert.equal(image.width, 768); assert.equal(image.height, 614); assert.ok(bytes.length < f.bytes.length / 10);
  const second = await handleMusicPublic(request(f.path), f.env, f.options);
  assert.deepEqual(Buffer.from(await second.arrayBuffer()), bytes); assert.equal(f.counts.hits, 2);
  const etag = first.headers.get('etag');
  const cached = await handleMusicPublic(request(f.path, { headers: { 'If-None-Match': `W/${etag}` } }), f.env, f.options);
  assert.equal(cached.status, 304); assert.equal(await cached.text(), ''); assert.equal(f.counts.hits, 2);
  const head = await handleMusicPublic(request(f.path, { method: 'HEAD' }), f.env, f.options);
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(Number(head.headers.get('content-length')), bytes.length);
  assert.equal(f.state.r2.length, 4); // Even cache hits check current storage identity.
});

test('warm cache and If-None-Match cannot bypass shutdown, downlisting, version, storage or DB failures', async () => {
  const f = await displayFixture();
  const first = await handleMusicPublic(request(f.path), f.env, f.options); await first.arrayBuffer();
  const init = { headers: { 'If-None-Match': first.headers.get('etag') } };
  f.env.MUSIC_PUBLIC_ENABLED = 'false';
  await json(await handleMusicPublic(request(f.path, init), f.env, f.options), 503, 'MUSIC_PUBLIC_DISABLED');
  f.env.MUSIC_PUBLIC_ENABLED = 'true';
  await json(await handleMusicPublic(request(f.path.replace('v=1', 'v=2'), init), f.env, f.options), 409, 'VERSION_CONFLICT');
  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(f.track.id);
  await json(await handleMusicPublic(request(f.path, init), f.env, f.options), 410, 'TRACK_UNAVAILABLE');
  assert.equal(f.state.r2.length, 1); assert.equal(f.counts.hits, 1);
  f.sql.prepare("UPDATE music_tracks SET lifecycle='published' WHERE id=?").run(f.track.id);
  f.state.objectPatch = object => ({ ...object, etag: 'changed' });
  await json(await handleMusicPublic(request(f.path, init), f.env, f.options), 503, 'MEDIA_UNAVAILABLE');
  await json(await handleMusicPublic(request(f.path), f.env, f.options), 503, 'MEDIA_UNAVAILABLE');
  f.state.objectPatch = null; f.state.failDatabase = true;
  await json(await handleMusicPublic(request(f.path, init), f.env, f.options), 503, 'MUSIC_DATABASE_UNAVAILABLE');
  assert.equal(f.counts.hits, 1);
});

test('display selector is bounded and applies only to cover routes', async () => {
  const f = await displayFixture();
  for (const path of [f.path + '&size=display', f.path.replace('display', '4096'), f.path + '&other=1',
    f.path.replace('/cover?', '/lyrics?'), f.path.replace('/cover?', '/access?')]) {
    await json(await handleMusicPublic(request(path), f.env, f.options), 400, 'INVALID_INPUT');
  }
  assert.equal(f.state.r2.length, 0); assert.equal(f.state.reads, 0);
});

test('missing display files and newly uploaded covers fall back to the original without runtime encoding', async () => {
  const f = await displayFixture();
  for (const service of [{ async fetch() { return new Response(null, { status: 404 }); } }, { async fetch() { throw Error('assets offline'); } }]) {
    f.env.ASSETS = service;
    const response = await handleMusicPublic(request(f.path), f.env, f.options);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
  }
  const response = await handleMusicPublic(request(f.path), f.env, { ...f.options, coverManifest: {} });
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
});

test('album display cover stays tied to the live album version and independent cover', async () => {
  const f = await displayFixture(), album = f.seedCollection('display-album', [f.track.id], 'album'), aid = randomUUID();
  f.sql.prepare("UPDATE music_collections SET status='draft' WHERE id=?").run(album.id);
  const asset = { id: aid, owner_collection_id: album.id, kind: 'cover', state: 'validated',
    object_key: `music/album-covers/${album.id}/${aid}.png`, format: 'png', content_type: 'image/png',
    byte_size: f.bytes.length, sha256: createHash('sha256').update(f.bytes).digest('hex'), etag: 'album-cover', created_at: now - 2000 };
  insert(f.sql, 'music_collection_assets', asset); f.objects.set(asset.object_key, { asset, bytes: f.bytes });
  f.sql.prepare("UPDATE music_collections SET cover_asset_id=?,status='published' WHERE id=?").run(aid, album.id);
  const path = `/api/music/collections/${album.slug}/cover?v=1&size=display`;
  const first = await handleMusicPublic(request(path), f.env, f.options);
  assert.equal(first.status, 200); await first.arrayBuffer();
  assert.equal(f.state.r2[0].key, asset.object_key);
  const init = { headers: { 'If-None-Match': first.headers.get('etag') } };
  assert.equal((await handleMusicPublic(request(path, init), f.env, f.options)).status, 304);
  f.sql.prepare('UPDATE music_collections SET version=2 WHERE id=?').run(album.id);
  assert.equal((await handleMusicPublic(request(path, init), f.env, f.options)).status, 409);
  f.sql.prepare("UPDATE music_collections SET status='draft' WHERE id=?").run(album.id);
  assert.equal((await handleMusicPublic(request(path.replace('v=1', 'v=2'), init), f.env, f.options)).status, 404);
});

test('display route cannot expose the generated files directly or import an image encoder', () => {
  const source = readFileSync(new URL('../src/music/coverDisplay.js', import.meta.url)).toString(), worker = readFileSync(new URL('../src/worker.js', import.meta.url)).toString();
  assert.doesNotMatch(source, /photon|resvg|sharp|renderMusic/);
  assert.match(worker, /isMusicDisplayAssetPath\(url\.pathname\)/);
  for (const path of ['/api/music/__cover-files/a.jpg', '/api/music/%5f%5fcover-files/a.jpg', '/api/music/%255f%255fcover-files/a.jpg', '/api/music%2f__cover-files%2fa.jpg']) assert.equal(isMusicDisplayAssetPath(path), true);
  assert.equal(isMusicDisplayAssetPath('/api/music/tracks/a/cover'), false);
  assert.equal(isMusicPublicPath('/api/music/__cover-files/' + 'a'.repeat(64) + '.jpg'), false);
});


test('native static assets serve a small cover while direct and escaped asset paths stay private', { timeout: 30000 }, async () => {
  const { Miniflare } = await import('miniflare'), { build } = await import('esbuild');
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const f = await displayFixture(), directory = await mkdtemp(join(tmpdir(), 'music-display-'));
  const original = [...f.objects.values()].find(item => item.asset.kind === 'cover');
  const asset = { ...original.asset, etag: createHash('md5').update(f.bytes).digest('hex') };
  await mkdir(join(directory, 'api/music/__cover-files'), { recursive: true });
  await writeFile(directory + f.variant.path, f.displayBytes);
  const compiled = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { musicDisplayCover, isMusicDisplayAssetPath } from './src/music/coverDisplay.js';
    export default {fetch(request,env){
      if(isMusicDisplayAssetPath(new URL(request.url).pathname)) return new Response(null,{status:404});
      return musicDisplayCover(request,env.R2,${JSON.stringify(asset)},{assets:env.ASSETS,manifest:${JSON.stringify(f.options.coverManifest)}});
    }}
  ` }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const mf = new Miniflare({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-05-17',
    r2Buckets: ['R2'], assets: { directory, binding: 'ASSETS', routerConfig: { has_user_worker: true, static_routing: { user_worker: ['/*'] } } } });
  try {
    const bucket = await mf.getR2Bucket('R2');
    await bucket.put(asset.object_key, f.bytes, { httpMetadata: { contentType: asset.content_type } });
    const response = await mf.dispatchFetch('https://music.test/cover'); assert.equal(response.status, 200);
    const received = Buffer.from(await response.arrayBuffer()); assert.equal(received.length, f.displayBytes.length, JSON.stringify(Object.fromEntries(response.headers))); assert.deepEqual(received, f.displayBytes);
    const cached = await mf.dispatchFetch('https://music.test/cover', { headers: { 'If-None-Match': response.headers.get('ETag') } });
    assert.equal(cached.status, 304);
    for(const path of [f.variant.path, f.variant.path.replace('__cover', '%5f%5fcover'), f.variant.path.replace('__cover', '%255f%255fcover')]) {
      assert.equal((await mf.dispatchFetch('https://music.test' + path)).status, 404);
    }
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});
