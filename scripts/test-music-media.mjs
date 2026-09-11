import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { handleMusicMedia, isMusicMediaPath, musicIfRangeMatches, parseMusicByteRange } from '../src/music/mediaResponse.js';

const now = Date.parse('2026-09-10T12:00:00Z');
const ids = Object.freeze({ track: randomUUID(), revision: randomUUID(), audio: randomUUID(), preview: randomUUID() });
const fullBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const previewBytes = Uint8Array.from([20, 21, 22, 23]);

function publishedRecord(mode = 'vip', preview = true) {
  const base = { owner_track_id: ids.track, state: 'validated', format: 'mp3', content_type: 'audio/mpeg',
    sha256: 'a'.repeat(64), created_at: now - 2000 };
  return {
    track: { id: ids.track, slug: 'media-fixture', lifecycle: 'published', published_revision_id: ids.revision,
      first_published_at: now - 10000, published_at: now - 10000, created_at: now - 20000, updated_at: now - 10000 },
    revision: { id: ids.revision, track_id: ids.track, revision_no: 1, state: 'sealed', created_at: now - 15000,
      technical_reviewed_at: now - 11000, access_mode: mode, early_access_until: null, post_early_access_mode: null,
      policy_version: 1, audio_asset_id: ids.audio, preview_asset_id: preview ? ids.preview : null,
      cover_asset_id: null, lyrics_asset_id: null, metadata_json: JSON.stringify({ originalLocale: 'en',
        title: { en: 'Media fixture' }, summary: { en: '' }, creatorName: 'Fixture', language: 'instrumental',
        instrumental: true, genres: [], moods: [] }) },
    assets: [
      { ...base, id: ids.audio, kind: 'audio', object_key: `music/audio/${ids.track}/${ids.audio}.mp3`,
        byte_size: fullBytes.length, duration_ms: 100000, etag: 'full-etag' },
      ...(preview ? [{ ...base, id: ids.preview, kind: 'preview', object_key: `music/previews/${ids.track}/${ids.preview}.mp3`,
        byte_size: previewBytes.length, duration_ms: 20000, derived_from_asset_id: ids.audio,
        source_start_ms: 10000, source_end_ms: 30000, etag: 'preview-etag' }] : [])
    ]
  };
}

function stream(bytes, state) {
  return new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
    cancel() { state.cancels++; }
  });
}

function fixture({ record = publishedRecord(), membership = 'active', bucketPatch = null,
  publicEnabled = true, vipDelivery = true, databaseFailure = false } = {}) {
  const state = { musicReads: 0, membershipReads: 0, r2: [], cancels: 0 };
  const music = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return {
      prepare(query) { return { bind() { return { query }; } }; },
      async batch(statements) {
        // Protocol fixtures isolate catalog/member/R2 behavior; atomic rate admission has its own SQL and native tests.
        if (statements.every(s => /^(DELETE FROM music_rate_|INSERT INTO music_rate_sources)/.test(s.query.trim()))) {
          return [{ success: true, results: [] }, { success: true, results: [] }, { success: true, results: [{ hits: 1 }] }];
        }
        state.musicReads++;
        if (databaseFailure) throw new Error('private database detail');
        assert.equal(statements.length, 3);
        return [record.track ? [record.track] : [], record.revision ? [record.revision] : [], record.assets || []]
          .map(results => ({ success: true, results }));
      }
    };
  } };
  const membershipDb = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return { prepare() { return { bind() { return { async all() {
      state.membershipReads++;
      if (membership === 'unavailable') throw new Error('private membership detail');
      const active = membership === 'active', expired = membership === 'expired';
      return { success: true, results: [{ session_account_id: 1, session_created_at: new Date(now - 20000).toISOString(),
        session_expires_at: new Date(now + 20000).toISOString(), session_revoked_at: null, account_id: 1,
        account_status: membership === 'restricted' ? 'disabled' : 'active', membership_account_id: active || expired ? 1 : null,
        membership_level: active || expired ? 'member' : null, started_at: active || expired ? new Date(now - 10000).toISOString() : null,
        expires_at: active ? new Date(now + 10000).toISOString() : expired ? new Date(now).toISOString() : null }] };
    } }; } }; } };
  } };
  const sources = new Map(record.assets?.map(asset => [asset.object_key, asset.kind === 'audio' ? fullBytes : previewBytes]));
  const bucket = { async get(key, options) {
    state.r2.push({ key, options: structuredClone(options) });
    const asset = record.assets?.find(row => row.object_key === key), bytes = sources.get(key);
    if (!asset || !bytes) return null;
    let chosen = bytes, range;
    if (options?.range) {
      chosen = bytes.slice(options.range.offset, options.range.offset + options.range.length);
      range = { offset: options.range.offset, length: options.range.length };
    }
    const object = { key, etag: asset.etag, httpEtag: `"${asset.etag}"`, size: bytes.length,
      httpMetadata: { contentType: 'audio/mpeg' }, body: stream(chosen, state), ...(range ? { range } : {}) };
    return bucketPatch ? bucketPatch(object, { key, options, asset }) : object;
  } };
  return { state, env: { MUSIC_DB: music, MUSIC_BUCKET: bucket, WAITLIST_DB: membershipDb,
    MUSIC_PUBLIC_ENABLED: String(publicEnabled), MUSIC_VIP_DELIVERY_ENABLED: String(vipDelivery),
    MUSIC_RATE_LIMIT_SECRET: 'media-unit-fixture-secret-not-for-deployment' } };
}

