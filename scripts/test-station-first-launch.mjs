import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { firstLaunchAssets } from './build-station-first-launch.mjs';
import { migrationFlags } from '../src/redesign/routeMigrationPaths.js';
import { legacyContentClosed, closedLegacyCheckout } from '../src/redesign/legacyClosure.js';
import { firstLaunchHtmlAllowed, checkFirstLaunchScope } from './helpers/station-first-launch.mjs';
import { firstLaunchConfiguration } from './build-station-first-launch-config.mjs';
import { stationReleaseCandidate, releaseRoot } from './build-station-release-candidate.mjs';
import { musicProductionCandidate } from './build-music-production-candidate.mjs';
import { PRODUCTION_ACCOUNT_ID } from '../src/mobile/environment.js';
import { createStationRouteRuntime, routeFixtureCookie } from './helpers/station-route-runtime.mjs';
import { homeFixture } from './helpers/station-content-fixture.mjs';
import { assessFirstLaunchContent } from './verify-station-first-launch-content.mjs';

const scope = JSON.parse(await readFile(new URL('../ops/station-first-launch.json', import.meta.url)));
const enabled = { ...Object.fromEntries(migrationFlags.map(key => [key, 'true'])), STATION_LEGACY_CONTENT_CLOSED: 'true' };
const base = musicProductionCandidate(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'), {
  account_id: PRODUCTION_ACCOUNT_ID, compatibility_date: '2026-05-17',
  d1_databases: [{ binding: 'MUSIC_DB', database_name: 'station-cat-music-production', database_id: 'ca230000-0000-4000-8000-000000000001', migrations_dir: join(releaseRoot, 'migrations-music') }],
  r2_buckets: [{ binding: 'MUSIC_BUCKET', bucket_name: 'station-cat-music-production-private' }],
});
Object.assign(base.vars, { MUSIC_PUBLIC_ENABLED: 'true', MUSIC_VIP_DELIVERY_ENABLED: 'true' });

test('launch scope leaves music promotion, preview and video empty and never deletes stored business data', () => {
  assert.equal(checkFirstLaunchScope(scope), scope);
  for (const mutate of [s => s.music.featuredTrackId = 'a-song', s => s.music.previewEnabled = true,
    s => s.music.videoEnabled = true, s => s.legacy.deleteStoredData = true, s => s.game.slug = 'cat-life']) {
    const changed = structuredClone(scope); mutate(changed); assert.throws(() => checkFirstLaunchScope(changed));
  }
  assert.equal(legacyContentClosed(enabled), true);
  for (const flag of migrationFlags) assert.equal(legacyContentClosed({ ...enabled, [flag]: 'false' }), false);
  assert.equal(legacyContentClosed({ ...enabled, STATION_LEGACY_CONTENT_CLOSED: 'false' }), false);
});
test('new activation proposal preserves old bindings/vars and enables no independent publishing/media/analytics switch', () => {
  const original = structuredClone(base), config = firstLaunchConfiguration(base, scope);
  assert.deepEqual(base, original);
  const expected = stationReleaseCandidate(base);
  for (const key of migrationFlags) expected.vars[key] = 'true';
  expected.vars.STATION_LEGACY_CONTENT_CLOSED = 'true';
  expected.assets.directory = firstLaunchAssets;
  assert.deepEqual(config, expected);
  assert.equal(config.vars.MUSIC_PUBLIC_ENABLED, 'true'); assert.equal(config.vars.MUSIC_VIP_DELIVERY_ENABLED, 'true');
});
test('package allows only required templates, actual game, admin and account/legal surfaces', () => {
  for (const path of ['/music/site-shell/en/', '/music/site-shell/brand-home/ja/', '/member/site-shell/zh-Hant/',
    '/games/site-shell/en/', '/games/cat-life/', '/admin/music/', '/en/points/', '/zh-hant/privacy/',
    '/ja/404/']) assert.equal(firstLaunchHtmlAllowed(path), true, path);
  for (const path of ['/', '/en/', '/about/', '/music/', '/en/music/', '/novel/story/chapter/a/',
    '/works/story/', '/devlog/a/', '/signal/a/', '/apps/cat-life-game/', '/en/apps/caption-ai/',
    '/ja/apps/privatepinyin/download/', '/en/apps/caption-ai/terms/', '/android/', '/en/library/']) assert.equal(firstLaunchHtmlAllowed(path), false, path);
});
test('shared checkout retires all novel products but preserves general Station Points', () => {
  for (const type of ['chapter', 'bundle', 'supporter', 'tip', '', 'unknown']) assert.equal(closedLegacyCheckout(enabled, { orderType: type }), true);
  for (const type of ['credit-pack', 'credits', ' CREDITS ']) {
    assert.equal(closedLegacyCheckout(enabled, { orderType: type }), false);
    assert.equal(closedLegacyCheckout(enabled, { orderType: type, seriesSlug: 'old-story' }), true);
  }
  assert.equal(closedLegacyCheckout({}, { orderType: 'tip' }), false);
});

