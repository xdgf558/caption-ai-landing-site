import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';
import { base, publishTrack, promotionFixture, iso } from './helpers/station-content-fixture.mjs';
import { fixtureId } from './helpers/station-redesign-database.mjs';

let runtime;
before(async () => { runtime = await createStationMusicRuntime(); }, { timeout: 60000 });
after(async () => { await runtime?.close(); });
const call = (path, { prefix = '/fixture-pages-on', method = 'GET', account, headers = {}, origin = 'https://wwwstationcat.org' } = {}) =>
  runtime.mf.dispatchFetch(origin + prefix + path, { method, redirect: 'manual',
    headers: { 'CF-Connecting-IP': '192.0.2.91', ...(account ? { Cookie: 'station_cat_reader_session=fixture-session-' + account } : {}), ...headers } });
async function html(path, options) {
  const response = await call(path, options), text = await response.text();
  assert.equal(response.status, 200, text); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('x-robots-tag'), /noindex/); return text;
}
const model = text => JSON.parse(/<script id="sc-music-bootstrap" type="application\/json">([^]*?)<\/script>/.exec(text)[1]);

test('default production route is unchanged; internal templates cannot be requested directly, including aliases and encoded paths', async () => {
  const old = await call('/music/', { prefix: '' }); assert.equal(old.status, 200);
  const oldHtml = await old.text(); assert(!oldHtml.includes('sc-music-bootstrap'));
  for (const prefix of ['', '/fixture-content-only']) {
    for (const path of ['/music/tracks/vip/', '/en/music/tracks/not-mapped?token=fixture-secret']) {
      const off = await call(path, { prefix }); assert.equal(off.status, 404); assert.equal((await off.json()).error.code, 'NOT_FOUND');
      const head = await call(path, { prefix, method: 'HEAD' }); assert.equal(head.status, 404); assert.equal(await head.text(), '');
      const method = await call(path, { prefix, method: 'POST' }); assert.equal(method.status, 405); assert.equal((await method.json()).error.code, 'METHOD_NOT_ALLOWED');
    }
  }
  for (const path of ['/music/site-shell/en/', '/en/music/site-shell/en/', '/music/%73ite-shell/en/', '/music//site-shell/en/']) {
    const response = await call(path); assert.equal(response.status, 404, path); assert.equal(await response.text(), '');
  }
});

