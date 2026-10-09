import { primary, rows } from '../music/adminStore.js';
import { fields, fail, mutationKey, musicId } from '../music/adminValidation.js';
import { contentAdminReadiness, contentRole, requirePublisher, readContentObject, listContentObjects, contentAssets, contentRevisionHistory } from './contentAdminStore.js';
import { createContentObject, saveContentObject, contentPublication, contentPreflight, saveContentPlatform, saveContentRights, addClipPublication } from './contentAdmin.js';
import { platformData } from './contentAdminModel.js';
import { runStationContentSchedule } from './contentSchedule.js';

export async function handleContentAdmin(request,env,actor,query,readBody) {
  if(env.STATION_CONTENT_ADMIN_ENABLED!==true&&env.STATION_CONTENT_ADMIN_ENABLED!=='true')fail('STATION_CONTENT_ADMIN_DISABLED',503);
  const runtime=await contentAdminReadiness(env),path=new URL(request.url).pathname.slice('/admin/api/music/site-content'.length);
  const read=['GET','HEAD'].includes(request.method),context={actorId:actor,key:request.headers.get('idempotency-key'),ifMatch:request.headers.get('if-match')};
  if(!read)mutationKey(context.key);
  if(path==='/status'&&read){fields(query,[]);return {actorId:actor,role:contentRole(env,actor),enabled:true,schedulesEnabled:env.STATION_CONTENT_SCHEDULES_ENABLED===true||env.STATION_CONTENT_SCHEDULES_ENABLED==='true',cachePolicy:'no-store'};}
  if(path==='/assets'&&read)return contentAssets(runtime.db,query);
  if(path==='/audit'&&read) {
    fields(query,['before']);const before=query.before===undefined?Number.MAX_SAFE_INTEGER:Number(query.before);if(!Number.isSafeInteger(before)||before<1)fail('INVALID_INPUT',400);
    const result=rows(await primary(runtime.db).prepare("SELECT rowid AS cursor,actor_id,action,target_id,summary_json,created_at FROM music_admin_audit_logs WHERE action LIKE 'station.%' AND rowid<? ORDER BY rowid DESC LIMIT 21").bind(before).all());
    return {items:result.slice(0,20).map(r=>({actorId:r.actor_id,action:r.action,targetId:r.target_id,summary:JSON.parse(r.summary_json),createdAt:r.created_at})),nextBefore:result.length>20?result[19].cursor:null};
  }
  if(path==='/jobs/run'&&request.method==='POST') {fields(query,[]);fields(await readBody(request),[]);requirePublisher(env,actor);return runStationContentSchedule(env);}
  const asset=/^\/assets\/([^/]+)\/rights$/.exec(path);
  if(asset){if(request.method!=='PUT')fail('METHOD_NOT_ALLOWED',405);fields(query,[]);requirePublisher(env,actor);return saveContentRights(runtime,asset[1],await readBody(request),context);}
  const platform=/^\/platforms(?:\/([^/]+))?$/.exec(path);
  if(platform) {
    if(platform[1]&&read)fail('METHOD_NOT_ALLOWED',405);
    if(read){fields(query,['trackId']);musicId(query.trackId);
      const items=rows(await primary(runtime.db).prepare('SELECT id,track_id,provider,territories_json,status,url,verified_at,external_released_at,sort_order,version FROM station_platform_links WHERE track_id=? ORDER BY sort_order,id LIMIT 26').bind(query.trackId).all());
      if(items.length>25)fail('STATION_REFERENCE_BUDGET',422);
      return {items:items.map(r=>({id:r.id,editVersion:r.version,trackId:r.track_id,provider:r.provider,territories:JSON.parse(r.territories_json),status:r.status,url:r.url,verifiedAt:r.verified_at,releasedAt:r.external_released_at,sortOrder:r.sort_order}))};
    }
    fields(query,[]);if(request.method!==(platform[1]?'PATCH':'POST'))fail('METHOD_NOT_ALLOWED',405);
    const input=await readBody(request),data=platformData(input,Date.now());
    if(contentRole(env,actor)==='editor') {
      const old=platform[1]?rows(await primary(runtime.db).prepare('SELECT status FROM station_platform_links WHERE id=? LIMIT 2').bind(musicId(platform[1])).all())[0]:null;
      if(old?.status==='live'||data.status==='live'||data.verified_at!==null)fail('STATION_PUBLISHER_REQUIRED',403);
    }
    return saveContentPlatform(runtime,platform[1]??null,input,{...context,role:contentRole(env,actor)});
  }
  const match=/^\/(tracks|promotions|clips|games|home)(?:\/([^/]+)(?:\/(publish|unpublish|rollback|schedule|cancel-schedule|preflight|publications|campaigns|revisions))?)?$/.exec(path);
  if(!match)fail('NOT_FOUND',404);
  const [,type,rawId,action]=match;const id=rawId?musicId(rawId):null;
  if(!id) {
    if(read)return listContentObjects(runtime.db,type,query);
    if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);fields(query,[]);return createContentObject(runtime,type,await readBody(request),context);
  }
  musicId(id);
  if(action==='revisions'&&read)return contentRevisionHistory(runtime.db,type,id,query);
  if(action==='campaigns'&&read){fields(query,[]);if(type!=='promotions')fail('NOT_FOUND',404);
    return {items:rows(await primary(runtime.db).prepare('SELECT id,source,medium,track_id,clip_id,landing_path,status FROM station_campaigns WHERE track_id=? ORDER BY created_at DESC,id LIMIT 20').bind(id).all()),creationAvailable:false,nextTask:'T17'};}
  if(action==='publications') {
    if(type!=='clips')fail('NOT_FOUND',404);fields(query,[]);
    if(read) return {items:rows(await primary(runtime.db).prepare('SELECT id,channel,post_id,post_url,external_published_at FROM station_clip_publications WHERE clip_id=? ORDER BY external_published_at DESC,id LIMIT 10').bind(id).all())};
    if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);requirePublisher(env,actor);return addClipPublication(runtime,id,await readBody(request),context);
  }
  if(action==='preflight'&&read){fields(query,['revision']);return contentPreflight(runtime,type,id,Number(query.revision));}
  fields(query,[]);
  if(!action&&read)return readContentObject(runtime.db,type,id);
  if(!action){if(request.method!=='PATCH')fail('METHOD_NOT_ALLOWED',405);return saveContentObject(runtime,type,id,await readBody(request),context);}
  if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);requirePublisher(env,actor);
  if(action==='schedule'&&env.STATION_CONTENT_SCHEDULES_ENABLED!==true&&env.STATION_CONTENT_SCHEDULES_ENABLED!=='true')fail('STATION_CONTENT_SCHEDULES_DISABLED',503);
  return contentPublication(runtime,type,id,action,await readBody(request),context);
}
