import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { handleStationContent, isStationContentPath } from '../src/redesign/publicHttp.js';
import { strictJson, platformUrl } from '../src/redesign/publicValidation.js';
import { handleMusicPublic, isMusicPublicPath } from '../src/music/publicHttp.js';
import { contentFixture, base, now, iso, publishTrack, promotionFixture, platformFixture,
  homeFixture, approve, mediaFixture } from './helpers/station-content-fixture.mjs';
import { insertFixture, fixtureId, homeId } from './helpers/station-redesign-database.mjs';

const fixtures = [];
async function fixture(options) { const f = await contentFixture(options); fixtures.push(f); return f; }
afterEach(() => { fixtures.splice(0).forEach(f => f.close()); });
function request(path, { method = 'GET', account = null, headers = {}, country } = {}) {
  const req = new Request('https://wwwstationcat.org' + (path.startsWith('/api/') ? path : base + path), {
    method, headers: { 'CF-Connecting-IP': '192.0.2.40',
      ...(account ? { Cookie: 'station_cat_reader_session=fixture-session-' + account } : {}), ...headers }
  });
  if (country) Object.defineProperty(req, 'cf', { value: { country } });
  return req;
}
const call = (f, path, input = {}, options = {}) => handleStationContent(request(path, input), f.env, { clock: () => now, ...options });
async function body(f, path, input, options) {
  const response = await call(f, path, input, options); assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
async function denied(response, status, code) {
  assert.equal(response.status, status, await response.clone().text());
  assert.match(response.headers.get('cache-control'), /no-store/);
  const value = await response.json();
  assert.equal(value.code, code); assert.match(value.request_id, /^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), value.request_id);
  assert.deepEqual(Object.keys(value).sort(), ['code', 'message', 'request_id']);
  assert.doesNotMatch(JSON.stringify(value), /private|SELECT|R2 details|fixture-session|object_key/);
}
const audioPath = (slug, revision = 2, variant = 'full', promo = 1) => '/tracks/' + slug + '/audio?variant=' + variant + '&v=' + revision + (variant === 'preview' ? '&p=' + promo : '');
function faultDb(db, predicate, effect = () => { throw new Error('private SELECT failure'); }) {
  const session = {
    prepare(query) {
      const wrap = statement => ({
        bind(...params) { return wrap(statement.bind(...params)); },
        async all() { if (predicate(query)) return effect(query); return statement.all(); },
        async first() { if (predicate(query)) return effect(query); return statement.first(); }
      });
      return wrap(db.prepare(query));
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.all())); }
  };
  return { withSession() { return session; } };
}

test('namespace stays separate from UUID music/native/services; default flag stops before any binding access', async () => {
  let reads = 0;
  const env = { get MUSIC_DB() { reads++; throw new Error('must not be read'); } };
  await denied(await handleStationContent(request('/tracks'), env), 503, 'CONTENT_DISABLED');
  assert.equal(reads, 0);
  for (const path of ['/api/music/catalog', '/api/mobile/v1/me/music/tracks', '/games/cat-life/', '/library/', '/api/payment/callback']) assert.equal(isStationContentPath(path), false);
  assert.equal(isMusicPublicPath(base + '/tracks/vip'), false);
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /if \(isStationContentPath\(url\.pathname\)\) return handleStationContent\(request, env\)/);
  for (const config of ['wrangler.toml', 'astro.config.mjs']) assert(!readFileSync(new URL('../' + config, import.meta.url), 'utf8').includes('STATION_CONTENT_PUBLIC_ENABLED'));
});

