import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleStationGamePage, stationGameRoute } from '../src/redesign/gamePages.js';
import { renderGamePage } from '../src/redesign/gameRender.js';
const locales = [['', 'zh-Hant'], ['/zh-hans', 'zh-Hans'], ['/en', 'en'], ['/ja', 'ja']];
for (const [prefix, locale] of locales) test(`${locale}: canonical catalog, safe detail and reserved runtime`, async () => {
  assert.equal(stationGameRoute(prefix + '/games/').locale, locale);
  assert.equal(stationGameRoute(prefix + '/games/cat-life-game/').kind, 'detail');
  for (const path of ['/games/cat-life', '/games/cat-life/', '/games/cat-life/src/js/main.js', prefix + '/games/cat-life/']) assert.equal(stationGameRoute(path), null);
  const env = { STATION_GAME_PAGES_ENABLED: 'true', STATION_CONTENT_PUBLIC_ENABLED: 'true', get MUSIC_DB() { throw new Error('Runtime must bypass DB'); } };
  assert.equal(await handleStationGamePage(new Request('https://wwwstationcat.org/games/cat-life/'), env), null);
});
for (const flags of [{}, { STATION_GAME_PAGES_ENABLED: 'true' }, { STATION_CONTENT_PUBLIC_ENABLED: 'true' }, { STATION_GAME_PAGES_ENABLED: 'true', STATION_CONTENT_PUBLIC_ENABLED: 'false' }]) test(`closed page ownership before method, query and binding: ${JSON.stringify(flags)}`, async () => {
  const env = { ...flags, get MUSIC_DB() { throw new Error('Unexpected DB read'); }, get ASSETS() { throw new Error('Unexpected asset read'); } };
  for (const [prefix] of locales) for (const method of ['GET', 'HEAD', 'POST']) for (const path of ['/games/', '/games/cat-life-game/', '/games/unknown/']) assert.equal(await handleStationGamePage(new Request('https://wwwstationcat.org' + prefix + path + '?cursor=!&cursor=!', { method }), env), null);
});
test('internal shells are never directly published and unknown descendants remain with existing handler', async () => {
  assert.equal((await handleStationGamePage(new Request('https://wwwstationcat.org/games/site-shell/en/'), {})).status, 404);
  assert.equal(await handleStationGamePage(new Request('https://wwwstationcat.org/games/old/deeper/'), { STATION_GAME_PAGES_ENABLED: true, STATION_CONTENT_PUBLIC_ENABLED: true }), null);
});
test('rendered DTO is escaped, has no unconfirmed continue button and unregistered launch paths cannot navigate', () => {
  const game = { title: '<script>unsafe</script>', summary: 'daily', href: '/games/example/', screenshots: [], supportedDevices: ['desktop', 'Tablet browser'], launchPath: '/games/arbitrary/' };
  const html = renderGamePage({ mode: 'detail', locale: 'en', game });
  assert.ok(html.includes('Tablet browser')); assert.ok(html.includes('Game screenshots are not available yet.'));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>unsafe')); assert.ok(!html.includes('data-sc-game-launch'));
  game.launchPath = '/games/cat-life/'; const registered = renderGamePage({ mode: 'detail', locale: 'en', game });
  assert.match(registered, /data-sc-game-launch hidden/); assert.ok(!registered.includes('Continue game'));
});
