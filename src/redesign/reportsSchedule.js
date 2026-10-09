import { rows } from '../music/adminStore.js';
import { fail } from '../music/adminValidation.js';
import { DAY, REPORT_VERSION, REPORT_STATS, enabled, reportFlags, dayFloor, calendarYear, liveStart, queryKey, filters } from './reportsModel.js';
import { statsSql, dailyKeys } from './reportsQuery.js';
import { reportReadiness, reportHealth } from './reportsStore.js';
import { sealReportWindow } from './reportSealing.js';

// Report expiry and short-lived flight revocation only. Reader erasure, content
// and raw-event TTL remain independent. Disabled queries do not stop expiry.
export async function runStationReportRetention(env,{clock=Date.now,runtime}={}){
  if(!enabled(env.STATION_REPORT_RETENTION_ENABLED)||env.STATION_REPORT_POLICY_VERSION!==REPORT_VERSION)return {available:false,reason:'RETENTION_DISABLED'};
  try{
    const now=clock(),{s}=runtime??await reportReadiness(env,{allowDisabled:true});
    const tables=['station_report_snapshots','station_report_jobs','station_external_metrics','station_report_operations'];
    const r=await s.batch([
      s.prepare('INSERT INTO station_report_retention_guard(singleton,cutoff) VALUES(1,?)').bind(now),
      s.prepare('DELETE FROM station_event_inflight WHERE expires_at<=?').bind(now),
      ...tables.map(t=>s.prepare(`DELETE FROM ${t} WHERE rowid IN (SELECT rowid FROM ${t} WHERE expires_at<=? ORDER BY expires_at LIMIT 1000)`).bind(now)),
      s.prepare('DELETE FROM station_report_retention_guard WHERE singleton=1'),
      s.prepare('SELECT '+tables.map(t=>`EXISTS(SELECT 1 FROM ${t} WHERE expires_at<=?)`).join(' OR ')+' AS pending').bind(now,now,now,now)
    ]);r.forEach(rows);
    if(rows(r.at(-1))[0]?.pending!==0)return {available:false,reason:'REPORT_RETENTION_BACKLOG'};
    rows(await s.prepare('UPDATE station_report_health SET last_sweep_at=? WHERE singleton=1 RETURNING singleton').bind(now).all());return {available:true,pending:false};
  }catch{return {available:false,reason:'REPORT_RETENTION_UNAVAILABLE'};}
}
export async function runStationReportAggregation(env,{clock=Date.now,runtime,batchSize=16}={}){
  if(!reportFlags(env)||!enabled(env.STATION_REPORT_AGGREGATION_ENABLED)||!enabled(env.STATION_REPORT_RETENTION_ENABLED))return {available:false,reason:'AGGREGATION_DISABLED'};
  try{
    const now=clock(),{s}=runtime??await reportReadiness(env);if(!Number.isInteger(batchSize)||batchSize<1||batchSize>16)fail('INVALID_INPUT',400);
    const health=await reportHealth(s,now);if(!health.retentionReady)return {available:false,reason:'REPORT_RETENTION_UNREADY'};
    let day=health.nextDay;
    if(day===null){
      const oldest=rows(await s.prepare("SELECT MIN(received_at) AS first FROM station_analytics_events WHERE consent_version='station-events-v1' AND received_at>=?").bind(liveStart(now)).all())[0]?.first;
      day=oldest===null?dayFloor(now)-DAY:Math.min(dayFloor(oldest),dayFloor(now)-DAY);
      rows(await s.prepare('UPDATE station_report_health SET coverage_start=?,next_day=? WHERE singleton=1 AND next_day IS NULL RETURNING singleton').bind(day,day).all());
      day=rows(await s.prepare('SELECT next_day FROM station_report_health WHERE singleton=1').all())[0]?.next_day;
    }
    if(!Number.isSafeInteger(day))fail('REPORT_AGGREGATE_UNAVAILABLE',503);
    if(day<liveStart(now))return {available:false,reason:'REPORT_SOURCE_EXPIRED'};
    if(day>=dayFloor(now))return {available:true,idle:true};
    await sealReportWindow(s,day+DAY,now);
    let job=rows(await s.prepare('SELECT * FROM station_report_jobs WHERE window_start=?').bind(day).all())[0];
    if(!job){
      const keys=await dailyKeys(s,day,day+DAY);
      rows(await s.prepare("INSERT INTO station_report_jobs(window_start,window_end,keys_json,status,expires_at) VALUES(?,?,?,'pending',?) ON CONFLICT(window_start) DO NOTHING RETURNING window_start").bind(day,day+DAY,JSON.stringify(keys),calendarYear(day+DAY)).all());
      job=rows(await s.prepare('SELECT * FROM station_report_jobs WHERE window_start=?').bind(day).all())[0];
    }
    const keys=JSON.parse(job.keys_json).map(filters),end=Math.min(keys.length,job.cursor+batchSize),complete=end===keys.length;
    if(job.status!=='pending'||job.cursor>=keys.length)fail('REPORT_JOB_CONFLICT',409);
    const token=crypto.randomUUID(),batch=[s.prepare(`INSERT INTO music_publication_guards(operation_token,passed) VALUES(?,CASE WHEN EXISTS
      (SELECT 1 FROM station_report_jobs WHERE window_start=? AND cursor=? AND edit_version=? AND status='pending') THEN 1 ELSE NULL END)`).bind(token,day,job.cursor,job.edit_version)];
    for(const f of keys.slice(job.cursor,end)){
      const query=statsSql({start:day,end:day+DAY,filters:f});
      batch.push(s.prepare(`INSERT INTO station_report_snapshots(id,window_start,window_end,query_key,stats_json,generated_at,expires_at)
        SELECT ?,?,?,?,json_object(${REPORT_STATS.map(k=>`'${k}',a.${k}`).join(',')}),?,? FROM (${query.sql}) a
        WHERE NOT EXISTS(SELECT 1 FROM station_report_snapshots WHERE window_start=? AND window_end=? AND query_key=?)`)
        .bind(crypto.randomUUID(),day,day+DAY,queryKey(f),now,calendarYear(day+DAY),...query.params,day,day+DAY,queryKey(f)));
    }
    batch.push(s.prepare('UPDATE station_report_jobs SET cursor=?,edit_version=edit_version+1,status=? WHERE window_start=? AND cursor=? AND edit_version=?')
      .bind(end,complete?'complete':'pending',day,job.cursor,job.edit_version),
      s.prepare('UPDATE music_publication_guards SET passed=CASE WHEN changes()=1 THEN 1 ELSE NULL END WHERE operation_token=?').bind(token),
      s.prepare('UPDATE station_report_health SET next_day=?,last_aggregate_at=? WHERE singleton=1 AND next_day=?').bind(complete?day+DAY:day,now,day),
      s.prepare('UPDATE music_publication_guards SET passed=CASE WHEN changes()=1 THEN 1 ELSE NULL END WHERE operation_token=?').bind(token),
      s.prepare('DELETE FROM music_publication_guards WHERE operation_token=?').bind(token));
    (await s.batch(batch)).forEach(rows);
    return {available:true,day,processed:end-job.cursor,complete,remaining:keys.length-end};
  }catch(e){return {available:false,reason:['REPORT_EVENT_BUDGET','REPORT_DIMENSION_BUDGET','REPORT_WINDOW_DRAINING'].includes(e.code)?e.code:'REPORT_AGGREGATION_UNAVAILABLE'};}
}
export async function runStationReportMaintenance(env,options={}){
  if(!enabled(env.STATION_REPORT_RETENTION_ENABLED)||env.STATION_REPORT_POLICY_VERSION!==REPORT_VERSION)return {available:false,reason:'RETENTION_DISABLED'};
  try{
    const runtime=await reportReadiness(env,{allowDisabled:true}),retention=await runStationReportRetention(env,{...options,runtime});
    if(!retention.available)return retention;
    const aggregation=await runStationReportAggregation(env,{...options,runtime});
    return {available:true,retention,aggregation};
  }catch{return {available:false,reason:'REPORT_MAINTENANCE_UNAVAILABLE'};}
}
