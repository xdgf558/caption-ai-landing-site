import {parseMusicLyrics} from '../scripts/musicLyrics.js';
import {requireValue,validSecret,randomSecret,hash,readBody,exactKeys,iso} from './security.js';
import {principal} from './sessions.js';
import {nativeMusicEntitlements} from './musicEntitlements.js';
import {musicRuntime} from '../music/runtime.js';
import {loadPublishedMusicRecord,loadPublicMusicSnapshot} from '../music/publicStore.js';
import {buildPublicCatalog,projectPublicTrack} from '../music/catalog.js';
import {MUSIC_LOCALES} from '../music/policy.js';
import {validMusicId} from '../music/publicationValidation.js';
import {validateMusicMediaAsset,cancelBody} from '../music/storage.js';
import {checkAssetIdentity,checkStoredObject} from '../music/resources.js';
import {serveValidatedMusicMedia} from '../music/mediaResponse.js';

export const nativeMusicEnabled=env=>env.MOBILE_MUSIC_ENABLED==='true' && env.MOBILE_ENVIRONMENT==='isolated' && env.MOBILE_AUTH_ENABLED==='true';
const trackDTO=t=>({id:t.id,title:t.title,artist:t.creatorName,durationSeconds:t.durationSec,audioVersion:t.audioVersion,
  access:t.effectiveAccess==='free'?'free':t.previewAvailable?'preview':'vip'});
const json=(data,now)=>Response.json({data,requestId:crypto.randomUUID(),serverNow:iso(now)},
  {headers:{'Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'}});
function query(url,keys) {
  const pairs=[...url.searchParams]; requireValue(pairs.every(([k])=>keys.includes(k)) && new Set(pairs.map(([k])=>k)).size===pairs.length);
}
async function published(db,id,locale,now) {
  requireValue(validMusicId(id));
  const record=await loadPublishedMusicRecord(db,id), track=projectPublicTrack(record,{locale,now});
  requireValue(track,'MEDIA_UNAVAILABLE',404);return {record,track};
}
async function entitlement(db,s,now) {
  return s ? nativeMusicEntitlements(db,s,now) : null;
}
function authorize(track,variant,s,rights,flags) {
  requireValue(variant==='full'||variant==='preview');
  if(variant==='preview') {requireValue(track.previewAvailable,'MEDIA_UNAVAILABLE',404);return 'public';}
  if(track.effectiveAccess==='free')return 'public';
  requireValue(s,'AUTH_REQUIRED',401);
  requireValue(flags.vipDelivery,'SERVICE_UNAVAILABLE',503);
  requireValue(rights?.music.canPlayVipFull,'ACCESS_DENIED',403);
  return 'session_bearer';
}
async function lyrics(bucket,record,version,signal) {
  const empty={kind:'none',text:'',lines:[],audioVersion:version};
  if(!record.revision.lyrics_asset_id)return empty;
  const asset=record.assets.find(a=>a.id===record.revision.lyrics_asset_id);
  checkAssetIdentity(asset);
  requireValue(asset.kind==='lyrics' && asset.state==='validated' && asset.owner_track_id===record.track.id && asset.byte_size<=131072,'SERVICE_UNAVAILABLE',503);
  const object=await bucket.get(asset.object_key,{onlyIf:{etagMatches:asset.etag}});
  try {
    checkStoredObject(object,asset);
    const reader=object.body.getReader(), chunks=[];let size=0;
    const abort=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;requireValue(size<=131072,'SERVICE_UNAVAILABLE',503);chunks.push(value);}}
    finally{signal.removeEventListener('abort',abort);await reader.cancel();}
    requireValue(size===asset.byte_size,'SERVICE_UNAVAILABLE',503);
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
    const parsed=parseMusicLyrics(text,asset.format);
    const result={kind:parsed.kind==='lrc'?'timed':'plain',text:parsed.text,
      lines:parsed.lines.map(row=>({startSeconds:Math.max(0,row.startMs/1000),text:row.text})),audioVersion:version};
    requireValue(new TextEncoder().encode(JSON.stringify(result)).byteLength<=196608,'SERVICE_UNAVAILABLE',503);return result;
  } finally {cancelBody(object);}
}