let runtime, ip = 1;
before(async () => { runtime = await createStationRouteRuntime({ bindings: enabled, assetsDirectory: firstLaunchAssets }); });
after(async () => { await runtime?.close(); });
const get = (path, options = {}) => runtime.mf.dispatchFetch('http://127.0.0.1' + path, {
  redirect: 'manual', ...options, headers: { 'CF-Connecting-IP': '192.0.2.' + (ip++ % 250 + 1), ...options.headers },
});
test('old chapters and aliases are gone for both guests and historical purchasers without redirecting to login', async () => {
  for (const prefix of ['', '/en']) for (const path of [prefix + '/novel/t20-history/chapter/chapter-one/', prefix + '/works/t20-history/chapter-one/']) {
    for (const cookie of ['', routeFixtureCookie(2)]) {
      const response = await get(path, { headers: { Cookie: cookie } });
      assert.equal(response.status, 410, path); assert.equal(response.headers.get('Location'), null);
      assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
      assert.doesNotMatch(await response.text(), /T20-PRESERVED-FREE-CHAPTER/);
    }
  }
  assert.equal((await get('/novel/t20-history/chapter/missing/')).status, 404);
});
test('old content APIs and unlocks cannot expose data or create purchases, including encoded aliases and HEAD', async () => {
  for (const path of ['/api/content/entries', '/api/content/body', '/api/content/media', '/api/novels/pricing',
    '/api/novels/access', '/api/novels/chapters/protected-content', '/api/novels/comments',
    '/api/novels/credits/unlock', '/api/novels/reading-events', '/api/readers/comments', '/api/%63ontent/body/']) {
    const response = await get(path, { method: 'POST', body: '{}', headers: { Cookie: routeFixtureCookie(2) } });
    assert.equal(response.status, 410, path); assert.equal((await response.json()).code, 'LEGACY_CONTENT_CLOSED');
    const head = await get(path, { method: 'HEAD' }); assert.equal(head.status, 410); assert.equal(await head.text(), '');
  }
  for (const orderType of ['tip', 'supporter', 'chapter', 'bundle']) {
    const response = await get('/api/novels/payments/checkout', { method: 'POST', body: JSON.stringify({ orderType, seriesSlug: 't20-history' }),
      headers: { 'Content-Type': 'application/json', Cookie: routeFixtureCookie(2) } });
    assert.equal(response.status, 410); assert.equal((await response.json()).code, 'LEGACY_CONTENT_CLOSED');
  }
});
test('old products, downloads and display entrances retire while general site policies and actual game keep their handlers', async () => {
  for (const path of ['/en/apps/privatepinyin/download/', '/apps/caption-ai/android/', '/downloads/nodepilot/old.pkg',
    '/android/', '/download/', '/devlog/t20-old-dynamic/', '/signal/t20-old-signal/', '/novel/t20-history/',
    '/en/apps/caption-ai/privacy/', '/en/apps/caption-ai/terms/', '/apps/privatepinyin/support/']) {
    const response = await get(path); assert.equal(response.status, 410, path); assert.equal(response.headers.get('Location'), null);
    await response.body?.cancel();
  }
  for (const path of ['/games/cat-life/', '/games/cat-life/src/js/main.js', '/en/privacy/', '/en/terms/']) {
    const response = await get(path); assert.equal(response.status, 200, path); await response.body?.cancel();
  }
});
test('partial activation hands old content back to its actual handler; closure never enables its own replacements', async () => {
  for (const flag of migrationFlags) {
    const response = await get('/api/novels/access?series=t20-history', { headers: { 'x-sc-fixture-mode': flag, Cookie: routeFixtureCookie(2) } });
    assert.notEqual(response.status, 410); await response.body?.cancel();
  }
});
test('account, historical order lookup, callbacks, native library and game saves are not retired or modified', async () => {
  for (const [path, options] of [
    ['/api/readers/session', {}], ['/api/novels/library', { headers: { Cookie: routeFixtureCookie(2) } }],
    ['/api/novels/payments/order?order=synthetic-missing', { headers: { Cookie: routeFixtureCookie(2) } }],
    ['/api/readers/game-saves/cat-life', { headers: { Cookie: routeFixtureCookie(2) } }],
    ['/api/mobile/v1/me/music/likes', {}], ['/.well-known/apple-app-site-association', {}],
    ['/api/novels/webhooks/nowpayments', { method: 'POST', body: '{}' }], ['/api/novels/webhooks/creem', { method: 'POST', body: '{}' }],
  ]) {
    const response = await get(path, options); assert.notEqual(response.status, 410, path); assert.notEqual(response.status, 500, path); await response.body?.cancel();
  }
  const saves = (await runtime.reader.prepare('SELECT account_id,game_key,save_json,save_hash,save_bytes,revision FROM reader_game_saves ORDER BY account_id').all()).results;
  const entitlements = (await runtime.reader.prepare('SELECT account_id,series_slug,scope,access_level FROM novel_entitlements ORDER BY id').all()).results;
  assert.deepEqual(saves, runtime.references.saves); assert.deepEqual(entitlements, runtime.references.entitlements);
  assert.equal((await runtime.reader.prepare('SELECT COUNT(*) AS n FROM novel_orders').first()).n, 0);
});
test('scope check rejects existing example publications and malformed or duplicated check rows', async () => {
  const sql = await readFile(new URL('../ops/station-first-launch-content-check.sql', import.meta.url), 'utf8');
  const rows = (await runtime.db.prepare(sql).all()).results;
  const result = assessFirstLaunchContent(rows); assert.equal(result.contentScopeMatches, false);
  assert.ok(result.failed.includes('published_tracks')); assert.ok(result.failed.includes('published_promotions'));
  assert.throws(() => assessFirstLaunchContent(rows.slice(1)));
  assert.throws(() => assessFirstLaunchContent([rows[0], rows[0]]));
});
test('actual pruned Assets and game-only local publications produce four language homes without music or media', async () => {
  // Disposable fixture state only; operational publications go through T16.
  await runtime.db.batch([
    runtime.db.prepare("UPDATE station_track_publications SET status='draft'"),
    runtime.db.prepare("UPDATE station_promotions SET status='draft'"),
    runtime.db.prepare("UPDATE station_clips SET status='draft'"),
  ]);
  await homeFixture(runtime.db, { game: runtime.content.game.id });
  const sql = await readFile(new URL('../ops/station-first-launch-content-check.sql', import.meta.url), 'utf8');
  const proof = assessFirstLaunchContent((await runtime.db.prepare(sql).all()).results);
  assert.equal(proof.contentScopeMatches, true); assert.equal(proof.rightsAndHttpVerified, false);
  for (const [prefix, locale] of [['', 'zh-Hant'], ['/en', 'en'], ['/ja', 'ja'], ['/zh-hans', 'zh-Hans']]) {
    const response = await get(prefix + '/'); assert.equal(response.status, 200);
    const body = await response.text(); assert.match(body, /data-home-game=/); assert.match(body, /games\/cat-life-game\//);
    assert.doesNotMatch(body, /data-home-track=|data-home-clip=|<audio\b|<video\b|<iframe\b|href="[^\"]*\/novel\//);
    const dto = await get('/api/station/content/home?locale=' + locale); assert.equal(dto.status, 200);
    const home = (await dto.json()).home; assert.equal(home.music, null); assert.equal(home.clips.length, 0); assert.equal(home.selectedTracks.length, 0);
    assert.ok(home.game.href.endsWith('/games/cat-life-game/'));
    const game = await get(prefix + '/games/cat-life-game/'); assert.equal(game.status, 200); await game.body?.cancel();
  }
  const guestMusic = await get('/api/station/content/tracks'); assert.equal(guestMusic.status, 200); assert.equal((await guestMusic.json()).items.length, 0);
  for (const path of ['/music/?collection=valid-legacy-album', '/en/music/?track=' + runtime.content.tracks[0].id,
    '/music/' + runtime.content.tracks[0].slug + '/']) {
    const retired = await get(path); assert.equal(retired.status, 410, path); await retired.body?.cancel();
  }
  const oldStaticFallback = await get('/en/apps/privatepinyin/', { headers: { 'x-sc-fixture-mode': 'closed' } });
  assert.equal(oldStaticFallback.status, 404); await oldStaticFallback.body?.cancel();
});
