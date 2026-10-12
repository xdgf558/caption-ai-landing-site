import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { catalogRows, catalogHasMore, listAssetState, adminImagePath, adminListImage, publicationFormReady } from '../src/scripts/stationWorkbenchState.js';
import { createContentAdminRuntime } from './helpers/station-content-admin-runtime.mjs';
import { insertFixture, fixtureId } from './helpers/station-redesign-database.mjs';
import { createHash } from 'node:crypto';

test('all-work pagination keeps per-model cursors and puts dormant legacy rows last', () => {
  const pages={tracks:{items:[{id:'old',status:'draft',legacyLifecycle:'archived'},{id:'song',status:'published'}],nextBefore:10},games:{items:[{id:'game',status:'published'}],nextBefore:null},clips:{items:[{id:'clip',status:'draft'}],nextBefore:20}};
  assert.deepEqual(catalogRows(pages).map(i=>[i.id,i.type]),[['song','tracks'],['game','games'],['clip','clips']]);
  assert.equal(catalogHasMore(pages),true);assert.equal(catalogHasMore(pages,'games'),false);assert.equal(catalogRows(pages,'clips').length,1);assert.equal(catalogRows(pages,'tracks').at(-1).id,'old');
});
test('technical metadata, revoked rights and missing selected assets cannot look approved', () => {
  const asset={id:fixtureId(1),state:'validated',rightsStatus:'approved'};
  assert.equal(listAssetState({assetDetails:[asset],expectedAssetCount:2}),'missing');
  assert.equal(listAssetState({assetDetails:[asset,{...asset,rightsStatus:'blocked'}],expectedAssetCount:2}),'blocked');
  assert.equal(listAssetState({assetDetails:[{...asset,rightsStatus:'pending'}],expectedAssetCount:1}),'pending');
  assert.equal(listAssetState({assetDetails:[asset],expectedAssetCount:1}),'approved');
  assert.equal(adminImagePath('tracks','../../private'),null);assert.equal(adminImagePath('games',asset.id),'/admin/api/music/site-content/assets/'+asset.id+'/image');
  assert.equal(adminListImage({imageId:asset.id,assetDetails:[{...asset,kind:'audio'}]},'tracks'),null);
  assert.equal(adminListImage({imageId:asset.id,assetDetails:[{...asset,kind:'cover'}]},'tracks'),'/admin/api/music/site-content/assets/'+asset.id+'/thumbnail');
  assert.equal(adminImagePath('tracks',asset.id),'/admin/api/music/assets/'+asset.id);
  assert.equal(adminListImage({imageId:'../invalid',assetDetails:[{id:'../invalid',kind:'cover',state:'validated'}]},'tracks'),null);
});
test('the editor keeps publication disabled for pending commands, dirty forms, wrong role and incomplete references', () => {
  const id=fixtureId(1),options={identity:{role:'publisher'},busy:false,pending:false,dirty:false,type:'tracks',assets:[{id,state:'validated',rightsStatus:'approved'}],current:{draft:{data:{coverAssetId:id}}}};
  assert.equal(publicationFormReady(options),true);
  for(const patch of [{dirty:true},{pending:true},{busy:true},{identity:{role:'editor'}},{assets:[]},{current:{draft:{data:{lyricsAssetId:id}}}}])assert.equal(publicationFormReady({...options,...patch}),false);
});
test('root and service boot cannot load the retired novel publishing workspace', async () => {
  const root=await readFile(new URL('../src/pages/admin-v2/index.astro',import.meta.url),'utf8'),service=await readFile(new URL('../src/pages/admin-v2/services/index.astro',import.meta.url),'utf8');
  assert.match(root,/StationAdminWorkbench/);assert.doesNotMatch(root,/loadEntries|novel\/|signal|BaseLayout/);
  const boot=service.slice(service.indexOf('const boot = async () =>'),service.indexOf('    boot();'));
  assert.doesNotMatch(boot,/loadEntries|loadSchema|loadPricingDefaults|loadRevisions|resetForm/);
  assert.match(service,/if \(!serviceTabs\.has\(name\)\) return/);
  for(const name of ['content','imports','signal','analytics','comments','feedback'])assert.match(service,new RegExp('data-admin-v2-tab="'+name+'" hidden inert'));
});
test('private image review requires genuine fixture Access, explicit admin flag and unchanged validated R2 identity', async t => {
  const f=await createContentAdminRuntime();t.after(()=>f.close());
  const owner=fixtureId(300),id=fixtureId(301),data=await readFile(new URL('../scripts/fixtures/station-redesign/assets/gentle-station/game-cover.webp',import.meta.url));
  await insertFixture(f.db,'station_games',{id:owner,slug:'image-review-test',runtime_key:'cat-life',created_at:Date.now(),updated_at:Date.now()});
  const key='station/media/game_screenshot/'+owner+'/'+id+'.webp',object=await f.bucket.put(key,data,{httpMetadata:{contentType:'image/webp'}});
  await insertFixture(f.db,'station_media_assets',{id,owner_game_id:owner,owner_clip_id:null,kind:'game_screenshot',state:'validated',object_key:key,content_type:'image/webp',byte_size:data.length,sha256:createHash('sha256').update(data).digest('hex'),etag:object.etag,width:1024,height:1024,created_at:Date.now()});
  const route='/admin/api/music/site-content/assets/'+id+'/image';
  const send=(path=route,options={})=>f.mf.dispatchFetch('http://content.local.test'+path,{...options,headers:{'Cf-Access-Jwt-Assertion':f.actorToken,'CF-Connecting-IP':'192.0.2.61',...options.headers}});
  assert.equal((await send(route,{headers:{'Cf-Access-Jwt-Assertion':'forged'}})).status,401);
  assert.equal((await send('/fixture-off'+route)).status,503);
  assert.equal((await send('/fixture-empty'+route)).status,503);
  const image=await send();assert.equal(image.status,200);assert.equal(image.headers.get('Cache-Control'),'private, no-store');assert.equal(image.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.deepEqual(Buffer.from(await image.arrayBuffer()),data);
  const head=await send(route,{method:'HEAD',headers:{Range:'bytes=0-9'}});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(head.headers.get('Accept-Ranges'),'none');
  const editor=await send('/fixture-editor'+route);assert.equal(editor.status,200);await editor.body.cancel(); // Existing admin editors may inspect pending rights privately.
  assert.equal((await send(route+'?unexpected=1')).status,400);
  assert.equal((await send(route,{method:'POST',headers:{Origin:'http://content.local.test','X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':crypto.randomUUID()},body:'{}'})).status,405);
  await f.bucket.put(key,Buffer.from('changed'),{httpMetadata:{contentType:'image/webp'}});
  assert.equal((await send()).status,409);
  const pendingId=fixtureId(302);await insertFixture(f.db,'station_media_assets',{id:pendingId,owner_game_id:owner,owner_clip_id:null,kind:'game_screenshot',state:'reserved',object_key:'station/media/game_screenshot/'+owner+'/'+pendingId+'.webp',content_type:'image/webp',created_at:Date.now()});assert.equal((await send('/admin/api/music/site-content/assets/'+pendingId+'/image')).status,404);
});
