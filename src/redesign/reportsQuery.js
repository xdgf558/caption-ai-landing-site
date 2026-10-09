import { rows } from '../music/adminStore.js';
import { fail } from '../music/adminValidation.js';
import { MAX_EVENTS, MAX_KEYS, PROVIDERS, REPORT_EVENTS, validateStats, queryKey } from './reportsModel.js';

// Frozen attribution from accepted T18 receipts; identity fields in the joined
// Campaign/material/provider records are immutable. Current publication is irrelevant.
export const sourceSql="CASE WHEN e.attribution_kind='campaign' THEN 'campaign:'||e.campaign_source WHEN e.attribution_kind='direct_or_unknown' THEN 'direct_or_unknown' ELSE 'unknown' END";
const base=`SELECT e.*,${sourceSql} AS report_source,COALESCE(e.clip_id,c.clip_id) AS material_id,p.provider
 FROM station_analytics_events e LEFT JOIN station_campaigns c ON c.id=e.campaign_id
 LEFT JOIN station_platform_links p ON p.id=e.platform_link_id AND p.track_id=e.track_id
 WHERE e.consent_version='station-events-v1' AND e.received_at>=? AND e.received_at<?`;
export function selectedSql(q){
  const sql=[base],params=[q.start,q.end];
  for(const [k,column]of [['trackId','e.track_id'],['source',sourceSql],['campaignId','e.campaign_id'],['clipId','COALESCE(e.clip_id,c.clip_id)']])if(q.filters[k]!==null){sql.push(`AND ${column}=?`);params.push(q.filters[k]);}
  // Platform selects click events only. It must never empty the visit denominator.
  if(q.filters.provider!==null){sql.push("AND (e.event_name<>'platform_click' OR p.provider=?)");params.push(q.filters.provider);}
  return {sql:sql.join(' '),params};
}
export function statsSql(q){
  const selected=selectedSql(q);
  return {params:selected.params,sql:`WITH selected AS MATERIALIZED (${selected.sql} LIMIT ${MAX_EVENTS+1}),
 visits AS (SELECT session_id,track_id,received_at FROM selected WHERE event_name='track_view'),
 linked AS (SELECT DISTINCT e.event_id,e.session_id,e.track_id,e.event_name FROM selected e JOIN visits v
 ON v.session_id=e.session_id AND v.track_id=e.track_id AND v.received_at<=e.received_at
 AND e.received_at-v.received_at<1800000 WHERE e.event_name IN ('preview_start','platform_click'))
 SELECT ${REPORT_EVENTS.map(k=>`COALESCE(SUM(event_name='${k}'),0) AS ${k}`).join(',')},
 (SELECT COUNT(*) FROM (SELECT DISTINCT session_id,track_id FROM visits)) AS visit_sessions,
 (SELECT COUNT(*) FROM (SELECT DISTINCT session_id,track_id FROM linked WHERE event_name='preview_start')) AS preview_sessions,
 (SELECT COUNT(*) FROM (SELECT DISTINCT session_id,track_id FROM linked WHERE event_name='platform_click')) AS click_sessions,
 COALESCE(SUM(event_name='preview_start'),0)-(SELECT COUNT(*) FROM linked WHERE event_name='preview_start') AS unlinked_previews,
 COALESCE(SUM(event_name='platform_click'),0)-(SELECT COUNT(*) FROM linked WHERE event_name='platform_click') AS unlinked_clicks,
 COALESCE(SUM(session_scope='memory'),0) AS memory_events,COALESCE(SUM(time_anomaly=1),0) AS time_anomalies FROM selected`};
}
export async function eventBudget(s,q){
  const selected=selectedSql(q),n=rows(await s.prepare(`SELECT COUNT(*) AS n FROM (${selected.sql} LIMIT ${MAX_EVENTS+1})`).bind(...selected.params).all())[0]?.n;
  if(!Number.isSafeInteger(n))fail('REPORT_QUERY_UNAVAILABLE',503);if(n>MAX_EVENTS)fail('REPORT_EVENT_BUDGET',422);
}
export async function liveStats(s,q){await eventBudget(s,q);const query=statsSql(q),stats=validateStats(rows(await s.prepare(query.sql).bind(...query.params).all())[0]);if(REPORT_EVENTS.reduce((n,k)=>n+stats[k],0)>MAX_EVENTS)fail('REPORT_EVENT_BUDGET',422);return stats;}
// Every observed intersection and its wildcard parents gets a daily snapshot.
// A hard limit stops the whole day before writing; no truncated report is "complete".
export async function dailyKeys(s,start,end){
  const q={start,end,filters:{trackId:null,source:null,campaignId:null,clipId:null,provider:null}};await eventBudget(s,q);
  const grains=rows(await s.prepare(`SELECT DISTINCT track_id,report_source,campaign_id,material_id FROM (${base}) LIMIT ${MAX_KEYS+1}`).bind(start,end).all());
  const keys=new Map();const add=f=>keys.set(queryKey(f),f);add(q.filters);
  for(const r of grains){
    const values=[r.track_id,r.report_source,r.campaign_id,r.material_id];
    for(let mask=0;mask<16;mask++){
      const [trackId,source,campaignId,clipId]=values.map((v,i)=>mask&(1<<i)?v:null);
      for(const provider of [null,...PROVIDERS])add({trackId,source,campaignId,clipId,provider});
      if(keys.size>MAX_KEYS)fail('REPORT_DIMENSION_BUDGET',422);
    }
  }
  if(grains.length>MAX_KEYS)fail('REPORT_DIMENSION_BUDGET',422);
  return [...keys.values()].sort((a,b)=>queryKey(a).localeCompare(queryKey(b),'en'));
}
