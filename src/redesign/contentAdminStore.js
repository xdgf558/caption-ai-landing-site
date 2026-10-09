import { primary, rows, mutate } from '../music/adminStore.js';
import { fail, fields, musicId } from '../music/adminValidation.js';
import { checkedContentRuntime } from './publicStore.js';
import { stationMediaReadiness } from './mediaUploads.js';
import { model, objectId, viewData, integer } from './contentAdminModel.js';

export async function contentAdminReadiness(env) {
  try {
    const runtime=await checkedContentRuntime(env);
    await stationMediaReadiness(runtime.db);
    const results=await runtime.session.batch([
      runtime.session.prepare('SELECT id,object_type,object_id,revision,edit_version,actor_id,due_at,status,error_code,created_at,finished_at FROM station_publish_jobs LIMIT 0'),
      runtime.session.prepare('SELECT edit_version FROM station_asset_rights LIMIT 0'),
      runtime.session.prepare("SELECT name FROM d1_migrations WHERE name IN ('0013_station_media_uploads.sql','0014_station_content_operations.sql') ORDER BY name LIMIT 3")
    ]);
    results.map(rows); if(results[2].results.length!==2) throw new Error('ledger');
    return runtime;
  } catch { fail('STATION_CONTENT_SCHEMA_UNAVAILABLE',503); }
}
// The Access verifier has already restricted these identities to existing admins.
// Optional editor membership only reduces privileges; it cannot admit a new user.
export function contentRole(env,actor) {
  const editors=String(env.STATION_CONTENT_EDITOR_EMAILS??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  return editors.includes(actor.toLowerCase())?'editor':'publisher';
}
export function requirePublisher(env,actor) { if(contentRole(env,actor)!=='publisher') fail('STATION_PUBLISHER_REQUIRED',403); }
export async function snapshot(db,type,id) {
  const d=model(type); objectId(type,id); const s=primary(db);
  const h=rows(await s.prepare(`SELECT * FROM ${d.table} WHERE ${d.key}=? LIMIT 2`).bind(id).all())[0];
  if(!h) fail('NOT_FOUND',404);
  const revisions=rows(await s.prepare(`SELECT * FROM ${d.revisions} WHERE ${d.key}=? ORDER BY revision DESC LIMIT 26`).bind(id).all());
  const current=rows(await s.prepare(`SELECT * FROM ${d.revisions} WHERE ${d.key}=? AND revision IN (?,?) ORDER BY revision`).bind(id,h.draft_revision,h.published_revision).all());
  const maximum=rows(await s.prepare(`SELECT MAX(revision) AS n FROM ${d.revisions} WHERE ${d.key}=?`).bind(id).all())[0].n??0;
  return {type,id,d,h,revisions:revisions.slice(0,25),hasOlder:revisions.length>25,current,maximum,
    draft:current.find(r=>r.revision===h.draft_revision)??null,published:current.find(r=>r.revision===h.published_revision)??null};
}
export async function readContentObject(db,type,id) {
  const x=await snapshot(db,type,id);
  const jobs=rows(await primary(db).prepare('SELECT * FROM station_publish_jobs WHERE object_type=? AND object_id=? ORDER BY created_at DESC,id LIMIT 20').bind(type,id).all());
  return {type,id,editVersion:x.h.edit_version,status:x.h.status,slug:x.h.slug??null,trackId:x.h.track_id??(type==='tracks'||type==='promotions'?id:null),clipType:x.h.type??null,
    publishedAt:x.h.published_at,scheduledAt:x.h.scheduled_at,
    draft:x.draft?{revision:x.draft.revision,data:viewData(type,x.draft)}:null,
    published:x.published?{revision:x.published.revision,data:viewData(type,x.published)}:null,
    revisions:x.revisions.map(r=>({revision:r.revision,state:r.state,createdAt:r.created_at,data:viewData(type,r)})),hasOlderRevisions:x.hasOlder,
    jobs:jobs.map(j=>({id:j.id,revision:j.revision,actorId:j.actor_id,dueAt:j.due_at,status:j.status,errorCode:j.error_code,finishedAt:j.finished_at}))};
}
export async function listContentObjects(db,type,query={}) {
  const d=model(type); fields(query,type==='clips'?['before','q','trackId']:['before','q']); const before=query.before===undefined?Number.MAX_SAFE_INTEGER:integer(Number(query.before),1,Number.MAX_SAFE_INTEGER);
  const trackId=type==='clips'&&query.trackId?musicId(query.trackId):null;
  const q=query.q??''; if(typeof q!=='string'||q.length>100||/[\u0000-\u001f]/.test(q)) fail('INVALID_INPUT',400);
  const s=primary(db);
  if(type==='tracks') {
    const items=rows(await s.prepare(`SELECT t.rowid AS cursor,t.id,t.slug,COALESCE(h.status,'unregistered') AS status,h.edit_version,
      COALESCE(r.metadata_json,o.metadata_json,'{}') AS metadata_json FROM music_tracks t
      LEFT JOIN station_track_publications h ON h.track_id=t.id
      LEFT JOIN station_track_revisions r ON r.track_id=t.id AND r.revision=COALESCE(h.draft_revision,h.published_revision)
      LEFT JOIN music_track_revisions o ON o.id=COALESCE(t.draft_revision_id,t.published_revision_id)
      WHERE t.rowid<? AND (?='' OR instr(lower(t.slug),lower(?))>0 OR instr(lower(COALESCE(r.metadata_json,o.metadata_json,'')),lower(?))>0)
      ORDER BY t.rowid DESC LIMIT 21`).bind(before,q,q,q).all());
    return listView(items);
  }
  const title=type==='promotions'?"COALESCE((SELECT metadata_json FROM station_track_revisions WHERE track_id=h.track_id AND revision=(SELECT COALESCE(draft_revision,published_revision) FROM station_track_publications WHERE track_id=h.track_id)),'{}')":type==='home'?"'{}'":'r.metadata_json';
  const items=rows(await s.prepare(`SELECT h.rowid AS cursor,h.${d.key} AS id,h.status,h.edit_version,${type==='clips'||type==='promotions'?'h.track_id':'NULL'} AS track_id,${title} AS metadata_json FROM ${d.table} h
    LEFT JOIN ${d.revisions} r ON r.${d.key}=h.${d.key} AND r.revision=COALESCE(h.draft_revision,h.published_revision)
    WHERE h.rowid<? AND (?='' OR instr(lower(${title}),lower(?))>0) ${type==='clips'?'AND (? IS NULL OR h.track_id=?)':''} ORDER BY h.rowid DESC LIMIT 21`).bind(before,q,q,...(type==='clips'?[trackId,trackId]:[])).all());
  return listView(items);
}
export async function contentRevisionHistory(db,type,id,query={}) {
  const d=model(type);id=objectId(type,id);fields(query,['before']);
  const before=query.before===undefined?Number.MAX_SAFE_INTEGER:integer(Number(query.before),1,Number.MAX_SAFE_INTEGER);
  await snapshot(db,type,id);
  const result=rows(await primary(db).prepare(`SELECT revision,state,created_at FROM ${d.revisions} WHERE ${d.key}=? AND revision<? ORDER BY revision DESC LIMIT 26`).bind(id,before).all());
  return {items:result.slice(0,25).map(r=>({revision:r.revision,state:r.state,createdAt:r.created_at})),nextBefore:result.length>25?result[24].revision:null};
}
function listView(items) { return {items:items.slice(0,20).map(r=>{ let m={};try{m=JSON.parse(r.metadata_json);}catch{} return {id:r.id,trackId:r.track_id??null,slug:r.slug??null,status:r.status,editVersion:r.edit_version??null,title:m.title?.[m.originalLocale]??r.slug??(r.id==='ca710000-0000-4000-8000-000000000001'?'首页配置':'尚未填写标题')}; }),nextBefore:items.length>20?items[19].cursor:null}; }

// A bounded dependency graph is compared in the SAME D1 batch as publication.
// One JSON fingerprint parameter per row keeps guards below D1's bind limit.
export function rowGuard(table,row) {
  if(!row) fail('STATION_REFERENCE_UNAVAILABLE',422);
  const keys=Object.keys(row); if(!/^[a-z_]+$/.test(table)||keys.some(k=>!/^[a-z_][a-z0-9_]*$/.test(k))) fail('STATION_CONTENT_SCHEMA_UNAVAILABLE',503);
  return {condition:`EXISTS(SELECT 1 FROM ${table} WHERE json_object(${keys.map(k=>`'${k}',${k}`).join(',')})=?)`,params:[JSON.stringify(row)]};
}
export function combineGuards(...guards) { return {condition:guards.map(g=>`(${g.condition})`).join(' AND ')||'1',params:guards.flatMap(g=>g.params)}; }
export const mutateContent=(db,context,build)=>mutate(db,{...context,conflictCode:'STATION_EDIT_CONFLICT'},build);
export function revisionInsert(s,x,number,data,now,state='draft') {
  const keys=x.d.columns;
  return s.prepare(`INSERT INTO ${x.d.revisions}(${x.d.key},revision,state,${keys.join(',')},created_at) VALUES(${Array(keys.length+4).fill('?').join(',')})`)
    .bind(x.id,number,state,...keys.map(k=>data[k]),now);
}
export async function pendingJobs(db,type,id) { return rows(await primary(db).prepare("SELECT * FROM station_publish_jobs WHERE object_type=? AND object_id=? AND status='pending' LIMIT 2").bind(type,id).all()); }
export function cancelJobs(s,jobs,now) { return jobs.map(j=>s.prepare("UPDATE station_publish_jobs SET status='cancelled',finished_at=? WHERE id=? AND status='pending'").bind(now,j.id)); }
export async function contentAssets(db,query={}) {
  fields(query,['ownerId','before','kind']); const owner=musicId(query.ownerId), before=query.before??'z';
  if(typeof before!=='string'||before.length>40||!['','audio','preview','cover','lyrics','short_video','mv','poster','game_screenshot'].includes(query.kind??'')) fail('INVALID_INPUT',400);
  const kind=query.kind??'';
  const items=rows(await primary(db).prepare(`SELECT a.id,a.kind,a.state,a.duration_ms,a.byte_size,a.created_at,w.status AS rights_status,w.edit_version AS rights_version,w.basis,w.reviewed_at
    FROM (SELECT id,kind,state,duration_ms,byte_size,created_at FROM music_assets WHERE owner_track_id=? AND kind IN ('audio','preview','cover','lyrics')
    UNION ALL SELECT id,kind,state,duration_ms,byte_size,created_at FROM station_media_assets WHERE owner_clip_id=? OR owner_game_id=?) a
    LEFT JOIN station_asset_rights w ON (w.music_asset_id=a.id OR w.media_asset_id=a.id) AND w.scope=a.kind
    WHERE a.id<? AND (?='' OR a.kind=?) ORDER BY a.id DESC LIMIT 51`).bind(owner,owner,owner,before,kind,kind).all());
  return {items:items.slice(0,50).map(a=>({id:a.id,kind:a.kind,state:a.state,durationMs:a.duration_ms,byteSize:a.byte_size,rightsStatus:a.rights_status??'pending',rightsVersion:a.rights_version??0,basis:a.basis??'',reviewedAt:a.reviewed_at})),nextBefore:items.length>50?items[49].id:null};
}
