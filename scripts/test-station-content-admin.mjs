import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { contentAdminFixture } from './helpers/station-content-admin-fixture.mjs';
import { homeId, insertFixture } from './helpers/station-redesign-database.mjs';
import { createContentObject, saveContentObject, contentPublication, saveContentPlatform, saveContentRights, contentPreflight } from '../src/redesign/contentAdmin.js';
import { readContentObject, contentAdminReadiness, listContentObjects, contentAssets } from '../src/redesign/contentAdminStore.js';
import { runStationContentSchedule } from '../src/redesign/contentSchedule.js';
import { handleStationContent } from '../src/redesign/publicHttp.js';
import { handleMusicAdmin } from '../src/music/adminHttp.js';

const fixtures=[];afterEach(()=>{for(const f of fixtures.splice(0))f.sql.close();});
const actor='content-admin@example.test',editor='content-editor@example.test',ctx=(version=1,extra={})=>({actorId:actor,key:randomUUID(),ifMatch:`"edit-${version}"`,...extra});
async function fixture(options){const f=await contentAdminFixture(options);fixtures.push(f);return f;}
const website=t=>({metadata:t.metadata,siteAudioMode:'none',legacyRevisionId:null,durationMs:120000,coverAssetId:t.cover,lyricsAssetId:null});
async function register(f,index=0){const t=f.tracks[index];await createContentObject(f.runtime,'tracks',{trackId:t.id,data:website(t),reason:'隔离测试登记'},ctx());return t;}
async function rights(f,t,kind='cover'){return saveContentRights(f.runtime,t[kind],{scope:kind,status:'approved',basis:'合成夹具授权记录，不代表真实素材权利',reason:'隔离测试'},ctx());}
async function publish(f,t){await rights(f,t);return contentPublication(f.runtime,'tracks',t.id,'publish',{revision:1,reason:'隔离测试发布'},ctx());}
const env=f=>({MUSIC_DB:f.db,MUSIC_BUCKET:f.bucket,MUSIC_RATE_LIMIT_SECRET:'isolated-content-rate-limit-only',STATION_CONTENT_ADMIN_ENABLED:'true',STATION_CONTENT_PUBLIC_ENABLED:'true',STATION_CONTENT_SCHEDULES_ENABLED:'true',ADMIN_ALLOWED_EMAILS:actor+','+editor,STATION_CONTENT_EDITOR_EMAILS:editor,CF_ACCESS_TEAM_DOMAIN:'https://content-fixture.cloudflareaccess.com',CF_ACCESS_AUD:'fixture-only'});
async function publicGet(f,path){const response=await handleStationContent(new Request('https://content.local.test/api/station/content/'+path,{headers:{'CF-Connecting-IP':'192.0.2.77'}}),env(f));return {response,data:await response.json()};}
const edit=(type,id,method,body,v=1,key=randomUUID())=>new Request('https://content.local.test/admin/api/music/site-content/'+type+(id?'/'+id:''),{method,headers:{Origin:'https://content.local.test','X-Requested-With':'StationCatMusicAdmin','Content-Type':'application/json','If-Match':`"edit-${v}"`,'Idempotency-Key':key},body:JSON.stringify(body)});

