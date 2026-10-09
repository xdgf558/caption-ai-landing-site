import { primary, rows } from '../music/adminStore.js';
import { fail, mutationKey, text, editVersion } from '../music/adminValidation.js';
import { publicationHash } from '../music/publicationValidation.js';
import { DAY, REPORT_MIGRATION, REPORT_VERSION, REPORT_STATS, enabled, reportFlags, dayFloor, calendarYear, liveStart, queryKey, reportQuery, validateStats, reportView, externalInput, reportOperationStarted } from './reportsModel.js';
import { liveStats } from './reportsQuery.js';
import { REPORT_SEAL_MIGRATION, sealReportWindow } from './reportSealing.js';

export async function reportReadiness(env,{allowDisabled=false}={}){
  if(!allowDisabled&&!reportFlags(env))fail('STATION_REPORTS_DISABLED',503);
  if(!env.MUSIC_DB||env.MUSIC_DB===env.WAITLIST_DB)fail('REPORT_DATABASE_UNAVAILABLE',503);
  try{
    const s=primary(env.MUSIC_DB),r=await s.batch([
      s.prepare("SELECT name FROM d1_migrations WHERE name IN ('0016_station_event_collection.sql',?,?) ORDER BY name").bind(REPORT_MIGRATION,REPORT_SEAL_MIGRATION),
      s.prepare(`SELECT e.event_name,e.consent_version,e.session_id,e.received_at,e.track_id,e.clip_id,e.campaign_id,e.platform_link_id,e.session_scope,e.attribution_kind,e.campaign_source,e.time_anomaly,
        c.clip_id,p.provider FROM station_analytics_events e LEFT JOIN station_campaigns c ON c.id=e.campaign_id LEFT JOIN station_platform_links p ON p.id=e.platform_link_id AND p.track_id=e.track_id LIMIT 0`),
      s.prepare('SELECT id,window_start,window_end,query_key,stats_json,generated_at,expires_at FROM station_report_snapshots LIMIT 0'),
      s.prepare('SELECT window_start,window_end,keys_json,cursor,edit_version,status,expires_at FROM station_report_jobs LIMIT 0'),
      s.prepare(`SELECT h.coverage_start,h.next_day,h.last_sweep_at,h.last_aggregate_at,g.singleton,g.cutoff,w.sealed_before,w.updated_at,f.token,f.received_at,f.expires_at
        FROM station_report_health h JOIN station_report_window_seal w ON w.singleton=h.singleton
        LEFT JOIN station_report_retention_guard g ON g.singleton=h.singleton LEFT JOIN station_event_inflight f ON 1=1 LIMIT 0`),
      s.prepare('SELECT id,track_id,clip_id,campaign_id,metric,provider,value,source_kind,source_label,window_start,window_end,observed_at,updated_at,status,edit_version,expires_at FROM station_external_metrics LIMIT 0'),
      s.prepare('SELECT actor_id,route,idempotency_key,request_hash,result_json,expires_at FROM station_report_operations LIMIT 0')
    ]);r.forEach(rows);if(rows(r[0]).length!==3)throw new Error('ledger');return {db:env.MUSIC_DB,s};
  }catch{fail('REPORT_SCHEMA_UNAVAILABLE',503);}
}
export async function reportHealth(s,now){
  const r=(await s.batch([
    s.prepare('SELECT coverage_start,next_day,last_sweep_at,last_aggregate_at FROM station_report_health WHERE singleton=1'),
    s.prepare(`SELECT EXISTS(SELECT 1 FROM station_report_snapshots WHERE expires_at<=?) OR EXISTS(SELECT 1 FROM station_report_jobs WHERE expires_at<=?)
      OR EXISTS(SELECT 1 FROM station_external_metrics WHERE expires_at<=?) OR EXISTS(SELECT 1 FROM station_report_operations WHERE expires_at<=?) AS pending`).bind(now,now,now,now)
  ])).map(rows),h=r[0][0];if(!h)fail('REPORT_SCHEMA_UNAVAILABLE',503);
  return {coverageStart:h.coverage_start,nextDay:h.next_day,lastSweepAt:h.last_sweep_at,lastAggregateAt:h.last_aggregate_at,
    retentionReady:h.last_sweep_at>0&&h.last_sweep_at<=now&&now-h.last_sweep_at<=2*3600000&&r[1][0]?.pending===0};
}
export async function reportWriteReady(env,s,now){
  if(!enabled(env.STATION_REPORT_RETENTION_ENABLED)||!reportFlags(env)||!(await reportHealth(s,now)).retentionReady)fail('REPORT_RETENTION_UNREADY',503);
}
export async function validateDimensions(s,f){
  const checks=[],params=[];
  if(f.trackId){checks.push('EXISTS(SELECT 1 FROM music_tracks WHERE id=?)');params.push(f.trackId);}
  if(f.clipId){checks.push('EXISTS(SELECT 1 FROM station_clips WHERE id=?'+(f.trackId?' AND track_id=?':'')+')');params.push(f.clipId,...(f.trackId?[f.trackId]:[]));}
  if(f.campaignId){checks.push('EXISTS(SELECT 1 FROM station_campaigns WHERE id=?'+(f.trackId?' AND track_id=?':'')+')');params.push(f.campaignId,...(f.trackId?[f.trackId]:[]));}
  if(checks.length&&rows(await s.prepare('SELECT '+checks.join(' AND ')+' AS valid').bind(...params).all())[0]?.valid!==1)fail('REPORT_DIMENSION_INVALID',400);
  // A Campaign's registered material may differ from the actual clip event; the
  // effective material is determined per receipt. Do not enforce a false equality.
}
export async function reportOptions(s){
  const r=(await s.batch([
    s.prepare(`SELECT t.id,t.slug,r.metadata_json FROM music_tracks t LEFT JOIN station_track_publications p ON p.track_id=t.id
      LEFT JOIN station_track_revisions r ON r.track_id=t.id AND r.revision=COALESCE(p.published_revision,p.draft_revision) ORDER BY t.slug LIMIT 201`),
    s.prepare('SELECT id,track_id,clip_id,source,medium FROM station_campaigns ORDER BY id LIMIT 201'),
    s.prepare('SELECT id,track_id FROM station_clips ORDER BY id LIMIT 201')
  ])).map(rows);if(r.some(a=>a.length>200))fail('REPORT_OPTION_BUDGET',422);
  return {tracks:r[0].map(t=>{let m={};try{m=JSON.parse(t.metadata_json)??{};}catch{}const title=m.title?.[m.originalLocale];return {id:t.id,label:typeof title==='string'?title:t.slug};}),
    campaigns:r[1].map(c=>({id:c.id,trackId:c.track_id,clipId:c.clip_id,source:c.source,medium:c.medium})),clips:r[2].map(c=>({id:c.id,trackId:c.track_id})),
    sources:[...new Set(['direct_or_unknown','unknown',...r[1].map(c=>'campaign:'+c.source)])].sort()};
}
const zero=()=>Object.fromEntries(REPORT_STATS.map(k=>[k,0]));
export async function externalRecords(s,q,now){
  const clauses=['x.expires_at>?','x.window_start<?','x.window_end>?'],params=[now,q.end,q.start],f=q.filters;
  if(f.trackId){clauses.push('x.track_id=?');params.push(f.trackId);}
  if(f.provider){clauses.push('x.provider=?');params.push(f.provider);}
  if(f.clipId){clauses.push('(x.clip_id=? OR x.clip_id IS NULL)');params.push(f.clipId);}
  if(f.campaignId){clauses.push('(x.campaign_id=? OR x.campaign_id IS NULL)');params.push(f.campaignId);}
  if(f.source){clauses.push('(c.source=? OR x.campaign_id IS NULL)');params.push(f.source.startsWith('campaign:')?f.source.slice(9):'');}
  const records=rows(await s.prepare(`SELECT x.*,c.source AS campaign_source FROM station_external_metrics x LEFT JOIN station_campaigns c ON c.id=x.campaign_id
    WHERE ${clauses.join(' AND ')} ORDER BY x.updated_at DESC,x.id LIMIT 101`).bind(...params).all());
  if(records.length>100)fail('REPORT_EXTERNAL_BUDGET',422);
  return records.map(r=>({id:r.id,trackId:r.track_id,clipId:r.clip_id,campaignId:r.campaign_id,metric:r.metric,provider:r.provider,value:r.value,
    sourceKind:r.source_kind,sourceLabel:r.source_label,from:r.window_start,to:r.window_end,observedAt:r.observed_at,updatedAt:r.updated_at,status:r.status,editVersion:r.edit_version,
    aligned:r.window_start===q.start&&r.window_end===q.end&&f.trackId!==null&&r.track_id===f.trackId&&f.provider!==null&&r.provider===f.provider&&r.clip_id===f.clipId&&r.campaign_id===f.campaignId&&(!f.source||(f.source.startsWith('campaign:')&&r.campaign_source===f.source.slice(9)))}));
}
export async function readReport(runtime,input,{clock=Date.now}={}){
  const now=clock(),q=reportQuery(input,now),s=runtime.s;await validateDimensions(s,q.filters);
  let stats=null,unique=true,basis='missing',generatedAt=null,daily=[];
  if(q.start>=liveStart(now)){stats=await liveStats(s,{...q,end:Math.min(q.end,now)});basis='live';generatedAt=now;}
  else{
    const exact=rows(await s.prepare('SELECT stats_json,generated_at FROM station_report_snapshots WHERE window_start=? AND window_end=? AND query_key=? AND expires_at>?')
      .bind(q.start,q.end,queryKey(q.filters),now).all())[0];
    if(exact){stats=validateStats(JSON.parse(exact.stats_json));basis='snapshot';generatedAt=exact.generated_at;}
    else{
      const r=(await s.batch([
        s.prepare('SELECT window_start,stats_json,generated_at FROM station_report_snapshots WHERE window_start>=? AND window_end<=? AND window_end=window_start+? AND query_key=? AND expires_at>? ORDER BY window_start LIMIT 31').bind(q.start,q.end,DAY,queryKey(q.filters),now),
        s.prepare('SELECT window_start,status FROM station_report_jobs WHERE window_start>=? AND window_end<=? AND expires_at>? ORDER BY window_start LIMIT 31').bind(q.start,q.end,now)
      ])).map(rows);const snapshots=new Map(r[0].map(x=>[x.window_start,x])),jobs=new Map(r[1].map(x=>[x.window_start,x]));
      for(let day=q.start;day<q.end;day+=DAY){const snap=snapshots.get(day),complete=jobs.get(day)?.status==='complete';
        const value=snap?validateStats(JSON.parse(snap.stats_json)):complete?zero():null;
        daily.push({from:day,to:day+DAY,available:value!==null,...reportView(value),generatedAt:snap?.generated_at??null});
      }
      if(daily.every(d=>d.available)){
        stats=zero();for(const day of daily){for(const k of Object.keys(day.counts))stats[k]+=day.counts[k];stats.unlinked_previews+=day.previewRate.unlinked;stats.unlinked_clicks+=day.platformRate.unlinked;stats.memory_events+=day.memoryEvents;stats.time_anomalies+=day.timeAnomalies;}
        // Sum event totals only. Daily session counts and rates cannot be added.
        unique=daily.length===1;if(unique){const snap=snapshots.get(q.start);stats=snap?validateStats(JSON.parse(snap.stats_json)):zero();}
        basis='daily';generatedAt=Math.max(...r[0].map(x=>x.generated_at),0)||null;
      }
    }
  }
  return {version:REPORT_VERSION,from:q.start,to:q.end,asOf:now,partial:q.end>now,filters:q.filters,available:stats!==null,basis,generatedAt,
    ...reportView(stats,unique),daily,external:await externalRecords(s,q,now),health:await reportHealth(s,now),
    definitions:{clock:'received_at',window:'[from,to) UTC',denominator:'distinct session_id + track_id in selected track_view receipts',linkWindowMs:1800000,
      provider:'filters platform_click only; visits and previews retain the selected cohort',scope:'consented accepted receipts, not unique visitors',qualified:'10 seconds of actual foreground playback OR native ended',save:'local write and readback only',external:'manual platform figures; never derived from clicks; never summed automatically'}};
}
// Separate, short-lived operation receipts. The old permanent mutation journal
// never receives report values, source labels or visitor identifiers.
export async function reportMutation(runtime,{actorId,key,route,command,clock=Date.now},build){
  text(actorId,200);mutationKey(key);const now=clock(),started=reportOperationStarted(key,now),hash=await publicationHash(command),s=runtime.s;
  const receipt=async()=>{const r=rows(await s.prepare('SELECT request_hash,result_json,expires_at FROM station_report_operations WHERE actor_id=? AND route=? AND idempotency_key=?').bind(actorId,route,key).all())[0];
    if(!r)return null;if(r.expires_at<=now)fail('REPORT_OPERATION_EXPIRED',409);if(r.request_hash!==hash)fail('IDEMPOTENCY_CONFLICT',409);return {...JSON.parse(r.result_json),replayed:true};};
  try{
    const prior=await receipt();if(prior)return prior;
    const plan=await build(s,now),token=crypto.randomUUID(),batch=[s.prepare(`INSERT INTO music_publication_guards(operation_token,passed) VALUES(?,CASE WHEN (${plan.condition})
      AND NOT EXISTS(SELECT 1 FROM station_report_operations WHERE actor_id=? AND route=? AND idempotency_key=?) THEN 1 ELSE NULL END)`).bind(token,...plan.params,actorId,route,key)];
    const checked=statement=>{batch.push(statement,s.prepare('UPDATE music_publication_guards SET passed=CASE WHEN changes()=1 THEN 1 ELSE NULL END WHERE operation_token=?').bind(token));};
    plan.writes.forEach(checked);
    checked(s.prepare('INSERT INTO music_admin_audit_logs(id,actor_id,action,target_id,summary_json,request_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .bind(token,actorId,plan.action,plan.targetId,JSON.stringify(plan.summary),token,now));
    checked(s.prepare('INSERT INTO station_report_operations(actor_id,route,idempotency_key,request_hash,result_json,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(actorId,route,key,hash,JSON.stringify(plan.result),started+DAY));batch.push(s.prepare('DELETE FROM music_publication_guards WHERE operation_token=?').bind(token));
    (await s.batch(batch)).forEach(rows);const saved=await receipt();if(!saved)fail('REPORT_DATABASE_UNAVAILABLE',503);return {...saved,replayed:false};
  }catch(error){try{const saved=await receipt();if(saved)return saved;}catch(e){if(e.code==='IDEMPOTENCY_CONFLICT'||e.code==='REPORT_OPERATION_EXPIRED')throw e;}
    if(error.status)throw error;if(/music_publication_guards\.passed|UNIQUE constraint|STATION_REPORT_EDIT_CONFLICT/.test(String(error.message)))fail('REPORT_EDIT_CONFLICT',409);fail('REPORT_DATABASE_UNAVAILABLE',503);}
}
export async function saveReportSnapshot(runtime,env,input,context,{clock=Date.now}={}){
  if(!enabled(env.STATION_REPORT_AGGREGATION_ENABLED))fail('REPORT_AGGREGATION_DISABLED',503);
  const now=clock(),q=reportQuery(input,now);if(q.end>now||q.start<liveStart(now))fail('REPORT_SNAPSHOT_WINDOW_INVALID',422);
  await reportWriteReady(env,runtime.s,now);await validateDimensions(runtime.s,q.filters);
  return reportMutation(runtime,{...context,route:'/reports/snapshots',command:q,clock},async(s,stamp)=>{
    await sealReportWindow(s,q.end,stamp);
    const old=rows(await s.prepare('SELECT id FROM station_report_snapshots WHERE window_start=? AND window_end=? AND query_key=?').bind(q.start,q.end,queryKey(q.filters)).all())[0];
    const id=old?.id??crypto.randomUUID(),stats=old?null:await liveStats(s,q);
    return {condition:old?'EXISTS(SELECT 1 FROM station_report_snapshots WHERE id=?)':'NOT EXISTS(SELECT 1 FROM station_report_snapshots WHERE window_start=? AND window_end=? AND query_key=?)',params:old?[id]:[q.start,q.end,queryKey(q.filters)],
      writes:old?[]:[s.prepare('INSERT INTO station_report_snapshots(id,window_start,window_end,query_key,stats_json,generated_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,q.start,q.end,queryKey(q.filters),JSON.stringify(stats),stamp,calendarYear(q.end))],
      action:'station.report.snapshot',targetId:id,summary:{kind:'aggregate_snapshot',existing:!!old},result:{id,kind:'aggregate_snapshot',saved:true}};
  });
}
export async function saveExternalMetric(runtime,env,id,input,context,{clock=Date.now}={}){
  const now=clock(),data=externalInput(input,now),version=id?editVersion(context.ifMatch):null;await reportWriteReady(env,runtime.s,now);await validateDimensions(runtime.s,data);
  if(id&&typeof id!=='string')fail('INVALID_INPUT',400);
  return reportMutation(runtime,{...context,route:'/reports/external'+(id?'/'+id:''),command:{data,version},clock},async(s,stamp)=>{
    const old=id?rows(await s.prepare('SELECT * FROM station_external_metrics WHERE id=? AND expires_at>?').bind(id,stamp).all())[0]:null;
    if(id&&!old)fail('NOT_FOUND',404);
    if(old&&(old.edit_version!==version||old.track_id!==data.trackId||old.clip_id!==data.clipId||old.campaign_id!==data.campaignId||old.metric!==data.metric||old.provider!==data.provider||old.window_start!==data.start||old.window_end!==data.end))fail('REPORT_EDIT_CONFLICT',409);
    const target=id??crypto.randomUUID(),next=(version??0)+1;
    const write=old?s.prepare('UPDATE station_external_metrics SET value=?,source_kind=?,source_label=?,observed_at=?,updated_at=?,status=?,edit_version=? WHERE id=? AND edit_version=?').bind(data.value,data.sourceKind,data.sourceLabel,data.observed,stamp,data.status,next,target,version):
      s.prepare('INSERT INTO station_external_metrics(id,track_id,clip_id,campaign_id,metric,provider,value,source_kind,source_label,window_start,window_end,observed_at,updated_at,status,edit_version,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(target,data.trackId,data.clipId,data.campaignId,data.metric,data.provider,data.value,data.sourceKind,data.sourceLabel,data.start,data.end,data.observed,stamp,data.status,next,calendarYear(data.end));
    return {condition:old?'EXISTS(SELECT 1 FROM station_external_metrics WHERE id=? AND edit_version=?)':'1',params:old?[target,version]:[],writes:[write],
      action:'station.report.external',targetId:target,summary:{kind:'manual_platform_record',editVersion:next,status:data.status},result:{id:target,kind:'manual_platform_record',editVersion:next,status:data.status}};
  });
}