test('actual schema columns, ledger and cleanup view are required; probes never install missing schema', async () => {
  const f = await fixture();
  const before = f.reader.sql.prepare('SELECT count(*) AS n FROM sqlite_master').get().n;
  const original = f.env.MUSIC_DB;
  f.env.MUSIC_DB = f.env.WAITLIST_DB;
  await denied(await call(f, '/tracks'), 503, 'CONTENT_NOT_CONFIGURED');
  assert.equal(f.reader.sql.prepare('SELECT count(*) AS n FROM sqlite_master').get().n, before);
  f.env.MUSIC_DB = original;
  f.music.sql.exec("DELETE FROM d1_migrations");
  await denied(await call(f, '/tracks'), 503, 'CONTENT_SCHEMA_UNAVAILABLE');
  f.music.sql.exec("INSERT INTO d1_migrations(name) VALUES('0012_station_redesign.sql')");
  f.music.sql.exec('ALTER TABLE station_clips RENAME TO unavailable_clips');
  await denied(await call(f, '/tracks'), 503, 'CONTENT_SCHEMA_UNAVAILABLE');
  assert.equal(f.music.sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='station_clips'").get().n, 0);
});

test('ledger alone cannot prove the extension view; read failures are fixed 503 errors', async () => {
  const f = await fixture();
  f.music.sql.exec("DROP VIEW music_asset_references; CREATE VIEW music_asset_references AS SELECT id FROM music_assets");
  await denied(await call(f, '/tracks'), 503, 'CONTENT_SCHEMA_UNAVAILABLE');
  assert.equal(f.r2.state.reads.length, 0);
  const g = await fixture();
  g.env.MUSIC_DB = faultDb(g.music.db, query => query.includes('FROM station_track_publications p'));
  await denied(await call(g, '/tracks'), 503, 'CONTENT_SERVICE_UNAVAILABLE');
});

test('migration/backfilled home remains empty until explicitly published; no latest-free fallback', async () => {
  const f = await fixture({ publish: false });
  const songs = await body(f, '/tracks');
  assert.deepEqual(songs.items, []); assert.equal(songs.nextCursor, null);
  const home = (await body(f, '/home')).home;
  assert.equal(home.music, null); assert.equal(home.game, null); assert.deepEqual(home.clips, []);
  await denied(await call(f, '/tracks/permanent-free'), 404, 'NOT_FOUND');
  await denied(await call(f, '/assets/' + f.content.tracks[0].cover), 404, 'NOT_FOUND');
  assert.equal(f.r2.state.reads.length, 0);
});

test('public fields are allowlisted; platform-only works and locale fallback never spreads metadata', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  const value = await body(f, '/tracks/vip?locale=ja');
  assert.equal(value.track.title, 'vip'); assert.equal(value.track.href, '/ja/music/tracks/vip/');
  assert.equal(value.track.preview.durationMs, 30000);
  assert.match(value.track.lyricsUrl, /\/assets\//);
  assert.doesNotMatch(JSON.stringify(value), /object_key|site_audio_mode|legacy_revision|sha256|etag|rights_|technical_|audioPath|audio_asset_id|storage|private/);
  assert(!JSON.stringify(value).includes(vip.audio));
  const platformOnly = (await body(f, '/tracks/draft-no-audio?locale=en')).track;
  assert.equal(platformOnly.preview, null); assert.equal(platformOnly.durationMs, null);
  assert.equal(platformOnly.summary, ''); assert.equal(platformOnly.story, 'Two lines\nSecond line');
  await denied(await call(f, '/tracks/draft-no-audio/playback?variant=full'), 404, 'FULL_AUDIO_UNAVAILABLE');
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) assert.equal((await body(f, '/tracks?locale=' + locale)).locale, locale);
});

test('draft edits do not replace sealed public snapshots; scheduled, future and archived heads disappear', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  await insertFixture(f.music.db, 'station_track_revisions', { track_id: vip.id, revision: 3,
    metadata_json: '{"originalLocale":"en","title":{"en":"private unpublished title"},"creatorName":"Fixture"}', created_at: now });
  f.music.sql.prepare('UPDATE station_track_publications SET draft_revision=3,edit_version=100 WHERE track_id=?').run(vip.id);
  assert.equal((await body(f, '/tracks/vip?locale=en')).track.title, 'vip');
  for (const [status, at] of [['scheduled', now], ['published', now + 1], ['archived', now], ['draft', now]]) {
    f.music.sql.prepare('UPDATE station_track_publications SET status=?,scheduled_at=?,published_at=? WHERE track_id=?').run(status, now + 1, at, vip.id);
    await denied(await call(f, '/tracks/vip'), 404, 'NOT_FOUND');
    assert(!(await body(f, '/tracks')).items.some(item => item.id === vip.id));
    await denied(await call(f, '/tracks/vip/clips'), 404, 'NOT_FOUND');
  }
});

