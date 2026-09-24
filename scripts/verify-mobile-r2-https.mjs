#!/usr/bin/env node
// Explicit, bounded remote smoke for the dedicated synthetic R2 environment only.
// Never print responses, credentials, callback URLs, grants, cookies or raw errors.
import {readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const ORIGIN = 'https://station-cat-music-r2.yehao1105.workers.dev';
const APP_ID = '2AM5S7BM2N.org.stationcat.music.staging';
const ROOT = new URL('../', import.meta.url);
const PRIVATE = new URL('.generated/r2/private/', ROOT);
const API = '/api/mobile/v1';
const MAX_JSON = 256 * 1024, MAX_HTML = 128 * 1024, REQUEST_MS = 20_000;
const started = performance.now();
const evidence = {schema:1, origin:ORIGIN, appID:APP_ID, startedAt:new Date().toISOString(),
  scope:'synthetic-https-api-only', success:false, checks:[], requests:0, responseBytes:0,
  statusCounts:{}, limitations:['Not an iOS browser callback or Universal Link acceptance test',
    'Not physical device, production, subscription or complete account deletion acceptance']};
let phase = 'arguments';
const sessions = [];
class SafeFailure extends Error {
  constructor(category) { super(category); this.category=category; }
}
function requireSafe(value, category='assertion_failed') { if (!value) throw new SafeFailure(category); }
function same(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function safeURL(path) {
  let url; try { url = new URL(path, ORIGIN); } catch { throw new SafeFailure('invalid_url'); }
  requireSafe(url.origin===ORIGIN && url.protocol==='https:' && !url.username && !url.password && !url.hash, 'origin_boundary');
  return url;
}
async function bounded(path, {method='GET', headers={}, body, expected=200, maxBytes=MAX_JSON, timeoutMs=REQUEST_MS, redirect=false}={}) {
  const url = safeURL(path), controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  const began=performance.now();
  let reader;
  try {
    const response=await fetch(url, {method, headers, body, redirect:'manual', signal:controller.signal, cache:'no-store'});
    evidence.requests++;
    evidence.statusCounts[response.status]=(evidence.statusCounts[response.status]||0)+1;
    requireSafe(response.status===expected, 'unexpected_http_status');
    requireSafe(redirect || !(response.status>=300 && response.status<400), 'unexpected_redirect');
    const length=response.headers.get('content-length');
    if(length!==null && method!=='HEAD')requireSafe(/^\d+$/.test(length) && Number(length)<=maxBytes,'response_too_large');
    reader=response.body?.getReader();
    const parts=[];let size=0;
    if(reader)while(true) {
      const result=await reader.read(); if(result.done)break;
      size+=result.value.byteLength;
      requireSafe(size<=maxBytes,'response_too_large'); parts.push(result.value);
    }
    requireSafe(!controller.signal.aborted && performance.now()-began<timeoutMs,'request_timeout');
    evidence.responseBytes+=size;
    return {headers:response.headers, bytes:Buffer.concat(parts,size)};
  } catch(error) {
    if(error instanceof SafeFailure)throw error;
    throw new SafeFailure(controller.signal.aborted?'request_timeout':'network_failure');
  } finally {
    controller.abort(); clearTimeout(timer);
    try { await reader?.cancel(); } catch {}
  }
}
async function json(path, options={}) {
  const r=await bounded(path,options);
  requireSafe(r.headers.get('content-type')?.toLowerCase().startsWith('application/json'),'unexpected_content_type');
  try {return JSON.parse(r.bytes.toString('utf8'));}catch {throw new SafeFailure('invalid_json');}
}
const auth=s=>({Authorization:'Bearer '+s.tokens.accessToken});
const payload=(body,s,method='POST',expected=200)=>({method,expected,headers:{'Content-Type':'application/json',...(s?auth(s):{})},body:JSON.stringify(body)});
async function api(path, options={}) { const result=await json(API+path,options); requireSafe(Object.hasOwn(result,'data'),'invalid_envelope'); return result.data; }
async function denied(path, options, expected, code) {
  const result=await json(path,{...options,expected});
  requireSafe(result.error?.code===code,'wrong_denial_reason');
}
async function check(name, work) {
  phase=name;const began=performance.now();await work();
  evidence.checks.push({name,passed:true,durationMs:Math.round(performance.now()-began)});
  console.log('PASS '+name);
}
function privateJSON(name) {
  try {return JSON.parse(readFileSync(new URL(name,PRIVATE),'utf8'));}catch {throw new SafeFailure('private_input_unavailable');}
}
function tokenShape(t) {
  return t && /^[A-Za-z0-9_-]{43}$/.test(t.accessToken) && /^[A-Za-z0-9_-]{43}$/.test(t.refreshToken) &&
    Number.isSafeInteger(t.generation) && typeof t.accountId==='string' && typeof t.sessionId==='string' &&
    typeof t.tokenFamilyId==='string' && Date.parse(t.accessExpiresAt)>Date.now();
}
async function signIn(credential, checkCodeReplay=false) {
  const verifier=randomBytes(32).toString('base64url'), state=randomBytes(32).toString('base64url');
  const query=new URLSearchParams({client_id:'station-cat-ios',redirect_uri:ORIGIN+'/auth/mobile/callback',
    code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),state,locale:'en'});
  const page=await bounded('/auth/mobile/authorize?'+query,{maxBytes:MAX_HTML});
  requireSafe(page.headers.get('content-type')?.startsWith('text/html'),'unexpected_content_type');
  const html=page.bytes.toString('utf8'), flow=/name="flow" value="([a-f0-9-]{36})"/.exec(html)?.[1];
  requireSafe(flow && html.includes('Test accounts only') && !/href="\/auth\/mobile\/(register|reset)/.test(html),'unsafe_login_page');
  const cookie=page.headers.get('set-cookie');
  requireSafe(cookie && /^__Host-station-native-flow=[A-Za-z0-9_-]{43};/.test(cookie) &&
    /; Secure(?:;|$)/i.test(cookie) && /; HttpOnly(?:;|$)/i.test(cookie) && /; SameSite=Lax(?:;|$)/i.test(cookie),'unsafe_browser_cookie');
  const cookiePair=cookie.split(';')[0];
  const result=await bounded('/auth/mobile/authorize',{method:'POST',expected:302,redirect:true,headers:{Origin:ORIGIN,Cookie:cookiePair,'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({flow,locale:'en',identifier:credential.username,password:credential.password,totpCode:''}).toString(),maxBytes:MAX_HTML});
  const location=result.headers.get('location');requireSafe(location,'missing_callback');
  const callback=safeURL(location);
  requireSafe(callback.pathname==='/auth/mobile/callback' && callback.searchParams.get('state')===state &&
    [...callback.searchParams.keys()].length===2 && /^[A-Za-z0-9_-]{43}$/.test(callback.searchParams.get('code')),'invalid_callback');
  const exchange={clientId:'station-cat-ios',code:callback.searchParams.get('code'),codeVerifier:verifier,redirectUri:ORIGIN+'/auth/mobile/callback'};
  const tokens=await api('/auth/token',payload(exchange));requireSafe(tokenShape(tokens),'invalid_token_shape');
  const session={tokens,closed:false};sessions.push(session);
  if(checkCodeReplay)await denied(API+'/auth/token',payload(exchange),401,'AUTH_REQUIRED');
  await denied(API+'/me',{headers:{Cookie:cookiePair}},401,'AUTH_REQUIRED');
  return session;
}
async function list(path,s) {
  const data=await api('/me/music/'+path,{headers:auth(s)});
  requireSafe(Array.isArray(data.items) && data.nextCursor===null,'unexpected_test_library_shape');return data.items;
}
async function favorite(s,trackId,value) {
  const previous=(await list('favorites',s)).find(x=>x.trackId===trackId);
  return api('/me/music/favorites/'+trackId,payload({favorite:value,expectedVersion:previous?.version||0,mutationId:randomUUID()},s,'PUT'));
}
async function preferences(s) {return api('/me/music/preferences',{headers:auth(s)});}
async function clear(s,p) {return api('/me/music/recent',payload({confirmed:true,historyEpoch:p.historyEpoch,mutationId:randomUUID()},s,'DELETE'));}
async function logout(s) {
  if(s.closed)return;
  await api('/auth/logout',payload({refreshToken:s.tokens.refreshToken}));s.closed=true;
}
async function media(grant,s) {
  requireSafe(grant && grant.variant==='full' && Date.parse(grant.expiresAt)>Date.now(),'invalid_grant');
  const url=safeURL(grant.playbackUrl);
  requireSafe(/^\/api\/mobile\/v1\/music\/media\/[A-Za-z0-9_-]{43}\/audio$/.test(url.pathname) && !url.search,'invalid_media_url');
  const head=await bounded(url.href,{method:'HEAD',headers:s?auth(s):{},maxBytes:0});
  requireSafe(head.bytes.length===0 && Number(head.headers.get('content-length'))>64 && head.headers.get('content-type')?.startsWith('audio/'),'invalid_media_head');
  const range=await bounded(url.href,{headers:{...(s?auth(s):{}),Range:'bytes=0-63'},expected:206,maxBytes:64});
  requireSafe(range.bytes.length===64 && /^bytes 0-63\/\d+$/.test(range.headers.get('content-range')) &&
    range.headers.get('cache-control')?.includes('no-store'),'invalid_media_range');
}

async function run({onlyPublic=false,realAlbum=false}={}) {
  phase='private_inputs';
  // The public subset must not read account passwords or create sessions.
  const credentials=onlyPublic?null:privateJSON('credentials.json'), tracks=privateJSON('tracks.json');
  const real=realAlbum?JSON.parse(readFileSync(new URL('.generated/r3-real/private/manifest.json',ROOT),'utf8')):null;
  if(real)requireSafe(real.schema===1 && real.origin===ORIGIN && real.database==='station-cat-music-r2-catalog' &&
    real.bucket==='station-cat-music-r2-audio' && real.collection?.slug==='wydgb' && real.tracks?.length===7 &&
    real.tracks.every(t=>t.access==='free') && new Set(real.tracks.map(t=>t.id)).size===7,'invalid_real_manifest');
  if(!onlyPublic)requireSafe(Array.isArray(credentials) && credentials.length===2,'invalid_private_inputs');
  for(const role of ['free','vip']) {
    if(!onlyPublic) {
      const c=credentials.find(x=>x.role===role);
      requireSafe(c && c.username==='r2tester-'+role && typeof c.password==='string' && c.password.length>=24,'invalid_private_inputs');
    }
    requireSafe(typeof tracks[role]==='string' && /^[A-Za-z0-9_-]{16,128}$/.test(tracks[role]),'invalid_private_inputs');
  }
  requireSafe(tracks.free!==tracks.vip,'invalid_private_inputs');
  await check('aasa_health_capabilities',async()=>{
    const a=await json('/.well-known/apple-app-site-association');
    requireSafe(same(a.webcredentials?.apps,[APP_ID]) && a.applinks?.details?.length===1 &&
      same(a.applinks.details[0].appIDs,[APP_ID]) && same(a.applinks.details[0].components,[{'/':'/music/'},{'/':'/auth/mobile/callback'}]),'aasa_mismatch');
    const health=await json('/health');requireSafe(health.environment==='isolated' && health.purchases===false,'unsafe_health');
    const c=(await api('/config')).capabilities;
    requireSafe(c?.nativeAuthentication===true && c.musicCatalog===true && c.musicPlayback===true && c.personalSync===true && c.musicPurchases===false,'unsafe_capabilities');
  });
  await check('restricted_routes',async()=>{
    for(const path of ['/fixture/seed','/admin/api/music','/api/readers/me','/auth/mobile/register','/auth/mobile/reset'])await bounded(path,{expected:404});
  });
  const details={};
  await check('catalog_featured_lyrics',async()=>{
    const catalog=await api('/music/catalog?locale=en');
    const expectedIds=[tracks.free,tracks.vip,...(real?.tracks.map(t=>t.id)||[])].sort();
    requireSafe(same(catalog.items?.map(t=>t.id).sort(),expectedIds) && catalog.nextCursor===null,'unexpected_test_catalog');
    const featured=await api('/music/featured?locale=en');requireSafe(featured.tracks?.[0]?.id===(real?.primary||tracks.free) && featured.tracks.some(t=>t.id===tracks.free),'featured_mismatch');
    for(const role of ['free','vip']) {
      details[role]=await api('/music/tracks/'+tracks[role]+'?locale=en');
      const d=details[role];requireSafe(d.track?.id===tracks[role] && d.lyrics?.kind==='timed' && d.lyrics.lines?.length>=2 && d.lyrics.audioVersion===d.track.audioVersion,'lyrics_mismatch');
    }
  });
  if(real)await check('real_album_audio_lyrics_covers_and_permissions',async()=>{
    const album=await api('/music/collections/'+real.collection.slug+'?locale=zh-Hans');
    requireSafe(album.id===real.collection.id && album.version===real.collection.version && album.nextCursor===null &&
      same(album.tracks?.map(t=>t.id),real.tracks.map(t=>t.id)),'real_album_order');
    const cover=await bounded(`/api/music/collections/${real.collection.slug}/cover?v=${real.collection.version}&size=display`,{maxBytes:2097152});
    requireSafe(createHash('sha256').update(cover.bytes).digest('hex')===real.collection.coverSHA256,'real_album_cover');
    for(const expected of real.tracks) {
      const detail=await api('/music/tracks/'+expected.id+'?locale=zh-Hans');
      requireSafe(detail.track?.title===expected.title && detail.track.id===expected.id && detail.track.access==='free' &&
        detail.track.audioVersion===expected.audioVersion && detail.track.durationSeconds>0 &&
        detail.lyrics?.kind==='timed' && detail.lyrics.audioVersion===expected.audioVersion && detail.lyrics.lines?.length>0 &&
        detail.lyrics.lines.every((line,i,lines)=>Number.isFinite(line.startSeconds) && line.startSeconds>=0 &&
          (i===0 || line.startSeconds>=lines[i-1].startSeconds) && !line.text.includes('\uFFFD')),'real_track_detail');
      const image=await bounded(detail.track.coverUrl,{maxBytes:2097152});
      requireSafe(image.headers.get('content-type')?.startsWith('image/jpeg') &&
        createHash('sha256').update(image.bytes).digest('hex')===expected.coverSHA256,'real_track_cover');
      const grant=await api('/music/tracks/'+expected.id+'/playback-grants',payload({audioVersion:expected.audioVersion,variant:'full'}));
      requireSafe(grant.authMode==='public' && grant.variant==='full','real_track_grant');
      const head=await bounded(grant.playbackUrl,{method:'HEAD',maxBytes:0});
      requireSafe(Number(head.headers.get('content-length'))===expected.audioBytes,'real_audio_length');
      const range=await bounded(grant.playbackUrl,{headers:{Range:'bytes=0-4095'},expected:206,maxBytes:4096});
      const object=real.objects.find(o=>o.key.startsWith('music/audio/'+expected.id+'/'));
      requireSafe(object && /^objects\/[a-f0-9-]+\.mp3$/.test(object.file),'real_audio_input');
      const local=readFileSync(new URL('.generated/r3-real/private/'+object.file,ROOT));
      requireSafe(range.bytes.equals(local.subarray(0,4096)) && range.headers.get('content-range')===`bytes 0-4095/${expected.audioBytes}` &&
        range.headers.get('cache-control')?.includes('no-store'),'real_audio_range');
    }
    await denied(API+'/music/tracks/'+tracks.vip+'/playback-grants',payload({audioVersion:details.vip.track.audioVersion,variant:'full'}),401,'AUTH_REQUIRED');
  });
  const album=privateJSON('album.json');
  requireSafe(album?.schema===1 && typeof album.id==='string' && /^[A-Za-z0-9_-]{16,128}$/.test(album.id) &&
    typeof album.slug==='string' && /^[a-z0-9-]{1,100}$/.test(album.slug) && Number.isSafeInteger(album.version) && album.version>0 &&
    same(album.trackIds,[tracks.free,tracks.vip]) && typeof album.title==='string' && album.title.length>0 &&
    album.coverContentType==='image/png' && Number.isSafeInteger(album.coverBytes) && album.coverBytes>8 && album.coverBytes<=5*1024*1024 &&
    /^[a-f0-9]{64}$/.test(album.coverSHA256) && /^[a-f0-9]{32}$/.test(album.coverETag) &&
    album.coverPath===`/api/music/collections/${album.slug}/cover?v=${album.version}` &&
    album.deepLinkPath===`/music/?collection=${album.slug}`,'invalid_album_input');
  await check('album_projection_cover_integrity',async()=>{
    const projected=await api('/music/collections/'+album.slug+'?locale=en');
    const featured=await api('/music/featured?locale=en');
    for(const item of [projected,featured.collections?.find(c=>c.id===album.id)]) {
      requireSafe(item?.id===album.id && item.slug===album.slug && item.title===album.title && item.version===album.version &&
        same(item.tracks?.map(t=>t.id),album.trackIds) && item.nextCursor===null,'album_projection_mismatch');
      requireSafe(item.tracks[0].access==='free' && ['vip','preview'].includes(item.tracks[1].access) &&
        item.tracks.every((t,i)=>t.audioVersion===details[i===0?'free':'vip'].track.audioVersion),'album_track_access_mismatch');
    }
    // This is the original album image: verify actual bytes as well as GET/HEAD metadata.
    const coverURL=safeURL(album.coverPath), expectedETag='"'+album.coverETag+'"';
    const head=await bounded(coverURL.href,{method:'HEAD',maxBytes:0});
    const image=await bounded(coverURL.href,{maxBytes:album.coverBytes});
    for(const response of [head,image])requireSafe(
      response.headers.get('content-type')?.split(';')[0].trim()===album.coverContentType &&
      Number(response.headers.get('content-length'))===album.coverBytes &&
      (response.headers.get('etag')===null || response.headers.get('etag')===expectedETag) &&
      !response.headers.has('set-cookie'),'album_cover_headers_mismatch');
    // The shared original-cover handler validates R2 ETags internally but may omit the
    // HTTP ETag header. This small single-part fixture also has a byte-verifiable MD5 ETag.
    requireSafe(head.headers.get('etag')===image.headers.get('etag') && head.bytes.length===0 && image.bytes.length===album.coverBytes &&
      createHash('md5').update(image.bytes).digest('hex')===album.coverETag &&
      image.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      createHash('sha256').update(image.bytes).digest('hex')===album.coverSHA256,'album_cover_integrity_mismatch');
  });
  await check('album_track_link_fallback_aasa_paths',async()=>{
    const aasa=await json('/.well-known/apple-app-site-association');
    const associated=aasa.applinks?.details?.find(d=>same(d.appIDs,[APP_ID]));
    requireSafe(associated?.components?.some(c=>c['/']==='/music/' && c.exclude!==true) &&
      associated.components.some(c=>c['/']==='/auth/mobile/callback' && c.exclude!==true),'link_aasa_path_mismatch');
    const head=await bounded('/.well-known/apple-app-site-association',{method:'HEAD',maxBytes:0});
    requireSafe(head.bytes.length===0 && head.headers.get('content-type')?.startsWith('application/json'),'aasa_head_mismatch');
    for(const path of [album.deepLinkPath,'/music/?track='+tracks.free]) {
      const link=safeURL(path);requireSafe(link.pathname==='/music/','link_path_mismatch');
      const fallback=await bounded(link.href,{maxBytes:4096});
      requireSafe(fallback.headers.get('content-type')?.startsWith('text/plain') &&
        fallback.bytes.toString('utf8').includes('isolated test link') && !fallback.headers.has('set-cookie'),'link_fallback_mismatch');
    }
    await bounded('/music/not-associated',{expected:404,maxBytes:4096});
  });
  if(onlyPublic) {evidence.success=true;return;}
  let free,vip,peer;
  await check('password_pkce_single_use_cookie_boundary',async()=>{
    free=await signIn(credentials.find(x=>x.role==='free'),true);
    vip=await signIn(credentials.find(x=>x.role==='vip'));
    peer=await signIn(credentials.find(x=>x.role==='free'));
    requireSafe(free.tokens.accountId===peer.tokens.accountId && free.tokens.sessionId!==peer.tokens.sessionId && free.tokens.accountId!==vip.tokens.accountId,'account_isolation');
  });
  await check('refresh_idempotent_replay',async()=>{
    const old=free.tokens;
    const body={clientId:'station-cat-ios',generation:old.generation,refreshToken:old.refreshToken,refreshRequestId:randomUUID()};
    free.tokens=await api('/auth/refresh',payload(body));
    const replay=await api('/auth/refresh',payload(body));
    requireSafe(tokenShape(free.tokens) && same(replay,free.tokens) && free.tokens.generation===old.generation+1 &&
      free.tokens.accountId===old.accountId && free.tokens.sessionId===old.sessionId && free.tokens.tokenFamilyId===old.tokenFamilyId &&
      free.tokens.absoluteExpiresAt===old.absoluteExpiresAt,'refresh_mismatch');
    await denied(API+'/me',{headers:{Authorization:'Bearer '+old.accessToken}},401,'SESSION_REVOKED');
    requireSafe((await api('/me',{headers:auth(free)})).accountId===old.accountId,'account_isolation');
  });
  const grantBody=role=>({audioVersion:details[role].track.audioVersion,variant:'full'});
  const grantPath=role=>'/music/tracks/'+tracks[role]+'/playback-grants';
  let vipGrant;
  await check('free_vip_grants_head_range_authorization',async()=>{
    const freeGrant=await api(grantPath('free'),payload(grantBody('free')));
    requireSafe(freeGrant.authMode==='public','incorrect_grant_mode');await media(freeGrant);
    await denied(API+grantPath('vip'),payload(grantBody('vip')),401,'AUTH_REQUIRED');
    await denied(API+grantPath('vip'),payload(grantBody('vip'),free),403,'ACCESS_DENIED');
    vipGrant=await api(grantPath('vip'),payload(grantBody('vip'),vip));
    requireSafe(vipGrant.authMode==='session_bearer' && vipGrant.accountId===vip.tokens.accountId && vipGrant.sessionId===vip.tokens.sessionId,'incorrect_grant_mode');
    await media(vipGrant,vip);
    await denied(vipGrant.playbackUrl,{headers:{Range:'bytes=0-63'}},401,'AUTH_REQUIRED');
    await denied(vipGrant.playbackUrl,{headers:{...auth(free),Range:'bytes=0-63'}},403,'ACCESS_DENIED');
  });
  await check('favorites_cross_session_replay_account_isolation',async()=>{
    const vipBefore=await list('favorites',vip), before=(await list('favorites',free)).find(x=>x.trackId===tracks.free);
    const body={favorite:true,expectedVersion:before?.version||0,mutationId:randomUUID()};
    const receipt=await api('/me/music/favorites/'+tracks.free,payload(body,free,'PUT'));
    const replay=await api('/me/music/favorites/'+tracks.free,payload(body,free,'PUT'));
    requireSafe(same(receipt,replay),'favorite_replay_mismatch');
    const row=(await list('favorites',peer)).find(x=>x.trackId===tracks.free);
    requireSafe(row?.favorite===true && row.version===receipt.version && same(await list('favorites',vip),vipBefore),'favorite_sync_mismatch');
    await favorite(free,tracks.free,false);
    requireSafe((await list('favorites',peer)).find(x=>x.trackId===tracks.free)?.favorite===false,'favorite_remove_mismatch');
  });
  await check('history_cross_session_clear_epoch_account_isolation',async()=>{
    const vipBefore=await list('recent',vip), original=await preferences(free);
    let p=original;
    if(!p.historyEnabled)p=await api('/me/music/preferences',payload({historyEnabled:true,expectedVersion:p.version,mutationId:randomUUID()},free,'PATCH'));
    p=await clear(free,p);
    const body={trackId:tracks.free,audioVersion:details.free.track.audioVersion,variant:'full',eventId:randomUUID(),historyEpoch:p.historyEpoch,audibleSeconds:5,positionSeconds:5,occurredAt:new Date().toISOString()};
    requireSafe((await api('/me/music/listens',payload(body,free))).accepted===true,'listen_rejected');
    const rows=await list('recent',peer);
    requireSafe(rows.length===1 && rows[0].trackId===tracks.free && rows[0].positionSeconds===5 && same(await list('recent',vip),vipBefore),'history_sync_mismatch');
    const cleared=await clear(free,p);
    requireSafe(cleared.historyEpoch===p.historyEpoch+1 && (await list('recent',peer)).length===0,'history_clear_mismatch');
    await denied(API+'/me/music/listens',payload({...body,eventId:randomUUID()},free),409,'HISTORY_EPOCH_STALE');
    let disabled=await api('/me/music/preferences',payload({historyEnabled:false,expectedVersion:cleared.version,mutationId:randomUUID()},free,'PATCH'));
    await denied(API+'/me/music/listens',payload({...body,eventId:randomUUID(),historyEpoch:disabled.historyEpoch},free),409,'HISTORY_DISABLED');
    requireSafe((await preferences(peer)).historyEnabled===false,'preference_sync_mismatch');
    if(original.historyEnabled)await api('/me/music/preferences',payload({historyEnabled:true,expectedVersion:disabled.version,mutationId:randomUUID()},free,'PATCH'));
  });
  await check('logout_revokes_session_and_vip_media',async()=>{
    for(const s of sessions) {
      await api('/auth/logout',payload({},s));s.closed=true;
      await denied(API+'/me',{headers:auth(s)},401,'SESSION_REVOKED');
    }
    await denied(vipGrant.playbackUrl,{headers:{...auth(vip),Range:'bytes=0-63'}},401,'SESSION_REVOKED');
  });
  evidence.success=true;
}

async function main() {
  const args=process.argv.slice(2);
  if(!args.includes('--run')) {
    console.log('No network or private-file access performed. Explicit invocation: node scripts/verify-mobile-r2-https.mjs --run [--only-public] [--real-album]');
    return;
  }
  const onlyPublic=args.includes('--only-public');
  const realAlbum=args.includes('--real-album');
  requireSafe(new Set(args).size===args.length && args.every(x=>['--run','--only-public','--real-album'].includes(x)),'invalid_arguments');
  const outputName=(realAlbum?'real-album-':'')+(onlyPublic?'https-public-evidence.json':'https-evidence.json');
  const output=new URL('.generated/r2/'+outputName,ROOT);
  if(onlyPublic)evidence.scope='synthetic-https-public-only';
  if(realAlbum)evidence.scope=onlyPublic?'real-album-https-public-only':'real-album-and-synthetic-https-api';
  try { await run({onlyPublic,realAlbum}); }
  catch(error) {
    evidence.failure={phase,category:error instanceof SafeFailure?error.category:'local_failure'};
    console.error('FAIL '+phase+' ('+evidence.failure.category+')');process.exitCode=1;
  } finally {
    // Revoke only sessions created by this run, including after a partial failure.
    // Refresh-token logout is revocation-only and is safe after access expiry.
    let cleanupFailures=0;
    for(const session of sessions)if(!session.closed)try{await logout(session);}catch{cleanupFailures++;}
    evidence.cleanup={sessionsCreated:sessions.length,sessionsRevoked:sessions.filter(s=>s.closed).length,failures:cleanupFailures};
    if(cleanupFailures){evidence.success=false;process.exitCode=1;}
    evidence.finishedAt=new Date().toISOString();evidence.durationMs=Math.round(performance.now()-started);
    mkdirSync(new URL('.generated/r2/',ROOT),{recursive:true});
    const temp=new URL('.generated/r2/https-evidence-'+randomUUID()+'.tmp',ROOT);
    writeFileSync(temp,JSON.stringify(evidence,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,output);
    console.log('Redacted evidence: .generated/r2/'+outputName);
  }
}
main().catch(()=>{console.error('FAIL smoke_runner (local_failure)');process.exitCode=1;});