function request({ variant = 'preview', version = '1', method = 'GET', headers = {}, track = ids.track,
  search = null, cookie = false } = {}) {
  const query = search ?? `v=${version}&variant=${variant}`;
  return new Request(`https://wwwstationcat.org/api/music/tracks/${track}/audio?${query}`, { method,
    headers: { 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: 'station_cat_reader_session=fixture-token' } : {}), ...headers } });
}

async function json(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie');
  return body;
}

async function bytes(response) { return [...new Uint8Array(await response.arrayBuffer())]; }

test('media route and input are exact; disabled public flag touches no database or storage', async () => {
  assert.equal(isMusicMediaPath(`/api/music/tracks/${ids.track}/audio`), true);
  for (const path of [`/api/music/tracks/${ids.track}/audio/`, `/api/music/tracks/${ids.track}/cover`,
    `/api/music/tracks/${ids.track}/audio/extra`, '/api/music/tracks//audio']) assert.equal(isMusicMediaPath(path), false);
  const f = fixture({ publicEnabled: false });
  await json(await handleMusicMedia(request(), f.env, { clock: () => now }), 503, 'MUSIC_PUBLIC_DISABLED');
  assert.deepEqual(f.state, { musicReads: 0, membershipReads: 0, r2: [], cancels: 0 });
  const post = await handleMusicMedia(request({ method: 'POST' }), f.env, { clock: () => now });
  assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET, HEAD');
  for (const bad of [request({ variant: 'FULL' }), request({ version: '0' }), request({ version: '9007199254740992' }),
    request({ track: 'not-a-uuid' }), request({ search: 'v=1&v=2&variant=preview' }),
    request({ search: 'v=1&variant=preview&key=private' })]) assert.equal((await handleMusicMedia(bad, f.env)).status, 400);
  assert.equal(f.state.musicReads, 0); assert.equal(f.state.r2.length, 0);
  await json(await handleMusicMedia(request(), { MUSIC_PUBLIC_ENABLED: 'true' }), 503, 'MUSIC_NOT_CONFIGURED');
});

