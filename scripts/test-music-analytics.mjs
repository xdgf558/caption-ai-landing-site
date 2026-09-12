import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {musicTestDatabase} from './helpers/music-test-database.mjs';
import {seedAnalyticsTrack} from './helpers/music-analytics-fixture.mjs';
import {handleMusicAnalytics,readMusicAnalytics,runMusicAnalyticsRetention,MUSIC_ANALYTICS_VERSION} from '../src/music/analytics.js';
import {handleMusicAdmin} from '../src/music/adminHttp.js';

const NOW=Date.parse('2026-09-11T12:00:30Z'), DAY=86400000;
const envelope=events=>({consentVersion:MUSIC_ANALYTICS_VERSION,events});
async function fixture(t,patch={}) {
  const f=musicTestDatabase(); t.after(()=>f.sql.close());
  const env={MUSIC_DB:f.db,WAITLIST_DB:{withSession(){throw new Error('identity database forbidden');}},
    MUSIC_PUBLIC_ENABLED:'true',MUSIC_ANALYTICS_ENABLED:'true',MUSIC_ANALYTICS_PRIVACY_VERSION:MUSIC_ANALYTICS_VERSION,
    MUSIC_ANALYTICS_RETENTION_ENABLED:'true',MUSIC_RATE_LIMIT_SECRET:'analytics-fixture-only-not-a-production-secret',...patch};
  const track=await seedAnalyticsTrack(f.db,{now:NOW}), session=randomUUID();
  let time=NOW;
  const event=(type='play_start',overrides={})=>({eventId:randomUUID(),eventType:type,playSessionId:randomUUID(),anonymousSessionId:session,
    trackId:track.id,revisionNo:1,variant:'full',occurredAt:time,listenedMs:0,entrySource:'player',...overrides});
  const request=(input,options={})=>new Request('https://music.example.test'+(options.path||'/api/music/events'),{
    method:options.method||'POST',headers:{Origin:'https://music.example.test','Content-Type':'application/json',
      'X-Requested-With':'StationCatMusicAnalytics','CF-Connecting-IP':'192.0.2.1',...options.headers},
    ...(input===undefined ? {} : {body:typeof input==='string' ? input : JSON.stringify(input)})});
  const send=(events,options={})=>handleMusicAnalytics(request(envelope(events),options),env,{clock:()=>time});
  const sweep=()=>runMusicAnalyticsRetention(env,{clock:()=>time});
  const count=table=>f.sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  await sweep();
  return {...f,env,track,event,send,request,count,sweep,time:value=>{time=value;}};
}
async function expect(response,status,code) {
  assert.equal(response.status,status); const data=await response.json();
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  if(code) assert.equal(data.error?.code,code); return data;
}
test('disabled switches and absent privacy configuration perform zero D1/R2 reads',async()=>{
  let calls=0;
  const db={withSession(){calls++;throw new Error('must not read');}};
  for(const env of [{},{MUSIC_PUBLIC_ENABLED:'true'},{MUSIC_PUBLIC_ENABLED:'true',MUSIC_ANALYTICS_ENABLED:'true'},
    {MUSIC_PUBLIC_ENABLED:'true',MUSIC_ANALYTICS_ENABLED:'true',MUSIC_ANALYTICS_PRIVACY_VERSION:MUSIC_ANALYTICS_VERSION}]) {
    const base={...env,MUSIC_DB:db};
    await expect(await handleMusicAnalytics(new Request('https://music.test/api/music/events',{method:'POST'}),base),503);
    const config=await expect(await handleMusicAnalytics(new Request('https://music.test/api/music/analytics/config'),base),200);
    assert.equal(config.available,false);
    assert.equal((await readMusicAnalytics(base,{}, {clock:()=>NOW})).available,false);
  }
  assert.equal(calls,0);
});
test('strict envelope, types, 20 events, time skew, credentials and server-only event rejection',async t=>{
  const f=await fixture(t), e=f.event(), before=f.dump();
  for(const change of [{email:'private@example.test'},{metadata:{}},{revisionNo:'1'},{occurredAt:NOW-300001},
    {occurredAt:NOW+300001},{listenedMs:-1},{variant:'vip'},{entrySource:'https://evil.test'},{accountId:'123'}]) {
    await expect(await f.send([{...e,...change}]),400);
  }
  for(const type of ['vip_grant_confirmed','vip_grant_reversed']) await expect(await f.send([{...e,eventType:type}]),403,'MUSIC_ANALYTICS_SERVER_EVENT_ONLY');
  await expect(await f.send(Array.from({length:21},()=>f.event())),400);
  await expect(await f.send([e,f.event('play_start',{anonymousSessionId:randomUUID()})]),400);
  await expect(await f.send([e],{headers:{Origin:'https://evil.test'}}),403);
  await expect(await f.send([e],{headers:{'CF-Connecting-IP':'','X-Forwarded-For':'192.0.2.1'}}),503);
  await expect(await handleMusicAnalytics(f.request({events:[e],consentVersion:'old'}),f.env,{clock:()=>NOW}),400);
  assert.deepEqual(f.dump(),before);
});
test('real streamed body cap applies without Content-Length, including UTF-8 bytes',async t=>{
  const f=await fixture(t);
  const req=f.request(' '.repeat(16385)); await expect(await handleMusicAnalytics(req,f.env),413);
  await expect(await handleMusicAnalytics(f.request('猫'.repeat(6000)),f.env),413);
  await expect(await handleMusicAnalytics(f.request('{}',{headers:{'Content-Length':'90000'}}),f.env),413);
  await expect(await handleMusicAnalytics(f.request('{}',{headers:{'Content-Length':'1'}}),f.env),400);
  await expect(await handleMusicAnalytics(f.request('{}',{headers:{'Content-Encoding':'gzip'}}),f.env),415);
  assert.equal(f.count('music_analytics_events'),0);
});
test('published revision/variant/duration are checked in the same event transaction',async t=>{
  const f=await fixture(t), start=f.event();
  for(const invalid of [{trackId:randomUUID()},{revisionNo:2},{eventType:'qualified_play',listenedMs:30000},
    {eventType:'preview_end'},{eventType:'play_start',listenedMs:1}]) await expect(await f.send([{...start,...invalid}]),400);
  await expect(await f.send([start,{...f.event('qualified_play'),playSessionId:start.playSessionId,listenedMs:29999}]),400);
  assert.equal(f.count('music_analytics_events'),0);
  f.state.beforeWrite=()=>{ f.state.beforeWrite=()=>f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(f.track.id); };
  await expect(await f.send([start]),400); assert.equal(f.count('music_analytics_events'),0);
});
test('lost receipt replay, per-play milestones and rolling qualified dedupe increment daily once',async t=>{
  const f=await fixture(t), start=f.event(), qualified=f.event('qualified_play',{playSessionId:start.playSessionId,listenedMs:30000});
  // Lose the event transaction acknowledgement, after successful rate admission.
  f.state.beforeWrite=()=>{f.state.beforeWrite=()=>{f.state.lose=true;};};
  await expect(await f.send([start,qualified]),503);
  assert.equal(f.count('music_analytics_events'),2);
  assert.equal((await expect(await f.send([start,qualified]),200)).accepted,0);
  const second=f.event();
  assert.equal((await expect(await f.send([second,f.event('qualified_play',{playSessionId:second.playSessionId,listenedMs:30000})]),200)).accepted,1);
  assert.equal(f.sql.prepare("SELECT value FROM music_analytics_daily WHERE metric='qualified_play'").get().value,1);
  f.time(NOW+1800000); await f.sweep();
  const third=f.event(); await expect(await f.send([third,f.event('qualified_play',{playSessionId:third.playSessionId,listenedMs:30000})]),200);
  assert.equal(f.sql.prepare("SELECT value FROM music_analytics_daily WHERE metric='qualified_play'").get().value,2);
});
test('preview completion and free/VIP full totals stay separate, with server-derived access policy',async t=>{
  const f=await fixture(t), free=await seedAnalyticsTrack(f.db,{now:NOW,accessMode:'free'});
  const preview=f.event('play_start',{variant:'preview'}), full=f.event('play_start',{trackId:free.id});
  await expect(await f.send([preview,f.event('qualified_play',{variant:'preview',playSessionId:preview.playSessionId,listenedMs:15000}),
    f.event('play_complete',{variant:'preview',playSessionId:preview.playSessionId,listenedMs:27000}),
    f.event('preview_end',{variant:'preview',playSessionId:preview.playSessionId,listenedMs:30000}),full]),200);
  const result=await readMusicAnalytics(f.env,{}, {clock:()=>NOW}); assert.equal(result.available,true);
  assert.equal(result.metrics.find(r=>r.metric==='play_complete').variant,'preview');
  assert.equal(result.metrics.find(r=>r.metric==='play_start' && r.variant==='full').accessKind,'free');
  assert.equal(result.unavailableMetrics.paidActivations.available,false);
  assert.doesNotMatch(JSON.stringify(result),/anonymousSessionId|playSessionId|object_key|192\.0|fixture-only-not/);
});
test('60 event units per minute, source/global rollback and rotating sessions cannot bypass limits',async t=>{
  const f=await fixture(t);
  const replies=await Promise.all(Array.from({length:9},()=>f.send(Array.from({length:20},()=>f.event()))));
  assert.equal(replies.filter(r=>r.status===200).length,3);
  assert.ok(replies.filter(r=>r.status!==200).every(r=>r.status===429 && r.headers.get('retry-after')==='30'));
  assert.deepEqual(f.sql.prepare('SELECT hits FROM music_analytics_rates').all().map(r=>r.hits),[60,60,60]);
  f.sql.prepare("UPDATE music_analytics_rates SET hits=600 WHERE scope='source'").run();
  const before=f.sql.prepare('SELECT * FROM music_analytics_rates ORDER BY scope').all();
  await expect(await f.send([f.event('play_start',{anonymousSessionId:randomUUID()})]),429);
  assert.deepEqual(f.sql.prepare('SELECT * FROM music_analytics_rates ORDER BY scope').all(),before);
  f.sql.prepare("UPDATE music_analytics_rates SET hits=12000 WHERE scope='global'").run();
  await expect(await f.send([f.event('play_start',{anonymousSessionId:randomUUID()})],{headers:{'CF-Connecting-IP':'192.0.2.2'}}),429);
  assert.deepEqual(f.sql.prepare("SELECT hits FROM music_analytics_rates WHERE scope<>'global'").all().map(r=>r.hits),[60,600]);
});
test('counter or aggregate faults fail closed; event and daily insert roll back together',async t=>{
  const f=await fixture(t);
  f.sql.exec("CREATE TRIGGER fail_global BEFORE INSERT ON music_analytics_rates WHEN NEW.scope='global' BEGIN SELECT RAISE(ABORT,'injected'); END;");
  await expect(await f.send([f.event()]),503); assert.equal(f.count('music_analytics_rates'),0);
  f.sql.exec('DROP TRIGGER fail_global');
  f.sql.exec("CREATE TRIGGER ignore_global BEFORE INSERT ON music_analytics_rates WHEN NEW.scope='global' BEGIN SELECT RAISE(IGNORE); END;");
  await expect(await f.send([f.event()]),503); assert.equal(f.count('music_analytics_rates'),0);
  f.sql.exec('DROP TRIGGER ignore_global');
  f.sql.exec("CREATE TRIGGER fail_daily BEFORE INSERT ON music_analytics_daily BEGIN SELECT RAISE(IGNORE); END;");
  await expect(await f.send([f.event()]),503);
  assert.equal(f.count('music_analytics_events'),0); assert.equal(f.count('music_analytics_daily'),0);
});
test('retention is bounded, runs with collection disabled, and stale/missing sweeps close admission',async t=>{
  const f=await fixture(t); await expect(await f.send([f.event()]),200);
  f.sql.prepare('UPDATE music_analytics_events SET received_at=?').run(NOW-30*DAY);
  f.sql.prepare('UPDATE music_analytics_daily SET day_start_ms=?').run(Math.floor((NOW-365*DAY)/DAY)*DAY);
  f.sql.prepare('INSERT INTO music_membership_attributions VALUES(?,?,?,?,?,?)').run(randomUUID(),randomUUID(),f.track.id,NOW-90*DAY,'unavailable',null);
  await expect(await f.send([f.event()]),503,'MUSIC_ANALYTICS_RETENTION_UNREADY');
  f.env.MUSIC_ANALYTICS_ENABLED='false'; assert.equal((await f.sweep()).available,true);
  for(const table of ['music_analytics_events','music_analytics_daily','music_membership_attributions']) assert.equal(f.count(table),0);
  f.env.MUSIC_ANALYTICS_ENABLED='true'; f.time(NOW+7200001);
  await expect(await f.send([f.event()]),503,'MUSIC_ANALYTICS_RETENTION_UNREADY');
  f.env.MUSIC_ANALYTICS_RETENTION_ENABLED='false'; const before=f.dump(); await f.sweep(); assert.deepEqual(f.dump(),before);
});
test('admin Access precedes analytics; no data is unavailable, never fabricated zero',async t=>{
  const f=await fixture(t), req=new Request('https://music.test/admin/api/music/analytics');
  f.sql.prepare('UPDATE music_analytics_health SET last_sweep_at=?').run(Date.now());
  assert.equal((await handleMusicAdmin(req,f.env,async()=>null)).status,401);
  const response=await handleMusicAdmin(req,f.env,async()=>'fixture-admin'); assert.equal(response.status,200);
  const result=await response.json(); assert.equal(result.available,false); assert.equal(result.reason,'NO_DATA'); assert.deepEqual(result.metrics,[]);
  for(const query of [{from:'2026-02-30'},{from:'2026-08-01',to:'2026-09-11'},{from:'https://evil.test'},{account:'123'}]) {
    await assert.rejects(()=>readMusicAnalytics(f.env,query,{clock:()=>NOW}),e=>e.status===400);
  }
  const worker=readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
  assert.match(worker,/if \(isMusicAnalyticsPath\(url.pathname\)\) return handleMusicAnalytics\(request, env\)/);
  assert.match(worker,/runMusicAnalyticsRetention\(env\)/);
});

test('retention backlog never marks an incomplete bounded pass healthy',async t=>{
  const f=await fixture(t), expired=Math.floor((NOW-3*3600000)/60000)*60000;
  const insert=f.sql.prepare("INSERT INTO music_analytics_rates VALUES('session',?,?,1)");
  for(let i=0;i<1001;i++) insert.run(expired,String(i).padStart(64,'0'));
  const pass=await runMusicAnalyticsRetention(f.env,{clock:()=>NOW,rounds:1});
  assert.equal(pass.reason,'RETENTION_BACKLOG');assert.equal(f.count('music_analytics_rates'),1);
  assert.equal((await f.sweep()).available,true);assert.equal(f.count('music_analytics_rates'),0);
});
