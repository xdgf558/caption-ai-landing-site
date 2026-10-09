import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { contentOperationsStatements, contentAdminFixture } from './station-content-admin-fixture.mjs';
import { createContentObject, contentPublication, saveContentObject, saveContentRights } from '../../src/redesign/contentAdmin.js';
import { createContentAdminRuntime, contentAdminActor } from './station-content-admin-runtime.mjs';
import { mediaFixture } from './station-content-fixture.mjs';

export const campaignMigration='0015_station_campaign_links.sql';
export const campaignSql=readFileSync(new URL('../../migrations-music/'+campaignMigration,import.meta.url),'utf8');
export function campaignMigrationGroups(){
  const groups=contentOperationsStatements(),parser=new DatabaseSync(':memory:');try{
    for(const g of groups)for(const sql of g.statements)parser.exec(sql);
    let rest=campaignSql;const statements=[];
    while(rest.trim()){const s=parser.prepare(rest),sql=s.sourceSQL;s.run();statements.push(sql);rest=rest.slice(sql.length);}
    return [...groups,{name:campaignMigration,statements}];
  }finally{parser.close();}
}
export async function seedCampaignObjects(runtime,tracks,actor=contentAdminActor,materializeMedia){
  const ctx=(v=1)=>({actorId:actor,key:randomUUID(),ifMatch:`"edit-${v}"`});
  for(const [index,t]of tracks.slice(0,2).entries()){
    const metadata={...t.metadata,originalLocale:'zh-Hans',title:{'zh-Hans':'本机示例 · 推广资料 '+(index?'B':'A')},summary:{'zh-Hans':'仅用于 Campaign 操作核对，主推作品与真实发行信息仍待确定。'}};
    await createContentObject(runtime,'tracks',{trackId:t.id,data:{metadata,coverAssetId:t.cover,siteAudioMode:'none'},reason:'隔离测试登记'},ctx());
    await saveContentRights(runtime,t.cover,{scope:'cover',status:'approved',basis:'合成夹具登记，不代表真实素材授权',reason:'隔离测试'},ctx());
    await contentPublication(runtime,'tracks',t.id,'publish',{revision:1,reason:'本机测试公开'},ctx());
  }
  const parent=tracks[0],clip=(await createContentObject(runtime,'clips',{trackId:parent.id,clipType:'short_video',data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'本机示例 · 推广短片'}}},reason:'隔离测试短片'},ctx())).id;
  const video=randomUUID(),poster=randomUUID();await mediaFixture(runtime.db,runtime.bucket,clip,'short_video',video,materializeMedia);await mediaFixture(runtime.db,runtime.bucket,clip,'poster',poster,materializeMedia);
  await saveContentObject(runtime,'clips',clip,{revision:1,data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'本机示例 · 推广短片'}},mediaAssetId:video,posterAssetId:poster,durationMs:30000},reason:'本机素材'},ctx());
  await contentPublication(runtime,'clips',clip,'publish',{revision:2,reason:'本机公开短片'},ctx(2));
  for(const [i,t]of tracks.slice(0,2).entries()){
    await createContentObject(runtime,'promotions',{trackId:t.id,data:{enabled:true,previewEnabled:false,selectedClipIds:i?[]:[clip]},reason:'隔离测试推广'},ctx());
    await contentPublication(runtime,'promotions',t.id,'publish',{revision:1,reason:'本机启用推广'},ctx());
  }
  return {clip,video,poster};
}
export async function campaignFixture({migrated=true,seed=true}={}){
  const f=await contentAdminFixture();if(migrated){f.sql.exec(campaignSql);await f.db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(campaignMigration,new Date().toISOString()).run();}
  const content=seed?await seedCampaignObjects(f.runtime,f.tracks):{};return {...f,...content};
}
export async function createCampaignRuntime({assets,seed,bindings={}}={}){
  return createContentAdminRuntime({assets,migrationGroups:campaignMigrationGroups(),bindings:{STATION_CAMPAIGNS_ENABLED:'true',STATION_MUSIC_PAGES_ENABLED:'true',...bindings},seed:seed??(async(db,bucket)=>{
    const {seedContentAdminFixture}=await import('./station-content-admin-fixture.mjs');const f=await seedContentAdminFixture(db,bucket);
    return {...f,...await seedCampaignObjects({db,bucket},f.tracks)};
  })});
}