test('preview and free full stream without membership lookup and use only their canonical object', async () => {
  const preview = fixture({ membership: 'unavailable', vipDelivery: false });
  const response = await handleMusicMedia(request(), preview.env, { clock: () => now });
  assert.equal(response.status, 200); assert.deepEqual(await bytes(response), [...previewBytes]);
  assert.equal(preview.state.membershipReads, 0); assert.equal(preview.state.r2[0].key,
    `music/previews/${ids.track}/${ids.preview}.mp3`);
  const free = fixture({ record: publishedRecord('free'), membership: 'unavailable', vipDelivery: false });
  const full = await handleMusicMedia(request({ variant: 'full' }), free.env, { clock: () => now });
  assert.equal(full.status, 200); assert.deepEqual(await bytes(full), [...fullBytes]);
  assert.equal(free.state.membershipReads, 0); assert.match(free.state.r2[0].key, /\/audio\//);
});

test('VIP denial and service failures never touch R2 or reveal media metadata', async () => {
  for (const [options, cookie, status, code] of [
    [{}, false, 401, 'AUTH_REQUIRED'],
    [{ membership: 'none' }, true, 403, 'VIP_REQUIRED'],
    [{ membership: 'expired' }, true, 403, 'MEMBERSHIP_EXPIRED'],
    [{ membership: 'restricted' }, true, 403, 'ACCOUNT_RESTRICTED'],
    [{ membership: 'unavailable' }, true, 503, 'MEMBERSHIP_UNAVAILABLE'],
    [{ vipDelivery: false }, true, 503, 'VIP_DELIVERY_DISABLED']
  ]) {
    const f = fixture(options), response = await handleMusicMedia(request({ variant: 'full', cookie,
      headers: { Range: 'bytes=0-1', 'If-Range': '"full-etag"', 'If-None-Match': '"full-etag"' } }), f.env, { clock: () => now });
    await json(response, status, code); assert.equal(f.state.r2.length, 0);
    for (const header of ['etag', 'accept-ranges', 'content-range', 'last-modified']) assert.equal(response.headers.get(header), null);
  }
  const head = fixture(), denied = await handleMusicMedia(request({ variant: 'full', method: 'HEAD' }), head.env, { clock: () => now });
  assert.equal(denied.status, 401); assert.equal(await denied.text(), ''); assert.equal(head.state.r2.length, 0);
});

test('published version, lifecycle and dedicated preview guards run before R2', async () => {
  const conflict = fixture(); await json(await handleMusicMedia(request({ version: '2' }), conflict.env, { clock: () => now }), 409, 'VERSION_CONFLICT');
  const missingPreview = fixture({ record: publishedRecord('vip', false) });
  await json(await handleMusicMedia(request(), missingPreview.env, { clock: () => now }), 404, 'PREVIEW_UNAVAILABLE');
  const unavailableRecord = publishedRecord(); unavailableRecord.track.lifecycle = 'unpublished';
  const unavailable = fixture({ record: unavailableRecord });
  await json(await handleMusicMedia(request(), unavailable.env, { clock: () => now }), 410, 'TRACK_UNAVAILABLE');
  const absent = fixture({ record: { track: null, revision: null, assets: [] } });
  await json(await handleMusicMedia(request(), absent.env, { clock: () => now }), 404, 'NOT_FOUND');
  for (const f of [conflict, missingPreview, unavailable, absent]) assert.equal(f.state.r2.length, 0);
});

test('single byte, open, suffix, clipped and oversized suffix ranges return exact 206 bytes', async () => {
  for (const [range, expected, contentRange] of [
    ['bytes=0-1', [20, 21], 'bytes 0-1/4'],
    ['bytes=2-', [22, 23], 'bytes 2-3/4'],
    ['bytes=-1', [23], 'bytes 3-3/4'],
    ['bytes=1-99', [21, 22, 23], 'bytes 1-3/4'],
    ['bytes=-99', [20, 21, 22, 23], 'bytes 0-3/4']
  ]) {
    const f = fixture(), response = await handleMusicMedia(request({ headers: { Range: range } }), f.env, { clock: () => now });
    assert.equal(response.status, 206); assert.deepEqual(await bytes(response), expected);
    assert.equal(response.headers.get('content-range'), contentRange);
    assert.equal(response.headers.get('content-length'), String(expected.length));
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('etag'), '"preview-etag"');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  }
});