// Only called behind handleMobile's validated isolated origin/configuration.
// No web Cookie is translated into native authority. A supplied invalid Bearer
// fails even on otherwise public routes.
export async function handleNativeMusic(request,env,db,config,{clock=Date.now}={}) {
  const controller=new AbortController();let timer;
  const guardedClock=()=>{requireValue(!controller.signal.aborted,'SERVICE_UNAVAILABLE',503);return clock();};
  const work=processMusic(request,env,db,config,guardedClock,controller.signal);
  // A late response is discarded and its stream cancelled, never delivered after timeout.
  work.then(r=>{if(controller.signal.aborted)r.body?.cancel().catch(()=>{});},()=>{});
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();try{guardedClock();}catch(error){reject(error);}},5000);})]);}
  finally{clearTimeout(timer);}
}
async function processMusic(request,env,db,config,clock,signal) {
  requireValue(nativeMusicEnabled(env),'SERVICE_UNAVAILABLE',503);
  const runtime=musicRuntime(env);requireValue(runtime.flags.public,'SERVICE_UNAVAILABLE',503);
  const dto=t=>({...trackDTO(t),coverUrl:t.coverUrl?config.origin+t.coverUrl+'&size=display':null});
  const url=new URL(request.url),path=url.pathname.replace('/api/mobile/v1','');
  let s=request.headers.has('authorization')?await principal(db,request,clock()):null;
  const locale=url.searchParams.get('locale')||'en';requireValue(MUSIC_LOCALES.includes(locale));
  if(path==='/me/entitlements') {
    query(url,[]);requireValue(request.method==='GET');requireValue(s,'AUTH_REQUIRED',401);
    return json(await entitlement(db,s,clock()),clock());
  }
  const media=/^\/music\/media\/([^/]+)\/audio$/.exec(path);
  if(media) {
    query(url,[]);requireValue(['GET','HEAD'].includes(request.method));requireValue(validSecret(media[1]));
    const grant=await db.prepare('SELECT * FROM mobile_playback_grants WHERE hash=?').bind(await hash(media[1])).first();
    requireValue(grant && !grant.revoked && grant.expires_at>clock(),'GRANT_EXPIRED',403);
    if(grant.auth_mode==='session_bearer') {
      requireValue(s,'AUTH_REQUIRED',401);
      requireValue(s.id===grant.session_id && s.account_id===grant.account_id,'ACCESS_DENIED',403);
    }
    const {record,track}=await published(runtime.db,grant.track_id,locale,clock());
    requireValue(track.audioVersion===grant.revision_no,'VERSION_CONFLICT',409);
    const rights=await entitlement(db,s,clock());
    const mode=authorize(track,grant.variant,s,rights,runtime.flags);
    // A public full grant can never turn into a paid grant after a policy change.
    requireValue(mode!=='session_bearer'||grant.auth_mode==='session_bearer','ACCESS_DENIED',403);
    // Refresh time and principal after metadata reads. R2 is touched only below.
    if(s)s=await principal(db,request,clock());
    const fresh=clock();
    requireValue(grant.expires_at>fresh,'GRANT_EXPIRED',403);
    const current=projectPublicTrack(record,{locale,now:fresh});
    requireValue(current,'MEDIA_UNAVAILABLE',404);
    const freshRights=await entitlement(db,s,fresh);
    const freshMode=authorize(projectPublicTrack(record,{locale,now:clock()}),grant.variant,s,freshRights,runtime.flags);
    if(freshMode==='session_bearer')requireValue(Date.parse(freshRights.music.accessValidUntil)>clock(),'ACCESS_DENIED',403);
    requireValue(freshMode!=='session_bearer'||grant.auth_mode==='session_bearer','ACCESS_DENIED',403);
    requireValue(grant.expires_at>clock(),'GRANT_EXPIRED',403);
    const id=grant.variant==='full'?record.revision.audio_asset_id:record.revision.preview_asset_id;
    const asset=validateMusicMediaAsset(record.assets.find(a=>a.id===id),grant.variant==='full'?'audio':'preview',track.id);
    const result=await serveValidatedMusicMedia(request,runtime.bucket,asset,record.track);
    result.headers.set('Vary','Authorization');result.headers.set('Referrer-Policy','no-referrer');return result;
  }
  const grantPath=/^\/music\/tracks\/([^/]+)\/playback-grants$/.exec(path);
  if(grantPath) {
    query(url,[]);requireValue(request.method==='POST');
    const body=await readBody(request);exactKeys(body,['audioVersion','variant']);
    const {track}=await published(runtime.db,grantPath[1],locale,clock());
    requireValue(Number.isSafeInteger(body.audioVersion) && body.audioVersion===track.audioVersion,'VERSION_CONFLICT',409);
    if(s)s=await principal(db,request,clock());
    const rights=await entitlement(db,s,clock()),now=clock();
    // Re-project limited-free boundaries at the actual authorization time.
    const {track:current}=await published(runtime.db,track.id,locale,now);
    requireValue(current.audioVersion===body.audioVersion,'VERSION_CONFLICT',409);
    const mode=authorize(current,body.variant,s,rights,runtime.flags);
    const expiry=Math.min(now+600000, current.nextPolicyChangeAt?Date.parse(current.nextPolicyChangeAt):Infinity,
      s?s.access_until:Infinity,s?s.absolute_until:Infinity,mode==='session_bearer'?Date.parse(rights.music.accessValidUntil):Infinity);
    requireValue(expiry>clock(),'GRANT_EXPIRED',403);
    const secret=randomSecret();
    await db.prepare(`INSERT INTO mobile_playback_grants(hash,auth_mode,account_id,session_id,track_id,revision_no,variant,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(await hash(secret),mode,mode==='public'?null:s.account_id,mode==='public'?null:s.id,track.id,body.audioVersion,body.variant,now,expiry).run();
    return json({playbackUrl:config.origin+'/api/mobile/v1/music/media/'+secret+'/audio',expiresAt:iso(expiry),playbackValidUntil:iso(expiry),
      revalidateAt:iso(Math.min(now+60000,expiry)),authMode:mode,accountId:mode==='public'?null:String(s.account_id),sessionId:mode==='public'?null:s.id,
      trackId:track.id,audioVersion:body.audioVersion,variant:body.variant,
      durationSeconds:body.variant==='full'?current.durationSec:current.previewDurationSec,
      previewSourceStartSeconds:body.variant==='preview'?current.previewSourceStartSec:null},clock());
  }
  requireValue(request.method==='GET');
  const detail=/^\/music\/tracks\/([^/]+)$/.exec(path);
  if(detail) {
    query(url,['locale']);const {record,track}=await published(runtime.db,detail[1],locale,clock());
    return json({track:dto(track),summary:track.summary,coverUrl:track.coverUrl?config.origin+track.coverUrl+'&size=display':null,
      lyrics:await lyrics(runtime.bucket,record,track.audioVersion,signal),genres:track.genres,moods:track.moods,previewAvailable:track.previewAvailable,
      previewSourceStartSeconds:track.previewSourceStartSec,previewDurationSeconds:track.previewDurationSec},clock());
  }
  const collection=/^\/music\/collections\/([a-z0-9-]{1,100})$/.exec(path);
  requireValue(collection || ['/music/catalog','/music/featured'].includes(path),'INVALID_REQUEST',404);
  query(url,path==='/music/catalog'?['locale','limit','cursor','q','access']:collection?['locale','limit','cursor']:['locale']);
  const now=clock(),snapshot=await loadPublicMusicSnapshot(runtime.db,now);
  const {body}=await buildPublicCatalog({...snapshot,locale,now});
  const map=new Map(body.tracks.map(t=>[t.id,dto(t)]));
  const collections=body.collections.map(c=>({id:c.id,slug:c.slug,title:c.title,description:c.description,version:c.version,tracks:c.trackIds.map(id=>map.get(id)),nextCursor:null}));
  if(collection){
    const item=collections.find(c=>c.slug===collection[1]);requireValue(item,'MEDIA_UNAVAILABLE',404);
    const raw=url.searchParams.get('limit')||'50',cursor=url.searchParams.get('cursor');
    requireValue(/^(?:[1-9]\d?|100)$/.test(raw));const limit=Number(raw);let offset=0;
    if(cursor){const match=/^(\d+):(\d+)$/.exec(cursor);requireValue(match && match[1]===String(item.version),'VERSION_CONFLICT',409);offset=Number(match[2]);requireValue(Number.isSafeInteger(offset)&&offset<=500);}
    return json({...item,tracks:item.tracks.slice(offset,offset+limit),nextCursor:offset+limit<item.tracks.length?item.version+':'+(offset+limit):null},clock());
  }
  if(path==='/music/featured')return json({tracks:body.tracks.slice(0,6).map(dto),collections:collections.slice(0,6).map(c=>({...c,tracks:c.tracks.slice(0,10),nextCursor:c.tracks.length>10?c.version+':10':null}))},clock());
  const q=url.searchParams.get('q')||'',access=url.searchParams.get('access')||'all',rawLimit=url.searchParams.get('limit')||'50';
  requireValue(q.length<=200 && ['all','free','vip'].includes(access) && /^(?:[1-9]\d?|100)$/.test(rawLimit));
  const limit=Number(rawLimit),cursor=url.searchParams.get('cursor'),tag=String(snapshot.catalogVersion);
  let offset=0;
  if(cursor){const parts=/^(\d+):(\d+)$/.exec(cursor);requireValue(parts && parts[1]===tag,'VERSION_CONFLICT',409);offset=Number(parts[2]);requireValue(Number.isSafeInteger(offset)&&offset<=500);}
  const tracks=body.tracks.filter(t=>(access==='all'||t.effectiveAccess===access) && (t.title+' '+t.creatorName).toLocaleLowerCase().includes(q.toLocaleLowerCase()));
  return json({items:tracks.slice(offset,offset+limit).map(dto),nextCursor:offset+limit<tracks.length?tag+':'+(offset+limit):null},clock());
}
