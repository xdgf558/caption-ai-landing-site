import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';
import {createStationEvents,eventConsentKey,eventOptOutKey} from '../src/redesign/analyticsClient.js';
import {createStationMediaMeasurement} from '../src/redesign/analyticsMedia.js';
import {STATION_EVENT_VERSION} from '../src/redesign/analyticsModel.js';
const trackId=randomUUID(),clipId=randomUUID();
function setup({storage,fetcher,privacy}={}){
 const requests=[],jobs=new Map(),map=new Map();let now=Date.now(),seq=0,gpc=false;
 const store=storage??{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const f=createStationEvents({storage:()=>store,clock:()=>now,makeId:randomUUID,privacy:privacy??(()=>gpc),deviceClass:()=> 'desktop',schedule:(fn,ms)=>{const key=++seq;jobs.set(key,{fn,ms});return key;},cancel:key=>jobs.delete(key),
  fetcher:fetcher??(async(path,options)=>{requests.push({path,options});return path.endsWith('/config')?Response.json({available:true,consentVersion:STATION_EVENT_VERSION,runtimeGameId:null}):Response.json({ok:true,accepted:1});})});
 return {f,map,jobs,requests,setPrivacy:v=>gpc=v,setTime:v=>now=v,time:()=>now};
}
test('statistics require explicit choice; no event identifiers or requests before consent',async()=>{
 const s=setup();await s.f.refresh();assert.equal(s.f.snapshot().status,'choice');assert.equal(s.f.enqueue('track_view',{trackId}),false);assert.equal(s.f.snapshot().queued,0);assert.equal(s.map.has('stationcat.attribution.v1'),false);
 assert(s.f.accept());assert(s.f.enqueue('track_view',{trackId}));assert.equal(s.f.inspectQueue().length,1);assert(s.map.has(eventConsentKey));s.f.destroy();
});
test('GPC and shared old opt-out override saved consent; withdraw purges and aborts pending work',async()=>{
 const s=setup();await s.f.refresh();s.f.accept();s.f.enqueue('track_view',{trackId});s.setPrivacy(true);assert.equal(s.f.enqueue('track_view',{trackId}),false);assert.equal(s.f.snapshot().queued,0);assert.equal(s.f.snapshot().status,'privacy');assert.equal(s.f.accept(),false);
 s.setPrivacy(false);await s.f.refresh();s.f.accept();s.f.withdraw();assert.equal(s.map.get(eventOptOutKey),'1');assert.equal(s.f.snapshot().status,'declined');assert.equal(s.map.has(eventConsentKey),false);assert.equal(s.f.snapshot().queued,0);s.f.destroy();
});
test('disabled storage keeps explicit page-only consent and random memory scope, playback independent',async()=>{
 const store={getItem(){throw new Error('disabled');},setItem(){throw new Error('disabled');},removeItem(){throw new Error('disabled');}};const s=setup({storage:store});await s.f.refresh();assert(s.f.accept());assert(s.f.enqueue('track_view',{trackId}));
 const e=s.f.inspectQueue()[0];assert.equal(e.sessionScope,'memory');assert.match(e.sessionId,/^[a-f0-9-]{36}$/);await s.f.flush();assert.equal(s.f.snapshot().queued,0);s.f.withdraw();assert.equal(s.f.enqueue('track_view',{trackId}),false);s.f.destroy();
});
test('queue is bounded at 100, batches at 20 and failures retry the exact immutable event',async()=>{
 const calls=[];let failure=true;const s=setup({fetcher:async(path,o)=>{if(path.endsWith('/config'))return Response.json({available:true,consentVersion:STATION_EVENT_VERSION});calls.push(JSON.parse(o.body));if(failure)throw new Error('offline');return Response.json({ok:true});}});await s.f.refresh();s.f.accept();
 for(let i=0;i<120;i++)s.f.enqueue('track_view',{trackId});assert.equal(s.f.snapshot().queued,100);
 await s.f.flush();assert.equal(calls[0].events.length,20);failure=false;await s.f.flush();assert.equal(calls.length,1);s.setTime(s.time()+2000);await s.f.flush();assert.deepEqual(calls[1],calls[0]);assert.equal(s.f.snapshot().queued,80);s.f.destroy();
});
test('retry exhaustion drops only failed batch; 429 uses bounded Retry-After',async()=>{
 const s=setup({fetcher:async path=>path.endsWith('/config')?Response.json({available:true,consentVersion:STATION_EVENT_VERSION}):new Response(null,{status:429,headers:{'Retry-After':'30'}})});await s.f.refresh();s.f.accept();s.f.enqueue('track_view',{trackId});await s.f.flush();assert([...s.jobs.values()].some(j=>j.ms===30000));s.setTime(s.time()+30000);await s.f.flush();s.setTime(s.time()+30000);await s.f.flush();assert.equal(s.f.snapshot().queued,0);s.f.destroy();
});
test('Campaign changes affect new events only; malicious producer fields do not replace envelope',async()=>{
 const s=setup();await s.f.refresh();s.f.accept();s.f.enter({kind:'campaign',campaignId:'channel-a',source:'douyin',medium:'short_video',trackId,clipId:null});s.f.enqueue('track_view',{trackId,sessionId:'private-account',url:'secret'});const a=s.f.inspectQueue()[0];
 s.f.enter({kind:'campaign',campaignId:'channel-b',source:'youtube',medium:'short_video',trackId,clipId:null});s.f.enqueue('track_view',{trackId});const b=s.f.inspectQueue()[1];assert.equal(a.campaignId,'channel-a');assert.equal(b.campaignId,'channel-b');assert.equal(b.firstCampaignId,'channel-a');assert.equal(a.sessionId,b.sessionId);assert.notEqual(a.contextId,b.contextId);assert(!Object.hasOwn(a,'url'));assert.notEqual(a.sessionId,'private-account');s.f.destroy();
});
test('thirty-minute inactivity rotates random visit session while playback UUID belongs to media',async()=>{
 const s=setup();await s.f.refresh();s.f.accept();s.f.enqueue('track_view',{trackId});const id=s.f.inspectQueue()[0].sessionId;s.setTime(s.time()+30*60000);s.f.enqueue('track_view',{trackId});assert.notEqual(s.f.inspectQueue()[1].sessionId,id);s.f.destroy();
});
test('queued events spanning visit expiry are sent as separate valid session batches',async()=>{
 const s=setup();await s.f.refresh();s.f.accept();s.f.enqueue('track_view',{trackId});s.setTime(s.time()+30*60000);s.f.enqueue('track_view',{trackId});
 await s.f.flush();await s.f.flush();const batches=s.requests.filter(x=>x.path==='/api/station/events').map(x=>JSON.parse(x.options.body).events);
 assert.equal(batches.length,2);assert(batches.every(x=>x.length===1));assert.notEqual(batches[0][0].sessionId,batches[1][0].sessionId);assert.equal(s.f.snapshot().queued,0);s.f.destroy();
});
test('expired tab choice purges queued events and returns to an actionable choice',async()=>{
 const s=setup();await s.f.refresh();s.f.accept();s.f.enqueue('track_view',{trackId});s.setTime(s.time()+86400000);await s.f.refresh();
 assert.equal(s.f.snapshot().status,'choice');assert.equal(s.f.snapshot().enabled,false);assert.equal(s.f.snapshot().queued,0);assert.equal(s.map.has(eventConsentKey),false);assert(s.f.accept());s.f.destroy();
});
function media(kind='music'){
 const events=[];let time=0,visible=true,enabled=true;const playbackId=randomUUID();
 const m=createStationMediaMeasurement({kind,emit:(name,data)=>events.push({name,data}),clock:()=>time,visible:()=>visible,enabled:()=>enabled});
 const state={playbackId,trackId,clipId:kind==='clip'?clipId:null,variant:'preview',status:'playing',positionSec:0,seeking:false,nativeEnded:false};
 return {m,events,state,tick(seconds=1,patch={}){time+=seconds*1000;state.positionSec+=seconds;Object.assign(state,patch);m.observe(state);},observe:patch=>{Object.assign(state,patch);m.observe(state);},hide(){visible=false;m.resetSample();},show(){visible=true;m.resetSample();},enable:v=>enabled=v};
}
test('confirmed native playing only starts once; ten actual seconds qualifies once across pause/resume',()=>{
 const x=media();x.observe({status:'loading'});assert.equal(x.events.length,0);x.observe({status:'playing'});for(let i=0;i<5;i++)x.tick();x.observe({status:'paused'});x.tick(100,{status:'paused'});x.observe({status:'playing'});for(let i=0;i<5;i++)x.tick();assert.deepEqual(x.events.map(e=>e.name),['preview_start','preview_qualified']);assert.equal(x.events[1].data.listenedMs,10000);x.tick();assert.equal(x.events.length,2);
});
test('waiting, hidden time, seeks and long sample gaps never inflate foreground listening',()=>{
 const x=media();x.observe({});x.tick(1);x.observe({status:'buffering'});x.tick(20,{status:'buffering'});x.observe({status:'playing'});x.hide();x.tick(30);x.show();x.observe({});x.observe({seeking:true});x.tick(20,{seeking:false});x.tick(5);assert.equal(x.events.filter(e=>e.name==='preview_qualified').length,0);
});
test('actual ended may qualify short preview; seek alone or fake ended does not',()=>{
 const x=media();x.observe({});x.tick(.5);x.observe({seeking:true});x.tick(29,{seeking:false});assert.equal(x.events.length,1);x.observe({status:'ended',nativeEnded:false});assert.equal(x.events.length,1);x.observe({status:'ended',nativeEnded:true});assert.equal(x.events[1].name,'preview_qualified');assert.equal(x.events[1].data.mediaEnded,true);
});
test('clip complete uses ended and conservative major-skip rejection, never 90% elapsed',()=>{
 const clean=media('clip');clean.observe({});clean.tick(.5);clean.observe({status:'ended',nativeEnded:true});assert.deepEqual(clean.events.map(e=>e.name),['clip_start','clip_complete']);
 const skip=media('clip');skip.observe({});skip.tick();skip.observe({seeking:true});skip.tick(20,{seeking:false});skip.observe({status:'ended',nativeEnded:true});assert.deepEqual(skip.events.map(e=>e.name),['clip_start']);
});
test('full playback gets its own start; consent off and new playback reset measurement',()=>{
 const x=media();x.enable(false);x.observe({});x.tick(10);assert.equal(x.events.length,0);x.enable(true);x.observe({variant:'full'});assert.equal(x.events[0].name,'full_audio_start');x.observe({playbackId:randomUUID(),variant:'preview',positionSec:0});assert.equal(x.events[1].name,'preview_start');
});
