import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleMusicPublic, isMusicPublicPath } from '../src/music/publicHttp.js';

const now = Date.parse('2026-09-11T00:00:00Z');
const migrations = ['0001_music_foundation.sql', '0002_music_publication.sql']
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
      assert.match(query.trim(), /^SELECT\s/i);
      assert.doesNotMatch(query, /rights|audit|mutation|upload|email|membership|account/i);
      return new Statement(query);
    }, async batch(statements) {
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
      body: new ReadableStream({ start(controller) { controller.enqueue(item.bytes); controller.close(); },
        cancel() { state.cancels++; } }) };
    return state.objectPatch ? state.objectPatch(object) : object;
  } };
  const env = { MUSIC_DB: db, MUSIC_BUCKET: bucket, WAITLIST_DB: {}, MUSIC_PUBLIC_ENABLED: 'true',
    MUSIC_VIP_DELIVERY_ENABLED: 'true' };

  function seedTrack({ slug, title, accessMode = 'vip', publishedAt = now - 10000, bad = false,
    badStorage = false, lifecycle = 'published', earlyAccessUntil = null, postEarlyAccessMode = null } = {}) {
    const id = randomUUID(), revision = randomUUID(), audio = randomUUID(), preview = randomUUID();
    const cover = randomUUID(), lyrics = randomUUID();
    insert(sql, 'music_tracks', { id, slug, lifecycle: 'draft', created_at: now - 30000, updated_at: now - 10000 });
    const bytes = { audio: Uint8Array.of(1, 2, 3), preview: Uint8Array.of(4, 5),
      cover: Uint8Array.of(137, 80, 78, 71), lyrics: new TextEncoder().encode('[00:00.00]Fixture lyric') };
    const base = { owner_track_id: id, state: 'validated', sha256: 'a'.repeat(64), created_at: now - 20000 };
    const assets = [
      { ...base, id: audio, kind: 'audio', object_key: badStorage ? `private/${audio}.mp3` : `music/audio/${id}/${audio}.mp3`, content_type: 'audio/mpeg',
        format: 'mp3', byte_size: bytes.audio.length, duration_ms: 120000, etag: `audio-${id}` },
      { ...base, id: preview, kind: 'preview', object_key: `music/previews/${id}/${preview}.mp3`, content_type: 'audio/mpeg',
        format: 'mp3', byte_size: bytes.preview.length, duration_ms: 30000, derived_from_asset_id: audio,
        source_start_ms: 10000, source_end_ms: 40000, etag: `preview-${id}` },
      { ...base, id: cover, kind: 'cover', object_key: `music/covers/${id}/${cover}.png`, content_type: 'image/png',
        format: 'png', byte_size: bytes.cover.length, etag: `cover-${id}` },
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

  function seedCollection(slug, trackIds) {
    const id = randomUUID();
    insert(sql, 'music_collections', { id, slug, original_locale: 'en', title_json: JSON.stringify({ en: `List ${slug}` }),
      description_json: JSON.stringify({ en: 'Public collection.' }), status: 'published', version: 1,
      created_at: now - 5000, updated_at: now - 5000 });
    trackIds.forEach((trackId, position) => insert(sql, 'music_collection_tracks', { collection_id: id, track_id: trackId, position }));
    return { id, slug };
  }

  return { sql, state, db, bucket, objects, env, seedTrack, seedCollection };
}

function request(path, options = {}) {
  return new Request(`https://wwwstationcat.org${path}`, options);
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
  const corrupt = f.seedTrack({ slug: 'broken-song', title: 'Broken', bad: true, publishedAt: now - 3000 });
  const invalidStorage = f.seedTrack({ slug: 'wrong-storage', title: 'Wrong storage', badStorage: true, publishedAt: now - 4000 });
  f.seedCollection('ordered-list', [second.id, corrupt.id, first.id]);
  f.seedCollection('empty-list', [corrupt.id]);
  f.sql.prepare("UPDATE music_settings SET value_json='7' WHERE key='catalogVersion'").run();

  const response = await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant'), f.env, { clock: () => now });
  const body = await json(response, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  assert.equal(response.headers.get('content-language'), 'zh-Hant');
  assert.match(response.headers.get('etag'), /^"music-[a-f0-9]{64}"$/);
  assert.deepEqual(body.tracks.map(track => track.id), [first.id, second.id]);
  assert.ok(!body.tracks.some(track => track.id === invalidStorage.id));
  assert.equal(body.tracks[0].title, '繁中 First');
  assert.equal(body.catalogVersion, 7);
  assert.deepEqual(body.collections.map(item => item.slug), ['ordered-list']);
  assert.deepEqual(body.collections[0].trackIds, [second.id, first.id]);
  assert.doesNotMatch(JSON.stringify(body), /Story for|object_key|sha256|canPlayFull|validUntil|technical_fingerprint/);

  const cached = await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant', {
    headers: { 'If-None-Match': `W/${response.headers.get('etag')}` } }), f.env, { clock: () => now });
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  const head = await handleMusicPublic(request('/api/music/catalog?locale=zh-Hant', { method: 'HEAD' }), f.env, { clock: () => now });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assert.equal(head.headers.get('etag'), response.headers.get('etag'));
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

test('cover and lyrics stream only the current versioned canonical object and HEAD cancels its body', async () => {
  const f = fixture(), track = f.seedTrack({ slug: 'asset-song', title: 'Assets' });
  let response = await handleMusicPublic(request(`/api/music/tracks/${track.id}/cover?v=1`), f.env, { clock: () => now });
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
