import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdtemp, chmod, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createContentRollbackWorker, contentRollbackEnvironment } from '../src/redesign/contentRollback.js';
import { closedStationVariables } from './helpers/station-release-flags.mjs';
import { legacyContentClosed } from '../src/redesign/legacyClosure.js';
import { stationHref } from '../src/redesign/routes.js';
import { contentRollbackConfiguration, writeContentRollbackConfiguration } from './build-station-content-rollback-config.mjs';
import { stationReleaseCandidate, releaseRoot } from './build-station-release-candidate.mjs';
import { musicProductionCandidate } from './build-music-production-candidate.mjs';
import { PRODUCTION_ACCOUNT_ID } from '../src/mobile/environment.js';
import { createStationRouteRuntime, routeFixtureCookie } from './helpers/station-route-runtime.mjs';
import { firstLaunchAssets } from './build-station-first-launch.mjs';

const allOn = Object.fromEntries(Object.keys(closedStationVariables).map(key => [key, 'true']));
const request = (path, options = {}) => new Request('https://wwwstationcat.org' + path, options);
test('rollback stays closed under every incoming page flag and neither queries bindings nor modifies the deployment environment', async () => {
  const calls = [], db = { prepare() { throw new Error('must not query'); } }, source = { ...allOn, MUSIC_DB: db, WAITLIST_DB: db,
    ASSETS: { async fetch() { return new Response('<html data-station-maintenance></html>', { headers: { 'Content-Type': 'text/html' } }); } } };
  const worker = createContentRollbackWorker({ fetch(...args) { calls.push(args); return new Response(null, { status: 418 }); } });
  for (const [path,status] of [['/novel/a/chapter/b/',410],['/api/content/body',410],['/api/%63ontent/body/',410],
    ['/en/apps/caption-ai/download/',410],['/downloads/old.bin',410],['/music/?collection=old',410],
    ['/en/music/old-child/',410],['/',503],['/en/music/tracks/new/',503],['/games/cat-life-game/',503],
    ['/api/station/content/home',503],['/music/site-shell/brand-maintenance/en/',404]]) {
    const response = await worker.fetch(request(path), source, {}); assert.equal(response.status,status,path);
    assert.equal(response.headers.get('Cache-Control'),'private, no-store'); await response.body?.cancel();
  }
  assert.equal(calls.length,0); assert.equal(source.STATION_CONTENT_PUBLIC_ENABLED,'true');
  const local = contentRollbackEnvironment(source); assert.equal(local.MUSIC_DB,db);
  for (const key of Object.keys(closedStationVariables)) if (key !== 'STATION_LEGACY_CONTENT_CLOSED') assert.equal(local[key],'false');
});
test('delegation preserves request credentials, method, bindings and original status; closure is not a permission grant', async () => {
  const cases = [], worker = createContentRollbackWorker({ fetch(req,env) { cases.push({req,env}); return new Response(null,{status:401}); } });
  const env = { ...allOn, oldSetting: 'fixture' };
  for (const path of ['/api/readers/session','/api/mobile/v1/me/music/likes','/api/readers/game-saves/cat-life',
    '/api/novels/webhooks/creem','/api/novels/payments/order','/games/cat-life/src/js/main.js','/.well-known/apple-app-site-association','/admin/api/music/tracks']) {
    const req=request(path,{method:'POST',headers:{Cookie:'fixture-account'},body:'{}'});
    assert.equal((await worker.fetch(req,env,{})).status,401); assert.equal(cases.at(-1).req,req);
    assert.equal(cases.at(-1).env.oldSetting,'fixture');
  }
});
test('rollback closes novel checkout while general points still receive the existing checkout authentication and validation', async () => {
  let delegated=0;
  const worker=createContentRollbackWorker({async fetch(req){delegated++; assert.equal((await req.json()).orderType,'credits');return new Response(null,{status:401});}});
  for(const payload of [{orderType:'tip'},{orderType:'chapter'},{orderType:'credits',seriesSlug:'old-story'}]) {
    const response=await worker.fetch(request('/api/novels/payments/checkout',{method:'POST',body:JSON.stringify(payload)}),{},{});
    assert.equal(response.status,410);
  }
  assert.equal(delegated,0);
  assert.equal((await worker.fetch(request('/api/novels/payments/checkout',{method:'POST',body:'{"orderType":"credits"}'}),{},{})).status,401);
  assert.equal(delegated,1);
});
test('scheduled rollback skips new Signal collection and independent Station work; existing queues are delegated', async () => {
  const calls=[], worker=createContentRollbackWorker({scheduled(controller,env){calls.push(env);},queue(batch,env){calls.push(env);}});
  await worker.scheduled({},allOn,{}); assert.equal(legacyContentClosed(calls[0]),true);
  for(const key of ['STATION_EVENTS_ENABLED','STATION_EVENTS_RETENTION_ENABLED','STATION_REPORTS_ENABLED','STATION_CONTENT_SCHEDULES_ENABLED']) assert.equal(calls[0][key],'false');
  await worker.queue({},allOn,{}); assert.equal(calls[1].STATION_CONTENT_PUBLIC_ENABLED,'false');
});
test('private rollback configuration fixes the dedicated entry and pruned assets while preserving business bindings', async () => {
  const base = musicProductionCandidate(await readFile(new URL('../wrangler.toml',import.meta.url),'utf8'), {
    account_id: PRODUCTION_ACCOUNT_ID, compatibility_date:'2026-05-17',
    d1_databases:[{binding:'MUSIC_DB',database_name:'station-cat-music-production',database_id:'ca230000-0000-4000-8000-000000000001',migrations_dir:join(releaseRoot,'migrations-music')}],
    r2_buckets:[{binding:'MUSIC_BUCKET',bucket_name:'station-cat-music-production-private'}],
  });
  const before=structuredClone(base), candidate=contentRollbackConfiguration(base), expected=stationReleaseCandidate(base);
  expected.main=join(releaseRoot,'src/stationContentRollback.js'); expected.assets.directory=firstLaunchAssets;
  expected.vars.STATION_LEGACY_CONTENT_CLOSED='true';
  assert.deepEqual(candidate,expected); assert.deepEqual(base,before); assert.equal(candidate.assets.run_worker_first,true);
});
test('rollback file writer requires private paths and exact input hash and refuses overwrite or output symlinks', async t => {
  const directory=await mkdtemp(join(tmpdir(),'station-l02-config-'));await chmod(directory,0o700);
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const base=musicProductionCandidate(await readFile(new URL('../wrangler.toml',import.meta.url),'utf8'),{
    account_id:PRODUCTION_ACCOUNT_ID,compatibility_date:'2026-05-17',
    d1_databases:[{binding:'MUSIC_DB',database_name:'station-cat-music-production',database_id:'ca230000-0000-4000-8000-000000000001',migrations_dir:join(releaseRoot,'migrations-music')}],
    r2_buckets:[{binding:'MUSIC_BUCKET',bucket_name:'station-cat-music-production-private'}],
  });
  const source=JSON.stringify(base),input=join(directory,'baseline.json'),output=join(directory,'rollback.json');
  await writeFile(input,source,{mode:0o600});const hash=createHash('sha256').update(source).digest('hex');
  await assert.rejects(writeContentRollbackConfiguration(input,'0'.repeat(64),output),/STATION_ROLLBACK_BASE_HASH/);
  const result=await writeContentRollbackConfiguration(input,hash,output);
  assert.equal(result.deployed,false);assert.equal(result.productionVerified,false);assert.equal((await stat(output)).mode&0o777,0o600);
  await assert.rejects(writeContentRollbackConfiguration(input,hash,output),/EEXIST/);
  const linked=join(directory,'linked.json');await symlink(output,linked);
  await assert.rejects(writeContentRollbackConfiguration(input,hash,linked),/EEXIST/);
  await chmod(input,0o644);await assert.rejects(writeContentRollbackConfiguration(input,hash,join(directory,'unsafe.json')),/STATION_BACKUP_PRIVATE_FILE/);
});

