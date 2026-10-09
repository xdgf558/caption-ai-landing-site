import { primary, rows } from '../music/adminStore.js';
import { fail, fields, musicId, editVersion, text } from '../music/adminValidation.js';
import { snapshot, rowGuard, combineGuards, mutateContent } from './contentAdminStore.js';
import { validateContentPublication } from './contentAdminValidation.js';
import { campaignToken, campaignId, campaignLocales, campaignLandingPath, campaignUrl, validCampaignRecord } from './campaignLinks.js';

export async function campaignReadiness(runtime) {
  try {
    const s=primary(runtime.db), result=await s.batch([
      s.prepare('SELECT id,source,medium,track_id,clip_id,landing_path,status,content_value,edit_version FROM station_campaigns LIMIT 0'),
      s.prepare('SELECT source_key,campaign_id,created_at FROM station_campaign_legacy_sources LIMIT 0'),
      s.prepare("SELECT name FROM d1_migrations WHERE name='0015_station_campaign_links.sql' LIMIT 2")
    ]);
    result.map(rows);if(result[2].results.length!==1)throw new Error('ledger');return runtime;
  } catch { fail('STATION_CAMPAIGN_SCHEMA_UNAVAILABLE',503); }
}
// Reuse T16's fresh ownership/rights/object checks, including the active promotion
// dependency graph. Compare that graph in the same D1 batch as activation.
export async function campaignEligibility(runtime, trackId, clipId, now=Date.now()) {
  const x=await snapshot(runtime.db,'promotions',musicId(trackId));
  if(x.h.status!=='published'||!x.published||x.published.enabled!==1||x.h.published_at===null||x.h.published_at>now)fail('STATION_CAMPAIGN_PROMOTION_REQUIRED',422);
  if(clipId!==null&&!JSON.parse(x.published.selected_clip_ids_json).includes(musicId(clipId)))fail('STATION_CAMPAIGN_CLIP_REQUIRED',422);
  const graph=await validateContentPublication(runtime,x,x.published,now);
  const routes=rows(await primary(runtime.db).prepare("SELECT * FROM station_track_routes WHERE track_id=? AND role='canonical' LIMIT 2").bind(trackId).all());
  if(routes.length!==1)fail('STATION_ROUTE_REQUIRED',422);
  return {slug:routes[0].slug,clipIds:JSON.parse(x.published.selected_clip_ids_json),guard:combineGuards(graph,rowGuard(x.d.table,x.h),rowGuard(x.d.revisions,x.published),rowGuard('station_track_routes',routes[0]))};
}
const getRow=async(db,id)=>rows(await primary(db).prepare('SELECT * FROM station_campaigns WHERE id=? LIMIT 2').bind(id).all())[0];
export async function campaignView(runtime,row,{checkEffective=true}={}) {
  const aliases=rows(await primary(runtime.db).prepare('SELECT source_key FROM station_campaign_legacy_sources WHERE campaign_id=? ORDER BY source_key LIMIT 6').bind(row.id).all());
  if(aliases.length>5)fail('STATION_CAMPAIGN_SCHEMA_UNAVAILABLE',503);
  let effective=false;
  if(checkEffective&&row.status==='active'&&validCampaignRecord(row)) {
    try { const ready=await campaignEligibility(runtime,row.track_id,row.clip_id);effective=campaignLocales.some(l=>campaignLandingPath(l,ready.slug)===row.landing_path); }
    catch(e){if(e.status!==404&&e.status!==422)throw e;}
  }
  return {id:row.id,source:row.source,medium:row.medium,trackId:row.track_id,clipId:row.clip_id,landingPath:row.landing_path,
    content:row.content_value,status:row.status,editVersion:row.edit_version,legacySources:aliases.map(a=>a.source_key),
    effective,url:effective?campaignUrl(row):null,createdAt:row.created_at,updatedAt:row.updated_at};
}
export async function readCampaign(runtime,id) {
  if(!campaignId(id))fail('INVALID_INPUT',400);const row=await getRow(runtime.db,id);if(!row)fail('NOT_FOUND',404);return campaignView(runtime,row);
}
export async function listCampaigns(runtime,trackId,query) {
  fields(query,['before']);musicId(trackId);const before=query.before===undefined?Number.MAX_SAFE_INTEGER:Number(query.before);
  if(!Number.isSafeInteger(before)||before<1)fail('INVALID_INPUT',400);
  const result=rows(await primary(runtime.db).prepare('SELECT rowid AS cursor,* FROM station_campaigns WHERE track_id=? AND rowid<? ORDER BY rowid DESC LIMIT 21').bind(trackId,before).all());
  let eligibility=null;try{eligibility=await campaignEligibility(runtime,trackId,null);}catch(e){if(e.status!==404&&e.status!==422)throw e;}
  // One fresh graph check for the page, rather than a separate R2 graph for each item.
  const items=[];for(const row of result.slice(0,20)){
    const view=await campaignView(runtime,row,{checkEffective:false});
    view.effective=Boolean(eligibility&&row.status==='active'&&validCampaignRecord(row)&&(!row.clip_id||eligibility.clipIds.includes(row.clip_id))&&campaignLocales.some(l=>campaignLandingPath(l,eligibility.slug)===row.landing_path));
    view.url=view.effective?campaignUrl(row):null;items.push(view);
  }
  return {items,nextBefore:result.length>20?result[19].cursor:null,creationAvailable:Boolean(eligibility),enabled:true,clipIds:eligibility?.clipIds??[]};
}
function creation(input) {
  fields(input,['id','source','medium','clipId','locale','legacySources','status','reason']);
  if(!campaignId(input.id)||!campaignToken(input.source)||!campaignToken(input.medium)||!campaignLocales.includes(input.locale)||!['draft','active'].includes(input.status))fail('INVALID_INPUT',400);
  const aliases=input.legacySources??[];
  if(!Array.isArray(aliases)||aliases.length>5||aliases.some(v=>!campaignToken(v))||new Set(aliases).size!==aliases.length)fail('INVALID_INPUT',400);
  return {...input,clipId:input.clipId==null?null:musicId(input.clipId),legacySources:[...aliases].sort(),reason:text(input.reason,1000,false,true)};
}
export async function createCampaign(runtime,trackId,input,context) {
  musicId(trackId);const data=creation(input);
  return mutateContent(runtime.db,{...context,route:'station.campaign.create:'+trackId,command:{trackId,...data}},async(s,now)=>{
    const eligible=await campaignEligibility(runtime,trackId,data.clipId,now);
    if(await getRow(runtime.db,data.id))fail('STATION_CAMPAIGN_ID_EXISTS',409);
    const aliases=data.legacySources;
    for(const alias of aliases)if(rows(await s.prepare('SELECT source_key FROM station_campaign_legacy_sources WHERE source_key=? LIMIT 1').bind(alias).all()).length)fail('STATION_CAMPAIGN_ALIAS_EXISTS',409);
    const row={id:data.id,source:data.source,medium:data.medium,track_id:trackId,clip_id:data.clipId,landing_path:campaignLandingPath(data.locale,eligible.slug),content_value:data.clipId||'track',status:data.status};
    const guards=combineGuards(eligible.guard,{condition:'NOT EXISTS(SELECT 1 FROM station_campaigns WHERE id=?)',params:[data.id]},...aliases.map(alias=>({condition:'NOT EXISTS(SELECT 1 FROM station_campaign_legacy_sources WHERE source_key=?)',params:[alias]})));
    return {...guards,writes:[s.prepare('INSERT INTO station_campaigns(id,source,medium,track_id,clip_id,landing_path,status,content_value,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(row.id,row.source,row.medium,row.track_id,row.clip_id,row.landing_path,row.status,row.content_value,now,now),
      ...aliases.map(alias=>s.prepare('INSERT INTO station_campaign_legacy_sources(source_key,campaign_id,created_at) VALUES(?,?,?)').bind(alias,data.id,now))],
      action:'station.campaign.create',targetId:data.id,summary:{trackId,clipId:data.clipId,status:data.status,reason:data.reason},result:{id:data.id,trackId,editVersion:1,status:data.status}};
  });
}
export async function setCampaignStatus(runtime,id,input,context) {
  fields(input,['status','reason']);if(!campaignId(id)||!['active','archived'].includes(input.status))fail('INVALID_INPUT',400);
  const reason=text(input.reason,1000,false,true),version=editVersion(context.ifMatch);
  return mutateContent(runtime.db,{...context,route:'station.campaign.status:'+id,command:{id,status:input.status,reason,version}},async(s,now)=>{
    const row=await getRow(runtime.db,id);if(!row)fail('NOT_FOUND',404);if(row.edit_version!==version)fail('STATION_EDIT_CONFLICT',409);
    let guard=rowGuard('station_campaigns',row);
    if(input.status==='active'){
      if(!validCampaignRecord(row))fail('STATION_CAMPAIGN_UNVERIFIED',422);
      const eligible=await campaignEligibility(runtime,row.track_id,row.clip_id,now);
      if(!campaignLocales.some(l=>campaignLandingPath(l,eligible.slug)===row.landing_path))fail('STATION_ROUTE_REQUIRED',422);
      guard=combineGuards(guard,eligible.guard);
    }
    return {...guard,writes:[s.prepare('UPDATE station_campaigns SET status=?,edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?').bind(input.status,now,id,version)],
      action:'station.campaign.'+input.status,targetId:id,summary:{trackId:row.track_id,status:input.status,reason},result:{id,trackId:row.track_id,editVersion:version+1,status:input.status}};
  });
}
