import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { migrationStatements, fixtureId } from './helpers/station-redesign-database.mjs';
import { base, seedContent, readerStatements, seedReaders, iso, publishTrack } from './helpers/station-content-fixture.mjs';

let mf, db, reader, bucket, content;
before(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('helpers/station-content-runtime-worker.js', import.meta.url))],
    bundle: true, format: 'esm', platform: 'browser', write: false, loader: { '.wasm': 'binary' } });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-30',
    host: '127.0.0.1', port: 0, d1Databases: { MUSIC_DB: 'station-content-music-only',
      WAITLIST_DB: 'station-content-reader-only', EMPTY_DB: 'station-content-empty-only' },
    r2Buckets: { MUSIC_BUCKET: 'station-content-r2-only' },
    bindings: { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true',
      MUSIC_RATE_LIMIT_SECRET: 'station-content-local-runtime-secret-no-production' },
    serviceBindings: { ASSETS: request => new Response('STATIC_FIXTURE ' + new URL(request.url).pathname,
      { headers: { 'Content-Type': 'text/html' } }) },
    outboundService: () => new Response('Outbound network disabled in local tests', { status: 403 })
  });
  db = await mf.getD1Database('MUSIC_DB'); reader = await mf.getD1Database('WAITLIST_DB'); bucket = await mf.getR2Bucket('MUSIC_BUCKET');
}, { timeout: 60000 });
after(async () => { await mf?.dispose(); });
const call = (path, { enabled = true, method = 'GET', account, headers = {}, prefix } = {}) => mf.dispatchFetch(
  'https://wwwstationcat.org' + (prefix || (enabled ? '/fixture-enabled' : '')) + (path.startsWith('/api/') || path.startsWith('/games/') ? path : base + path),
  { method, headers: { 'CF-Connecting-IP': '192.0.2.50', ...(account ? { Cookie: 'station_cat_reader_session=fixture-session-' + account } : {}), ...headers } });