test('local metadata uses the actual loopback origin while public canonical and noindex remain controlled', async () => {
  for (const [origin, expected] of [['http://127.0.0.1:4208', 'http://127.0.0.1:4208'], ['http://localhost:4208', 'http://localhost:4208'],
    ['https://preview.example.test', 'https://wwwstationcat.org']]) {
    const text = await html('/en/music/tracks/vip/', { origin, headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' } });
    assert(text.includes('rel="canonical" href="' + expected + '/en/music/tracks/vip/"'));
    assert(text.includes('property="og:url" content="' + expected + '/en/music/tracks/vip/"'));
    assert(text.includes('hreflang="ja" href="' + expected + '/ja/music/tracks/vip/"'));
    assert.match(text, /name="robots" content="noindex,nofollow"/);
    assert(!text.includes('evil.example'));
  }
});

test('actual Astro shell receives server-rendered songs and bounded bootstrap; metadata and language links describe the real route', async () => {
  const text = await html('/en/music/'), value = model(text);
  assert.equal(value.items.length, 20); assert(value.nextCursor); assert.equal(value.featured.title, 'A Little Late to Say');
  assert.match(text, /<title>The music station \| Station Cat<\/title>/);
  assert.match(text, /rel="canonical" href="https:\/\/wwwstationcat.org\/en\/music\/"/);
  assert.match(text, /aria-current="page"[^>]*>Music/);
  assert.match(text, /<audio[^>]+preload="none"[^>]*><\/audio>/); assert(!/<audio[^>]+src=/.test(text));
  assert(!/<(?:video|iframe)\b/.test(text)); assert(!text.includes('object_key'));
  const detail = await html('/en/music/tracks/vip/'), detailValue = model(detail);
  assert.equal(detailValue.related.length, 3);
  assert.match(detail, /<h1 id="sc-song-title">A Little Late to Say<\/h1>/);
  assert.match(detail, /href="\/ja\/music\/tracks\/vip\/"[^>]*data-sc-language="ja"/);
  assert.match(detail, /rel="canonical" href="https:\/\/wwwstationcat.org\/en\/music\/tracks\/vip\/"/);
  assert(!detail.includes('site-shell/en')); assert(!detail.includes('isVip'));
});

test('HEAD/method/failure behavior is bounded and no missing binding or asset is provisioned', async () => {
  const head = await call('/music/tracks/vip/', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const method = await call('/music/', { method: 'POST' }); assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'GET, HEAD'); await method.text();
  for (const prefix of ['/fixture-pages-no-db', '/fixture-pages-no-assets']) {
    const response = await call('/music/', { prefix }); assert.equal(response.status, 503);
    const text = await response.text(); assert(!/SELECT|object_key|fixture-session/.test(text));
  }
  const empty = await runtime.mf.getD1Database('EMPTY_DB');
  assert.equal((await empty.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'station_%'").first()).n, 0);
});

test('roots and detail normalize aliases/slashes, remove credentials, preserve only single valid campaign values', async () => {
  const cases = [
    ['/en/music', '/en/music/'], ['/zh-hant/music/', '/music/'],
    ['/music/?sort=default&q=VIP&token=fixture-secret', '/music/?q=VIP'],
    ['/en/music/tracks/vip?token=fixture-secret&utm_source=launch&utm_campaign=a&utm_campaign=b', '/en/music/tracks/vip/?utm_source=launch'],
    ['/music/?q=one&q=two', null]
  ];
  for (const [path, expected] of cases) {
    const response = await call(path);
    assert.equal(response.status, expected ? 302 : 400, path);
    if (expected) assert.equal(response.headers.get('location'), expected);
    const text = await response.text(); assert(!text.includes('fixture-secret'));
  }
});

test('mapped old UUID and slug share destinations are temporary; collection, unknown UUID and unknown descendants retain the old handler', async () => {
  const vip = runtime.content.tracks[1];
  for (const [path, target] of [
    ['/music/?track=' + vip.id + '&token=fixture-secret&utm_source=clip', '/music/tracks/vip/?utm_source=clip'],
    ['/en/music/vip/', '/en/music/tracks/vip/']
  ]) {
    const response = await call(path); assert.equal(response.status, 302); assert.equal(response.headers.get('location'), target); await response.text();
  }
  for (const path of ['/music/?collection=old-album', '/music/?track=' + fixtureId(99999)]) {
    const text = await html(path); assert(!text.includes('sc-music-bootstrap'));
  }
  for (const path of ['/music/unknown-child/', '/en/music/old/deeper/', '/music/tracks/not-mapped/', '/en/music/tracks/not-mapped']) {
    const response = await call(path); assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
});

test('actual SQL finite paging and title/artist searches agree with SSR empty and long-title states', async () => {
  const first = model(await html('/music/'));
  const second = model(await html('/music/?cursor=' + first.nextCursor));
  assert.equal(second.items.length, 5); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.items, ...second.items].map(track => track.id)).size, 25);
  const searched = model(await html('/en/music/?q=Everyday&sort=release'));
  assert.equal(searched.items.length, 17); assert.equal(searched.featured, null);
  const empty = await html('/music/?q=no-such-song'); assert.equal(model(empty).items.length, 0); assert.match(empty, /清除搜尋/);
  const long = model(await html('/music/tracks/local-sample-18/')).track;
  assert(long.title.length > 40); assert.equal(long.preview, null); assert.equal(long.fullPlayback, null); assert.equal(long.platforms.length, 0);
});

test('real synthetic cover/audio bytes match sealed metadata, Range is correct, and promotion preview is an independent source', async () => {
  const vip = runtime.content.tracks[1], detail = model(await html('/music/tracks/vip/')).track;
  const cover = await call(detail.coverUrl), bytes = Buffer.from(await cover.arrayBuffer());
  assert.equal(bytes.length, runtime.content.mediaProof.coverBytes); assert.equal((await sharp(bytes).metadata()).format, 'webp');
  const asset = await runtime.db.prepare('SELECT * FROM music_assets WHERE id=?').bind(vip.preview).first();
  const preview = await call(base + '/tracks/vip/playback?variant=preview'); assert.equal(preview.status, 200);
  const playback = await preview.json(); assert.equal(playback.durationMs, runtime.content.mediaProof.previewMs);
  const audio = await call(playback.audioPath), sound = Buffer.from(await audio.arrayBuffer());
  assert.equal(sound.length, asset.byte_size); assert.equal(createHash('sha256').update(sound).digest('hex'), asset.sha256);
  const ranged = await call(playback.audioPath, { headers: { Range: 'bytes=0-9' } });
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 10);
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-9/' + sound.length);
  assert.notEqual(vip.preview, vip.audio); assert(runtime.content.mediaProof.audioIsSynthetic);
});

test('full playback hint is not an authorization; guest, ordinary account, expired member and active member still use old policy', async () => {
  const text = await html('/music/tracks/vip/'); assert.equal(model(text).track.fullPlayback.requiresAccessCheck, true);
  assert.match(text, /確認完整收聽權限/); assert.match(text, /完整播放前，需確認/); assert(!text.includes('已準備好，點擊播放'));
  const path = base + '/tracks/vip/playback?variant=full';
  for (const [account, status] of [[null, 401], [2, 403], [3, 403]]) {
    const response = await call(path, { account }); assert.equal(response.status, status); await response.json();
  }
  const full = await call(path, { account: 1 }); assert.equal(full.status, 200);
  assert.match(full.headers.get('vary'), /Cookie/); const handshake = await full.json();
  const resource = await call(handshake.audioPath, { account: 1 }); assert.equal(resource.status, 200); await resource.arrayBuffer();
  await runtime.reader.prepare('UPDATE reader_sessions SET revoked_at=? WHERE account_id=1').bind(iso(Date.now())).run();
  const revoked = await call(handshake.audioPath, { account: 1, method: 'HEAD', headers: { 'If-None-Match': '*' } });
  assert.equal(revoked.status, 401); assert.equal(await revoked.text(), '');
});

test('SSR title/story/bootstrap treat operator markup as text, not executable HTML', async () => {
  const track = runtime.content.tracks[0], attack = '</script><img src=x onerror=alert(1)>&';
  await publishTrack(runtime.db, track, { metadata_json: JSON.stringify({ originalLocale: 'en', title: { en: attack }, creatorName: 'Fixture', story: attack }) });
  const text = await html('/en/music/tracks/permanent-free/'), value = model(text);
  assert.equal(value.track.title, attack); assert.equal(value.track.story, attack);
  assert(!text.includes('<img src=x')); assert.match(text, /&lt;\/script&gt;&lt;img/);
  assert(!/<script>alert/.test(text));
});

test('preview-off, no-audio and revoked-rights states remove play/resource UI immediately; no new events or route migrations are written', async () => {
  const vip = runtime.content.tracks[1];
  await promotionFixture(runtime.db, vip, { preview: 0 });
  let text = await html('/music/tracks/vip/'); assert.equal(model(text).track.preview, null); assert(!text.includes('data-sc-preview='));
  await runtime.db.prepare("UPDATE station_asset_rights SET status='blocked' WHERE music_asset_id=?").bind(vip.cover).run();
  text = await html('/music/tracks/vip/'); assert.equal(model(text).track.coverUrl, null);
  const denied = await call(base + '/assets/' + vip.cover); assert.equal(denied.status, 404); await denied.text();
  assert.equal((await runtime.db.prepare('SELECT count(*) AS n FROM station_analytics_events').first()).n, 0);
  assert.equal((await runtime.db.prepare('SELECT count(*) AS n FROM station_route_migrations').first()).n, 0);
  assert.equal((await runtime.reader.prepare('SELECT count(*) AS n FROM reader_accounts').first()).n, 3);
  const before = await call('/games/cat-life/', { prefix: '' }), after = await call('/games/cat-life/');
  assert.equal(after.status, before.status); assert.equal(await after.text(), await before.text());
});
