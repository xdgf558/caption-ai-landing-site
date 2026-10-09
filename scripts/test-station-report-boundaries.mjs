import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {reportFixture,reportSealSql} from './helpers/station-report-fixture.mjs';
import {event,eventRequest} from './helpers/station-event-fixture.mjs';
import {collectStationEvents,runStationEventRetention} from '../src/redesign/analyticsStore.js';
import {reportReadiness,readReport,saveReportSnapshot,saveExternalMetric} from '../src/redesign/reportsStore.js';
import {runStationReportAggregation} from '../src/redesign/reportsSchedule.js';
import {createContentController} from '../src/scripts/stationContentClient.js';
import {DAY,dayFloor} from '../src/redesign/reportsModel.js';
import {sealReportWindow,REPORT_SEAL_MIGRATION} from '../src/redesign/reportSealing.js';

const date=n=>new Date(n).toISOString().slice(0,10);
const context=now=>({actorId:'boundary-publisher@example.test',key:`r1_${now}_${randomUUID()}`});
function pauseAppend(db,pattern=/INSERT INTO station_analytics_events/){
  let release,entered;const blocked=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
  const s={prepare:q=>db.prepare(q),async batch(statements){
    if(statements.some(x=>pattern.test(x.query))){entered();await resume;}
    return db.batch(statements);
  }};
  return {db:{withSession:()=>s},blocked,release};
}
test('midnight in-flight event blocks both manual and daily snapshots until its append completes',async()=>{
  const end=dayFloor(Date.now()),before=end-1,after=end+1,f=await reportFixture({sample:false,now:after});
  let delayed,write;
  try{
    await runStationEventRetention(f.env,{clock:()=>before});
    await f.db.prepare('UPDATE station_track_publications SET published_at=MIN(published_at,?),edit_version=edit_version+1').bind(before-1000).run();
    delayed=pauseAppend(f.db);const env={...f.env,MUSIC_DB:delayed.db},e=event('track_view',{trackId:f.tracks[0].id});
    write=collectStationEvents(eventRequest([e]),env,[e],before);await delayed.blocked;
    const runtime=await reportReadiness(f.env),q={from:date(end-DAY),to:date(end)};
    await assert.rejects(saveReportSnapshot(runtime,f.env,q,context(after),{clock:()=>after}),{code:'REPORT_WINDOW_DRAINING'});
    await f.db.prepare('UPDATE station_report_health SET coverage_start=?,next_day=? WHERE singleton=1').bind(end-DAY,end-DAY).run();
    assert.equal((await runStationReportAggregation(f.env,{clock:()=>after})).reason,'REPORT_WINDOW_DRAINING');
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_report_snapshots').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_report_jobs').get().n,0);
    delayed.release();assert.equal((await write).accepted,1);
    await saveReportSnapshot(runtime,f.env,q,context(after),{clock:()=>after});
    assert.equal((await readReport(runtime,q,{clock:()=>after})).counts.track_view,1);
    const saved=JSON.parse(f.sql.prepare('SELECT stats_json FROM station_report_snapshots').get().stats_json);
    assert.equal(saved.track_view,1);
    await saveReportSnapshot(runtime,f.env,q,context(after),{clock:()=>after});
    assert.equal((await runStationReportAggregation(f.env,{clock:()=>after})).available,true);
    assert.equal(JSON.parse(f.sql.prepare('SELECT stats_json FROM station_report_snapshots WHERE query_key=(SELECT query_key FROM station_report_snapshots LIMIT 1)').get().stats_json).track_view,1);
  }finally{delayed?.release();await write?.catch(()=>{});f.sql.close();}
});
test('expired in-flight batch is fenced before sealing and cannot append late or receive a success',async()=>{
  const end=dayFloor(Date.now()),before=end-1,after=end+60001,f=await reportFixture({sample:false,now:after});let delayed,write;
  try{
    await runStationEventRetention(f.env,{clock:()=>before});await f.db.prepare('UPDATE station_track_publications SET published_at=MIN(published_at,?),edit_version=edit_version+1').bind(before-1000).run();
    delayed=pauseAppend(f.db);const e=event('track_view',{trackId:f.tracks[0].id});write=collectStationEvents(eventRequest([e]),{...f.env,MUSIC_DB:delayed.db},[e],before);const rejected=assert.rejects(write,{code:'EVENT_WRITE_FENCED',status:503});
    await delayed.blocked;const runtime=await reportReadiness(f.env),q={from:date(end-DAY),to:date(end)};
    await saveReportSnapshot(runtime,f.env,q,context(after),{clock:()=>after});delayed.release();await rejected;
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_analytics_events').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_event_inflight').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_publication_guards').get().n,0);
    assert.throws(()=>f.sql.prepare('UPDATE station_report_window_seal SET sealed_before=0').run(),/STATION_REPORT_SEAL_RETAINED/);
    await runStationEventRetention(f.env,{clock:()=>after});assert.equal((await collectStationEvents(eventRequest([e]),f.env,[e],after)).accepted,1);
    assert.equal(JSON.parse(f.sql.prepare('SELECT stats_json FROM station_report_snapshots').get().stats_json).track_view,0);
  }finally{delayed?.release();await write?.catch(()=>{});f.sql.close();}
});
test('a delayed registration and an older collector are rejected at the database boundary after sealing',async()=>{
  const end=dayFloor(Date.now()),before=end-1,after=end+1,f=await reportFixture({sample:false,now:after});let delayed,write;
  try{
    await runStationEventRetention(f.env,{clock:()=>before});delayed=pauseAppend(f.db,/INSERT INTO station_event_inflight/);
    const e=event('track_view',{trackId:f.tracks[0].id});write=collectStationEvents(eventRequest([e]),{...f.env,MUSIC_DB:delayed.db},[e],before);const rejected=assert.rejects(write,{code:'EVENT_WRITE_FENCED'});
    await delayed.blocked;await sealReportWindow(f.db,end,after);delayed.release();await rejected;
    assert.throws(()=>f.sql.prepare("INSERT INTO station_analytics_events(event_id,event_name,occurred_at,received_at,expires_at) VALUES(?,'track_view',?,?,?)").run(randomUUID(),before,before,before+90*DAY),/STATION_EVENT_WRITE_FENCED/);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_analytics_events').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_event_inflight').get().n,0);
  }finally{delayed?.release();await write?.catch(()=>{});f.sql.close();}
});
test('0018 invalidates unsealed archives but retains platform figures, their receipts and raw events',async()=>{
  const f=await reportFixture({sample:false,sealing:false}),now=Date.now(),end=dayFloor(now),start=end-DAY,id=randomUUID();
  try{
    await assert.rejects(reportReadiness(f.env),{code:'REPORT_SCHEMA_UNAVAILABLE'});
    const e=event('track_view',{trackId:f.tracks[0].id});assert.equal((await collectStationEvents(eventRequest([e]),f.env,[e],now)).accepted,1);
    const zero=Object.fromEntries(['track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete','game_launch_request','game_ready','save_success','visit_sessions','preview_sessions','click_sessions','unlinked_previews','unlinked_clicks','memory_events','time_anomalies'].map(k=>[k,0]));
    f.sql.prepare('INSERT INTO station_report_snapshots VALUES(?,?,?,?,?,?,?)').run(id,start,end,'{}',JSON.stringify(zero),now,end+365*DAY);
    f.sql.prepare("INSERT INTO station_report_jobs(window_start,window_end,keys_json,status,expires_at) VALUES(?,?,?,'pending',?)").run(start,end,'[{}]',end+365*DAY);
    const manual=randomUUID();f.sql.prepare("INSERT INTO station_external_metrics VALUES(?,?,NULL,NULL,'platform_plays','netease',7,'platform_export','本机合成导出',?,?,?,?,'active',1,?)").run(manual,f.tracks[0].id,start,end,now,now,end+365*DAY);
    for(const [kind,target]of [['aggregate_snapshot',id],['manual_platform_record',manual]])f.sql.prepare('INSERT INTO station_report_operations VALUES(?,?,?,?,?,?)').run('publisher','/reports/'+kind,`r1_${now}_${randomUUID()}`,'hash',JSON.stringify({id:target,kind}),now+DAY);
    f.sql.exec(reportSealSql);await f.db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(REPORT_SEAL_MIGRATION).run();
    assert.ok(await reportReadiness(f.env));assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_report_snapshots').get().n,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_report_jobs').get().n,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_report_operations').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_analytics_events').get().n,1);
    assert.equal(f.sql.prepare('SELECT id,value FROM station_external_metrics').get().id,manual);assert.equal(f.sql.prepare('SELECT id,value FROM station_external_metrics').get().value,7);
    assert.equal(f.sql.prepare('SELECT next_day FROM station_report_health').get().next_day,null);
  }finally{f.sql.close();}
});
test('successful platform insertion then a 401 preserves the command across reload and prevents a duplicate',async()=>{
  const f=await reportFixture({sample:false}),now=Date.now(),end=dayFloor(now),runtime=await reportReadiness(f.env);
  try{
    const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
    let rejectStatus=false,nonce=0;const calls=[];
    const request=async(path,op)=>{
      if(path==='/reports/status'){if(rejectStatus)throw Object.assign(new Error('auth'),{code:'ADMIN_AUTH_REQUIRED',status:401});return {actorId:'boundary-publisher@example.test',role:'publisher'};}
      calls.push(structuredClone(op));const result=await saveExternalMetric(runtime,f.env,null,op.body,{actorId:'boundary-publisher@example.test',key:op.key},{clock:()=>now});rejectStatus=true;return result;
    };
    const make=()=>createContentController({scope:'reports',request,storage,clock:()=>now,makeId:()=>`${randomUUID()}-${++nonce}`});
    const body={trackId:f.tracks[0].id,clipId:null,campaignId:null,metric:'platform_plays',provider:'netease',value:7,sourceKind:'platform_export',sourceLabel:'本机边界回归',from:new Date(end-DAY).toISOString(),to:new Date(end).toISOString(),observedAt:new Date(Math.floor(now/1000)*1000).toISOString(),recognized:true,status:'active'};
    const c=make();await c.connect();await assert.rejects(c.mutate('/reports/external','POST',body),{status:401});
    assert.ok(c.pending());await assert.rejects(c.mutate('/reports/external','POST',body));
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_external_metrics').get().n,1);
    rejectStatus=false;const restored=make();await restored.connect();await assert.rejects(restored.retry(),{status:401});
    assert.deepEqual(calls[0],calls[1]);assert.ok(restored.pending());assert.equal(nonce,1);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_external_metrics').get().n,1);
    rejectStatus=false;const recovered=make();await recovered.connect();const original=request;
    // Allow the final identity check after the same-key replay.
    const stable=createContentController({scope:'reports',storage,clock:()=>now,request:async(path,op)=>{const result=await original(path,op);if(op)rejectStatus=false;return result;}});
    await stable.connect();assert.equal((await stable.retry()).replayed,true);assert.equal(stable.pending(),null);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_external_metrics').get().n,1);
  }finally{f.sql.close();}
});
test('post-write identity or local journal failure preserves pending operations in both workspaces',async t=>{
  for(const scope of ['content','reports'])for(const fault of ['401','403','actor','storage'])await t.test(`${scope}: ${fault}`,async()=>{
    const values=new Map();let committed=false,failClear=false;
    const storage={getItem:k=>values.get(k)??null,setItem(k,v){if(failClear&&JSON.parse(v).pending===null)throw new Error('storage blocked');values.set(k,v);}};
    const request=async(path,op)=>{
      if(!op){if(committed&&['401','403'].includes(fault))throw Object.assign(new Error('auth'),{status:Number(fault),code:'ADMIN_AUTH_REQUIRED'});return {actorId:committed&&fault==='actor'?'other@example.test':'publisher@example.test',role:'publisher'};}
      committed=true;failClear=fault==='storage';return {id:'saved'};
    };
    const c=createContentController({scope,request,storage});await c.connect();
    await assert.rejects(c.mutate(scope==='reports'?'/reports/external':'/platforms','POST',{value:1}),e=>e.uncertain===true&&e.postWrite===true);
    assert.ok(c.pending());assert.ok(JSON.parse([...values.values()][0]).pending);
    await assert.rejects(c.mutate(scope==='reports'?'/reports/external':'/platforms','POST',{value:1}));
  });
});
test('a terminal authorization error during recovery cannot clear an earlier acknowledged operation',async()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let phase='after-success';
  const request=async(path,op)=>{if(!op){if(phase==='after-success'&&values.get('written'))throw Object.assign(new Error('auth'),{status:401});return {actorId:'publisher',role:'publisher'};}if(phase==='recovery')throw Object.assign(new Error('forbidden'),{status:403});values.set('written','yes');return {id:'saved'};};
  const c=createContentController({scope:'reports',request,storage});await c.connect();await assert.rejects(c.mutate('/reports/external','POST',{value:0}));const key=c.pending().key;
  phase='recovery';const restored=createContentController({scope:'reports',request,storage});await restored.connect();await assert.rejects(restored.retry(),{status:403});assert.equal(restored.pending().key,key);
  await assert.rejects(restored.mutate('/reports/external','POST',{value:0}));
});
