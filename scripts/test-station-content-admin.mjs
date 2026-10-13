import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { contentAdminFixture } from './helpers/station-content-admin-fixture.mjs';
import { homeId, insertFixture } from './helpers/station-redesign-database.mjs';
import { createContentObject, saveContentObject, contentPublication, saveContentPlatform, saveContentRights, contentPreflight, applyHomeSelection } from '../src/redesign/contentAdmin.js';
import { readContentObject, contentAdminReadiness, listContentObjects, contentAssets, listHomeTracks } from '../src/redesign/contentAdminStore.js';
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
test('homepage saves, scheduling, cancellation, publication, withdrawal and rollback need no manual note',async()=>{
 const f=await fixture();let version=1;
 await saveContentObject(f.runtime,'home',homeId,{revision:1,data:{}},ctx(version++));
 await contentPublication(f.runtime,'home',homeId,'schedule',{revision:2,dueAt:Date.now()+60000},ctx(version++));
 await contentPublication(f.runtime,'home',homeId,'cancel-schedule',{revision:2},ctx(version++));
 await contentPublication(f.runtime,'home',homeId,'publish',{revision:2},ctx(version++));
 await contentPublication(f.runtime,'home',homeId,'unpublish',{revision:2},ctx(version++));
 const context=ctx(version),body={revision:2};
 const restored=await contentPublication(f.runtime,'home',homeId,'rollback',body,context);
 const replay=await contentPublication(f.runtime,'home',homeId,'rollback',body,context);
 assert.equal(restored.revision,3);assert.equal(replay.replayed,true);
 const logs=f.sql.prepare('SELECT actor_id,action,target_id,summary_json,created_at FROM music_admin_audit_logs WHERE target_id=? ORDER BY rowid').all(homeId);
 assert.deepEqual(logs.map(r=>r.action),['save','schedule','cancel-schedule','publish','unpublish','rollback'].map(action=>'station.content.'+action));
 for(const row of logs){assert.equal(row.actor_id,actor);assert(row.created_at>0);const summary=JSON.parse(row.summary_json);assert.equal(summary.type,'home');assert(summary.revision>0);assert.equal(Object.hasOwn(summary,'reason'),false);}
});
test('older valid notes remain compatible while invalid supplied notes are rejected without writes',async()=>{
 const f=await fixture(),data={},before=f.dump();
 for(const reason of ['',null,123,'x'.repeat(1001),'bad\u0000note'])await assert.rejects(saveContentObject(f.runtime,'home',homeId,{revision:1,data,reason},ctx()),{code:'INVALID_INPUT'});
 assert.equal((await readContentObject(f.db,'home',homeId)).editVersion,1);
 assert.deepEqual(f.dump(),before);
 await saveContentObject(f.runtime,'home',homeId,{revision:1,data,reason:'较早打开的编辑页'},ctx());
 assert.equal(JSON.parse(f.sql.prepare('SELECT summary_json FROM music_admin_audit_logs WHERE target_id=?').get(homeId).summary_json).reason,'较早打开的编辑页');
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
test('title and artist alone create a stable song address, including identical Chinese titles',async()=>{
 const f=await fixture(),before=f.sql.prepare('SELECT id,slug FROM music_tracks ORDER BY id').all();
 const data={metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'晚一点告白'},creatorName:'站猫'}},body={data};
 const created=await Promise.all([createContentObject(f.runtime,'tracks',body,ctx()),createContentObject(f.runtime,'tracks',body,ctx())]);
 const slugs=[];
 for(const result of created){
  const song=f.sql.prepare('SELECT * FROM music_tracks WHERE id=?').get(result.id),slug=song.slug;slugs.push(slug);
  assert.equal(slug,'track-'+result.id);assert.equal(song.lifecycle,'draft');assert.equal(song.published_revision_id,null);
  const canonical=f.sql.prepare("SELECT slug FROM station_track_routes WHERE track_id=? AND role='canonical'").get(result.id);
  assert.equal(canonical.slug,slug);assert.equal((await publicGet(f,'tracks/'+slug)).response.status,404);
  const saved=await readContentObject(f.db,'tracks',result.id);assert.equal(saved.draft.data.siteAudioMode,'none');assert.equal(saved.published,null);
  await saveContentObject(f.runtime,'tracks',result.id,{revision:1,data:{metadata:{...data.metadata,title:{'zh-Hans':'修改后的歌名'}}}},ctx());
  assert.equal(f.sql.prepare('SELECT slug FROM music_tracks WHERE id=?').get(result.id).slug,slug);
  assert.equal(f.sql.prepare("SELECT slug FROM station_track_routes WHERE track_id=? AND role='canonical'").get(result.id).slug,slug);
 }
 assert.equal(new Set(slugs).size,2);
 for(const row of before)assert.equal(f.sql.prepare('SELECT slug FROM music_tracks WHERE id=?').get(row.id).slug,row.slug);
});
test('automatic song address replays one creation after a lost acknowledgement and concurrent retries',async()=>{
 const f=await fixture(),body={data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'重试同一首歌'},creatorName:'Station Cat'}}},context=ctx();
 f.sqlState.lose=true;
 const results=await Promise.all([createContentObject(f.runtime,'tracks',body,context),createContentObject(f.runtime,'tracks',body,context)]);
 const again=await createContentObject(f.runtime,'tracks',body,context);
 assert(results.every(result=>result.id===again.id));assert.equal(again.replayed,true);
 assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM music_admin_audit_logs WHERE action='station.content.create' AND target_id=?").get(again.id).n,1);
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM station_track_routes WHERE track_id=?').get(again.id).n,1);
 assert.equal(f.sql.prepare('SELECT slug FROM music_tracks WHERE id=?').get(again.id).slug,'track-'+again.id);
 await assert.rejects(createContentObject(f.runtime,'tracks',{data:{metadata:{...body.data.metadata,creatorName:'另一艺名'}}},context),{code:'IDEMPOTENCY_CONFLICT'});
});
test('explicit old-client slugs remain validated and games still require their own address',async()=>{
 const f=await fixture(),data={metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'格式核对'},creatorName:'Station Cat'}};
 for(const slug of ['',null,'中文地址','UpperCase','two--hyphens','../other'])await assert.rejects(createContentObject(f.runtime,'tracks',{slug,data},ctx()),{code:'INVALID_INPUT'});
 await assert.rejects(createContentObject(f.runtime,'games',{data:{metadata:{originalLocale:'en',title:{en:'Game'}}}},ctx()),{code:'INVALID_INPUT'});
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