test('invalid query, duplicate parameters, methods and paths fail before DB/R2', async () => {
  const f = await fixture();
  for (const path of ['/tracks?locale=xx', '/tracks?locale=en&locale=ja', '/tracks?limit=51', '/tracks?limit=0',
    '/tracks?limit=01', '/tracks?cursor=broken', '/tracks?cursor=%3D', '/tracks?q=' + 'x'.repeat(101),
    '/tracks?token=private', '/games?q=unsupported', '/tracks/vip/playback?variant=full&isVip=true',
    '/tracks/vip/audio?variant=preview&v=2', '/tracks/vip/audio?variant=full&v=2&p=1', '/tracks/VIP', '/assets/not-a-uuid']) {
    await denied(await call(f, path), 400, 'INVALID_INPUT');
  }
  await denied(await call(f, '/tracks', { method: 'POST' }), 405, 'METHOD_NOT_ALLOWED');
  await denied(await call(f, '/unknown'), 404, 'NOT_FOUND');
  assert.equal(f.r2.state.reads.length, 0);
});

test('keyset pagination has stable ID tie breaks, title/artist search, bounded limits and filtered-page progress', async () => {
  const f = await fixture(), expected = f.content.tracks.map(track => track.id).concat(f.content.platformTrack.id);
  const found = [], cursors = new Set(); let cursor = '';
  do {
    const value = await body(f, '/tracks?locale=en&limit=2' + (cursor ? '&cursor=' + cursor : ''));
    found.push(...value.items.map(item => item.id)); cursor = value.nextCursor;
    if (cursor) { assert(!cursors.has(cursor)); cursors.add(cursor); }
  } while (cursor);
  assert.deepEqual(found, expected);
  assert.equal((await body(f, '/tracks?q=vip')).items.length, 1);
  assert.equal((await body(f, '/tracks?q=station')).items.length, 6);
  assert.equal((await body(f, '/tracks?q=no-match')).items.length, 0);
  assert.equal((await body(f, '/tracks?limit=50')).items.length, 7);
  await publishTrack(f.music.db, f.content.tracks[0], { metadata_json: '{"originalLocale":"en","title":{"en":"first","en":"second"},"creatorName":"Fixture"}' });
  const emptyPage = await body(f, '/tracks?limit=1');
  assert.deepEqual(emptyPage.items, []); assert(emptyPage.nextCursor);
  assert.equal((await body(f, '/tracks?limit=1&cursor=' + emptyPage.nextCursor)).items[0].id, f.content.tracks[1].id);
});

test('canonical alias lookup returns canonical links without treating old music descendants as already migrated', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  f.music.sql.prepare("UPDATE station_track_routes SET role='alias' WHERE track_id=? AND role='canonical'").run(vip.id);
  await insertFixture(f.music.db, 'station_track_routes', { slug: 'vip-new', track_id: vip.id, role: 'canonical', created_at: now });
  const value = await body(f, '/tracks/vip?locale=en');
  assert.equal(value.track.slug, 'vip-new'); assert.equal(value.track.href, '/en/music/tracks/vip-new/');
  await denied(await call(f, '/tracks/old-child'), 404, 'NOT_FOUND');
});

test('default 20/max 50 are actual SQL page limits and cannot dump the whole catalog', async () => {
  const f = await fixture();
  for (let index = 0; index < 55; index++) {
    const id = fixtureId(10000 + index), slug = 'bounded-song-' + index;
    await insertFixture(f.music.db, 'music_tracks', { id, slug, created_at: now, updated_at: now });
    await insertFixture(f.music.db, 'station_track_publications', { track_id: id, created_at: now, updated_at: now });
    await insertFixture(f.music.db, 'station_track_routes', { slug, track_id: id, role: 'canonical', created_at: now });
    await insertFixture(f.music.db, 'station_track_revisions', { track_id: id, revision: 1, state: 'sealed',
      metadata_json: '{"originalLocale":"en","title":{"en":"Bounded song"},"creatorName":"Fixture"}', created_at: now });
    f.music.sql.prepare("UPDATE station_track_publications SET status='published',published_revision=1,published_at=? WHERE track_id=?").run(now - 100, id);
  }
  const standard = await body(f, '/tracks'), maximum = await body(f, '/tracks?limit=50');
  assert.equal(standard.items.length, 20); assert(standard.nextCursor);
  assert.equal(maximum.items.length, 50); assert(maximum.nextCursor);
  const last = await body(f, '/tracks?limit=50&cursor=' + maximum.nextCursor);
  assert.equal(last.items.length, 12); assert.equal(last.nextCursor, null);
});

