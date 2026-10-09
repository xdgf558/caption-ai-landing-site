import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';
import {eventFixture,event,eventRequest,eventBindings} from './helpers/station-event-fixture.mjs';
import {handleStationEvents} from '../src/redesign/analyticsHttp.js';
import {runStationEventRetention,eventMigration} from '../src/redesign/analyticsStore.js';
import {STATION_EVENT_VERSION,validateStationEvents} from '../src/redesign/analyticsModel.js';
import {platformFixture} from './helpers/station-content-fixture.mjs';
const send=async(f,events,options)=>{const r=await handleStationEvents(eventRequest(events),f.env,options);return {r,data:await r.json()};};
const close=f=>f.sql.close();
test('exact event dictionary, batch limits, types and no arbitrary dimensions or private data',()=>{
 const e=event('track_view',{trackId:randomUUID()});assert.equal(validateStationEvents({consentVersion:STATION_EVENT_VERSION,events:[e]}).length,1);
 for(const patch of [{name:'qualified_play'},{name:'vip_grant_confirmed'},{sessionId:'account-1'},{country:'SG'},{member:true},{url:'private'},{deviceClass:'iPhone 18'},{occurredAt:-1},{campaignId:'known-looking'}])assert.throws(()=>validateStationEvents({consentVersion:STATION_EVENT_VERSION,events:[{...e,...patch}]}));
 for(const events of [[],Array(21).fill(e),[e,{...e,sessionId:randomUUID()}]])assert.throws(()=>validateStationEvents({consentVersion:STATION_EVENT_VERSION,events}));
});
test('disabled or half-configured collection never reads bindings or installs schema',async()=>{
 let reads=0;const db=new Proxy({},{get(){reads++;throw new Error('binding');}});
 for(const patch of [{STATION_EVENTS_ENABLED:'false'},{STATION_CONTENT_PUBLIC_ENABLED:'false'},{STATION_EVENTS_PRIVACY_VERSION:'old'},{STATION_EVENTS_RETENTION_ENABLED:'false'}]){
  const r=await handleStationEvents(new Request('https://wwwstationcat.org/api/station/events?bad=1',{method:'DELETE'}),{...eventBindings,...patch,MUSIC_DB:db});assert.equal(r.status,503);
 }assert.equal(reads,0);
});
test('origin, method, GPC, media type and streaming/declaration limits precede writes',async()=>{
 const f=await eventFixture();try{
  for(const [headers,status]of [[{Origin:'https://evil.test'},403],[{'Sec-GPC':'1'},403],[{'Sec-Fetch-Site':'cross-site'},403],[{'Content-Type':'text/plain'},415],[{'Content-Encoding':'gzip'},415],[{'Content-Length':'32769'},413]]){
   const req=eventRequest([event('track_view',{trackId:f.tracks[0].id})]);for(const [k,v]of Object.entries(headers))req.headers.set(k,v);assert.equal((await handleStationEvents(req,f.env)).status,status);
  }
  const big=eventRequest([]);assert.equal((await handleStationEvents(new Request(big,{body:' '.repeat(32769)}),f.env)).status,413);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM station_analytics_events').get().n,0);
 }finally{close(f);}
});
test('0016 missing ledger/columns and stale retention fail closed with private responses',async()=>{
 const f=await eventFixture();try{
  const now=Date.now();await f.db.prepare('UPDATE station_event_retention_health SET last_sweep_at=?').bind(now-2*3600000-1).run();
  const stale=await send(f,[event('track_view',{trackId:f.tracks[0].id})],{clock:()=>now});assert.equal(stale.r.status,503);assert.equal(stale.data.code,'EVENT_RETENTION_UNREADY');
  assert.equal((await runStationEventRetention(f.env,{clock:()=>now})).available,true);
  await f.db.prepare('DELETE FROM d1_migrations WHERE name=?').bind(eventMigration).run();const {r,data}=await send(f,[event('track_view',{trackId:f.tracks[0].id})]);assert.equal(r.status,503);assert.equal(data.code,'EVENT_SCHEMA_UNAVAILABLE');assert.equal(r.headers.get('cache-control'),'private, no-store');assert(uuidLike(data.request_id));
 }finally{close(f);}
 const old=await eventFixture({migrated:false});try{assert.equal((await send(old,[event('track_view',{trackId:old.tracks[0].id})])).r.status,503);}finally{close(old);}
});
const uuidLike=x=>/^[a-f0-9-]{36}$/.test(x);
test('event_id retries and semantic playback dedupe are immutable, atomic and not replace',async()=>{
 const f=await eventFixture();try{
  const e=event('preview_start',{trackId:f.tracks[0].id,playbackId:randomUUID()});assert.equal((await send(f,[e])).data.accepted,1);assert.equal((await send(f,[e])).data.accepted,0);
  assert.equal((await send(f,[{...e,eventId:randomUUID()}])).data.accepted,0);
  assert.equal((await send(f,[{...e,deviceClass:'mobile'}])).data.accepted,0);
  const stored=f.sql.prepare('SELECT * FROM station_analytics_events').get();assert.equal(stored.device_class,'desktop');assert.throws(()=>f.sql.prepare('UPDATE station_analytics_events SET listened_ms=1').run(),/STATION_EVENT_RETAINED/);assert.throws(()=>f.sql.prepare('DELETE FROM station_analytics_events').run(),/STATION_EVENT_RETAINED/);
 }finally{close(f);}
});
test('same session/song visit is a sliding 30-minute window across attribution contexts',async()=>{
 const f=await eventFixture();try{
  const now=Date.now(),e=event('track_view',{trackId:f.tracks[0].id});assert.equal((await send(f,[e],{clock:()=>now})).data.accepted,1);
  assert.equal((await send(f,[{...e,eventId:randomUUID(),contextId:randomUUID()}],{clock:()=>now+29*60000})).data.accepted,0);
  assert.equal((await send(f,[{...e,eventId:randomUUID()}],{clock:()=>now+30*60000})).data.accepted,1);
 }finally{close(f);}
});
test('playback and launch identifiers cannot be reused by another session or media kind',async()=>{
 const f=await eventFixture();try{
  const start=event('preview_start',{trackId:f.tracks[0].id,playbackId:randomUUID()});assert.equal((await send(f,[start])).data.accepted,1);
  assert.equal((await send(f,[event('clip_start',{sessionId:start.sessionId,trackId:start.trackId,clipId:f.clip,playbackId:start.playbackId})])).data.accepted,0);
  assert.equal((await send(f,[{...start,eventId:randomUUID(),sessionId:randomUUID()}])).data.accepted,0);
  const launch=event('game_launch_request',{gameId:f.gameId,launchId:randomUUID()});assert.equal((await send(f,[launch])).data.accepted,1);
  assert.equal((await send(f,[{...launch,eventId:randomUUID(),sessionId:randomUUID()}])).data.accepted,0);
 }finally{close(f);}
});
test('qualifications require a matching start; ten foreground seconds OR actual ended, no 90% rule',async()=>{
 const f=await eventFixture();try{
  const start=event('preview_start',{trackId:f.tracks[0].id,playbackId:randomUUID()}),qualified={...start,eventId:randomUUID(),name:'preview_qualified',listenedMs:10000};
  assert.equal((await send(f,[qualified])).data.accepted,0);assert.equal((await send(f,[start,qualified])).data.accepted,2);
  const short=event('preview_start',{trackId:f.tracks[0].id,playbackId:randomUUID()}),end={...short,eventId:randomUUID(),name:'preview_qualified',mediaEnded:true,listenedMs:900};assert.equal((await send(f,[short,end])).data.accepted,2);
  assert.equal((await send(f,[{...qualified,eventId:randomUUID(),listenedMs:9999}])).r.status,400);
  const other={...qualified,eventId:randomUUID(),sessionId:randomUUID()};assert.equal((await send(f,[other])).data.accepted,0);
 }finally{close(f);}
});
test('game_ready and save_success require same current game/launch/session confirmation',async()=>{
 const f=await eventFixture();try{
  const launch=event('game_launch_request',{gameId:f.gameId,launchId:randomUUID()}),ready={...launch,eventId:randomUUID(),name:'game_ready'},save={...ready,eventId:randomUUID(),name:'save_success',saveOperationId:randomUUID()};
  assert.equal((await send(f,[ready])).data.accepted,0);assert.equal((await send(f,[launch,ready,save])).data.accepted,3);
  assert.equal((await send(f,[{...save,eventId:randomUUID()}])).data.accepted,0);
  assert.equal((await send(f,[{...ready,eventId:randomUUID(),launchId:randomUUID()}])).data.accepted,0);
 }finally{close(f);}
});
test('clip start/completion identity and browser completion claims never grant content rights',async()=>{
 const f=await eventFixture();try{
  const start=event('clip_start',{trackId:f.tracks[0].id,clipId:f.clip,playbackId:randomUUID()}),end={...start,eventId:randomUUID(),name:'clip_complete',mediaEnded:true};
  assert.equal((await send(f,[start,end])).data.accepted,2);assert.equal((await send(f,[{...end,eventId:randomUUID()}])).data.accepted,0);
  assert.equal((await send(f,[{...end,eventId:randomUUID(),mediaEnded:false}])).r.status,400);
  assert.equal((await send(f,[event('full_audio_start',{trackId:f.tracks[0].id,playbackId:randomUUID()})])).r.status,400);
 }finally{close(f);}
});
test('campaign dimensions come from registered active records, unknown IDs are not stored',async()=>{
 const f=await eventFixture();try{
  const e=event('track_view',{trackId:f.tracks[0].id,attributionKind:'campaign',campaignId:'event-douyin',firstCampaignId:'event-douyin'});assert.equal((await send(f,[e])).data.accepted,1);
  const r=f.sql.prepare('SELECT * FROM station_analytics_events WHERE event_id=?').get(e.eventId);assert.equal(r.campaign_source,'douyin');assert.equal(r.campaign_medium,'short_video');
  const unknown={...e,eventId:randomUUID(),sessionId:randomUUID(),campaignId:'unknown-id',firstCampaignId:'unknown-first'};assert.equal((await send(f,[unknown])).data.accepted,1);const u=f.sql.prepare('SELECT * FROM station_analytics_events WHERE event_id=?').get(unknown.eventId);assert.equal(u.attribution_kind,'unknown');assert.equal(u.campaign_id,null);assert.equal(u.first_campaign_id,null);
 }finally{close(f);}
});
test('an untrusted country header cannot admit a regional platform click',async()=>{
 const f=await eventFixture();try{
  const platformLinkId=await platformFixture(f.db,f.tracks[0],{territories_json:'["SG"]'});
  const click=event('platform_click',{trackId:f.tracks[0].id,platformLinkId,interactionId:randomUUID()}),request=eventRequest([click]);request.headers.set('CF-IPCountry','SG');
  assert.equal((await handleStationEvents(request,f.env)).status,400);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_analytics_events').get().n,0);
 }finally{close(f);}
});
test('unpublished/deleted content does not append; client time is flagged and windows use received_at',async()=>{
 const f=await eventFixture();try{
  const now=Date.now();const e=event('track_view',{trackId:f.tracks[0].id,occurredAt:0});assert.equal((await send(f,[e],{clock:()=>now})).data.accepted,1);
  const r=f.sql.prepare('SELECT received_at,time_anomaly,expires_at FROM station_analytics_events').get();assert.equal(r.received_at,now);assert.equal(r.time_anomaly,1);assert.equal(r.expires_at,now+90*86400000);
  assert.equal((await send(f,[event('track_view',{trackId:randomUUID()})])).data.accepted,0);
 }finally{close(f);}
});
test('session/source/global event-unit admission also meters retries and rotating IDs',async()=>{
 const f=await eventFixture();try{
  const now=Date.now(),e=event('track_view',{trackId:f.tracks[0].id});for(let i=0;i<6;i++)assert.equal((await send(f,Array.from({length:20},()=>({...e,eventId:randomUUID()})),{clock:()=>now})).r.status,200);
  assert.equal((await send(f,[e],{clock:()=>now})).r.status,429);
  for(let i=0;i<24;i++){const sessionId=randomUUID();assert.equal((await send(f,Array.from({length:20},()=>event('track_view',{trackId:f.tracks[0].id,sessionId})),{clock:()=>now})).r.status,200);}
  const limited=await send(f,[event('track_view',{trackId:f.tracks[0].id})],{clock:()=>now});assert.equal(limited.r.status,429);assert(+limited.r.headers.get('retry-after')>0);
 }finally{close(f);}
});
test('controlled expiry keeps live receipts and content, works with collection off, leaves no guard',async()=>{
 const f=await eventFixture();try{
  const now=Date.now();await send(f,[event('track_view',{trackId:f.tracks[0].id})],{clock:()=>now});
  const later=now+89*86400000;await runStationEventRetention(f.env,{clock:()=>later});
  const live=event('track_view',{trackId:f.tracks[0].id});assert.equal((await send(f,[live],{clock:()=>later})).data.accepted,1);
  assert.equal((await runStationEventRetention({...f.env,STATION_EVENTS_ENABLED:'false'},{clock:()=>now+90*86400000})).available,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_analytics_events').get().n,1);assert.equal(f.sql.prepare('SELECT event_id FROM station_analytics_events').get().event_id,live.eventId);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_event_retention_guard').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_track_publications').get().n,2);
 }finally{close(f);}
});