let runtime, ip=1;
before(async()=>{runtime=await createStationRouteRuntime({assetsDirectory:firstLaunchAssets,
  entrypoint:fileURLToPath(new URL('../src/stationContentRollback.js',import.meta.url)),bindings:allOn});});
after(async()=>{await runtime?.close();});
const get=(path,options={})=>runtime.mf.dispatchFetch('https://wwwstationcat.org'+path,{redirect:'manual',...options,
  headers:{'CF-Connecting-IP':'192.0.2.'+(ip++%250+1),...options.headers}});
test('real pruned Assets serve four branded maintenance states and reachable member forms without public station queries',async()=>{
  for(const [prefix,locale] of [['','zh-Hant'],['/en','en'],['/ja','ja'],['/zh-hans','zh-Hans']]){
    const response=await get(prefix+'/'); assert.equal(response.status,503); const html=await response.text();
    assert.match(html,/data-station-maintenance/); assert.match(html,/href="\/games\/cat-life\/"/);
    assert.doesNotMatch(html,/<audio\b|<video\b|<iframe\b|data-home-track=/);
    const member=await get(stationHref(locale,'member')); assert.equal(member.status,200); const body=await member.text();
    assert.match(body,/id="reader-login-form"/); assert.match(body,/data-sc-member-services/);
    assert.match(body,/href="\/games\/cat-life\/"/);
  }
  const head=await get('/en/',{method:'HEAD'}); assert.equal(head.status,503); assert.equal(await head.text(),'');
  assert.equal((await get('/',{method:'POST'})).status,405);
  assert.equal((await get('/music/site-shell/brand-maintenance/en/')).status,404);
});
test('actual rollback keeps existing game framing and save writes and retains orders, credits, accounts and historical entitlements',async()=>{
  const runtimePage=await get('/games/cat-life/?sc_entry=1&sc_launch_id=ff000000-0000-4000-8000-000000000001');
  assert.equal(runtimePage.status,200); assert.equal(runtimePage.headers.get('X-Frame-Options'),'DENY'); await runtimePage.body.cancel();
  const asset=await get('/games/cat-life/src/js/main.js'); assert.equal(asset.status,200); await asset.body.cancel();
  await runtime.reader.prepare("INSERT INTO novel_orders(order_token,account_id,provider,order_type,price_amount,status) VALUES('l02-synthetic-order',2,'creem','credit_pack','10.00','finished')").run();
  const original=await runtime.reader.prepare('SELECT * FROM novel_orders ORDER BY id').all();
  const saveData={version:'1.28.0',schemaVersion:3,meta:{createdAt:new Date().toISOString(),lastSavedAt:new Date().toISOString()},
    player:{gold:187,energy:80},cats:[{id:'l02-synthetic-cat',name:'Fixture',careStatus:'sheltered',intimacy:61}],inventory:{food:2},settings:{language:'en'}};
  const saved=await get('/api/readers/game-saves/cat-life',{method:'PUT',headers:{Cookie:routeFixtureCookie(2),Origin:'https://wwwstationcat.org','Content-Type':'application/json'},
    body:JSON.stringify({baseRevision:4,saveData})}); assert.equal(saved.status,200); await saved.body.cancel();
  const cloud=await get('/api/readers/game-saves/cat-life',{headers:{Cookie:routeFixtureCookie(2)}}); assert.equal(cloud.status,200); await cloud.body.cancel();
  assert.equal((await runtime.reader.prepare('SELECT revision FROM reader_game_saves WHERE account_id=2').first()).revision,5);
  for(const path of ['/api/readers/session','/api/novels/library','/api/novels/payments/order?order=l02-synthetic-order',
    '/api/mobile/v1/me/music/likes','/api/music/me/capabilities?locale=en','/.well-known/apple-app-site-association']) {
    const response=await get(path,{headers:{Cookie:routeFixtureCookie(2)}}); assert.notEqual(response.status,410,path); assert.notEqual(response.status,500,path); await response.body?.cancel();
  }
  assert.deepEqual((await runtime.reader.prepare('SELECT * FROM novel_orders ORDER BY id').all()).results,original.results);
  assert.deepEqual((await runtime.reader.prepare('SELECT account_id,series_slug,scope,access_level FROM novel_entitlements ORDER BY id').all()).results,runtime.references.entitlements);
  assert.equal((await runtime.reader.prepare('SELECT COUNT(*) n FROM reader_accounts').first()).n,3);
});
test('real retired APIs and all legacy namespaces stay closed for signed-in historical purchasers',async()=>{
  for(const path of ['/novel/t20-history/chapter/chapter-one/','/works/t20-history/chapter-one/','/api/content/body',
    '/api/novels/credits/unlock','/en/apps/caption-ai/privacy/','/downloads/anything','/music/?collection=legacy']){
    const response=await get(path,{headers:{Cookie:routeFixtureCookie(2)}}); assert.equal(response.status,410,path); assert.equal(response.headers.get('Location'),null); await response.body?.cancel();
  }
  const robots=await get('/robots.txt'); assert.equal(await robots.text(),'User-agent: *\nDisallow: /\n');
  assert.equal((await get('/sitemap.xml')).status,404);
  for(const path of ['/api/novels/webhooks/nowpayments','/api/novels/webhooks/creem']){
    const response=await get(path,{method:'POST',body:'{}'}); assert.notEqual(response.status,410); await response.body?.cancel();
  }
});
