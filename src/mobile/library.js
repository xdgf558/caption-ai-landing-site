import {MobileError,requireValue,validID,readBody,exactKeys,hash,iso,assertChanged,clearAssert} from './security.js';
import {principal} from './sessions.js';
import {loadPublishedMusicRecord} from '../music/publicStore.js';
import {projectPublicTrack} from '../music/catalog.js';
export const personalSyncEnabled=env=>env.MOBILE_PERSONAL_SYNC_ENABLED==='true' && env.MOBILE_ENVIRONMENT==='isolated' && env.MOBILE_AUTH_ENABLED==='true' && env.MOBILE_MUSIC_ENABLED==='true';
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const preferences=s=>({historyEnabled:!!s.history_enabled,historyEpoch:s.history_epoch,version:s.preference_version});
const favorite=r=>({trackId:r.track_id,favorite:!!r.favorite,version:r.version,updatedAt:iso(r.updated_at)});
class AccountContention extends Error {}
export async function personalMusic(request,env,db,s,now) {
 // Re-evaluate resource versions after unrelated account writes; keep the same body/ID.
 // Exhaustion is transient (503), never a resource conflict that discards client intent.
 for(let attempt=0;attempt<3;attempt++) {
  try {return await personalMusicAttempt(request.clone(),env,db,s,now);}
  catch(error) {
   if(!(error instanceof AccountContention))throw error;
   if(attempt===2)throw new MobileError('LIBRARY_BUSY',503);
   now=Date.now();s=await principal(db,request,now);
  }
 }
}
async function personalMusicAttempt(request,env,db,s,now) {
 requireValue(personalSyncEnabled(env),'SERVICE_UNAVAILABLE',503);
 const account=s.account_id,url=new URL(request.url),path=url.pathname.split('/me/music/')[1];
 await db.prepare('INSERT OR IGNORE INTO mobile_music_state(account_id) VALUES(?)').bind(account).run();
 const state=await db.prepare('SELECT * FROM mobile_music_state WHERE account_id=?').bind(account).first();
 if(request.method==='GET') {
  const entries=[...url.searchParams];requireValue(entries.every(([k])=>['limit','cursor'].includes(k))&&new Set(entries.map(([k])=>k)).size===entries.length);
  if(path==='preferences'){requireValue(entries.length===0);return preferences(state);}
  requireValue(['favorites','recent'].includes(path));
  const limit=Number(url.searchParams.get('limit')||50);requireValue(integer(limit)&&limit>0&&limit<=100);
  let offset=0;const cursor=url.searchParams.get('cursor');
  if(cursor){requireValue(/^\d+:\d+$/.test(cursor));const [revision,n]=cursor.split(':').map(Number);requireValue(revision===state.revision,'CURSOR_EXPIRED',409);requireValue(integer(n)&&n<=100000);offset=n;}
  const rows=path==='favorites'?(await db.prepare('SELECT * FROM mobile_music_favorites WHERE account_id=? ORDER BY track_id LIMIT ? OFFSET ?').bind(account,limit+1,offset).all()).results:
   (await db.prepare('SELECT * FROM mobile_music_recent WHERE account_id=? AND played_at>? ORDER BY played_at DESC,track_id LIMIT ? OFFSET ?').bind(account,now-90*86400000,limit+1,offset).all()).results;
  return {items:rows.slice(0,limit).map(path==='favorites'?favorite:r=>({trackId:r.track_id,lastPlayedAt:iso(r.played_at),positionSeconds:r.position})),
   nextCursor:rows.length>limit?`${state.revision}:${offset+limit}`:null,...(path==='favorites'?{syncVersion:state.revision}:{historyEpoch:state.history_epoch})};
 }
 requireValue(url.searchParams.size===0);
 const body=await readBody(request),isFavorite=path?.startsWith('favorites/'),isListen=path==='listens';
 if(isFavorite){requireValue(request.method==='PUT');exactKeys(body,['favorite','mutationId','expectedVersion']);requireValue(typeof body.favorite==='boolean'&&integer(body.expectedVersion));}
 else if(isListen){requireValue(request.method==='POST');exactKeys(body,['trackId','audioVersion','variant','eventId','historyEpoch','audibleSeconds','positionSeconds','occurredAt']);
  requireValue(validID(body.trackId)&&integer(body.audioVersion)&&body.audioVersion>0&&['full','preview'].includes(body.variant)&&integer(body.historyEpoch)&&Number.isFinite(body.audibleSeconds)&&body.audibleSeconds>=5&&body.audibleSeconds<=86400&&Number.isFinite(body.positionSeconds)&&body.positionSeconds>=0&&body.positionSeconds<=86400);
  const occurred=Date.parse(body.occurredAt);
  requireValue(typeof body.occurredAt==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.occurredAt) && Number.isFinite(occurred) && occurred>=now-30*86400000 && occurred<=now+5*60000);
  requireValue(state.history_enabled===1,'HISTORY_DISABLED',409);requireValue(body.historyEpoch===state.history_epoch,'HISTORY_EPOCH_STALE',409);
 } else if(path==='preferences'){requireValue(request.method==='PATCH');exactKeys(body,['historyEnabled','expectedVersion','mutationId']);requireValue(typeof body.historyEnabled==='boolean'&&integer(body.expectedVersion));}
 else {requireValue(path==='recent'&&request.method==='DELETE');exactKeys(body,['confirmed','historyEpoch','mutationId']);requireValue(body.confirmed===true&&integer(body.historyEpoch));}
 const id=isListen?body.eventId:body.mutationId;requireValue(validID(id));
 const digest=await hash(JSON.stringify([request.method,path,Object.keys(body).sort().map(k=>[k,body[k]])]));
 const replay=async()=>{const r=await db.prepare('SELECT * FROM mobile_music_operations WHERE account_id=? AND id=?').bind(account,id).first();if(r){requireValue(r.digest===digest,'IDEMPOTENCY_CONFLICT',409);return JSON.parse(r.result);}return null;};
 const previous=await replay();if(previous)return previous;
 requireValue((await db.prepare('SELECT count(*) n FROM mobile_music_operations WHERE account_id=?').bind(account).first()).n<100000,'LIBRARY_LIMIT',409);
 const writes=[];let result;
 if(isFavorite){
  const track=path.slice('favorites/'.length);requireValue(validID(track));
  const existing=await db.prepare('SELECT * FROM mobile_music_favorites WHERE account_id=? AND track_id=?').bind(account,track).first();
  if((existing?.version||0)!==body.expectedVersion){const error=new MobileError('VERSION_CONFLICT',409);error.current=existing?favorite(existing):{trackId:track,favorite:false,version:0,updatedAt:iso(now)};throw error;}
  if(body.favorite){const record=await loadPublishedMusicRecord(env.MUSIC_DB,track);requireValue(projectPublicTrack(record,{locale:'en',now}),'MEDIA_UNAVAILABLE',404);
   if(!existing?.favorite)requireValue((await db.prepare('SELECT count(*) n FROM mobile_music_favorites WHERE account_id=? AND favorite=1').bind(account).first()).n<5000,'LIBRARY_LIMIT',409);}
  result={trackId:track,favorite:body.favorite,version:body.expectedVersion+1,updatedAt:iso(now)};
  writes.push(db.prepare(`INSERT INTO mobile_music_favorites(account_id,track_id,favorite,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,track_id) DO UPDATE SET favorite=excluded.favorite,version=excluded.version,updated_at=excluded.updated_at`).bind(account,track,Number(body.favorite),result.version,now));
 } else if(isListen){
  const record=await loadPublishedMusicRecord(env.MUSIC_DB,body.trackId);const track=projectPublicTrack(record,{locale:'en',now});requireValue(track&&track.audioVersion===body.audioVersion,'MEDIA_UNAVAILABLE',404);
  // Personal history is untrusted telemetry; it never grants playback or points.
  const occurred=Math.min(Date.parse(body.occurredAt),now); // Small future clock skew is clamped to receipt time.
  result={accepted:true};writes.push(db.prepare('INSERT INTO mobile_music_recent(account_id,track_id,played_at,position,received_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,track_id) DO UPDATE SET played_at=excluded.played_at,position=excluded.position,received_at=excluded.received_at WHERE excluded.played_at>mobile_music_recent.played_at').bind(account,body.trackId,occurred,body.positionSeconds,now),
   db.prepare('DELETE FROM mobile_music_recent WHERE account_id=? AND (played_at<=? OR track_id NOT IN (SELECT track_id FROM mobile_music_recent WHERE account_id=? ORDER BY played_at DESC,track_id LIMIT 1000))').bind(account,now-90*86400000,account));
 } else if(path==='preferences'){
  requireValue(body.expectedVersion===state.preference_version,'VERSION_CONFLICT',409);
  // Any toggle invalidates prior offline history, including disable then re-enable.
  result={historyEnabled:body.historyEnabled,historyEpoch:state.history_epoch+1,version:state.preference_version+1};
  writes.push(db.prepare('UPDATE mobile_music_state SET history_enabled=?,history_epoch=?,preference_version=? WHERE account_id=?').bind(Number(result.historyEnabled),result.historyEpoch,result.version,account));
 } else {
  requireValue(body.historyEpoch===state.history_epoch,'HISTORY_EPOCH_STALE',409);
  result={historyEnabled:!!state.history_enabled,historyEpoch:state.history_epoch+1,version:state.preference_version+1};
  writes.push(db.prepare('DELETE FROM mobile_music_recent WHERE account_id=?').bind(account),db.prepare('UPDATE mobile_music_state SET history_epoch=?,preference_version=? WHERE account_id=?').bind(result.historyEpoch,result.version,account));
 }
 try {await db.batch([
  db.prepare(`UPDATE mobile_music_state SET revision=revision+1 WHERE account_id=? AND revision=? AND EXISTS(
   SELECT 1 FROM mobile_sessions s JOIN reader_accounts a ON a.id=s.account_id JOIN reader_password_credentials p ON p.account_id=a.id LEFT JOIN reader_totp_credentials t ON t.account_id=a.id
   WHERE s.id=? AND s.revoked=0 AND s.access_until>? AND s.absolute_until>? AND a.status='active' AND s.password_version=p.password_hash AND s.totp_version=json_array(coalesce(t.enabled_at,''),coalesce(t.disabled_at,'')))`).bind(account,state.revision,s.id,now,now),assertChanged(db),...writes,
  db.prepare('INSERT INTO mobile_music_operations(account_id,id,digest,result,created_at) VALUES(?,?,?,?,?)').bind(account,id,digest,JSON.stringify(result),now),clearAssert(db)
 ]);}catch(error){await principal(db,request,Date.now());const r=await replay();if(r)return r;const latest=await db.prepare('SELECT revision FROM mobile_music_state WHERE account_id=?').bind(account).first();if(latest.revision!==state.revision)throw new AccountContention();throw error;}
 return result;
}