test('duplicate/escaped keys, prototypes and oversized stored metadata are rejected, including related references', async () => {
  for (const source of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":{}}', '{"x":{"constructor":1}}',
    '['.repeat(14) + '0' + ']'.repeat(14), '{"x":"' + 'a'.repeat(32768) + '"}']) assert.throws(() => strictJson(source));
  assert.deepEqual(strictJson('{"text":"comma, colon: and \\"quote\\"","array":[1,null,{"ok":true}]}').array, [1, null, { ok: true }]);
  const f = await fixture(), free = f.content.tracks[0], vip = f.content.tracks[1];
  await publishTrack(f.music.db, free, { metadata_json: JSON.stringify({ ...free.metadata, relatedTrackIds: [vip.id, f.content.archived.id],
    object_key: 'do-not-forward', accessToken: 'do-not-forward' }) });
  const detail = await body(f, '/tracks/permanent-free?locale=en');
  assert.deepEqual(detail.related.map(item => item.id), [vip.id]);
  assert.doesNotMatch(JSON.stringify(detail), /do-not-forward|accessToken|object_key/);
  await publishTrack(f.music.db, vip, { metadata_json: '{"originalLocale":"en","title":{"en":"vip"},"creatorName":"Fixture","\\u0063reatorName":"duplicate"}' });
  await denied(await call(f, '/tracks/vip'), 404, 'NOT_FOUND');
  assert.deepEqual((await body(f, '/clips')).items, []);
});

test('platform visibility requires actual live verification, provider host and trusted territory; query/header claims cannot override', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  await platformFixture(f.music.db, vip, { provider: 'spotify', territories_json: '["JP"]', url: 'https://open.spotify.com/track/synthetic-fixture' });
  await platformFixture(f.music.db, vip, { provider: 'qishui', url: 'https://music.douyin.com/track/synthetic-fixture', verified_at: now + 1 });
  await platformFixture(f.music.db, vip, { provider: 'netease', status: 'planned', url: 'https://music.163.com/song?id=1' });
  const unknown = (await body(f, '/tracks/vip', { headers: { 'CF-IPCountry': 'JP', 'X-Country': 'JP' } })).track;
  assert.deepEqual(unknown.platforms.map(item => item.provider), ['apple_music']);
  const japan = (await body(f, '/tracks/vip', { country: 'JP' })).track;
  assert.deepEqual(japan.platforms.map(item => item.provider).sort(), ['apple_music', 'spotify']);
  for (const url of ['https://music.apple.com.evil.test/song', 'https://user:secret@music.apple.com/song',
    'https://music.apple.com/song?token=private', 'https://music.apple.com/redirect?url=https://evil.test',
    'https://music.apple.com/song#token', 'http://music.apple.com/song', 'https://evil.test/song']) assert.equal(platformUrl(url, 'apple_music'), null);
  f.music.sql.prepare("UPDATE station_platform_links SET status='removed' WHERE id=?").run(f.content.platformId);
  assert.equal((await body(f, '/tracks/vip')).track.platforms.length, 0);
});

test('independent guest preview requires current enabled promotion and owned approved resource; no account/full object lookup', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  f.env.MUSIC_PUBLIC_ENABLED = false; f.env.MUSIC_VIP_DELIVERY_ENABLED = false;
  const response = await call(f, '/tracks/vip/playback?variant=preview');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const value = await response.json(); assert.equal(value.variant, 'preview'); assert.equal(value.durationMs, 30000);
  assert(!JSON.stringify(value).includes(vip.audio)); assert(!JSON.stringify(value).includes('object_key'));
  assert.equal(f.reader.state.reads.length, 0);
  assert(f.r2.state.reads.every(read => !read.key.includes(vip.audio)));
  const audio = await call(f, value.audioPath); assert.equal(audio.status, 200); assert.equal((await audio.arrayBuffer()).byteLength, 100);
  await promotionFixture(f.music.db, vip, { preview: 0 });
  assert.equal((await body(f, '/tracks/vip')).track.preview, null);
  await denied(await call(f, '/tracks/vip/playback?variant=preview'), 404, 'PREVIEW_UNAVAILABLE');
  await denied(await call(f, value.audioPath), 409, 'VERSION_CONFLICT');
});

