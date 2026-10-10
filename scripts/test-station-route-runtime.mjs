import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createStationRouteRuntime, routeFixtureCookie } from './helpers/station-route-runtime.mjs';
import { homeFixture } from './helpers/station-content-fixture.mjs';
import { stationLegacyInventory } from '../src/generated/stationLegacyRouteInventory.js';
import { migrationServicePath, legacyFamily, publicSearchRoute } from '../src/redesign/routeMigrationPaths.js';
import { fixtureId, insertFixture } from './helpers/station-redesign-database.mjs';
let runtime, ip = 1;
before(async () => { runtime = await createStationRouteRuntime(); });
after(async () => { await runtime?.close(); });
const get = (path, { mode, cookie, ...options } = {}) => runtime.mf.dispatchFetch('http://127.0.0.1' + path, {
  redirect: 'manual', ...options, headers: { 'CF-Connecting-IP': '192.0.' + Math.floor(ip / 250) + '.' + (ip++ % 250 + 1),
    ...(mode ? { 'x-sc-fixture-mode': mode } : {}), ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
for (const [prefix, locale] of [['','zh-Hant'],['/en','en'],['/ja','ja'],['/zh-hans','zh-Hans']]) test(`${locale}: new home/about and music/game navigation use actual Worker + native Assets`, async () => {
  for (const path of [prefix+'/', prefix+'/about/', prefix+'/music/', prefix+'/games/']) {
    const response = await get(path); assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    const body = await response.text(); assert.match(body, new RegExp('lang="' + locale + '"')); assert.match(body, /data-sc-route-profile="brand"/);
    assert.match(body, new RegExp('rel="canonical" href="http://127.0.0.1' + path.replaceAll('/', '\\/') + '"'));
    assert.equal((body.match(/<link rel="alternate" hreflang=/g)||[]).length, 4);
    if (path.endsWith('/about/')) for (const [lang, href] of [['en','/en/about/'],['ja','/ja/about/'],['zh-Hans','/zh-hans/about/'],['zh-Hant','/about/']]) {
      const tag = [...body.matchAll(/<a\b[^>]*data-sc-language="[^"]+"[^>]*>/g)].find(match => match[0].includes('data-sc-language="'+lang+'"'))?.[0];
      assert.ok(tag?.includes('href="'+href+'"'),lang + ' corresponding about link');
    }
    assert.ok(body.includes('href="' + prefix + '/about/"')); assert.ok(!body.includes('href="/signal/"'));
    const head = await get(path,{method:'HEAD'}); assert.equal(head.status,200); assert.equal(await head.text(),'');
  }
});
test('all inventoried retired static introductions exit directly; policy/download exceptions stay services', async () => {
  for (const path of stationLegacyInventory.retiredStaticPaths) {
    if (migrationServicePath(path)) continue;
    const family = legacyFamily(path), response = await get(path);
    assert.equal(response.status, family.game ? 301 : 410, path);
    if (family.game) {
      const target = response.headers.get('Location'); assert.ok(!target.includes('/games/cat-life/'));
      const final = await get(target); assert.equal(final.status,200,target); await final.body?.cancel();
    } else {
      assert.equal(response.headers.get('Location'),null); assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
      assert.ok(!(await response.text()).includes('rel="canonical"'));
      const withoutSlash = await get(path.slice(0,-1),{method:'HEAD'}); assert.equal(withoutSlash.status,410,path); assert.equal(await withoutSlash.text(),'');
      const index = await get(path + 'index.html'); assert.equal(index.status,410,path); await index.body?.cancel();
    }
  }
});
test('dynamic retirees, missing paths and encoded descendants never become a soft 200 or unrelated redirect', async () => {
  for (const path of ['/devlog/t20-old-dynamic/','/en/devlog/t20-old-dynamic/', '/signal/t20-old-signal/card.svg','/novel/t20-history/','/works/t20-history/']) {
    const r=await get(path);assert.equal(r.status,410,path);await r.body?.cancel();
  }
  for (const path of ['/apps/never-existed/','/signal/no-such-content/','/novel/no-such-series/','/music/old/child/', '/en/music/missing/', '/music/tracks/does-not-exist/', '/games/not-published/', '/ja/novel/t20-history/chapter/chapter-one/']) {
    const r=await get(path);assert.equal(r.status,404,path);assert.equal(r.headers.get('Location'),null);await r.body?.cancel();
  }
  assert.equal((await get('/%73ignal/t20-old-signal/index.html')).status,410);
  assert.equal((await get('/signal/%2574est/')).status,400);
  assert.equal((await get('/devlog/t20-old-dynamic/',{mode:'missing-reader-db'})).status,503);
});
test('mapped UUID/slug shares reach the same published entity; unpublished mappings remain unavailable', async () => {
  const track=runtime.content.tracks[0];
  for (const path of ['/music/?track='+track.id, '/zh-hant/music?track='+track.id, '/music/'+track.slug+'/']) {
    const r=await get(path);assert.ok([301,302].includes(r.status));assert.equal(r.headers.get('Location'),'/music/tracks/'+track.slug+'/');
    const final=await get(r.headers.get('Location'));assert.equal(final.status,200);await final.body?.cancel();
  }
  const previous=await runtime.db.prepare('SELECT status FROM station_track_publications WHERE track_id=?').bind(track.id).first();
  await runtime.db.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").bind(track.id).run();
  try { assert.equal((await get('/music/?track='+track.id)).status,503); assert.equal((await get('/music/'+track.slug+'/')).status,503); }
  finally { await runtime.db.prepare('UPDATE station_track_publications SET status=? WHERE track_id=?').bind(previous.status,track.id).run(); }
  assert.equal((await get('/music/?track='+fixtureId(99999))).status,404);
  const clean=await get('/music/?track='+track.id+'&token=PRIVATE-QUERY');assert.equal(clean.headers.get('Location'),'/music/tracks/'+track.slug+'/');
  assert.equal((await get('/music/?track=bad')).status,400);
  const collection=await get('/music/?collection=valid-legacy-album');assert.equal(collection.status,200);
  const text=await collection.text();assert.ok(!text.includes('data-sc-music-page'));assert.ok(!text.includes('rel="alternate" hreflang='));
  const alias=await get('/en/music?collection=valid-legacy-album&token=PRIVATE');assert.equal(alias.status,301);assert.equal(alias.headers.get('Location'),'/en/music/?collection=valid-legacy-album');
});
test('novel bookmarks keep root/en addresses, require login and preserve old purchase checks', async () => {
  for(const prefix of ['', '/en']) {
    const chapter=prefix+'/novel/t20-history/chapter/chapter-one/';
    const guest=await get(chapter);assert.equal(guest.status,303);assert.ok(guest.headers.get('Location').includes('returnTo='+encodeURIComponent(chapter)));
    const signed=await get(chapter,{cookie:routeFixtureCookie(2)});assert.equal(signed.status,200);
    const html=await signed.text();assert.match(html,/T20-PRESERVED-FREE-CHAPTER/);assert.match(html,/noindex,nofollow/);
    assert.ok(!html.includes('href="'+prefix+'/novel/"'));assert.ok(!html.includes('rel="canonical"'));
    const alias=await get(prefix+'/works/t20-history/chapter-one/',{cookie:routeFixtureCookie(2)});assert.equal(alias.status,301);assert.equal(alias.headers.get('Location'),chapter);
    assert.equal((await get(chapter+'index.html',{cookie:routeFixtureCookie(2)})).status,301);
  }
  const response=await get('/api/novels/access?access=all&chapter=paid-chapter&series=t20-history',{cookie:routeFixtureCookie(2)});
  assert.equal(response.status,200);const access=await response.json();assert.equal(access.allowed,true);
  const guest=await get('/novel/t20-history/chapter/missing/');assert.equal(guest.status,404);
});
test('service methods, auth boundaries, AASA and runtime bytes remain owned by their original handlers', async () => {
  for (const [path,options] of [
    ['/api/readers/session',{}], ['/api/readers/membership',{}], ['/api/readers/game-saves/cat-life',{cookie:routeFixtureCookie(2)}],
    ['/api/mobile/v1/me/music/likes',{}], ['/.well-known/apple-app-site-association',{}], ['/admin/api/music/tracks',{}],
    ['/api/creem/webhook',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}}],
    ['/api/novels/access?access=all&series=t20-history',{cookie:routeFixtureCookie(2)}],
    ['/en/apps/privatepinyin/privacy/',{}],['/en/apps/privatepinyin/support/',{}],['/en/apps/caption-ai/android/',{}],
    ['/zh-hans/apps/simplecut-pro/download/',{}], ['/downloads/nodepilot/no-such-file.pkg',{}]
  ]) {
    const baseline=await get(path,{...options,mode:'closed'}), active=await get(path,options);
    assert.notEqual(baseline.status,500,path); assert.notEqual(active.status,500,path);
    assert.equal(active.status,baseline.status,path);assert.equal(active.headers.get('Location'),baseline.headers.get('Location'),path);
    if(!active.headers.get('content-type')?.includes('text/html')) {
      const stable = value => { if (value && typeof value === 'object') { delete value.requestId; delete value.serverNow; } return value; };
      assert.deepEqual(stable(await active.json().catch(()=>null)),stable(await baseline.json().catch(()=>null)),path);
    }
    else {const html=await active.text();await baseline.body?.cancel();assert.ok(!html.includes('href="/apps/"'));}
  }
  for(const path of ['/games/cat-life/','/games/cat-life/index.html','/games/cat-life/src/js/main.js','/games/cat-life/src/js/state/saveSystem.js','/games/cat-life/src/js/state/saveRecovery.js']) {
    const baseline=await get(path,{mode:'closed'}), active=await get(path);assert.equal(active.status,baseline.status,path);
    assert.notEqual(baseline.status,500,path);
    assert.equal(await active.text(),await baseline.text(),path);
  }
  const saved=(await runtime.reader.prepare('SELECT account_id,game_key,save_json,save_hash,save_bytes,revision FROM reader_game_saves ORDER BY account_id').all()).results;
  assert.deepEqual(saved,runtime.references.saves);
  const history=(await runtime.reader.prepare('SELECT account_id,series_slug,scope,access_level FROM novel_entitlements ORDER BY id').all()).results;
  assert.deepEqual(history,runtime.references.entitlements);
});
test('search sitemap enumerates every shard beyond the first page and excludes old/private/runtime routes', async () => {
  const index=await get('/sitemap.xml');assert.equal(index.status,200);const body=await index.text();assert.match(body,/<sitemapindex/);
  assert.ok(body.includes('tracks-2.xml'));assert.ok(body.includes('tracks-3.xml'));
  const locs=[...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>new URL(m[1].replaceAll('&amp;','&')));
  const urls=[];
  for(const loc of locs) {
    const r=await get(loc.pathname+loc.search);assert.equal(r.status,200);const text=await r.text();
    for(const match of text.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(new URL(match[1]).pathname);
    for(const match of text.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)) assert.ok(publicSearchRoute(new URL(match[2]).pathname));
  }
  assert.ok(urls.length>16+20*4);assert.equal(new Set(urls).size,urls.length);
  for(const path of urls) assert.ok(publicSearchRoute(path),path);
  for(const fragment of ['/apps/','/signal/','/novel/','/library/','/games/cat-life/','/site-shell/']) assert.ok(!urls.some(path=>path.includes(fragment)));
  const first=locs.find(loc=>loc.pathname==='/sitemaps/tracks-1.xml');
  const before=await get(first.pathname+first.search), oldXml=await before.text();
  const track=runtime.content.tracks[0];assert.ok(oldXml.includes('/'+track.slug+'/'));
  const state=await runtime.db.prepare('SELECT status FROM station_track_publications WHERE track_id=?').bind(track.id).first();
  await runtime.db.prepare("UPDATE station_track_publications SET status='archived' WHERE track_id=?").bind(track.id).run();
  try {const fresh=await get(first.pathname+first.search);assert.ok(!(await fresh.text()).includes('/'+track.slug+'/'));
    const remaining=[];for(const loc of locs.filter(loc=>/tracks-/.test(loc.pathname))){const r=await get(loc.pathname+loc.search);assert.equal(r.status,200);remaining.push(...[...(await r.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>new URL(m[1]).pathname));}
    assert.deepEqual(remaining.sort(),urls.filter(path=>path.includes('/music/tracks/')&&!path.includes('/'+track.slug+'/')).sort());}
  finally {await runtime.db.prepare('UPDATE station_track_publications SET status=? WHERE track_id=?').bind(state.status,track.id).run();}
  assert.equal((await get('/sitemaps/tracks-9999.xml')).status,404);
  assert.equal((await get('/sitemap.xml',{mode:'missing-music-db'})).status,503);
  assert.equal((await get('/sitemap.xml?at=9999999999999999')).status,400);
  const robots=await get('/robots.txt');assert.equal(await robots.text(),'User-agent: *\nDisallow: /\n');
});
test('index activation requires the production host; production sitemap/robots do not hide retirees from crawlers', async () => {
  const local=await get('/en/about/',{mode:'indexing'});assert.match(await local.text(),/noindex,nofollow/);
  const request=path=>runtime.mf.dispatchFetch('https://wwwstationcat.org'+path,{redirect:'manual',headers:{'x-sc-fixture-mode':'indexing','CF-Connecting-IP':'192.0.3.250'}});
  const about=await request('/en/about/');assert.equal(about.status,200);const html=await about.text();assert.match(html,/content="index,follow"/);assert.match(html,/canonical" href="https:\/\/wwwstationcat.org\/en\/about\//);
  const robots=await request('/robots.txt'), text=await robots.text();assert.ok(!text.includes('Disallow: /signal/'));assert.ok(text.includes('Sitemap: https://wwwstationcat.org/sitemap.xml'));
});
test('unpublished home stays empty, synthetic configuration remains explicit and resource failure fails closed', async () => {
  const head=await runtime.db.prepare('SELECT status,published_revision FROM station_home_configs').first();
  await runtime.db.prepare("UPDATE station_home_configs SET status='draft'").run();
  try {const response=await get('/');assert.equal(response.status,200);const html=await response.text();assert.match(html,/data-home-empty="music"/);assert.ok(!html.includes('data-home-track='));}
  finally {await runtime.db.prepare('UPDATE station_home_configs SET status=?,published_revision=?').bind(head.status,head.published_revision).run();}
  assert.equal((await get('/',{mode:'missing-music-db'})).status,503);
  assert.equal((await get('/',{mode:'missing-assets'})).status,503);
  for(const path of ['/','/sitemap.xml']) assert.equal((await get(path,{mode:'bad-rate-secret'})).status,503);
  for(const path of ['/music/site-shell/brand-home/en/','/music/site-shell/brand-about/en/']) assert.equal((await get(path,{mode:'closed'})).status,404);
  const old=await get('/apps/',{mode:'closed'});assert.equal(old.status,301);assert.equal(new URL(old.headers.get('Location'),'http://127.0.0.1').pathname,'/en/apps/');
});
