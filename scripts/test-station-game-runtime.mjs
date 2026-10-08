import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';
let runtime, ip = 1;
before(async () => { runtime = await createStationMusicRuntime({ gameCases: true }); });
after(async () => { await runtime?.close(); });
const get = (path, options = {}) => runtime.mf.dispatchFetch('http://127.0.0.1' + path, { redirect: 'manual', headers: { 'CF-Connecting-IP': '192.0.2.' + ip++ }, ...options });
for (const [prefix, locale] of [['', 'zh-Hant'], ['/zh-hans', 'zh-Hans'], ['/en', 'en'], ['/ja', 'ja']]) test(`${locale}: actual Worker/D1/R2 renders catalog, intro, language links and original runtime`, async () => {
  const catalog = await get('/fixture-pages-on' + prefix + '/games/'); assert.equal(catalog.status, 200); const html = await catalog.text();
  assert.match(html, new RegExp('lang="' + locale + '"')); assert.ok(html.includes('data-sc-game-page')); assert.ok(html.includes(prefix + '/games/cat-life-game/'));
  assert.equal(catalog.headers.get('X-Robots-Tag'), 'noindex, nofollow'); assert.equal(catalog.headers.get('Cache-Control'), 'private, no-store');
  const detail = await get('/fixture-pages-on' + prefix + '/games/cat-life-game/'); assert.equal(detail.status, 200); const body = await detail.text();
  assert.ok(body.includes('data-sc-game-launch hidden')); assert.ok(body.includes('http://127.0.0.1' + prefix + '/games/cat-life-game/'));
  for (const lang of ['', '/zh-hans', '/en', '/ja']) assert.ok(body.includes('href="' + lang + '/games/cat-life-game/"'));
  const old = await get('/fixture-pages-on/games/cat-life/?lang=en'); assert.equal(old.status, 200); assert.ok((await old.text()).includes('src/js/main.js'));
  const head = await get('/fixture-pages-on' + prefix + '/games/cat-life-game/', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
test('half-enabled rollout does not own new game paths; registered runtime remains reachable under every mode', async () => {
  for (const mode of ['pages-only', 'content-only']) {
    for (const path of ['/games/', '/games/cat-life-game/']) { const response = await get('/fixture-' + mode + path); assert.equal(response.status, 404); assert.ok(!(await response.text()).includes('data-sc-game-entry')); }
    assert.equal((await get('/fixture-' + mode + '/games/cat-life/')).status, 200);
  }
  assert.equal((await get('/games/cat-life/')).status, 200);
});
test('canonical alias/no-slash redirects, unmapped detail and method/query errors', async () => {
  const alias = await get('/fixture-pages-on/zh-hant/games/cat-life-game'); assert.equal(alias.status, 302); assert.equal(alias.headers.get('Location'), '/games/cat-life-game/');
  const unknown = await get('/fixture-pages-on/games/missing/'); assert.equal(unknown.status, 404);
  assert.equal((await get('/fixture-pages-on/games/', { method: 'POST' })).status, 405);
  assert.equal((await get('/fixture-pages-on/games/?cursor=a&cursor=b')).status, 400);
  assert.equal((await get('/fixture-pages-no-db/games/')).status, 503);
  assert.equal((await get('/fixture-pages-no-assets/games/')).status, 503);
  assert.equal((await get('/fixture-pages-on/games/site-shell/en/')).status, 404);
});
test('screenshots are actual prior runtime capture bytes and go through controlled assets with revocation', async () => {
  const response = await get('/fixture-pages-on/api/station/content/games/cat-life-game?locale=en'); assert.equal(response.status, 200);
  const { game } = await response.json(), path = game.screenshots[0].url;
  const asset = await get('/fixture-pages-on' + path); assert.equal(asset.status, 200);
  const { createHash } = await import('node:crypto'); assert.equal(createHash('sha256').update(new Uint8Array(await asset.arrayBuffer())).digest('hex'), runtime.gameScenarios.screenshotSha256);
  const row = await runtime.db.prepare('SELECT object_key FROM station_media_assets WHERE id=?').bind(runtime.content.game.screenshot).first();
  await runtime.bucket.delete(row.object_key);
  const revoked = await get('/fixture-pages-on' + path); assert.equal(revoked.status, 404);
  const detail = await get('/fixture-pages-on/games/cat-life-game/'); assert.equal(detail.status, 200); assert.ok(!(await detail.text()).includes('src="' + path + '"'));
});