test('stopped/draft/future promotions revoke current preview and home; old free featured state is irrelevant', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  await promotionFixture(f.music.db, vip, { enabled: 0 });
  assert.equal((await body(f, '/home')).home.music, null);
  assert.equal((await body(f, '/tracks/vip')).track.preview, null);
  await denied(await call(f, '/tracks/vip/playback?variant=preview'), 404, 'PREVIEW_UNAVAILABLE');
  await promotionFixture(f.music.db, vip);
  for (const [status, at] of [['draft', now], ['published', now + 1], ['archived', now]]) {
    f.music.sql.prepare('UPDATE station_promotions SET status=?,published_at=? WHERE track_id=?').run(status, at, vip.id);
    await denied(await call(f, '/tracks/vip/playback?variant=preview'), 404, 'PREVIEW_UNAVAILABLE');
  }
});

test('rights, source identity and object freshness independently prevent preview delivery', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").run(vip.preview);
  await denied(await call(f, '/tracks/vip/playback?variant=preview'), 404, 'PREVIEW_UNAVAILABLE');
  assert.equal((await body(f, '/tracks/vip')).track.preview, null);
  f.music.sql.prepare("UPDATE station_asset_rights SET status='approved' WHERE music_asset_id=?").run(vip.preview);
  const key = f.music.sql.prepare('SELECT object_key FROM music_assets WHERE id=?').get(vip.preview).object_key;
  const object = f.r2.objects.get(key);
  f.r2.objects.delete(key);
  await denied(await call(f, '/tracks/vip/playback?variant=preview'), 503, 'CONTENT_MEDIA_UNAVAILABLE');
  assert.equal((await body(f, '/tracks/vip')).track.preview, null);
  f.r2.objects.set(key, { ...object, etag: 'changed-object' });
  await denied(await call(f, '/tracks/vip/playback?variant=preview'), 503, 'CONTENT_MEDIA_UNAVAILABLE');
  f.r2.objects.set(key, object);
  f.r2.state.failHead = true;
  await denied(await call(f, '/tracks/vip/playback?variant=preview'), 503, 'CONTENT_MEDIA_UNAVAILABLE');
});

test('a preview copied from the entire full file or referencing another owner cannot pass independent clip proof', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  const original = f.music.sql.prepare('SELECT * FROM music_assets WHERE id=?').get(vip.preview);
  for (const [index, duration, sourceId] of [[0, 120000, vip.audio], [1, 30000, f.content.tracks[0].audio]]) {
    const id = fixtureId(850 + index);
    const values = { ...original, id,
      object_key: 'music/previews/' + vip.id + '/' + id + '.mp3', derived_from_asset_id: sourceId,
      duration_ms: duration, source_start_ms: 0, source_end_ms: duration };
    if (index === 1) {
      await assert.rejects(insertFixture(f.music.db, 'music_assets', values), /MUSIC_PREVIEW_SOURCE/);
      continue; // The existing ownership trigger already rejects this reference.
    }
    await insertFixture(f.music.db, 'music_assets', values);
    await approve(f.music.db, id, 'preview');
    await promotionFixture(f.music.db, { ...vip, preview: id });
    await denied(await call(f, '/tracks/vip/playback?variant=preview'), 404, 'PREVIEW_UNAVAILABLE');
    assert.equal((await body(f, '/tracks/vip')).track.preview, null);
  }
});

test('free_full hint on VIP does not grant access; guest, ordinary, expired and real member responses stay distinct', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  const version = await publishTrack(f.music.db, vip, { site_audio_mode: 'free_full' });
  for (const [account, status, code] of [[null, 401, 'AUTH_REQUIRED'], [2, 403, 'VIP_REQUIRED'], [3, 403, 'MEMBERSHIP_EXPIRED']]) {
    f.r2.state.reads.length = 0;
    const response = await call(f, '/tracks/vip/playback?variant=full', { account });
    assert.equal(response.headers.get('vary'), 'Cookie'); await denied(response, status, code);
    assert.equal(f.r2.state.reads.length, 0);
    await denied(await call(f, audioPath('vip', version), { account }), status, code);
    assert.equal(f.r2.state.reads.length, 0);
  }
  const response = await call(f, '/tracks/vip/playback?variant=full', { account: 1 });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie'); const value = await response.json();
  assert.equal(value.audioPath, base + audioPath('vip', version));
  assert.doesNotMatch(JSON.stringify(value), /object_key|sha256|private1|session_hash|rights_/);
});

