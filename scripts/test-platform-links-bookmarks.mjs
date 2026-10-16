import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionAssociation, productionAssociationPath } from '../src/mobile/productionAssociation.js';
import { platformAssociation, platformAppLinkProfile, platformAppID } from '../src/redesign/platformAssociation.js';
import { handleStationContent } from '../src/redesign/publicHttp.js';
import { contentFixture, now } from './helpers/station-content-fixture.mjs';

const origin = 'https://wwwstationcat.org';
const enabled = { STATION_PUBLIC_APP_LINKS_ENABLED: 'true', STATION_PUBLIC_APP_LINKS_PROFILE: platformAppLinkProfile, STATION_CONTENT_PUBLIC_ENABLED: 'true' };
const req = () => new Request(origin + productionAssociationPath);
const cases = JSON.parse(readFileSync(new URL('../tests/fixtures/platform-link-cases.json', import.meta.url))).cases;
// A contract checker, not an Apple CDN/system acceptance substitute.
function matches(pattern, value) { return new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$').test(value); }
function delivered(components, value) {
  const url = new URL(value);
  for (const rule of components) {
    if (rule['/'] && !matches(rule['/'], url.pathname)) continue;
    if (rule['#'] && !matches(rule['#'], url.hash.slice(1))) continue;
    if (rule['?'] && !Object.entries(rule['?']).every(([key, pattern]) => matches(pattern, url.searchParams.get(key) || ''))) continue;
    return !rule.exclude;
  }
  return false;
}
test('public app association is separate, closed by default, and never reads native bindings', async () => {
  for (const values of [{}, { ...enabled, STATION_CONTENT_PUBLIC_ENABLED: 'false' }, { ...enabled, STATION_PUBLIC_APP_LINKS_PROFILE: 'wrong' }]) {
    const response = platformAssociation(req(), values);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /2AM5S7BM2N/);
  }
  const env = new Proxy(enabled, { get(target, key) { if (/^(MOBILE|MUSIC|WAITLIST)/.test(key)) throw new Error('native binding read'); return target[key]; } });
  const response = await productionAssociation(req(), env);
  assert.equal(response.status, 200);
  const body = await response.json(); assert.deepEqual(Object.keys(body), ['applinks']);
  assert.deepEqual(body.applinks.details[0].appIDs, [platformAppID]);
  const components = body.applinks.details[0].components;
  for (const item of cases.filter(item => item.accepted)) assert(delivered(components, item.url), item.url);
  for (const path of ['/music/', '/music/tracks/', '/music/tracks/a/child/', '/music/tracks/a//', '/api/station/content/tracks/a', '/auth/mobile/callback', '/en/library/', '/music/tracks/a/#verse']) assert(!delivered(components, origin + path), path);
  for (const path of ['/music', '/en/music/']) assert(delivered(components, origin + path + '?track=11111111-1111-4111-8111-111111111111&utm_source=douyin'));
});
test('association denies aliases, query and writes; HEAD has no body', async () => {
  for (const url of ['https://stationcat.org' + productionAssociationPath, origin + productionAssociationPath + '?x=1']) assert.equal(platformAssociation(new Request(url), enabled).status, 404);
  assert.equal(platformAssociation(new Request(origin + productionAssociationPath, { method: 'POST' }), enabled).status, 405);
  const response = platformAssociation(new Request(origin + productionAssociationPath, { method: 'HEAD' }), enabled);
  assert.equal(response.status, 200); assert.equal(await response.text(), '');
});
test('bookmark projection authorizes only bounded private text, independent of audio and artwork', async () => {
  const f = await contentFixture();
  try {
    f.r2.state.failHead = true; // Metadata caching must not wait for artwork or touch audio.
    const call = (suffix, method = 'GET') => handleStationContent(new Request(origin + '/api/station/content/tracks/permanent-free/bookmark' + suffix,
      { method, headers: { 'CF-Connecting-IP': '192.0.2.61' } }), f.env, { clock: () => now });
    const response = await call('?locale=en'); assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('cache-control'), 'private, max-age=86400, must-revalidate');
    for (const header of ['CDN-Cache-Control','Cloudflare-CDN-Cache-Control']) assert.equal(response.headers.get(header), 'no-store');
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['bookmark','locale','schemaVersion']);
    assert.deepEqual(Object.keys(body.bookmark).sort(), ['artist','id','revision','slug','title']);
    assert.equal(body.bookmark.slug, 'permanent-free'); assert.equal(body.locale, 'en');
    assert.equal(f.r2.state.reads.length, 0);
    for (const query of ['?locale=en&locale=ja','?locale=en&url=x','?locale=unknown']) {
      const rejected = await call(query); assert.equal(rejected.status, 400); assert.match(rejected.headers.get('cache-control'), /no-store/);
    }
    assert.equal((await call('?locale=en', 'HEAD')).status, 200);
    await f.music.db.prepare("UPDATE station_track_publications SET status='archived' WHERE track_id=?").bind(body.bookmark.id).run();
    const removed = await call('?locale=en'); assert.equal(removed.status, 404); assert.match(removed.headers.get('cache-control'), /no-store/);
  } finally { f.close(); }
});