async function jsonError(response, status, code) {
  assert.equal(response.status, status, await response.clone().text()); const value = await response.json();
  assert.equal(value.code, code); assert.match(value.request_id, /^[a-f0-9-]{36}$/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.doesNotMatch(JSON.stringify(value), /object_key|session_hash|SQL|SELECT|station-test-only/);
}

test('production Worker dispatch is default closed; actual empty D1 fails readiness without automatic DDL', async () => {
  await jsonError(await call('/tracks', { enabled: false }), 503, 'CONTENT_DISABLED');
  await jsonError(await call('/tracks'), 503, 'CONTENT_SCHEMA_UNAVAILABLE');
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'station_%'").first()).n, 0);
  await jsonError(await call('/tracks', { prefix: '/fixture-wrong' }), 503, 'CONTENT_NOT_CONFIGURED');
});

test('explicit local fixture migration enables published queries only, with a separate reader binding and actual ledger', async () => {
  const groups = migrationStatements();
  for (const group of groups.slice(0, -1)) await db.batch(group.statements.map(sql => db.prepare(sql)));
  content = await seedContent(db, bucket);
  await reader.batch(readerStatements().map(sql => reader.prepare(sql)));
  await seedReaders(reader);
  // The actual Worker uses Date.now. Keep the synthetic finite periods current.
  const time = Date.now();
  await reader.prepare('UPDATE reader_sessions SET created_at=?,expires_at=?').bind(iso(time - 60000), iso(time + 3600000)).run();
  await reader.prepare('UPDATE reader_memberships SET started_at=?,expires_at=? WHERE account_id=1').bind(iso(time - 60000), iso(time + 3600000)).run();
  const response = await call('/tracks?locale=en&limit=2'); assert.equal(response.status, 200, await response.clone().text());
  const value = await response.json(); assert.equal(value.items.length, 2); assert(value.nextCursor);
  assert.equal(value.items[1].id, content.tracks[1].id);
  assert.doesNotMatch(JSON.stringify(value), /object_key|sha256|legacy_revision|site_audio_mode|audioPath|rights_basis/);
  assert.equal((await reader.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'station_%'").first()).n, 0);
  await jsonError(await call('/tracks', { prefix: '/fixture-missing-schema' }), 503, 'CONTENT_SCHEMA_UNAVAILABLE');
});

test('native D1 publication pointer coexists with drafts; clip/game/home DTO and actual R2 streaming agree', async () => {
  const detail = await call('/tracks/vip?locale=en'); assert.equal(detail.status, 200);
  const track = (await detail.json()).track;
  let response = await call(track.coverUrl, { method: 'HEAD' });
  assert.equal(response.status, 200); assert.equal(await response.text(), ''); assert.equal(response.headers.get('content-length'), '100');
  response = await call(track.coverUrl, { headers: { Range: 'bytes=0-9' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 0-9/100');
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  const clips = await call('/clips?locale=en'); assert.equal(clips.status, 200);
  const clip = (await clips.json()).items[0]; assert.equal(clip.id, content.clip.id);
  response = await call(clip.mediaUrl, { headers: { Range: 'bytes=-5' } });
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 5);
  const games = await call('/games?locale=en'); assert.equal(games.status, 200);
  assert.equal((await games.json()).items[0].launchPath, '/games/cat-life/');
  const home = await call('/home?locale=en'); assert.equal(home.status, 200);
  assert.equal((await home.json()).home.music.id, content.tracks[1].id);
});

test('native guest preview is independent; generic assets cannot deliver audio; private full responses use real existing membership', async () => {
  const vip = content.tracks[1];
  const preview = await call('/tracks/vip/playback?variant=preview'); assert.equal(preview.status, 200);
  const previewBody = await preview.json(); assert.equal(previewBody.durationMs, 30000);
  let response = await call(previewBody.audioPath, { headers: { Range: 'bytes=0-4' } });
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 5);
  await jsonError(await call('/assets/' + vip.preview), 404, 'NOT_FOUND');
  await jsonError(await call('/assets/' + vip.audio, { account: 1 }), 404, 'NOT_FOUND');
  await jsonError(await call('/tracks/vip/playback?variant=full'), 401, 'AUTH_REQUIRED');
  await jsonError(await call('/tracks/vip/playback?variant=full', { account: 2 }), 403, 'VIP_REQUIRED');
  await jsonError(await call('/tracks/vip/playback?variant=full', { account: 3 }), 403, 'MEMBERSHIP_EXPIRED');
  const full = await call('/tracks/vip/playback?variant=full', { account: 1 }); assert.equal(full.status, 200);
  assert.equal(full.headers.get('cache-control'), 'private, no-store'); assert.equal(full.headers.get('vary'), 'Cookie');
  const fullBody = await full.json();
  response = await call(fullBody.audioPath, { account: 1, headers: { Range: 'bytes=0-9' } });
  assert.equal(response.status, 206); assert.equal(response.headers.get('vary'), 'Cookie'); await response.arrayBuffer();
  await reader.prepare('UPDATE reader_sessions SET revoked_at=? WHERE account_id=1').bind(iso(Date.now())).run();
  response = await call(fullBody.audioPath, { account: 1, method: 'HEAD', headers: { Range: 'bytes=0-9', 'If-None-Match': '*' } });
  assert.equal(response.status, 401); assert.equal(await response.text(), ''); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('actual R2 replacement and rights revocation are visible immediately, including conditional requests and home', async () => {
  const vip = content.tracks[1], asset = await db.prepare('SELECT * FROM music_assets WHERE id=?').bind(vip.preview).first();
  await bucket.put(asset.object_key, new Uint8Array(100).fill(99), { httpMetadata: { contentType: 'audio/mpeg' } });
  await jsonError(await call('/tracks/vip/playback?variant=preview'), 503, 'CONTENT_MEDIA_UNAVAILABLE');
  const detail = await call('/tracks/vip'); assert.equal((await detail.json()).track.preview, null);
  await db.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").bind(vip.cover).run();
  await jsonError(await call('/assets/' + vip.cover, { headers: { 'If-None-Match': '*' } }), 404, 'NOT_FOUND');
  const home = await call('/home'); assert.equal((await home.json()).home.music, null);
  await db.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").bind(vip.id).run();
  const clips = await call('/clips'); assert.deepEqual((await clips.json()).items, []);
  await jsonError(await call('/assets/' + content.clip.video), 404, 'NOT_FOUND');
});

test('old UUID catalog and real game runtime address still dispatch separately; no new event writes', async () => {
  const response = await call('/api/music/catalog?locale=en'); assert.equal(response.status, 200, await response.clone().text());
  const old = await response.json(); assert.equal(old.tracks.length, 5); assert.equal(old.popularity.metric, 'qualified_play');
  const game = await call('/games/cat-life/', { enabled: false }); assert.equal(game.status, 200);
  assert.equal(await game.text(), 'STATIC_FIXTURE /games/cat-life/');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM station_analytics_events').first()).n, 0);
  assert.equal((await reader.prepare('SELECT count(*) AS n FROM reader_accounts').first()).n, 3);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM station_route_migrations").first()).n, 0);
});
