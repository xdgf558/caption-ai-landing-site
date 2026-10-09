import { primary, rows } from '../music/adminStore.js';
import { fields, fail, musicId, text } from '../music/adminValidation.js';
import { model, objectId, draftData, viewData, requestedVersion, revisionNumber, cleanSlug, platformData, integer, cleanText } from './contentAdminModel.js';
import { snapshot, readContentObject, mutateContent, rowGuard, combineGuards, revisionInsert, pendingJobs, cancelJobs } from './contentAdminStore.js';
import { validateContentPublication } from './contentAdminValidation.js';
import { stationHomeConfig } from '../data/station-home.js';
import { platformUrl } from './publicValidation.js';

const route=(type,id,action='')=>'/admin/api/music/site-content/'+type+(id?'/'+id:'')+(action?'/'+action:'');
const checked=(x,v)=>{if(x.h.edit_version!==v)fail('STATION_EDIT_CONFLICT',409);return rowGuard(x.d.table,x.h);};
const reason=input=>text(input.reason,1000,false,true);
const draftGuard=x=>x.draft?rowGuard(x.d.revisions,x.draft):{condition:'1',params:[]};
const commandResult=(type,id,number,version)=>({type,id,revision:number,editVersion:version,cachePolicy:'no-store'});

export async function createContentObject(runtime,type,input,context) {
  const d=model(type);fields(input,['slug','trackId','clipType','data','reason']); reason(input);
  if(type==='home')fail('STATION_HOME_ALREADY_EXISTS',409);
  const data=draftData(type,input.data);const trackId=input.trackId?musicId(input.trackId):null;
  if((type==='promotions'||type==='clips')&&!trackId)fail('INVALID_INPUT',400);
  if(type==='clips'&&!['short_video','mv'].includes(input.clipType))fail('INVALID_INPUT',400);
  const slug=type==='games'||(type==='tracks'&&!trackId)?cleanSlug(input.slug):null;
  if(type==='games'&&slug==='cat-life')fail('STATION_RUNTIME_DIRECTORY_RESERVED',422);
  return mutateContent(runtime.db,{...context,route:route(type),command:{type,input}},async(s,now)=>{
    const id=type==='promotions'||(type==='tracks'&&trackId)?trackId:crypto.randomUUID(), x={id,d};
    const guard={condition:`NOT EXISTS(SELECT 1 FROM ${d.table} WHERE ${d.key}=?)`,params:[id]},writes=[];
    if(type==='tracks') {
      if(!trackId) {
        const legacyId=crypto.randomUUID(),m=JSON.parse(data.metadata_json);
        const legacyMeta={...m,instrumental:true,language:'instrumental',genres:[],moods:[]};delete legacyMeta.relatedTrackIds;
        if(Object.values(legacyMeta.title).some(v=>v.length>120)||legacyMeta.creatorName.length>80)fail('MUSIC_INVALID_METADATA',422);
        writes.push(s.prepare('INSERT INTO music_tracks(id,slug,created_at,updated_at) VALUES(?,?,?,?)').bind(id,slug,now,now),
          s.prepare('INSERT INTO music_track_revisions(id,track_id,revision_no,metadata_json,created_at) VALUES(?,?,1,?,?)').bind(legacyId,id,JSON.stringify(legacyMeta),now),
          s.prepare('UPDATE music_tracks SET draft_revision_id=? WHERE id=?').bind(legacyId,id));
      } else {
        const old=rows(await s.prepare('SELECT * FROM music_tracks WHERE id=? LIMIT 2').bind(id).all())[0];if(!old)fail('NOT_FOUND',404);
        Object.assign(guard,combineGuards(guard,rowGuard('music_tracks',old)));
      }
      writes.push(s.prepare(`INSERT INTO station_track_publications(track_id,created_at,updated_at) VALUES(?,?,?)`).bind(id,now,now));
      const canonical=rows(await s.prepare("SELECT * FROM station_track_routes WHERE track_id=? AND role='canonical' LIMIT 2").bind(id).all());
      if(!canonical.length) writes.push(s.prepare("INSERT INTO station_track_routes(slug,track_id,role,created_at) VALUES(?,?,'canonical',?)").bind(trackId?rows(await s.prepare('SELECT slug FROM music_tracks WHERE id=?').bind(id).all())[0].slug:slug,id,now));
    } else if(type==='clips') writes.push(s.prepare('INSERT INTO station_clips(id,track_id,type,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,trackId,input.clipType,now,now));
    else if(type==='games') writes.push(s.prepare('INSERT INTO station_games(id,slug,runtime_key,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,slug,data.launch_url?'cat-life':null,now,now));
    else writes.push(s.prepare('INSERT INTO station_promotions(track_id,created_at,updated_at) VALUES(?,?,?)').bind(id,now,now));
    writes.push(revisionInsert(s,x,1,data,now),s.prepare(`UPDATE ${d.table} SET draft_revision=1 WHERE ${d.key}=?`).bind(id));
    return {...guard,writes,action:'station.content.create',targetId:id,summary:{type,revision:1,reason:input.reason},result:commandResult(type,id,1,1)};
  });
}
export async function saveContentObject(runtime,type,id,input,context) {
  objectId(type,id);fields(input,['revision','data','reason']);revisionNumber(input.revision);reason(input);
  const data=draftData(type,input.data),v=requestedVersion(context);
  return mutateContent(runtime.db,{...context,route:route(type,id),command:{input,version:v}},async(s,now)=>{
    const x=await snapshot(runtime.db,type,id),guard=checked(x,v);
    if((x.draft??x.published)?.revision!==input.revision)fail('STATION_EDIT_CONFLICT',409);
    const jobs=await pendingJobs(runtime.db,type,id),number=x.maximum+1,writes=cancelJobs(s,jobs,now);
    writes.push(revisionInsert(s,x,number,data,now),s.prepare(`UPDATE ${x.d.table} SET draft_revision=?,edit_version=edit_version+1,scheduled_at=NULL,
      status=CASE WHEN status='scheduled' THEN 'draft' ELSE status END,updated_at=?${type==='games'&&data.launch_url?',runtime_key=COALESCE(runtime_key,\'cat-life\')':''} WHERE ${x.d.key}=? AND edit_version=?`).bind(number,now,id,v));
    return {...combineGuards(guard,...jobs.map(j=>rowGuard('station_publish_jobs',j))),writes,action:'station.content.save',targetId:id,
      summary:{type,revision:number,previousRevision:input.revision,reason:input.reason},result:commandResult(type,id,number,v+1)};
  });
}
export async function contentPublication(runtime,type,id,action,input,context,{job=null}={}) {
  objectId(type,id);fields(input,action==='schedule'?['revision','dueAt','reason']:['revision','reason']);revisionNumber(input.revision);reason(input);const v=requestedVersion(context);
  if(!['publish','unpublish','rollback','schedule','cancel-schedule'].includes(action))fail('NOT_FOUND',404);
  if(action==='schedule'&&(!Number.isSafeInteger(input.dueAt)||input.dueAt<=Date.now()||input.dueAt>Date.now()+366*86400000))fail('STATION_SCHEDULE_TIME_INVALID',422);
  return mutateContent(runtime.db,{...context,route:route(type,id,action),command:{input,version:v,jobId:job?.id??null}},async(s,now)=>{
    const x=await snapshot(runtime.db,type,id),guard=checked(x,v),jobs=await pendingJobs(runtime.db,type,id);
    let r=action==='rollback'?rows(await s.prepare(`SELECT * FROM ${x.d.revisions} WHERE ${x.d.key}=? AND revision=? AND state='sealed' LIMIT 2`).bind(id,input.revision).all())[0]:x.draft;
    if(action==='unpublish'||action==='cancel-schedule') r=x.draft??x.published;
    if(!r||r.revision!==input.revision)fail('STATION_EDIT_CONFLICT',409);
    const dependencies=action==='publish'||action==='rollback'||action==='schedule'?await validateContentPublication(runtime,x,r,now):{condition:'1',params:[]};
    let number=r.revision,writes=[],status=x.h.status;
    if(action==='publish'||action==='rollback') {
      if(action==='rollback'){number=x.maximum+1;writes.push(revisionInsert(s,x,number,Object.fromEntries(x.d.columns.map(k=>[k,r[k]])),now,'sealed'));}
      else writes.push(s.prepare(`UPDATE ${x.d.revisions} SET state='sealed' WHERE ${x.d.key}=? AND revision=? AND state='draft'`).bind(id,number));
      status='published';
      writes.push(s.prepare(`UPDATE ${x.d.table} SET status='published',published_revision=?,published_at=?,draft_revision=NULL,scheduled_at=NULL,edit_version=edit_version+1,updated_at=? WHERE ${x.d.key}=? AND edit_version=?`).bind(number,now,now,id,v));
      for(const j of jobs) writes.push(s.prepare('UPDATE station_publish_jobs SET status=?,finished_at=? WHERE id=? AND status=\'pending\'').bind(job?.id===j.id?'succeeded':'cancelled',now,j.id));
      if(job && !jobs.some(j=>j.id===job.id))fail('STATION_EDIT_CONFLICT',409);
    } else if(action==='schedule') {
      if(jobs.length)fail('STATION_SCHEDULE_EXISTS',409);
      const jobId=crypto.randomUUID(); status=x.h.status==='published'?'published':'scheduled';
      writes.push(s.prepare(`UPDATE ${x.d.table} SET status=?,scheduled_at=?,edit_version=edit_version+1,updated_at=? WHERE ${x.d.key}=? AND edit_version=?`).bind(status,input.dueAt,now,id,v),
        s.prepare('INSERT INTO station_publish_jobs(id,object_type,object_id,revision,edit_version,actor_id,due_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(jobId,type,id,number,v+1,context.actorId,input.dueAt,now));
    } else {
      status=action==='unpublish'?'archived':x.h.status==='scheduled'?'draft':x.h.status;
      writes.push(...cancelJobs(s,jobs,now),s.prepare(`UPDATE ${x.d.table} SET status=?,scheduled_at=NULL,edit_version=edit_version+1,updated_at=? WHERE ${x.d.key}=? AND edit_version=?`).bind(status,now,id,v));
    }
    return {...combineGuards(guard,rowGuard(x.d.revisions,r),dependencies,...jobs.map(j=>rowGuard('station_publish_jobs',j))),writes,
      action:'station.content.'+action,targetId:id,summary:{type,revision:number,sourceRevision:r.revision,reason:input.reason,jobId:job?.id??null},result:{...commandResult(type,id,number,v+1),status}};
  });
}
export async function contentPreflight(runtime,type,id,revision) {
  revisionNumber(revision);const x=await snapshot(runtime.db,type,id),r=rows(await primary(runtime.db).prepare(`SELECT * FROM ${x.d.revisions} WHERE ${x.d.key}=? AND revision=? LIMIT 2`).bind(id,revision).all())[0];
  if(!r)fail('NOT_FOUND',404);await validateContentPublication(runtime,x,r,Date.now());
  return {type,id,revision,editVersion:x.h.edit_version,ready:true,data:viewData(type,r),previewScope:'private-metadata',cachePolicy:'no-store'};
}
export async function saveContentPlatform(runtime,id,input,context) {
  const v=id?requestedVersion(context):null,data=platformData(input,Date.now());if(id)id=musicId(id);
  return mutateContent(runtime.db,{...context,route:route('platforms',id),command:{input,version:v}},async(s,now)=>{
    const target=id??crypto.randomUUID(),keys=Object.keys(data),old=id?rows(await s.prepare('SELECT * FROM station_platform_links WHERE id=? LIMIT 2').bind(id).all())[0]:null;
    if(id&&(!old||old.version!==v))fail('STATION_EDIT_CONFLICT',409);
    if(old&&(old.track_id!==data.track_id||old.provider!==data.provider))fail('STATION_OBJECT_IDENTITY',409);
    if(context.role==='editor'&&(old?.status==='live'||data.status==='live'||data.verified_at!==null))fail('STATION_PUBLISHER_REQUIRED',403);
    if(!id&&rows(await s.prepare('SELECT COUNT(*) AS n FROM station_platform_links WHERE track_id=?').bind(data.track_id).all())[0].n>=25)fail('STATION_REFERENCE_BUDGET',422);
    const writes=id?[s.prepare(`UPDATE station_platform_links SET ${keys.filter(k=>!['track_id','provider'].includes(k)).map(k=>k+'=?').join(',')},version=version+1,updated_at=? WHERE id=? AND version=?`).bind(...keys.filter(k=>!['track_id','provider'].includes(k)).map(k=>data[k]),now,id,v)]:
      [s.prepare(`INSERT INTO station_platform_links(id,${keys.join(',')},created_at,updated_at) VALUES(${Array(keys.length+3).fill('?').join(',')})`).bind(target,...keys.map(k=>data[k]),now,now)];
    return {...(old?rowGuard('station_platform_links',old):{condition:'(SELECT COUNT(*) FROM station_platform_links WHERE track_id=?)<25',params:[data.track_id]}),writes,action:'station.platform.save',targetId:target,
      summary:{trackId:data.track_id,provider:data.provider,status:data.status,previousStatus:old?.status??null},result:{id:target,editVersion:(v??0)+1,cachePolicy:'no-store'}};
  });
}
export async function saveContentRights(runtime,id,input,context) {
  id=musicId(id);fields(input,['scope','status','basis','reason']);reason(input);
  if(!['cover','lyrics','preview','short_video','mv','poster','game_screenshot'].includes(input.scope)||!['pending','approved','blocked'].includes(input.status))fail('INVALID_INPUT',400);
  cleanText(input.basis,8000,input.status==='pending');const v=requestedVersion(context);
  return mutateContent(runtime.db,{...context,route:route('assets',id,'rights'),command:{input,version:v}},async(s,now)=>{
    const media=['short_video','mv','poster','game_screenshot'].includes(input.scope),table=media?'station_media_assets':'music_assets',col=media?'media_asset_id':'music_asset_id';
    const a=rows(await s.prepare(`SELECT * FROM ${table} WHERE id=? LIMIT 2`).bind(id).all())[0];if(!a||a.kind!==input.scope||a.state!=='validated')fail('STATION_ASSET_NOT_READY',422);
    const old=rows(await s.prepare(`SELECT * FROM station_asset_rights WHERE ${col}=? AND scope=? LIMIT 2`).bind(id,input.scope).all())[0];
    if(old?old.edit_version!==v:v!==1)fail('STATION_EDIT_CONFLICT',409);
    const reviewer=input.status==='pending'?null:context.actorId,reviewed=input.status==='pending'?null:now;
    const write=old?s.prepare('UPDATE station_asset_rights SET status=?,basis=?,reviewer_id=?,reviewed_at=?,edit_version=edit_version+1 WHERE id=? AND edit_version=?').bind(input.status,input.basis,reviewer,reviewed,old.id,v):
      s.prepare(`INSERT INTO station_asset_rights(id,${col},scope,status,basis,reviewer_id,reviewed_at,created_at) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,input.scope,input.status,input.basis,reviewer,reviewed,now);
    return {...combineGuards(rowGuard(table,a),old?rowGuard('station_asset_rights',old):{condition:`NOT EXISTS(SELECT 1 FROM station_asset_rights WHERE ${col}=? AND scope=?)`,params:[id,input.scope]}),writes:[write],action:'station.rights.review',targetId:id,
      summary:{scope:input.scope,status:input.status,previousStatus:old?.status??'pending',reason:input.reason},result:{id,editVersion:old?v+1:1,status:input.status}};
  });
}
export async function addClipPublication(runtime,clipId,input,context) {
  clipId=musicId(clipId);fields(input,['channel','postId','url','publishedAt','reason']);reason(input);
  const url=platformUrl(input.url,input.channel);if(!url)fail('STATION_PLATFORM_URL_INVALID',422);cleanText(input.postId,200);
  integer(input.publishedAt,0,Date.now());const v=requestedVersion(context);
  return mutateContent(runtime.db,{...context,route:route('clips',clipId,'publications'),command:{input,version:v}},async(s,now)=>{
    const x=await snapshot(runtime.db,'clips',clipId),guard=checked(x,v),id=crypto.randomUUID();
    if(rows(await s.prepare('SELECT COUNT(*) AS n FROM station_clip_publications WHERE clip_id=?').bind(clipId).all())[0].n>=10)fail('STATION_REFERENCE_BUDGET',422);
    return {...guard,writes:[s.prepare('INSERT INTO station_clip_publications(id,clip_id,channel,post_id,post_url,external_published_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,clipId,input.channel,input.postId,url,input.publishedAt,now),
      s.prepare('UPDATE station_clips SET edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?').bind(now,clipId,v)],action:'station.clip.publication',targetId:clipId,summary:{publicationId:id,channel:input.channel,reason:input.reason},result:{id,editVersion:v+1}};
  });
}
