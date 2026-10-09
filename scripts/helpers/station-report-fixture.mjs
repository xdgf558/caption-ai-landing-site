import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { eventFixture, eventMigrationGroups, eventBindings, seedEventObjects, event } from './station-event-fixture.mjs';
import { createContentAdminRuntime, contentAdminActor } from './station-content-admin-runtime.mjs';
import { seedContentAdminFixture } from './station-content-admin-fixture.mjs';
import { seedCampaignObjects } from './station-campaign-fixture.mjs';
import { platformFixture } from './station-content-fixture.mjs';
import { REPORT_MIGRATION, REPORT_VERSION, DAY, dayFloor } from '../../src/redesign/reportsModel.js';
import { reportReadiness, saveExternalMetric } from '../../src/redesign/reportsStore.js';
import { runStationReportRetention } from '../../src/redesign/reportsSchedule.js';
import { REPORT_SEAL_MIGRATION } from '../../src/redesign/reportSealing.js';

export const reportSql=readFileSync(new URL('../../migrations-music/'+REPORT_MIGRATION,import.meta.url),'utf8');
export const reportSealSql=readFileSync(new URL('../../migrations-music/'+REPORT_SEAL_MIGRATION,import.meta.url),'utf8');
export const reportBindings={...eventBindings,STATION_REPORTS_ENABLED:'true',STATION_REPORT_POLICY_VERSION:REPORT_VERSION,STATION_REPORT_AGGREGATION_ENABLED:'true',STATION_REPORT_RETENTION_ENABLED:'true',STATION_CONTENT_ADMIN_ENABLED:'true'};
export function reportMigrationGroups(){const groups=eventMigrationGroups(),parser=new DatabaseSync(':memory:');try{
  for(const g of groups)for(const sql of g.statements)parser.exec(sql);
  for(const [name,source]of [[REPORT_MIGRATION,reportSql],[REPORT_SEAL_MIGRATION,reportSealSql]]){let rest=source;const statements=[];
    while(rest.trim()){const s=parser.prepare(rest),sql=s.sourceSQL;s.run();statements.push(sql);rest=rest.slice(sql.length);}groups.push({name,statements});}return groups;
}finally{parser.close();}}
export async function reportFixture({sample=true,migrated=true,sealing=true,now=Date.now()}={}){
  const f=await eventFixture();if(migrated){for(const [name,source]of [[REPORT_MIGRATION,reportSql],...(sealing?[[REPORT_SEAL_MIGRATION,reportSealSql]]:[])]){f.sql.exec(source);await f.db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(name,new Date(now).toISOString()).run();}}
  f.env={...f.env,...reportBindings};if(migrated&&sealing)await runStationReportRetention(f.env,{clock:()=>now});
  if(sample&&migrated)f.sample=await seedReportSample(f.db,f,{now});return f;
}
// Synthetic accepted-receipt shapes for aggregation arithmetic. This does not
// simulate native playback, collector admission, real media or production rights.
export async function insertReportReceipt(db,name,patch={}){
  const e=event(name,patch),now=patch.receivedAt??Date.now();
  await db.prepare(`INSERT INTO station_analytics_events(event_id,event_name,occurred_at,received_at,track_id,clip_id,game_id,campaign_id,platform_link_id,session_id,playback_id,interaction_id,launch_id,save_operation_id,context_id,session_scope,attribution_kind,campaign_source,campaign_medium,first_campaign_id,device_class,listened_ms,media_ended,time_anomaly,consent_version,expires_at)
    VALUES(${Array(26).fill('?').join(',')})`).bind(e.eventId,e.name,e.occurredAt,now,e.trackId,e.clipId,e.gameId,e.campaignId,e.platformLinkId,e.sessionId,e.playbackId,e.interactionId,e.launchId,e.saveOperationId,e.contextId,e.sessionScope,e.attributionKind,e.campaignId?'douyin':null,e.campaignId?'short_video':null,e.firstCampaignId,e.deviceClass,e.listenedMs,e.mediaEnded?1:0,patch.timeAnomaly??0,patch.consentVersion??'station-events-v1',now+90*DAY).run();return e;
}
export async function seedReportSample(db,content,{now=Date.now(),external=true}={}){
  const start=dayFloor(now)-DAY,end=start+DAY,A=content.tracks[0],B=content.tracks[1],s1=randomUUID(),s2=randomUUID(),s3=randomUUID();
  const netease=await platformFixture(db,A,{provider:'netease'}),apple=await platformFixture(db,A,{provider:'apple_music',url:'https://music.apple.com/us/song/fixture/12345'}),other=await platformFixture(db,B,{provider:'netease'});
  const tagged={trackId:A.id,attributionKind:'campaign',campaignId:'event-douyin',firstCampaignId:'event-douyin'};
  const add=(name,minutes,patch={})=>insertReportReceipt(db,name,{...tagged,receivedAt:start+minutes*60000,...patch});
  await add('track_view',60,{sessionId:s1});await add('track_view',120,{sessionId:s1});await add('track_view',65,{sessionId:s2});await add('track_view',130,{sessionId:s3});
  for(const [minutes,sessionId]of [[61,s1],[121,s1],[66,s2]]){const playbackId=randomUUID();await add('preview_start',minutes,{sessionId,playbackId});await add('preview_qualified',minutes+1,{sessionId,playbackId,listenedMs:10000});}
  for(const minutes of [62,63,64,122])await add('platform_click',minutes,{sessionId:s1,platformLinkId:netease,interactionId:randomUUID()});
  await add('platform_click',67,{sessionId:s2,platformLinkId:apple,interactionId:randomUUID()});
  const b={trackId:B.id,sessionId:s1,attributionKind:'direct_or_unknown',campaignId:null,firstCampaignId:null};
  await add('track_view',61,b);await add('preview_start',62,{...b,playbackId:randomUUID()});await add('platform_click',63,{...b,platformLinkId:other,interactionId:randomUUID()});
  const orphan={trackId:A.id,attributionKind:'unknown',campaignId:null,firstCampaignId:null,sessionScope:'memory',sessionId:randomUUID()};
  await add('platform_click',70,{...orphan,platformLinkId:netease,interactionId:randomUUID(),timeAnomaly:1});
  const boundary=randomUUID();await add('track_view',-5,{...orphan,sessionId:boundary});await add('platform_click',1,{...orphan,sessionId:boundary,platformLinkId:netease,interactionId:randomUUID()});
  const video=randomUUID();await add('clip_start',80,{sessionId:s1,clipId:content.clip,playbackId:video});await add('clip_complete',81,{sessionId:s1,clipId:content.clip,playbackId:video,mediaEnded:true});
  await add('full_audio_start',90,{sessionId:s1,playbackId:randomUUID()});
  const launch=randomUUID(),game={...orphan,trackId:null,sessionScope:'session_storage',attributionKind:'direct_or_unknown',gameId:content.gameId,launchId:launch};
  await add('game_launch_request',140,game);await add('game_ready',141,game);await add('save_success',142,{...game,saveOperationId:randomUUID()});
  const from=new Date(start).toISOString().slice(0,10),to=new Date(end).toISOString().slice(0,10),env={...reportBindings,MUSIC_DB:db},runtime=await reportReadiness(env);
  if(external){for(const [metric,value]of [['impressions',1800],['platform_plays',72]])await saveExternalMetric(runtime,env,null,{trackId:A.id,clipId:null,campaignId:null,metric,provider:'netease',value,sourceKind:'platform_dashboard',sourceLabel:'本机合成平台报表 · 不是真实发行数据',from:new Date(start).toISOString(),to:new Date(end).toISOString(),observedAt:new Date(Math.floor(now/1000)*1000).toISOString(),recognized:true,status:'active'},{actorId:contentAdminActor,key:`r1_${now}_${randomUUID()}`},{clock:()=>now});}
  return {start,end,from,to,trackA:A.id,trackB:B.id,clipId:content.clip,netease,apple,session1:s1,session2:s2,session3:s3,
    expectedA:{track_view:4,visit_sessions:3,preview_start:3,preview_sessions:2,preview_qualified:3,platform_click:5,click_sessions:2,rate:2/3},cohort:{from,to,trackId:A.id,campaignId:'event-douyin'}};
}
export async function createReportRuntime({assets,bindings={},sample=true}={}){
  const f=await createContentAdminRuntime({assets,workerFile:'station-report-runtime-worker.js',migrationGroups:reportMigrationGroups(),bindings:{...reportBindings,STATION_CONTENT_EDITOR_EMAILS:'second-content-fixture@example.test',...bindings},seed:async(db,bucket)=>{
    const content=await seedContentAdminFixture(db,bucket),clips=await seedCampaignObjects({db,bucket},content.tracks),extra=await seedEventObjects({db,bucket},content.tracks,clips);return {...content,...clips,...extra};
  }});try{const env={...reportBindings,MUSIC_DB:f.db};await runStationReportRetention(env);if(sample)f.content.sample=await seedReportSample(f.db,f.content);return f;}catch(error){await f.close();throw error;}
}