test('finite account/session revocation and membership DB failures are rechecked on direct HEAD/Range requests', async () => {
  const f = await fixture();
  const first = await call(f, '/tracks/vip/playback?variant=full', { account: 1 });
  const path = (await first.json()).audioPath;
  f.reader.sql.prepare('UPDATE reader_sessions SET expires_at=? WHERE account_id=1').run(iso(now));
  for (const method of ['GET', 'HEAD']) {
    const response = await call(f, path, { method, account: 1, headers: { Range: 'bytes=0-9', 'If-None-Match': '*' } });
    assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('vary'), 'Cookie');
    if (method === 'HEAD') assert.equal(await response.text(), ''); else await denied(response, 401, 'AUTH_REQUIRED');
  }
  f.reader.sql.prepare('UPDATE reader_sessions SET expires_at=? WHERE account_id=1').run(iso(now + 60000));
  f.reader.sql.prepare("UPDATE reader_accounts SET status='disabled' WHERE id=1").run();
  await denied(await call(f, path, { account: 1 }), 403, 'ACCOUNT_RESTRICTED');
  f.reader.sql.prepare("UPDATE reader_accounts SET status='active' WHERE id=1").run();
  f.reader.state.fail = true;
  await denied(await call(f, path, { account: 1 }), 503, 'MEMBERSHIP_UNAVAILABLE');
  f.reader.state.fail = false;
  f.reader.state.delay = 20;
  await denied(await call(f, path, { account: 1 }, { timeoutMs: 1 }), 503, 'MEMBERSHIP_UNAVAILABLE');
  await new Promise(resolve => setTimeout(resolve, 25));
});

test('legacy flags and current legacy revision still control full media, including time-limited free music', async () => {
  const f = await fixture();
  for (const slug of ['permanent-free', 'limited-active']) {
    const response = await call(f, '/tracks/' + slug + '/playback?variant=full');
    assert.equal(response.status, 200);
  }
  for (const slug of ['limited-expired', 'early-access']) await denied(await call(f, '/tracks/' + slug + '/playback?variant=full'), 401, 'AUTH_REQUIRED');
  f.env.MUSIC_VIP_DELIVERY_ENABLED = false;
  await denied(await call(f, '/tracks/vip/playback?variant=full', { account: 1 }), 503, 'VIP_DELIVERY_DISABLED');
  f.env.MUSIC_VIP_DELIVERY_ENABLED = true; f.env.MUSIC_PUBLIC_ENABLED = false;
  await denied(await call(f, '/tracks/permanent-free/playback?variant=full'), 503, 'MUSIC_PUBLIC_DISABLED');
  f.env.MUSIC_PUBLIC_ENABLED = true;
  await denied(await call(f, '/tracks/unpublished/playback?variant=full', { account: 1 }), 404, 'FULL_AUDIO_UNAVAILABLE');
  const vip = f.content.tracks[1], revision = f.music.sql.prepare('SELECT * FROM music_track_revisions WHERE id=?').get(vip.revision);
  await insertFixture(f.music.db, 'music_track_revisions', { ...revision, id: fixtureId(800), revision_no: 2 });
  f.music.sql.prepare('UPDATE music_tracks SET published_revision_id=? WHERE id=?').run(fixtureId(800), vip.id);
  await denied(await call(f, '/tracks/vip/playback?variant=full', { account: 1 }), 409, 'VERSION_CONFLICT');
});