test('one homepage command publishes a missing basic promotion and home, with verified platforms and no new audio grant',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);
 const link=await saveContentPlatform(f.runtime,null,{trackId:t.id,provider:'netease',status:'live',url:'https://music.163.com/song?id=3438977672',verifiedAt:Date.now()-1000},ctx());
 await saveContentPlatform(f.runtime,null,{trackId:t.id,provider:'spotify',status:'planned'},ctx());
 const old=f.sql.prepare('SELECT * FROM music_tracks ORDER BY id').all(),context=ctx(),body={revision:1,data:{featuredTrackId:t.id}};
 f.sqlState.lose=true;
 const result=await applyHomeSelection(f.runtime,homeId,body,context),replay=await applyHomeSelection(f.runtime,homeId,body,context);
 assert.equal(result.status,'published');assert.equal(replay.replayed,true);assert.equal(replay.revision,result.revision);
 const home=await readContentObject(f.db,'home',homeId),p=await readContentObject(f.db,'promotions',t.id);
 assert.equal(home.draft,null);assert.equal(home.published.data.featuredTrackId,t.id);
 assert.equal(p.draft,null);assert.equal(p.published.data.enabled,true);assert.equal(p.published.data.previewEnabled,false);assert.equal(p.published.data.previewAssetId,null);
 assert.deepEqual(p.published.data.selectedPlatformIds,[link.id]);assert.deepEqual(p.published.data.selectedClipIds,[]);
 assert.deepEqual(f.sql.prepare('SELECT * FROM music_tracks ORDER BY id').all(),old);
 assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
 assert.equal((await publicGet(f,'tracks/'+t.slug)).data.track.preview,null);
 const logs=f.sql.prepare("SELECT * FROM music_admin_audit_logs WHERE action='station.home.apply'").all();assert.equal(logs.length,1);assert.equal(logs[0].actor_id,actor);
 assert.equal(JSON.parse(logs[0].summary_json).preparedPromotions[0].trackId,t.id);
 await applyHomeSelection(f.runtime,homeId,{revision:2,data:{}},ctx(2));
 assert.equal((await publicGet(f,'home')).data.home.music,null);assert.equal((await readContentObject(f.db,'promotions',t.id)).status,'published');
});
test('home selection keeps an unpublished promotion draft untouched and never publishes its preview settings',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);
 await createContentObject(f.runtime,'promotions',{trackId:t.id,data:{enabled:true,previewEnabled:true,previewAssetId:t.preview}},ctx());
 const before=await readContentObject(f.db,'promotions',t.id);
 await applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id}},ctx());
 const after=await readContentObject(f.db,'promotions',t.id);
 assert.deepEqual(after.draft,before.draft);assert.equal(after.published.revision,2);assert.equal(after.published.data.previewEnabled,false);assert.equal(after.editVersion,2);
 assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
});
test('home selection reuses reviewed live promotion including preview, without publishing later edits',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);await rights(f,t,'preview');
 const data={enabled:true,previewEnabled:true,previewAssetId:t.preview};
 await createContentObject(f.runtime,'promotions',{trackId:t.id,data},ctx());await contentPublication(f.runtime,'promotions',t.id,'publish',{revision:1},ctx());
 await saveContentObject(f.runtime,'promotions',t.id,{revision:1,data:{enabled:false,previewEnabled:false}},ctx(2));
 const before=await readContentObject(f.db,'promotions',t.id);
 await applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id}},ctx());
 assert.deepEqual(await readContentObject(f.db,'promotions',t.id),before);
 assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
 assert((await publicGet(f,'tracks/'+t.slug)).data.track.preview);
});
test('home command validates every selected track before committing any promotion or home pointer',async()=>{
 const f=await fixture(),t=await register(f),other=await register(f,1);await publish(f,t);
 const before=f.dump();
 await assert.rejects(applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id,selectedTrackIds:[other.id]}},ctx()),{code:'STATION_REFERENCE_NOT_PUBLIC'});
 assert.deepEqual(f.dump(),before);
 await publish(f,other);
 const result=await applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id,selectedTrackIds:[t.id,other.id]}},ctx());
 assert.equal(result.status,'published');assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_promotions').get().n,2);
});
test('a failed final homepage write rolls back already planned promotion writes, audit and receipt',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const before=f.dump();
 f.sqlState.fail=/UPDATE station_home_configs/;
 await assert.rejects(applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id}},ctx()),{code:'MUSIC_DATABASE_UNAVAILABLE'});
 assert.deepEqual(f.dump(),before);
});
test('home application checks resource identity and current rights before publication',async()=>{
 for(const failure of ['rights','object']){
  const f=await fixture(),t=await register(f);await publish(f,t);
  if(failure==='rights')await saveContentRights(f.runtime,t.cover,{scope:'cover',status:'blocked',basis:'测试撤销'},ctx());
  else f.objects.delete(f.sql.prepare('SELECT object_key FROM music_assets WHERE id=?').get(t.cover).object_key);
  const before=f.dump();await assert.rejects(applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id}},ctx()),{code:failure==='rights'?'STATION_ASSET_NOT_READY':'STATION_ASSET_OBJECT_CHANGED'});assert.deepEqual(f.dump(),before);
 }
});
test('concurrent rights, track, promotion and platform changes invalidate the atomic home command',async()=>{
 for(const change of ['rights','track','promotion','platform']){
  const f=await fixture(),t=await register(f);await publish(f,t);
  const link=await saveContentPlatform(f.runtime,null,{trackId:t.id,provider:'netease',status:'live',url:'https://music.163.com/song?id=3438977672',verifiedAt:Date.now()-1000},ctx());
  await createContentObject(f.runtime,'promotions',{trackId:t.id,data:{enabled:false,previewEnabled:false}},ctx());
  f.sqlState.beforeWrite=()=>{
   if(change==='rights')f.sql.prepare("UPDATE station_asset_rights SET status='blocked',edit_version=edit_version+1 WHERE music_asset_id=?").run(t.cover);
   if(change==='track')f.sql.prepare("UPDATE station_track_publications SET status='archived',edit_version=edit_version+1 WHERE track_id=?").run(t.id);
   if(change==='promotion')f.sql.prepare('UPDATE station_promotions SET edit_version=edit_version+1 WHERE track_id=?').run(t.id);
   if(change==='platform')f.sql.prepare("UPDATE station_platform_links SET status='removed',version=version+1 WHERE id=?").run(link.id);
  };
  await assert.rejects(applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id}},ctx()),{code:'STATION_EDIT_CONFLICT'});
  assert.equal((await readContentObject(f.db,'home',homeId)).published,null);assert.equal((await readContentObject(f.db,'promotions',t.id)).published,null);
 }
});
test('two homepage editors cannot overwrite each other and each result has one receipt',async()=>{
 const f=await fixture(),t=await register(f),other=await register(f,1);await publish(f,t);await publish(f,other);
 const results=await Promise.allSettled([t,other].map(track=>applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:track.id}},ctx())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'STATION_EDIT_CONFLICT');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_promotions').get().n,1);
});
test('home choices read published website titles without needing a promotion; follow bounded pages',async()=>{
 const f=await fixture(),t=await register(f),unpublished=await register(f,1);await publish(f,t);
 await saveContentObject(f.runtime,'tracks',t.id,{revision:1,data:{...website(t),metadata:{...t.metadata,title:{[t.metadata.originalLocale]:'未公开改名'}}}},ctx(2));
 let list=await listHomeTracks(f.db);assert.deepEqual(list.items.map(x=>x.id),[t.id]);assert.equal(list.items[0].title,t.metadata.title[t.metadata.originalLocale]);
 assert(!list.items.some(x=>x.id===unpublished.id));
 for(let i=0;i<21;i++){
  const r=await createContentObject(f.runtime,'tracks',{slug:'website-choice-'+i,data:{metadata:t.metadata,siteAudioMode:'none'}},ctx());
  // Candidate enumeration fixture only. Resource validation remains at apply.
  f.sql.prepare("UPDATE station_track_revisions SET state='sealed' WHERE track_id=?").run(r.id);
  f.sql.prepare("UPDATE station_track_publications SET status='published',published_revision=1,draft_revision=NULL,published_at=? WHERE track_id=?").run(Date.now()-1,r.id);
 }
 list=await listHomeTracks(f.db);assert.equal(list.items.length,20);assert(list.nextBefore);
 const next=await listHomeTracks(f.db,{before:String(list.nextBefore)});assert.equal(next.items.length,2);assert.equal(next.nextBefore,null);assert.equal(new Set([...list.items,...next.items].map(x=>x.id)).size,22);
 const ui=await homeEditor(f),featuredMore=ui.node('content-featured-track').parentElement.querySelector('[data-choice-more]'),selectedMore=ui.node('content-selected-tracks').parentElement.querySelector('[data-choice-more]');
 assert(featuredMore&&selectedMore);await featuredMore.click();await ui.idle();await selectedMore.click();await ui.idle();
 assert.equal(ui.node('content-featured-track').options.filter(o=>o.value).length,22);assert.equal(ui.node('content-selected-tracks').options.length,22);
 assert(!ui.calls.some(c=>c.path.includes('before=null')));await ui.choose(t.id);await ui.submit();assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);

});