test('invalid and multi-ranges are ignored; authorized out-of-range is 416 after object validation', async () => {
  for (const range of ['bytes=3-2', 'bytes=0-1,2-3', 'items=0-1', 'bytes=-0', 'bytes=a-b',
    'bytes=9007199254740992-']) {
    const f = fixture(), response = await handleMusicMedia(request({ headers: { Range: range } }), f.env, { clock: () => now });
    assert.equal(response.status, 200, range); assert.deepEqual(await bytes(response), [...previewBytes]);
    assert.equal(response.headers.get('content-range'), null);
  }
  const f = fixture(), response = await handleMusicMedia(request({ headers: { Range: 'bytes=4-' } }), f.env, { clock: () => now });
  await json(response, 416, 'RANGE_NOT_SATISFIABLE');
  assert.equal(response.headers.get('content-range'), 'bytes */4');
  assert.equal(f.state.r2.length, 1); assert.equal(f.state.r2[0].options.range, undefined);
  assert.equal(f.state.r2[0].key, `music/previews/${ids.track}/${ids.preview}.mp3`);
});

test('If-Range accepts only matching strong ETag or fresh HTTP date; other validators never produce 304', async () => {
  const modified = new Date(now - 10000).toUTCString();
  for (const [ifRange, status] of [['"preview-etag"', 206], ['W/"preview-etag"', 200], ['"old"', 200],
    [modified, 206], [new Date(now - 20000).toUTCString(), 200], ['2026-09-10T12:00:00Z', 200]]) {
    const f = fixture(), response = await handleMusicMedia(request({ headers: { Range: 'bytes=0-1', 'If-Range': ifRange,
      'If-None-Match': '"preview-etag"', 'If-Modified-Since': modified } }), f.env, { clock: () => now });
    assert.equal(response.status, status, ifRange); assert.notEqual(response.status, 304); await response.arrayBuffer();
  }
  assert.equal(musicIfRangeMatches('W/"preview-etag"', 'preview-etag', now), false);
});

test('HEAD ignores Range, returns full headers and cancels storage body', async () => {
  const f = fixture(), response = await handleMusicMedia(request({ method: 'HEAD', headers: { Range: 'bytes=0-1' } }), f.env, { clock: () => now });
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
  assert.equal(response.headers.get('content-length'), '4'); assert.equal(response.headers.get('content-range'), null);
  assert.equal(f.state.r2[0].options.range, undefined);
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(f.state.cancels, 1);
});

test('changed, missing or malformed storage stays a private generic 503', async () => {
  for (const patch of [() => null, object => ({ ...object, etag: 'changed' }),
    object => ({ ...object, httpMetadata: { contentType: 'text/html' } }),
    object => ({ ...object, key: 'music/audio/private.mp3' }), object => ({ ...object, range: { offset: 1, length: 1 } })]) {
    const f = fixture({ bucketPatch: patch });
    const response = await handleMusicMedia(request({ headers: { Range: 'bytes=0-1' } }), f.env, { clock: () => now });
    await json(response, 503, 'MEDIA_UNAVAILABLE');
    for (const header of ['etag', 'accept-ranges', 'content-range', 'last-modified']) assert.equal(response.headers.get(header), null);
  }
  const failed = fixture({ databaseFailure: true });
  await json(await handleMusicMedia(request(), failed.env, { clock: () => now }), 503, 'MUSIC_DATABASE_UNAVAILABLE');
  assert.equal(failed.state.r2.length, 0);
});

test('range parser boundaries and production wiring keep a versioned non-generic route', () => {
  assert.deepEqual(parseMusicByteRange('bytes=0-0', 1), { start: 0, end: 0, length: 1 });
  assert.deepEqual(parseMusicByteRange('bytes=-2', 1), { start: 0, end: 0, length: 1 });
  assert.deepEqual(parseMusicByteRange('bytes=1-', 1), { unsatisfiable: true });
  assert.equal(parseMusicByteRange('bytes=1-0', 1), null);
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /if \(isMusicMediaPath\(url\.pathname\)\) return handleMusicMedia\(request, env\)/);
  assert.doesNotMatch(worker, /api\/music[^\n]+(?:object_key|\?key=)/);
});
