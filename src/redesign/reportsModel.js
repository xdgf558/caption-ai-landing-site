import { fields, fail, musicId, text } from '../music/adminValidation.js';

export const REPORT_VERSION='station-reports-v1', REPORT_MIGRATION='0017_station_reports.sql';
export const DAY=86400000, MAX_EVENTS=20000, MAX_KEYS=512;
export const REPORT_EVENTS=['track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete','game_launch_request','game_ready','save_success'];
export const REPORT_STATS=[...REPORT_EVENTS,'visit_sessions','preview_sessions','click_sessions','unlinked_previews','unlinked_clicks','memory_events','time_anomalies'];
export const PROVIDERS=['netease','qishui','apple_music','spotify','youtube'];
export const EXPOSURE_PROVIDERS=[...PROVIDERS,'douyin','xiaohongshu','bilibili','instagram'];
export const enabled=v=>v===true||v==='true';
export const dayFloor=n=>Math.floor(n/DAY)*DAY;
// A calendar year: clamp February 29 and month ends, rather than assuming 365 days.
export function calendarYear(n,delta=1){
  const d=new Date(n),year=d.getUTCFullYear()+delta,month=d.getUTCMonth(),day=d.getUTCDate();
  const max=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  d.setUTCDate(1);d.setUTCFullYear(year);d.setUTCDate(Math.min(day,max));return d.getTime();
}
export function reportFlags(env){return enabled(env.STATION_REPORTS_ENABLED)&&env.STATION_REPORT_POLICY_VERSION===REPORT_VERSION;}
export const liveStart=now=>dayFloor(now)-88*DAY;
// Timestamp stays in the original idempotency key after the short-lived receipt
// is removed. A stale retry can never become a fresh insertion after cleanup.
export function reportOperationStarted(key,now){
  const match=/^r1_([0-9]{13})_([A-Za-z0-9_-]{16,80})$/.exec(key??'');
  if(!match)fail('IDEMPOTENCY_KEY_REQUIRED',400);
  const started=Number(match[1]);if(started>now+300000)fail('REPORT_OPERATION_CLOCK_INVALID',400);
  if(started+DAY<=now)fail('REPORT_OPERATION_EXPIRED',409);return started;
}
export function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('INVALID_INPUT',400);
  const n=Date.parse(value+'T00:00:00Z');if(!Number.isSafeInteger(n)||new Date(n).toISOString().slice(0,10)!==value)fail('INVALID_INPUT',400);return n;
}
export function filters(input){
  const f={trackId:input.trackId??null,source:input.source??null,campaignId:input.campaignId??null,clipId:input.clipId??null,provider:input.provider??null};
  for(const k of ['trackId','clipId'])if(f[k]!==null)f[k]=musicId(f[k]);
  if(f.campaignId!==null&&!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(f.campaignId))fail('INVALID_INPUT',400);
  if(f.source!==null&&!/^(?:direct_or_unknown|unknown|campaign:[a-z0-9][a-z0-9_-]{0,63})$/.test(f.source))fail('INVALID_INPUT',400);
  if(f.provider!==null&&!PROVIDERS.includes(f.provider))fail('INVALID_INPUT',400);
  return f;
}
export const queryKey=f=>JSON.stringify(filters(f));
export function reportQuery(input,now=Date.now()){
  fields(input,['from','to','trackId','source','campaignId','clipId','provider']);
  const start=date(input.from),end=date(input.to);
  if(end<=start||end-start>31*DAY||start<dayFloor(calendarYear(now,-1))||end>dayFloor(now)+DAY)fail('REPORT_WINDOW_INVALID',400);
  return {start,end,filters:filters(input)};
}
export function validateStats(input){
  if(!input||Object.keys(input).length!==REPORT_STATS.length||REPORT_STATS.some(k=>!Number.isSafeInteger(input[k])||input[k]<0))fail('REPORT_AGGREGATE_UNAVAILABLE',503);
  if(input.preview_sessions>input.visit_sessions||input.click_sessions>input.visit_sessions||input.visit_sessions>input.track_view||input.unlinked_previews>input.preview_start||input.unlinked_clicks>input.platform_click)fail('REPORT_AGGREGATE_UNAVAILABLE',503);
  return Object.fromEntries(REPORT_STATS.map(k=>[k,input[k]]));
}
export function reportView(stats,unique=true){
  const count=stats===null?Object.fromEntries(REPORT_EVENTS.map(k=>[k,null])):Object.fromEntries(REPORT_EVENTS.map(k=>[k,stats[k]]));
  const rate=(numerator,unlinked)=>{
    const denominator=unique&&stats?stats.visit_sessions:null;
    const reason=!stats?'NO_DATA':!unique?'HISTORICAL_DISTINCT_UNAVAILABLE':!denominator?'NO_VISIT_SESSIONS':stats[unlinked]?'UNLINKED_EVENTS':null;
    return {numerator:unique&&stats?stats[numerator]:null,denominator,unlinked:stats?.[unlinked]??null,value:reason?null:stats[numerator]/denominator,reason};
  };
  return {counts:count,visitSessions:unique&&stats?stats.visit_sessions:null,previewRate:rate('preview_sessions','unlinked_previews'),platformRate:rate('click_sessions','unlinked_clicks'),
    gameReady:count.game_ready>0?count.game_ready:null,memoryEvents:stats?.memory_events??null,timeAnomalies:stats?.time_anomalies??null};
}
function timestamp(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))fail('INVALID_INPUT',400);const n=Date.parse(v);if(!Number.isSafeInteger(n)||new Date(n).toISOString().replace('.000Z','Z')!==v.replace('.000Z','Z'))fail('INVALID_INPUT',400);return n;}
export function externalInput(input,now){
  fields(input,['trackId','clipId','campaignId','metric','provider','value','sourceKind','sourceLabel','from','to','observedAt','recognized','status']);
  const f=filters({trackId:input.trackId,clipId:input.clipId,campaignId:input.campaignId});musicId(f.trackId);
  if(!['impressions','platform_plays'].includes(input.metric)||!(input.metric==='platform_plays'?PROVIDERS:EXPOSURE_PROVIDERS).includes(input.provider)||
    !Number.isInteger(input.value)||input.value<0||input.value>2147483647||!['platform_dashboard','platform_export'].includes(input.sourceKind)||input.recognized!==true||!['active','withdrawn'].includes(input.status))fail('INVALID_INPUT',400);
  const start=timestamp(input.from),end=timestamp(input.to),observed=timestamp(input.observedAt),label=text(input.sourceLabel,160).trim();
  if(label.length<3||/[\x00-\x1f<>]|https?:\/\//i.test(label)||end<=start||end-start>31*DAY||observed<end||observed>now||calendarYear(end)<=now)fail('INVALID_INPUT',400);
  return {...f,metric:input.metric,provider:input.provider,value:input.value,sourceKind:input.sourceKind,sourceLabel:label,start,end,observed,status:input.status};
}