async function homeEditor(f,{actorId=actor,loseApply=false,failReadAfterApply=false}={}) {
 const {adminScriptFixture}=await import('./helpers/station-admin-dom.mjs');const calls=[];let lost=false,acting=actorId,committed=false,readFailed=false;
 const request=async(path,options={})=>{
  calls.push({path,...options});const method=options.method??'GET';
  if(failReadAfterApply&&committed&&!readFailed&&method==='GET'&&path.startsWith('/home?')){readFailed=true;throw Object.assign(new Error('读取失败'),{uncertain:true});}
  const response=await handleMusicAdmin(new Request('https://content.local.test/admin/api/music/site-content'+path,{method,
   headers:{Origin:'https://content.local.test','X-Requested-With':'StationCatMusicAdmin','Content-Type':'application/json',...(options.key?{'Idempotency-Key':options.key}:{}),...(options.etag?{'If-Match':options.etag}:{})},
   ...(options.body===undefined?{}:{body:JSON.stringify(options.body)})}),env(f),async()=>acting);
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.code),{code:data.code,field:data.field,status:response.status,uncertain:response.status>=500});
  if(path.endsWith('/apply'))committed=true;
  if(loseApply&&!lost&&path.endsWith('/apply')){lost=true;throw Object.assign(new Error('回执丢失'),{uncertain:true});}return data;
 };
 const ui=await adminScriptFixture('adminStationContent.js',{search:'?view=home',request});
 const choose=async id=>{ui.node('content-featured-track').value=id;await ui.node('content-form').fire('input',{target:ui.node('content-featured-track')});};
 const submit=async()=>{await ui.node('content-form').fire('submit');await ui.idle();};
 return {...ui,calls,choose,submit,setActor(value){acting=value;}};
}
test('actual homepage entry selects a published song without a promotion and updates it with one button',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const ui=await homeEditor(f);
 assert.equal(ui.node('content-save').textContent,'更新首页');assert.equal(ui.node('content-publish').hidden,true);assert.equal(ui.node('content-preflight').hidden,true);assert.equal(ui.node('content-language-details').hidden,true);
 assert(ui.node('content-featured-track').options.some(o=>o.value===t.id));
 await ui.choose(t.id);assert.equal(ui.state().dirty,true);assert.equal(ui.node('content-save').disabled,false);
 await ui.submit();assert.equal(ui.state().dirty,false);assert.equal(ui.state().current.published.data.featuredTrackId,t.id);
 assert.match(ui.node('content-home-feedback').textContent,/首页已更新/);assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
 const writes=ui.calls.filter(c=>c.method&&c.method!=='GET');assert.equal(writes.length,1);assert.equal(writes[0].path,'/home/'+homeId+'/apply');assert.equal(writes[0].etag,'"edit-1"');
});
test('homepage conflict retains selection and can be reloaded through the existing discard flow',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const ui=await homeEditor(f);await ui.choose(t.id);
 await applyHomeSelection(f.runtime,homeId,{revision:1,data:{}},ctx());
 await ui.submit();assert.equal(ui.state().dirty,true);assert.match(ui.node('content-home-feedback').textContent,/版本已变化/);assert.equal(ui.node('content-featured-track').value,t.id);
 await ui.node('content-reload').click();assert.equal(ui.node('content-reload-confirm').hidden,false);
 await ui.node('content-reload-cancel').click();assert.equal(ui.node('content-featured-track').value,t.id);
 await ui.node('content-reload').click();await ui.node('content-reload-discard').click();await ui.idle();
 assert.equal(ui.state().current.editVersion,2);await ui.choose(t.id);await ui.submit();assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
});
test('homepage uncertain result retries the exact command once without losing its saved selection',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const ui=await homeEditor(f,{loseApply:true});await ui.choose(t.id);await ui.submit();
 const first=ui.calls.find(c=>c.path.endsWith('/apply'));assert(ui.state().pending);assert.equal(ui.node('content-save').disabled,true);assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
 await ui.node('content-retry').click();await ui.idle();
 const retry=ui.calls.filter(c=>c.path.endsWith('/apply'))[1];assert.equal(retry.key,first.key);assert.deepEqual(retry.body,first.body);
 assert.equal(ui.state().pending,null);assert.equal(ui.state().current.published.data.featuredTrackId,t.id);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='station.home.apply'").get().n,1);
});
test('homepage actor change and editor role cannot publish, retaining the selected song',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const ui=await homeEditor(f);await ui.choose(t.id);ui.setActor(editor);await ui.submit();
 assert.equal(ui.state().dirty,true);assert.equal(ui.node('content-featured-track').value,t.id);assert.equal(ui.calls.filter(c=>c.path.endsWith('/apply')).length,0);
 const editorUi=await homeEditor(f,{actorId:editor});await editorUi.choose(t.id);assert.equal(editorUi.node('content-save').disabled,true);await editorUi.submit();assert.equal(editorUi.calls.filter(c=>c.path.endsWith('/apply')).length,0);
 assert.equal((await readContentObject(f.db,'home',homeId)).published,null);
});