test('0014 ledger and actual schema are required; missing schema does not backfill or write',async()=>{
 const f=await fixture({migrated:false}),before=f.dump();await assert.rejects(contentAdminReadiness(env(f)),{code:'STATION_CONTENT_SCHEMA_UNAVAILABLE'});assert.deepEqual(f.dump(),before);
});
test('default-off content namespace checks the flag before bindings after admin authorization',async()=>{
 let reads=0;const db={withSession(){reads++;throw new Error('closed');}};
 const r=await handleMusicAdmin(edit('tracks',null,'POST',{bad:true}),{MUSIC_DB:db,MUSIC_BUCKET:{}},async()=>actor);
 assert.equal(r.status,503);assert.equal((await r.json()).code,'STATION_CONTENT_ADMIN_DISABLED');assert.equal(reads,0);
});
test('website registration never publishes, changes old policies or generates promotions',async()=>{
 const f=await fixture(),old=f.sql.prepare('SELECT * FROM music_tracks ORDER BY id').all(),t=await register(f);
 assert.deepEqual(f.sql.prepare('SELECT * FROM music_tracks ORDER BY id').all(),old);assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM station_promotions').get().n,0);
 assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,404);
 assert.equal((await readContentObject(f.db,'tracks',t.id)).draft.data.siteAudioMode,'none');
});
test('new website song keeps the original music workspace editable without granting full audio',async()=>{
 const f=await fixture(),r=await createContentObject(f.runtime,'tracks',{slug:'new-isolated-song',data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'本机新作品'},creatorName:'测试作者'},siteAudioMode:'none'},reason:'测试新建'},ctx());
 const t=f.sql.prepare('SELECT * FROM music_tracks WHERE id=?').get(r.id);assert.equal(t.lifecycle,'draft');assert.ok(t.draft_revision_id);assert.equal(t.published_revision_id,null);
 assert.equal(f.sql.prepare('SELECT audio_asset_id FROM music_track_revisions WHERE id=?').get(t.draft_revision_id).audio_asset_id,null);
});
test('unready or unapproved cover blocks publication with a concrete field, then old operation replays once',async()=>{
 const f=await fixture(),t=await register(f);await assert.rejects(contentPublication(f.runtime,'tracks',t.id,'publish',{revision:1,reason:'测试'},ctx()),{code:'STATION_ASSET_RIGHTS_REQUIRED',field:'track.coverAssetId'});
 await rights(f,t);const c=ctx(),body={revision:1,reason:'测试'};f.sqlState.lose=true;
 const first=await contentPublication(f.runtime,'tracks',t.id,'publish',body,c),again=await contentPublication(f.runtime,'tracks',t.id,'publish',body,c);assert.equal(first.revision,again.revision);assert.equal(again.replayed,true);
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM music_admin_audit_logs WHERE action='station.content.publish'").get().n,1);
 assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,200);
});
test('concurrent saves accept one revision and leave the published version untouched',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);
 const data=website(t),results=await Promise.allSettled([saveContentObject(f.runtime,'tracks',t.id,{revision:1,data,reason:'编辑甲'},ctx(2)),saveContentObject(f.runtime,'tracks',t.id,{revision:1,data,reason:'编辑乙'},ctx(2))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'STATION_EDIT_CONFLICT');
 const view=await readContentObject(f.db,'tracks',t.id);assert.equal(view.published.revision,1);assert.equal(view.draft.revision,2);
});
test('a concurrent rights block invalidates the final publication batch and does not seal its draft',async()=>{
 const f=await fixture(),t=await register(f);await rights(f,t);
 f.sqlState.beforeWrite=()=>f.sql.prepare("UPDATE station_asset_rights SET status='blocked',edit_version=edit_version+1 WHERE music_asset_id=?").run(t.cover);
 await assert.rejects(contentPublication(f.runtime,'tracks',t.id,'publish',{revision:1,reason:'测试'},ctx()),{code:'STATION_EDIT_CONFLICT'});
 assert.equal(f.sql.prepare('SELECT state FROM station_track_revisions WHERE track_id=?').get(t.id).state,'draft');assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,404);
});
test('current bound R2 object identity is checked, and failure does not write a public version',async()=>{
 const f=await fixture(),t=await register(f);await rights(f,t);const a=f.sql.prepare('SELECT object_key FROM music_assets WHERE id=?').get(t.cover);f.objects.delete(a.object_key);
 await assert.rejects(contentPublication(f.runtime,'tracks',t.id,'publish',{revision:1,reason:'测试'},ctx()),{code:'STATION_ASSET_OBJECT_CHANGED'});assert.equal((await readContentObject(f.db,'tracks',t.id)).status,'draft');
});
test('publishing site_audio_mode cannot turn a VIP legacy record into a free grant',async()=>{
 const f=await fixture(),t=await register(f,1);await rights(f,t);
 await saveContentObject(f.runtime,'tracks',t.id,{revision:1,data:{...website(t),siteAudioMode:'free_full',legacyRevisionId:t.revision},reason:'测试'},ctx());
 await assert.rejects(contentPublication(f.runtime,'tracks',t.id,'publish',{revision:2,reason:'测试'},ctx(2)),{code:'STATION_FULL_POLICY_MISMATCH'});
 const data={...website(t),siteAudioMode:'existing_entitlement',legacyRevisionId:t.revision};await saveContentObject(f.runtime,'tracks',t.id,{revision:2,data,reason:'保持旧权限'},ctx(2));
 await contentPublication(f.runtime,'tracks',t.id,'publish',{revision:3,reason:'测试'},ctx(3));assert.equal(f.sql.prepare('SELECT access_mode FROM music_track_revisions WHERE id=?').get(t.revision).access_mode,'vip');
});
test('platform verification is independent of song publication and validates the provider target',async()=>{
 const f=await fixture(),t=await register(f),p={trackId:t.id,provider:'netease',status:'planned',url:null,verifiedAt:null,releasedAt:null,territories:['*'],sortOrder:0};
 const created=await saveContentPlatform(f.runtime,null,p,ctx());await assert.rejects(saveContentPlatform(f.runtime,created.id,{...p,status:'live',url:'https://evil.test/track',verifiedAt:Date.now()},ctx()),{code:'STATION_PLATFORM_URL_INVALID'});
 await assert.rejects(saveContentPlatform(f.runtime,created.id,{...p,status:'live',url:'https://music.163.com/song?id=123'},ctx()),{code:'STATION_PLATFORM_VERIFICATION_REQUIRED'});
 await saveContentPlatform(f.runtime,created.id,{...p,status:'live',url:'https://music.163.com/song?id=123',verifiedAt:Date.now()},ctx());assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,404);
 await assert.rejects(saveContentPlatform(f.runtime,created.id,p,ctx()),{code:'STATION_EDIT_CONFLICT'});
});
test('promotion preview requires an owned independent ready clip and rights; disabling clears every reference',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);await rights(f,t,'preview');
 const p={enabled:true,previewEnabled:true,previewAssetId:t.preview,selectedPlatformIds:[],selectedClipIds:[],sortOrder:0};
 await createContentObject(f.runtime,'promotions',{trackId:t.id,data:p,reason:'测试'},ctx());await contentPublication(f.runtime,'promotions',t.id,'publish',{revision:1,reason:'测试'},ctx());
 assert.equal((await publicGet(f,'tracks/'+t.slug)).data.track.preview.durationMs,30000);
 await saveContentObject(f.runtime,'promotions',t.id,{revision:1,data:{...p,previewEnabled:false},reason:'关闭试听'},ctx(2));await contentPublication(f.runtime,'promotions',t.id,'publish',{revision:2,reason:'测试'},ctx(3));
 const published=(await publicGet(f,'tracks/'+t.slug));assert.equal(published.data.track.preview,null);assert.equal(published.response.headers.get('cache-control'),'no-store');
 await saveContentObject(f.runtime,'promotions',t.id,{revision:2,data:{...p,enabled:false},reason:'停止推广'},ctx(4));const v=await readContentObject(f.db,'promotions',t.id);assert.equal(v.draft.data.previewAssetId,null);assert.deepEqual(v.draft.data.selectedPlatformIds,[]);
});
test('cross-owner previews and clips cannot be bound to a promotion',async()=>{
 const f=await fixture(),t=await register(f),other=await register(f,1);await publish(f,t);await publish(f,other);
 await assert.rejects(createContentObject(f.runtime,'promotions',{trackId:t.id,data:{enabled:true,previewEnabled:true,previewAssetId:other.preview},reason:'测试'},ctx()));
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM station_promotions').get().n,0);
});
test('homepage reads current enabled promotion; stopping it and taking the song down removes fresh references',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);await createContentObject(f.runtime,'promotions',{trackId:t.id,data:{enabled:true,previewEnabled:false},reason:'测试'},ctx());await contentPublication(f.runtime,'promotions',t.id,'publish',{revision:1,reason:'测试'},ctx());
 await saveContentObject(f.runtime,'home',homeId,{revision:1,data:{featuredTrackId:t.id},reason:'测试主推'},ctx());await contentPublication(f.runtime,'home',homeId,'publish',{revision:2,reason:'测试'},ctx(2));
 const first=await publicGet(f,'home');assert.equal(first.data.home.music.id,t.id);assert.equal(first.response.headers.get('cache-control'),'no-store');
 await contentPublication(f.runtime,'promotions',t.id,'unpublish',{revision:1,reason:'停止推广'},ctx(2));assert.equal((await publicGet(f,'home')).data.home.music,null);
 await contentPublication(f.runtime,'tracks',t.id,'unpublish',{revision:1,reason:'网站下架'},ctx(2));assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,404);
});
test('rollback copies the sealed snapshot to a new immutable version, then revalidates current resources',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const data=website(t);data.metadata={...data.metadata,title:{...data.metadata.title,en:'revised title'}};
 await saveContentObject(f.runtime,'tracks',t.id,{revision:1,data,reason:'修订'},ctx(2));await contentPublication(f.runtime,'tracks',t.id,'publish',{revision:2,reason:'测试'},ctx(3));
 await contentPublication(f.runtime,'tracks',t.id,'rollback',{revision:1,reason:'恢复原版'},ctx(4));const v=await readContentObject(f.db,'tracks',t.id);assert.equal(v.published.revision,3);assert.equal(v.published.data.metadata.title.en,t.metadata.title.en);assert.equal(v.revisions.filter(r=>r.state==='sealed').length,3);
 await saveContentRights(f.runtime,t.cover,{scope:'cover',status:'blocked',basis:'夹具模拟撤销',reason:'测试'},ctx());await assert.rejects(contentPublication(f.runtime,'tracks',t.id,'rollback',{revision:2,reason:'测试'},ctx(5)),{code:'STATION_ASSET_NOT_READY'});
});
test('two publishers cannot seal competing versions; a late failed batch rolls back audit and pointer',async()=>{
 const f=await fixture(),t=await register(f);await rights(f,t);const results=await Promise.allSettled([contentPublication(f.runtime,'tracks',t.id,'publish',{revision:1,reason:'甲'},ctx()),contentPublication(f.runtime,'tracks',t.id,'publish',{revision:1,reason:'乙'},ctx())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const second=await register(f,1);await rights(f,second);f.sqlState.fail=/INSERT INTO music_admin_audit_logs/;await assert.rejects(contentPublication(f.runtime,'tracks',second.id,'publish',{revision:1,reason:'测试'},ctx()),{code:'MUSIC_DATABASE_UNAVAILABLE'});assert.equal((await readContentObject(f.db,'tracks',second.id)).status,'draft');
});
test('scheduled validation failure retains editable draft and a bounded reason without public exposure',async()=>{
 const f=await fixture(),t=await register(f);await rights(f,t);await contentPublication(f.runtime,'tracks',t.id,'schedule',{revision:1,dueAt:Date.now()+60,reason:'测试定时'},ctx());
 await saveContentRights(f.runtime,t.cover,{scope:'cover',status:'blocked',basis:'夹具撤销',reason:'测试'},ctx());await new Promise(r=>setTimeout(r,65));await runStationContentSchedule(env(f));
 const v=await readContentObject(f.db,'tracks',t.id);assert.equal(v.status,'draft');assert.equal(v.draft.revision,1);assert.equal(v.jobs[0].status,'failed');assert.equal(v.jobs[0].errorCode,'STATION_ASSET_NOT_READY');assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,404);
 const data=website(t);await saveContentObject(f.runtime,'tracks',t.id,{revision:1,data,reason:'继续编辑'},ctx(v.editVersion));
});
test('scheduled success is idempotent and actor privilege is rechecked, while disabled scheduler reads nothing',async()=>{
 const f=await fixture(),t=await register(f);await rights(f,t);await contentPublication(f.runtime,'tracks',t.id,'schedule',{revision:1,dueAt:Date.now()+30,reason:'测试'},ctx());await new Promise(r=>setTimeout(r,35));await Promise.all([runStationContentSchedule(env(f)),runStationContentSchedule(env(f))]);
 assert.equal((await readContentObject(f.db,'tracks',t.id)).jobs[0].status,'succeeded');assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM music_admin_audit_logs WHERE action='station.content.publish'").get().n,1);
 const t2=await register(f,1);await rights(f,t2);await contentPublication(f.runtime,'tracks',t2.id,'schedule',{revision:1,dueAt:Date.now()+30,reason:'测试'},ctx());await new Promise(r=>setTimeout(r,35));await runStationContentSchedule({...env(f),STATION_CONTENT_EDITOR_EMAILS:actor});assert.equal((await readContentObject(f.db,'tracks',t2.id)).jobs[0].errorCode,'STATION_SCHEDULE_ACTOR_REVOKED');
 assert.equal((await runStationContentSchedule({MUSIC_DB:{withSession(){throw new Error('read');}}})).reason,'SCHEDULE_DISABLED');
});
test('editing cancels an approved schedule atomically and leaves the existing published revision visible',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);await saveContentObject(f.runtime,'tracks',t.id,{revision:1,data:website(t),reason:'编辑'},ctx(2));await contentPublication(f.runtime,'tracks',t.id,'schedule',{revision:2,dueAt:Date.now()+60000,reason:'定时修订'},ctx(3));
 assert.equal((await publicGet(f,'tracks/'+t.slug)).response.status,200);await saveContentObject(f.runtime,'tracks',t.id,{revision:2,data:website(t),reason:'更改定时版本'},ctx(4));assert.equal((await readContentObject(f.db,'tracks',t.id)).jobs[0].status,'cancelled');assert.equal((await publicGet(f,'tracks/'+t.slug)).data.track.revision,1);
});
test('editor may save drafts but cannot publish, approve rights or edit a live platform',async()=>{
 const f=await fixture(),t=await register(f),authorize=async()=>editor;const e=env(f);
 const save=await handleMusicAdmin(edit('tracks',t.id,'PATCH',{revision:1,data:website(t),reason:'编辑草稿'}),e,authorize);assert.equal(save.status,200);
 for(const [type,id,method,body] of [['tracks',t.id+'/publish','POST',{revision:2,reason:'发布'}],['assets',t.cover+'/rights','PUT',{scope:'cover',status:'approved',basis:'测试',reason:'测试'}]]){assert.equal((await handleMusicAdmin(edit(type,id,method,body,2),e,authorize)).status,403);}
 const body={trackId:t.id,provider:'netease',status:'live',url:'https://music.163.com/song?id=123',verifiedAt:Date.now()};assert.equal((await handleMusicAdmin(edit('platforms',null,'POST',body),e,authorize)).status,403);
});
test('game draft cannot occupy the runtime directory; preflight refuses missing screenshots and invented runtime',async()=>{
 const f=await fixture(),body={slug:'cat-life',data:{metadata:{originalLocale:'en',title:{en:'Test'}},launchUrl:'/games/cat-life/'},reason:'测试'};
 await assert.rejects(createContentObject(f.runtime,'games',body,ctx()),{code:'STATION_RUNTIME_DIRECTORY_RESERVED'});
 const g=await createContentObject(f.runtime,'games',{...body,slug:'cat-life-game'},ctx());await assert.rejects(contentPreflight(f.runtime,'games',g.id,1),{code:'STATION_GAME_DETAILS_REQUIRED'});
 await assert.rejects(saveContentObject(f.runtime,'games',g.id,{revision:1,data:{...body.data,launchUrl:'/games/unknown/'},reason:'测试'},ctx()),{code:'STATION_RUNTIME_INVALID'});
});
test('content lists and asset choices are bounded, preserve ID ordering and do not expose storage keys',async()=>{
 const f=await fixture(),t=await register(f),list=await listContentObjects(f.db,'tracks');assert.equal(list.items.length,8);const a=await contentAssets(f.db,{ownerId:t.id});assert.equal(a.items.length,4);assert.doesNotMatch(JSON.stringify(a),/object_key|sha256|etag/);
 await assert.rejects(listContentObjects(f.db,'tracks',{before:'NaN'}),{code:'INVALID_INPUT'});
});
