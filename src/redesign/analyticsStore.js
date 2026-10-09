import { primary, rows } from '../music/adminStore.js';
import { musicRateSourceHash } from '../music/rateLimits.js';
import { resolveMusicAccess } from '../music/access.js';
import { loadPublishedMusicRecord } from '../music/publicStore.js';
import { STATION_EVENT_VERSION, STATION_EVENT_RETENTION, eventEnabled, eventConfiguration } from './analyticsModel.js';
import { campaignEnabled, validCampaignRecord, campaignLocales, campaignLandingPath } from './campaignLinks.js';
import { campaignEligibility } from './campaignStore.js';
import { uuid, platform } from './publicValidation.js';

const MINUTE=60000, HOUR=60*MINUTE, DAY=24*HOUR;
export const eventMigration='0016_station_event_collection.sql';
const fail=(code,status=503)=>{throw Object.assign(new Error(code),{code,status});};
function database(env) {
  if(!env.MUSIC_DB || env.MUSIC_DB===env.WAITLIST_DB)fail('EVENTS_NOT_CONFIGURED');
  return primary(env.MUSIC_DB);
}
async function schema(s) {
  try {
    const result=await s.batch([
      s.prepare('SELECT name FROM d1_migrations WHERE name=? LIMIT 2').bind(eventMigration),
      s.prepare('SELECT context_id,expires_at,consent_version FROM station_analytics_events LIMIT 0'),
      s.prepare('SELECT scope,window_start,subject,hits FROM station_event_rates LIMIT 0'),
      s.prepare('SELECT singleton,last_sweep_at FROM station_event_retention_health LIMIT 0'),
      s.prepare('SELECT singleton,cutoff FROM station_event_retention_guard LIMIT 0')
    ]);
    if(rows(result[0]).length!==1)fail('EVENT_SCHEMA_UNAVAILABLE');
    result.slice(1).forEach(rows);
  } catch {fail('EVENT_SCHEMA_UNAVAILABLE');}
}
async function retentionReady(s,now) {
  const result=(await s.batch([
    s.prepare('SELECT last_sweep_at FROM station_event_retention_health WHERE singleton=1'),
    s.prepare('SELECT EXISTS(SELECT 1 FROM station_analytics_events WHERE expires_at<=?) AS pending').bind(now)
  ])).map(rows);
  const last=result[0][0]?.last_sweep_at;
  return Number.isSafeInteger(last)&&last<=now&&now-last<=2*HOUR&&result[1][0]?.pending===0;
}
export async function checkedEventStore(env,now) {
  const s=database(env);await schema(s);
  if(!await retentionReady(s,now))fail('EVENT_RETENTION_UNREADY');
  return s;
}
// Expiry has a separate switch: turning collection off never keeps old events.
// The guard and deletion share one transaction, and the guard is removed before
// commit. Reader erasure, content and legacy music analytics are never touched.
export async function runStationEventRetention(env,{clock=Date.now,rounds=10}={}) {
  if(!eventEnabled(env.STATION_EVENTS_RETENTION_ENABLED))return {available:false,reason:'RETENTION_DISABLED'};
  try {
    const now=clock();if(!Number.isSafeInteger(now)||now<0||!Number.isInteger(rounds)||rounds<1||rounds>10)throw new Error('input');
    const s=database(env);await schema(s);
    const cutoff=now+HOUR;
    for(let i=0;i<rounds;i++){
      const result=(await s.batch([
        s.prepare('INSERT INTO station_event_retention_guard(singleton,cutoff) VALUES(1,?)').bind(cutoff),
        s.prepare('DELETE FROM station_analytics_events WHERE rowid IN (SELECT rowid FROM station_analytics_events WHERE expires_at<=? ORDER BY expires_at,event_id LIMIT 1000)').bind(cutoff),
        s.prepare('DELETE FROM station_event_retention_guard WHERE singleton=1'),
        s.prepare('DELETE FROM station_event_rates WHERE rowid IN (SELECT rowid FROM station_event_rates WHERE window_start<=? ORDER BY window_start LIMIT 1000)').bind(now-STATION_EVENT_RETENTION.rateHours*HOUR+HOUR),
        s.prepare('SELECT EXISTS(SELECT 1 FROM station_analytics_events WHERE expires_at<=?) OR EXISTS(SELECT 1 FROM station_event_rates WHERE window_start<=?) AS pending').bind(cutoff,now-HOUR)
      ])).map(rows);
      if(result.at(-1)[0]?.pending===0){
        rows(await s.prepare('INSERT INTO station_event_retention_health(singleton,last_sweep_at) VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET last_sweep_at=excluded.last_sweep_at RETURNING singleton').bind(now).all());
        return {available:true,pending:false};
      }
    }
    return {available:false,reason:'RETENTION_BACKLOG'};
  }catch{return {available:false,reason:'RETENTION_UNAVAILABLE'};}
}
async function admit(s,request,env,events,now) {
  const window=Math.floor(now/MINUTE)*MINUTE, hash=await musicRateSourceHash(request,env,'station-events',window);
  const keys=[...(events[0].sessionId?[['session',events[0].sessionId]]:[]),['source',hash],['global','0'.repeat(64)]];
  try {
    const r=await s.batch(keys.map(([scope,key])=>s.prepare('INSERT INTO station_event_rates(scope,window_start,subject,hits) VALUES(?,?,?,?) ON CONFLICT(scope,window_start,subject) DO UPDATE SET hits=hits+excluded.hits RETURNING hits').bind(scope,window,key,events.length)));
    if(r.length!==keys.length || r.some(x=>rows(x).length!==1))throw new Error('counter');
  }catch(error){
    if(String(error?.message).includes('STATION_EVENT_RATE_LIMITED'))throw Object.assign(new Error('limited'),{code:'EVENT_RATE_LIMITED',status:429,retryAfter:Math.max(1,Math.ceil((window+MINUTE-now)/1000))});
    throw error;
  }
}
const publishedTrack=`EXISTS(SELECT 1 FROM station_track_publications p JOIN station_track_revisions r ON r.track_id=p.track_id AND r.revision=p.published_revision AND r.state='sealed' JOIN music_tracks t ON t.id=p.track_id WHERE p.track_id=?1 AND p.status='published' AND p.published_at<=?2 AND t.lifecycle<>'archived')`;
const publishedGame=`EXISTS(SELECT 1 FROM station_games g JOIN station_game_revisions r ON r.id=g.id AND r.revision=g.published_revision AND r.state='sealed' WHERE g.id=?1 AND g.status='published' AND g.published_at<=?2 AND g.runtime_key='cat-life' AND r.launch_url='/games/cat-life/')`;
function eventGuard(e,now) {
  const sql=[],params=[],add=(clause,...values)=>{sql.push(clause.replace(/\?(\d+)/g,(_,n)=>'?'+(params.length+Number(n))));params.push(...values);};
  if(e.gameId)add(publishedGame,e.gameId,now);else add(publishedTrack,e.trackId,now);
  if(e.name.startsWith('preview_'))add(`EXISTS(SELECT 1 FROM station_promotions p JOIN station_promotion_revisions r ON r.track_id=p.track_id AND r.revision=p.published_revision AND r.state='sealed' WHERE p.track_id=?1 AND p.status='published' AND p.published_at<=?2 AND r.enabled=1 AND r.preview_enabled=1 AND r.preview_asset_id IS NOT NULL)`,e.trackId,now);
  if(e.clipId)add(`EXISTS(SELECT 1 FROM station_clips c JOIN station_clip_revisions r ON r.id=c.id AND r.revision=c.published_revision AND r.state='sealed' WHERE c.id=?1 AND c.track_id=?2 AND c.status='published' AND c.published_at<=?3)`,e.clipId,e.trackId,now);
  if(e.playbackId){
    const startName=e.clipId?'clip_start':e.name==='full_audio_start'?'full_audio_start':'preview_start';
    add(`NOT EXISTS(SELECT 1 FROM station_analytics_events WHERE playback_id=?1 AND (session_id<>?2 OR track_id IS NOT ?3 OR clip_id IS NOT ?4 OR event_name IN ('preview_start','full_audio_start','clip_start') AND event_name<>?5))`,e.playbackId,e.sessionId,e.trackId,e.clipId,startName);
  }
  if(e.launchId)add(`NOT EXISTS(SELECT 1 FROM station_analytics_events WHERE launch_id=?1 AND (session_id<>?2 OR game_id IS NOT ?3))`,e.launchId,e.sessionId,e.gameId);
  const start=e.name==='preview_qualified'?'preview_start':e.name==='clip_complete'?'clip_start':e.name==='game_ready'?'game_launch_request':e.name==='save_success'?'game_ready':null;
  if(start)add(`EXISTS(SELECT 1 FROM station_analytics_events WHERE event_name=?1 AND session_id=?2 AND track_id IS ?3 AND clip_id IS ?4 AND game_id IS ?5 AND ${e.gameId?'launch_id':'playback_id'}=?6 AND expires_at>?7)`,start,e.sessionId,e.trackId,e.clipId,e.gameId,e.gameId?e.launchId:e.playbackId,now);
  if(e.name==='track_view')add(`NOT EXISTS(SELECT 1 FROM station_analytics_events WHERE event_name='track_view' AND session_id=?1 AND track_id=?2 AND received_at>?3)`,e.sessionId,e.trackId,now-30*MINUTE);
  return {sql:sql.join(' AND '),params};
}
async function dimensions(s,e,env,now,cache) {
  let kind=e.attributionKind, current=null, first=null;
  if(campaignEnabled(env.STATION_CAMPAIGNS_ENABLED)){
    if(e.campaignId){
      if(!cache.has(e.campaignId)){
        let candidate=null;
        try{
          const row=rows(await s.prepare('SELECT * FROM station_campaigns WHERE id=? LIMIT 1').bind(e.campaignId).all())[0];
          if(row?.status==='active'&&validCampaignRecord(row)){
            const eligible=await campaignEligibility({db:env.MUSIC_DB,bucket:env.MUSIC_BUCKET},row.track_id,row.clip_id,now);
            if(campaignLocales.some(l=>campaignLandingPath(l,eligible.slug)===row.landing_path))candidate=row;
          }
        }catch{}
        cache.set(e.campaignId,candidate);
      }
      current=cache.get(e.campaignId);
    }
    if(e.firstCampaignId){const row=rows(await s.prepare('SELECT * FROM station_campaigns WHERE id=? LIMIT 1').bind(e.firstCampaignId).all())[0];first=validCampaignRecord(row)?row.id:null;}
  }
  if(kind==='campaign'&&!current)kind='unknown';
  return {kind,id:current?.id??null,source:current?.source??null,medium:current?.medium??null,first};
}
async function validPlatform(s,e,request,now) {
  const link=rows(await s.prepare("SELECT * FROM station_platform_links WHERE id=? AND track_id=? AND status='live'").bind(e.platformLinkId,e.trackId).all())[0];
  const country=request.cf?.country;
  if(!link || !platform(link,country,now))fail('INVALID_EVENT',400);
}
async function validFull(s,e,request,env,now) {
  if(!eventEnabled(env.MUSIC_PUBLIC_ENABLED))fail('INVALID_EVENT',400);
  const p=rows(await s.prepare("SELECT r.legacy_revision_id,r.site_audio_mode FROM station_track_publications p JOIN station_track_revisions r ON r.track_id=p.track_id AND r.revision=p.published_revision AND r.state='sealed' WHERE p.track_id=? AND p.status='published'").bind(e.trackId).all())[0];
  if(!p || !['free_full','existing_entitlement'].includes(p.site_audio_mode)||!uuid(p.legacy_revision_id))fail('INVALID_EVENT',400);
  const record=await loadPublishedMusicRecord(env.MUSIC_DB,e.trackId);
  if(record.track?.lifecycle!=='published'||record.revision?.id!==p.legacy_revision_id)fail('INVALID_EVENT',400);
  const permissionRequest=new Request(request.url,{method:'GET',headers:request.headers,cf:request.cf});
  const decision=await resolveMusicAccess(permissionRequest,env,{record,revisionNo:record.revision.revision_no,variant:'full',vipDeliveryEnabled:eventEnabled(env.MUSIC_VIP_DELIVERY_ENABLED),clock:()=>now,timeoutMs:1500});
  if(decision.status!==200)fail('INVALID_EVENT',400);
}
export async function collectStationEvents(request,env,events,now) {
  const s=await checkedEventStore(env,now);await admit(s,request,env,events,now);
  const statements=[],attributionCache=new Map();
  for(const e of events){
    // Lost-response retry: never overwrite a receipt or require the content to
    // remain published. A changed payload with the same UUID cannot append.
    if(rows(await s.prepare('SELECT event_id FROM station_analytics_events WHERE event_id=? LIMIT 1').bind(e.eventId).all()).length)continue;
    if(e.name==='platform_click')await validPlatform(s,e,request,now);
    if(e.name==='full_audio_start')await validFull(s,e,request,env,now);
    const d=await dimensions(s,e,env,now,attributionCache),guard=eventGuard(e,now);
    const values=[e.eventId,e.name,e.occurredAt,now,e.trackId,e.clipId,e.gameId,d.id,e.platformLinkId,e.sessionId,e.playbackId,e.interactionId,e.launchId,e.saveOperationId,e.contextId,e.sessionScope,d.kind,d.source,d.medium,d.first,e.deviceClass,e.listenedMs,Number(e.mediaEnded),Number(Math.abs(e.occurredAt-now)>5*MINUTE),STATION_EVENT_VERSION,now+90*DAY];
    // Content guard, semantic dedupe and append happen on the primary inside a
    // D1 batch. In-batch starts precede completions. No SELECT-then-increment.
    const placeholders=values.map((_,i)=>'?'+(guard.params.length+i+1));
    const duplicates=`NOT EXISTS(SELECT 1 FROM station_analytics_events WHERE event_id=${placeholders[0]} OR (event_name=${placeholders[1]} AND (playback_id IS NOT NULL AND playback_id=${placeholders[10]} OR interaction_id IS NOT NULL AND interaction_id=${placeholders[11]} OR event_name IN ('game_launch_request','game_ready') AND launch_id=${placeholders[12]} OR save_operation_id IS NOT NULL AND save_operation_id=${placeholders[13]})))`;
    statements.push(s.prepare(`INSERT INTO station_analytics_events(event_id,event_name,occurred_at,received_at,track_id,clip_id,game_id,campaign_id,platform_link_id,session_id,playback_id,interaction_id,launch_id,save_operation_id,context_id,session_scope,attribution_kind,campaign_source,campaign_medium,first_campaign_id,device_class,listened_ms,media_ended,time_anomaly,consent_version,expires_at) SELECT ${placeholders.join(',')} WHERE ${guard.sql} AND ${duplicates} RETURNING event_id`).bind(...guard.params,...values));
  }
  if(!statements.length)return {accepted:0};
  const result=await s.batch(statements);
  return {accepted:result.reduce((n,r)=>n+rows(r).length,0)};
}
export async function stationEventReadiness(env,now,request) {
  const config=eventConfiguration(env);if(!config.available)return config;
  try {
    const s=await checkedEventStore(env,now);
    if(request)await admit(s,request,env,[{sessionId:null}],now);
    const games=rows(await s.prepare("SELECT id FROM station_games WHERE runtime_key='cat-life' AND status='published' AND published_at<=? LIMIT 2").bind(now).all());
    return {...config,runtimeGameId:games.length===1&&uuid(games[0].id)?games[0].id:null};
  }catch(error){return {...config,available:false,reason:error.code||'EVENTS_UNAVAILABLE'};}
}