test('authorized audio streams bounded ranges, HEAD and If-Range; no GET on denied HEAD or stale website versions', async () => {
  const f = await fixture();
  let response = await call(f, audioPath('vip'), { account: 1, headers: { Range: 'bytes=10-19' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal(response.headers.get('content-length'), '10'); assert.equal((await response.arrayBuffer()).byteLength, 10);
  response = await call(f, audioPath('vip'), { account: 1, method: 'HEAD' });
  assert.equal(response.status, 200); assert.equal(await response.text(), ''); assert.equal(response.headers.get('content-length'), '100');
  response = await call(f, audioPath('vip'), { account: 1, headers: { Range: 'bytes=0-9', 'If-Range': '"wrong"' } });
  assert.equal(response.status, 200); assert.equal((await response.arrayBuffer()).byteLength, 100);
  await denied(await call(f, audioPath('vip'), { account: 1, headers: { Range: 'bytes=999-' } }), 416, 'RANGE_NOT_SATISFIABLE');
  const before = f.r2.state.reads.length;
  await denied(await call(f, audioPath('vip', 1), { account: 1 }), 409, 'VERSION_CONFLICT');
  assert.equal(f.r2.state.reads.length, before);
  f.r2.state.failGet = true;
  await denied(await call(f, audioPath('vip'), { account: 1 }), 503, 'CONTENT_MEDIA_UNAVAILABLE');
});

test('generic asset paths never deliver full/preview files, even to members; public cover and lyric stream only current references', async () => {
  const f = await fixture(), vip = f.content.tracks[1];
  for (const id of [vip.audio, vip.preview]) await denied(await call(f, '/assets/' + id, { account: 1 }), 404, 'NOT_FOUND');
  let response = await call(f, '/assets/' + vip.cover);
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png'); await response.arrayBuffer();
  response = await call(f, '/assets/' + vip.lyrics);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^text\/plain/); await response.arrayBuffer();
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").run(vip.cover);
  await denied(await call(f, '/assets/' + vip.cover, { headers: { 'If-None-Match': '*' } }), 404, 'NOT_FOUND');
  await publishTrack(f.music.db, vip, { cover_asset_id: null });
  await denied(await call(f, '/assets/' + vip.cover), 404, 'NOT_FOUND');
});

test('object replacement between HEAD and conditional GET cannot leak different bytes', async () => {
  const f = await fixture(), cover = f.content.tracks[0].cover;
  f.r2.state.beforeGet = key => { const value = f.r2.objects.get(key); f.r2.objects.set(key, { ...value, etag: 'changed' }); };
  await denied(await call(f, '/assets/' + cover), 503, 'CONTENT_MEDIA_UNAVAILABLE');
});

test('an R2 body arriving after the request deadline is cancelled instead of becoming a late response', async () => {
  const f = await fixture(); let cancelled = 0;
  f.env.MUSIC_BUCKET.get = async key => {
    const object = f.r2.objects.get(key);
    await new Promise(resolve => setTimeout(resolve, 60));
    return { key, etag: object.etag, size: object.bytes.length, httpMetadata: object.httpMetadata,
      body: new ReadableStream({ cancel() { cancelled++; } }) };
  };
  const response = await call(f, '/assets/' + f.content.tracks[0].cover, {}, { deadlineMs: 20 });
  assert.equal(response.status, 503);
  await new Promise(resolve => setTimeout(resolve, 70)); assert.equal(cancelled, 1);
});

test('video requires current published parent, matching video/poster rights, dimensions and ready objects', async () => {
  const f = await fixture(), { clip, tracks } = f.content;
  const value = await body(f, '/tracks/vip/clips?locale=en&limit=1');
  assert.equal(value.items[0].id, clip.id); assert.equal(value.items[0].durationMs, 30000);
  let response = await call(f, '/assets/' + clip.video, { headers: { Range: 'bytes=1-5' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-type'), 'video/mp4'); await response.arrayBuffer();
  f.music.sql.prepare("UPDATE station_asset_rights SET status='blocked' WHERE media_asset_id=?").run(clip.poster);
  assert.deepEqual((await body(f, '/clips')).items, []);
  await denied(await call(f, '/assets/' + clip.video), 404, 'NOT_FOUND');
  f.music.sql.prepare("UPDATE station_asset_rights SET status='approved' WHERE media_asset_id=?").run(clip.poster);
  f.music.sql.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").run(tracks[1].id);
  assert.deepEqual((await body(f, '/clips')).items, []);
  await denied(await call(f, '/tracks/vip/clips'), 404, 'NOT_FOUND');
  await denied(await call(f, '/assets/' + clip.video), 404, 'NOT_FOUND');
});

test('game detail preserves the real runtime directory; unregistered stored launch paths cannot become launch promises', async () => {
  const f = await fixture(), { game } = f.content;
  const value = (await body(f, '/games/cat-life-game?locale=zh-Hans')).game;
  assert.equal(value.launchPath, '/games/cat-life/'); assert.equal(value.href, '/zh-hans/games/cat-life-game/');
  await denied(await call(f, '/games/cat-life'), 404, 'NOT_FOUND');
  await insertFixture(f.music.db, 'station_game_revisions', { id: game.id, revision: 2, state: 'sealed',
    metadata_json: '{"originalLocale":"en","title":{"en":"Game"}}', launch_url: '/games/arbitrary-new-runtime/', created_at: now });
  f.music.sql.prepare('UPDATE station_games SET published_revision=2 WHERE id=?').run(game.id);
  assert.equal((await body(f, '/games/cat-life-game')).game.launchPath, null);
});

test('asset IDs colliding across music/media domains are omitted rather than resolved by arrival order', async () => {
  const f = await fixture(), { game, tracks } = f.content, cover = tracks[1].cover;
  await mediaFixture(f.music.db, f.r2.bucket, game.id, 'game_screenshot', cover);
  assert.equal((await body(f, '/tracks/vip')).track.coverUrl, null);
  assert.equal((await body(f, '/home')).home.music, null);
  await denied(await call(f, '/assets/' + cover), 404, 'NOT_FOUND');
});

test('published home ignores concurrent drafts and removes revoked promotions/media on each fresh projection', async () => {
  const f = await fixture(), { tracks, clip, game } = f.content;
  let home = (await body(f, '/home?locale=en')).home;
  assert.equal(home.music.id, tracks[1].id); assert.equal(home.game.id, game.id); assert.equal(home.clips[0].id, clip.id);
  await insertFixture(f.music.db, 'station_home_revisions', { id: homeId, revision: 3, created_at: now });
  f.music.sql.prepare('UPDATE station_home_configs SET draft_revision=3,edit_version=50 WHERE id=?').run(homeId);
  assert.equal((await body(f, '/home')).home.music.id, tracks[1].id);
  await promotionFixture(f.music.db, tracks[1], { platforms: [f.content.platformId], clips: [] });
  assert.deepEqual((await body(f, '/home')).home.clips, []);
  assert.equal((await body(f, '/clips')).items.length, 1);
  f.music.sql.prepare("UPDATE station_media_assets SET state='revoked' WHERE id=?").run(clip.video);
  assert.deepEqual((await body(f, '/home')).home.clips, []);
  await promotionFixture(f.music.db, f.content.archived, { preview: 0 });
  await homeFixture(f.music.db, { track: f.content.archived.id, game: game.id });
  home = (await body(f, '/home')).home; assert.equal(home.music, null); assert.equal(home.game.id, game.id);
});

test('bounded rate admission distinguishes 429 from service failure and request budgets expire without publication writes', async () => {
  const f = await fixture();
  f.env.MUSIC_RATE_LIMITS_JSON = JSON.stringify({ catalog: { source: 1, global: 100 },
    artwork: { source: 240, global: 12000 }, audio: { source: 120, global: 6000 } });
  assert.equal((await call(f, '/tracks')).status, 200);
  const limited = await call(f, '/tracks'); assert.equal(limited.headers.get('retry-after'), '60');
  await denied(limited, 429, 'MUSIC_RATE_LIMITED');
  await denied(await call(f, '/tracks', { headers: { 'CF-Connecting-IP': '' } }), 503, 'MUSIC_RATE_LIMIT_UNAVAILABLE');
  const g = await fixture(); g.r2.state.delay = 60;
  const timedOut = await call(g, '/tracks', {}, { deadlineMs: 20 });
  assert.equal(timedOut.status, 503);
  assert(['CONTENT_SERVICE_UNAVAILABLE', 'CONTENT_MEDIA_UNAVAILABLE'].includes((await timedOut.json()).code));
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(g.music.sql.prepare('SELECT count(*) AS n FROM station_analytics_events').get().n, 0);
  assert.equal(g.reader.sql.prepare('SELECT count(*) AS n FROM reader_accounts').get().n, 3);
});

test('existing UUID catalog retains its contract and old qualification metric after the extension is populated', async () => {
  const f = await fixture(), req = request('/api/music/catalog?locale=en');
  const response = await handleMusicPublic(req, f.env, { clock: () => now });
  assert.equal(response.status, 200); const value = await response.json();
  assert(value.tracks.some(track => track.id === f.content.tracks[1].id));
  assert.equal(value.tracks.length, 5);
  assert.equal(value.popularity.metric, 'qualified_play');
  assert.equal(f.music.sql.prepare('SELECT count(*) AS n FROM station_analytics_events').get().n, 0);
});
