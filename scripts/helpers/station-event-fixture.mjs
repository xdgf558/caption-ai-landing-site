import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {campaignFixture,campaignMigrationGroups,seedCampaignObjects} from './station-campaign-fixture.mjs';
import {createContentAdminRuntime,contentAdminActor} from './station-content-admin-runtime.mjs';
import {seedContentAdminFixture} from './station-content-admin-fixture.mjs';
import {mediaFixture} from './station-content-fixture.mjs';
import {createContentObject,saveContentObject,contentPublication,saveContentRights} from '../../src/redesign/contentAdmin.js';
import {createCampaign} from '../../src/redesign/campaignStore.js';
import {runStationEventRetention,eventMigration} from '../../src/redesign/analyticsStore.js';
import {STATION_EVENT_VERSION} from '../../src/redesign/analyticsModel.js';

export const eventSql=readFileSync(new URL('../../migrations-music/'+eventMigration,import.meta.url),'utf8');
export const eventBindings={STATION_CONTENT_PUBLIC_ENABLED:'true',STATION_EVENTS_ENABLED:'true',STATION_EVENTS_PRIVACY_VERSION:STATION_EVENT_VERSION,STATION_EVENTS_RETENTION_ENABLED:'true',STATION_CAMPAIGNS_ENABLED:'true',MUSIC_PUBLIC_ENABLED:'true',MUSIC_VIP_DELIVERY_ENABLED:'true',MUSIC_RATE_LIMIT_SECRET:'isolated-event-rate-secret-not-deployed'};
export function eventMigrationGroups(){
 const groups=campaignMigrationGroups(),parser=new DatabaseSync(':memory:');try{
  for(const g of groups)for(const sql of g.statements)parser.exec(sql);
  let rest=eventSql;const statements=[];while(rest.trim()){const s=parser.prepare(rest),sql=s.sourceSQL;s.run();statements.push(sql);rest=rest.slice(sql.length);}
  return [...groups,{name:eventMigration,statements}];
 }finally{parser.close();}
}
export async function seedEventObjects(runtime,tracks,clips,materializeMedia){
 const ctx=v=>({actorId:contentAdminActor,key:randomUUID(),ifMatch:`"edit-${v}"`}),track=tracks[0];
 await saveContentRights(runtime,track.preview,{scope:'preview',status:'approved',basis:'本机合成素材，不代表真实权利',reason:'统计夹具'},ctx(1));
 await saveContentObject(runtime,'promotions',track.id,{revision:1,data:{enabled:true,previewEnabled:true,previewAssetId:track.preview,selectedClipIds:[clips.clip]},reason:'本机试听统计'},ctx(2));
 await contentPublication(runtime,'promotions',track.id,'publish',{revision:2,reason:'本机启用试听'},ctx(3));
 const data={metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'本机游戏 · 统计核对'},summary:{'zh-Hans':'独立测试运行与本机保存确认'}},launchUrl:'/games/cat-life/',supportedDevices:['desktop','ios','android'],screenshotIds:[]};
 const game=await createContentObject(runtime,'games',{slug:'cat-life-game',data,reason:'本机游戏统计'},ctx(1));
 const screenshot=randomUUID();await mediaFixture(runtime.db,runtime.bucket,game.id,'game_screenshot',screenshot,materializeMedia);
 await saveContentObject(runtime,'games',game.id,{revision:1,data:{...data,screenshotIds:[screenshot]},reason:'本机截图'},ctx(1));
 await contentPublication(runtime,'games',game.id,'publish',{revision:2,reason:'本机游戏统计'},ctx(2));
 await createCampaign(runtime,track.id,{id:'event-douyin',source:'douyin',medium:'short_video',clipId:clips.clip,locale:'zh-Hant',legacySources:[],status:'active',reason:'本机统计归因'},{actorId:contentAdminActor,key:randomUUID()});
 return {gameId:game.id};
}
export async function eventFixture({migrated=true}={}){
 const f=await campaignFixture();if(migrated){f.sql.exec(eventSql);await f.db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(eventMigration,new Date().toISOString()).run();}
 const extra=await seedEventObjects(f.runtime,f.tracks,f),env={...eventBindings,MUSIC_DB:f.db,MUSIC_BUCKET:f.bucket};
 if(migrated)await runStationEventRetention(env);
 return {...f,...extra,env};
}
export async function createEventRuntime({assets,seed,bindings={}}={}){
 const f=await createContentAdminRuntime({assets,workerFile:'station-event-runtime-worker.js',migrationGroups:eventMigrationGroups(),bindings:{...eventBindings,STATION_MUSIC_PAGES_ENABLED:'true',STATION_GAME_PAGES_ENABLED:'true',...bindings},seed:seed??(async(db,bucket)=>{
  const f=await seedContentAdminFixture(db,bucket),runtime={db,bucket},clips=await seedCampaignObjects(runtime,f.tracks),extra=await seedEventObjects(runtime,f.tracks,clips);
  return {...f,...clips,...extra};
 })});
 await runStationEventRetention({...eventBindings,MUSIC_DB:f.db});return f;
}
export function event(name='track_view',patch={}){
 return {eventId:randomUUID(),name,occurredAt:Date.now(),sessionId:randomUUID(),contextId:randomUUID(),sessionScope:'session_storage',attributionKind:'direct_or_unknown',campaignId:null,firstCampaignId:null,
  trackId:null,clipId:null,gameId:null,platformLinkId:null,playbackId:null,interactionId:null,launchId:null,saveOperationId:null,deviceClass:'desktop',listenedMs:0,mediaEnded:false,...patch};
}
export const eventRequest=input=>new Request('https://wwwstationcat.org/api/station/events',{method:'POST',headers:{Origin:'https://wwwstationcat.org','Content-Type':'application/json','X-Requested-With':'StationCatEvents','CF-Connecting-IP':'192.0.2.18'},body:JSON.stringify({consentVersion:STATION_EVENT_VERSION,events:input})});
