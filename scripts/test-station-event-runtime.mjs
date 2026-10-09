import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';import vm from 'node:vm';
import {createEventRuntime,event,eventBindings} from './helpers/station-event-fixture.mjs';
import {stationMusicAssets} from './helpers/station-music-runtime.mjs';
import {STATION_EVENT_VERSION} from '../src/redesign/analyticsModel.js';
import {createStationGameSession} from '../src/redesign/gameSession.js';
import {GAME_PROTOCOL,GAME_ID} from '../src/redesign/gameProtocol.js';
import {catLifeSaveHarness} from './helpers/cat-life-save-harness.mjs';
import {saveContentObject,contentPublication,saveContentPlatform} from '../src/redesign/contentAdmin.js';
import {contentAdminActor} from './helpers/station-content-admin-runtime.mjs';
test('native Worker/D1: guarded batches, exact schema, atomic retry/dedupe, current published pages',async t=>{
 const f=await createEventRuntime({assets:stationMusicAssets});t.after(()=>f.close());
 const send=(events,options={})=>f.mf.dispatchFetch('https://wwwstationcat.org'+(options.prefix??'')+'/api/station/events',{method:'POST',...(options.cf?{cf:options.cf}:{}),headers:{Origin:'https://wwwstationcat.org','Content-Type':'application/json','X-Requested-With':'StationCatEvents','CF-Connecting-IP':'192.0.2.19',...options.headers},body:JSON.stringify({consentVersion:STATION_EVENT_VERSION,events})});
 const track=f.content.tracks[0],single=()=>event('track_view',{trackId:track.id});
 await t.test('each rollout/privacy/retention prerequisite closes collection before bindings',async()=>{
  for(const prefix of ['off','collection-only','content-only','privacy-off','retention-off','empty','wrong'])assert.equal((await send([single()],{prefix:'/fixture-event-'+prefix})).status,503);
 });
 await t.test('concurrent lost-response retries append one receipt on actual D1 primary',async()=>{
  const e=single(),responses=await Promise.all(Array.from({length:6},()=>send([e])));assert(responses.every(r=>r.status===200));const data=await Promise.all(responses.map(r=>r.json()));assert.equal(data.reduce((n,r)=>n+r.accepted,0),1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM station_analytics_events WHERE event_id=?').bind(e.eventId).first()).n,1);
 });
 await t.test('native transactional start/qualification and semantic duplicates',async()=>{
  const a=event('preview_start',{trackId:track.id,playbackId:randomUUID()}),b={...a,eventId:randomUUID(),name:'preview_qualified',listenedMs:10000};const r=await send([a,b]);assert.equal(r.status,200);assert.equal((await r.json()).accepted,2);
  const retry=await send([{...b,eventId:randomUUID()}]);assert.equal((await retry.json()).accepted,0);
 });
 await t.test('global admission rejection rolls back other counters in same batch',async()=>{
  const window=Math.floor(Date.now()/60000)*60000;await f.db.prepare("INSERT INTO station_event_rates(scope,window_start,subject,hits) VALUES('global',?,?,12000) ON CONFLICT(scope,window_start,subject) DO UPDATE SET hits=12000").bind(window,'0'.repeat(64)).run();
  const e=single(),r=await send([e]);assert.equal(r.status,429);assert.equal(await f.db.prepare("SELECT hits FROM station_event_rates WHERE scope='session' AND subject=?").bind(e.sessionId).first(),null);
  await f.db.prepare("DELETE FROM station_event_rates WHERE scope='global' AND window_start=?").bind(window).run();
 });
 await t.test('live verified platform IDs only; removed/planned/regional URLs never become clicks',async()=>{
  const runtime={db:f.db,bucket:f.bucket},ctx=()=>({actorId:contentAdminActor,key:randomUUID()});
  const link=await saveContentPlatform(runtime,null,{trackId:track.id,provider:'youtube',status:'live',url:'https://www.youtube.com/watch?v=t18-local-fixture',territories:['SG'],sortOrder:0,verifiedAt:Date.now(),releasedAt:Date.now()},ctx());
  const e=event('platform_click',{trackId:track.id,platformLinkId:link.id,interactionId:randomUUID()});assert.equal((await send([e],{cf:{country:'SG'}})).status,200);
  assert.equal((await send([{...e,eventId:randomUUID(),interactionId:randomUUID()}],{cf:{country:'US'}})).status,400);
 });
 await t.test('full audio start independently reuses old free/entitlement permission decision',async()=>{
  const runtime={db:f.db,bucket:f.bucket},ctx=v=>({actorId:contentAdminActor,key:randomUUID(),ifMatch:`"edit-${v}"`});
  const old=await f.db.prepare('SELECT metadata_json,cover_asset_id FROM station_track_revisions WHERE track_id=? AND revision=1').bind(track.id).first();
  await saveContentObject(runtime,'tracks',track.id,{revision:1,data:{metadata:JSON.parse(old.metadata_json),coverAssetId:old.cover_asset_id,siteAudioMode:'existing_entitlement',legacyRevisionId:track.revision},reason:'本机完整权限核对'},ctx(2));
  await contentPublication(runtime,'tracks',track.id,'publish',{revision:2,reason:'本机完整权限核对'},ctx(3));
  const r=await send([event('full_audio_start',{trackId:track.id,playbackId:randomUUID()})]);assert.equal(r.status,200);assert.equal((await r.json()).accepted,1);
 });
 await t.test('published Astro detail exposes only rollout boolean; collector config contains no credentials',async()=>{
  const r=await f.mf.dispatchFetch('https://wwwstationcat.org/music/tracks/'+track.slug+'/',{headers:{'CF-Connecting-IP':'192.0.2.19'}});assert.equal(r.status,200);const html=await r.text();assert.match(html,/data-sc-event-controls/);assert.match(html,/"analytics":\{"enabled":true\}/);
  const config=await f.mf.dispatchFetch('https://wwwstationcat.org/api/station/events/config',{headers:{'CF-Connecting-IP':'192.0.2.19'}});assert.equal(config.status,200);const body=await config.json();assert.equal(body.available,true);assert.equal(body.retention.rawDays,90);assert.equal(body.runtimeGameId,f.content.gameId);assert.doesNotMatch(JSON.stringify(body),/account|token|object_key|sessionId|source_hash/);
 });
});
test('game observer accepts launch, verified ready and confirmed local-save only; iframe load is silent',()=>{
 const frames=[],events=[],id=randomUUID();class Frame extends EventTarget{constructor(){super();this.contentWindow={postMessage(){}};}remove(){}}
 const game=createStationGameSession({origin:'https://wwwstationcat.org',locale:'en',uuid:()=>id,createFrame(){const f=new Frame();frames.push(f);return f;},mount(){},pauseMedia(){},observer:(name,data)=>events.push({name,data})});
 game.launch();frames[0].dispatchEvent(new Event('load'));assert.deepEqual(events.map(e=>e.name),['game_launch_request']);
 const msg=(type,patch={},outer={})=>game.receive({origin:'https://wwwstationcat.org',source:frames[0].contentWindow,data:{protocol:GAME_PROTOCOL,game_id:GAME_ID,launch_id:id,type,...patch},...outer});
 assert.equal(msg('ready',{}, {source:{}}),false);assert.equal(msg('save_success',{save_kind:'local',save_operation_id:randomUUID()}),false);assert(msg('ready'));assert(msg('save_success',{save_kind:'local',save_operation_id:randomUUID()}));
 assert.equal(msg('save_success',{save_kind:'cloud',save_operation_id:randomUUID()}),false);assert.equal(msg('ready'),false);assert.deepEqual(events.map(e=>e.name),['game_launch_request','game_ready','save_success']);game.destroy();
});
test('local save telemetry happens after verified read-back; denied/corrupt storage and observer exceptions do not fake success',()=>{
 const f=catLifeSaveHarness();let confirms=0;f.context.CatGameHostBridge={localSaved:()=>confirms++};f.game.state.saveSystem.saveGame();assert.equal(confirms,1);
 f.setDeniedWrite(true);assert.throws(()=>f.game.state.saveSystem.saveGame());assert.equal(confirms,1);
 const good=catLifeSaveHarness();good.context.CatGameHostBridge={localSaved(){throw new Error('statistics failure');}};assert.doesNotThrow(()=>good.game.state.saveSystem.saveGame());assert(good.writes.length);
});
test('embedded bridge exposes only operation UUID after ready, never saved-game/identity data',()=>{
 const messages=[],id=randomUUID(),context={URLSearchParams,crypto:{randomUUID},CustomEvent:class{},document:{querySelectorAll:()=>[],body:{setAttribute(){}}}};context.window=context;context.location={search:'?sc_entry=1&sc_launch_id='+id,origin:'https://wwwstationcat.org'};context.parent={postMessage:data=>messages.push(data)};context.addEventListener=()=>{};
 vm.runInNewContext(readFileSync(new URL('../public/games/cat-life/host-bridge.js',import.meta.url),'utf8'),context);context.CatGameHostBridge.localSaved();assert.equal(messages.length,0);context.CatGameHostBridge.ready();context.CatGameHostBridge.localSaved();assert.equal(messages[1].type,'save_success');assert.deepEqual(Object.keys(messages[1]).sort(),['game_id','launch_id','protocol','save_kind','save_operation_id','type']);
});