test('confirmed homepage update is not reported as a failed publication when its workspace reload fails',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);const ui=await homeEditor(f,{failReadAfterApply:true});await ui.choose(t.id);await ui.submit();
 assert.equal(ui.state().pending,null);assert.equal(ui.state().dirty,false);assert.match(ui.node('content-home-feedback').textContent,/首页更新已确认/);
 assert.equal((await publicGet(f,'home')).data.home.music.id,t.id);
 await ui.node('content-reload').click();await ui.idle();assert.equal(ui.state().current.published.data.featuredTrackId,t.id);
 assert.equal(ui.calls.filter(c=>c.path.endsWith('/apply')).length,1);
});
test('immediate homepage publication cancels older schedules but keeps the promotion draft intact',async()=>{
 const f=await fixture(),t=await register(f);await publish(f,t);
 await createContentObject(f.runtime,'promotions',{trackId:t.id,data:{enabled:true,previewEnabled:false}},ctx());
 await contentPublication(f.runtime,'promotions',t.id,'schedule',{revision:1,dueAt:Date.now()+60000},ctx());
 await contentPublication(f.runtime,'home',homeId,'schedule',{revision:1,dueAt:Date.now()+60000},ctx());
 const before=await readContentObject(f.db,'promotions',t.id);
 await applyHomeSelection(f.runtime,homeId,{revision:1,data:{featuredTrackId:t.id}},ctx(2));
 const p=await readContentObject(f.db,'promotions',t.id),home=await readContentObject(f.db,'home',homeId);
 assert.deepEqual(p.draft,before.draft);assert.equal(p.jobs[0].status,'cancelled');assert.equal(home.jobs[0].status,'cancelled');assert.equal(home.scheduledAt,null);
});
