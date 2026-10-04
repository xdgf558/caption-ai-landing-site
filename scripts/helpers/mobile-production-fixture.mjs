// Local cross-repository fixture only. Not imported by a deployed entrypoint.
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash,pbkdf2Sync} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {PRODUCTION_MOBILE_PROFILE as profile,PRODUCTION_ACCOUNT_ID,PRODUCTION_READER_DATABASE_ID,PRODUCTION_MUSIC_BUCKET} from '../../src/mobile/environment.js';
import {productionBindingMarkerMaterials,closedMobileVariables} from '../build-mobile-production-candidate.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const secret=()=>randomBytes(32).toString('base64url');
const files=directory=>readdirSync(path.join(root,directory)).filter(x=>x.endsWith('.sql')).sort().map(x=>path.join(root,directory,x));
async function migrate(db,paths) {
  const parser=new DatabaseSync(':memory:');
  try {for(const file of paths) {
    let sql=readFileSync(file,'utf8');
    while(sql.trim()) {const statement=parser.prepare(sql);statement.run();await db.prepare(statement.sourceSQL).run();sql=sql.slice(statement.sourceSQL.length);}
  }} finally {parser.close();}
}

function evidenceRoute(url) {
  return new URL(url).pathname
    .replace(/(\/music\/media\/)[^/]+/,'$1:grant')
    .replace(/(\/(?:tracks|favorites)\/)[^/]+/,'$1:trackId')
    .replace(/(\/collections\/)[^/]+/,'$1:collection')
    .replace(/(\/deletion-requests\/)[^/]+(?=\/(?:confirm|status)$)/,'$1:requestId');
}

export async function createProductionFixture() {
  const internalProof=secret(),requests=[];
  let outboundRequests=0;
  const manifest={profileId:profile.id,accountId:PRODUCTION_ACCOUNT_ID,
    reader:{id:PRODUCTION_READER_DATABASE_ID,nonce:secret()},catalog:{id:randomUUID(),nonce:secret()},
    audio:{name:PRODUCTION_MUSIC_BUCKET,nonce:secret()}};
  const materials=productionBindingMarkerMaterials(manifest);
  const bundle=await build({stdin:{resolveDir:root,contents:`
    import worker from './src/worker.js';
    import {seedMusicRuntimeFixture} from './scripts/helpers/music-runtime-fixture.js';
    export default {async fetch(request,env) {
      if(request.headers.get('x-production-internal-proof')!==env._PRODUCTION_INTERNAL_PROOF)return new Response(null,{status:403});
      if(new URL(request.url).pathname==='/fixture/seed')return Response.json(await seedMusicRuntimeFixture(env.MUSIC_DB,await request.json()));
      const headers=new Headers(request.headers);headers.delete('x-production-internal-proof');
      return worker.fetch(new Request(request,{headers}),env,{});
    }};`},bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-17',host:'127.0.0.1',port:0,
    d1Databases:{WAITLIST_DB:'local-production-contract-reader',MUSIC_DB:'local-production-contract-catalog'},
    r2Buckets:{MUSIC_BUCKET:'local-production-contract-audio'},bindings:{...closedMobileVariables,
      _PRODUCTION_INTERNAL_PROOF:internalProof,MOBILE_AUTH_ENABLED:'true',MOBILE_MUSIC_ENABLED:'true',MOBILE_PERSONAL_SYNC_ENABLED:'true',
      MOBILE_AUTH_ORIGIN:profile.origin,MOBILE_REDIRECT_URI:profile.redirect,MOBILE_RESULT_KEY_VERSION:'production-v1',
      MOBILE_RESULT_KEYS_JSON:JSON.stringify({'production-v1':secret()}),MOBILE_BINDING_MANIFEST_JSON:JSON.stringify(manifest),
      MUSIC_PUBLIC_ENABLED:'true',MUSIC_VIP_DELIVERY_ENABLED:'true'},
    outboundService:()=>{outboundRequests++;return new Response(null,{status:503});}});
  try {
    const [reader,music,bucket]=await Promise.all([mf.getD1Database('WAITLIST_DB'),mf.getD1Database('MUSIC_DB'),mf.getR2Bucket('MUSIC_BUCKET')]);
    await migrate(reader,[...files('migrations'),...files('migrations-mobile'),...files('migrations-mobile-candidate')]);
    await migrate(music,[...files('migrations-music'),...files('migrations-mobile-candidate')]);
    await reader.prepare(materials.readerSql).run();await music.prepare(materials.catalogSql).run();
    await bucket.put(materials.audio.key,materials.audio.body,{customMetadata:materials.audio.customMetadata});

    async function identity(vip) {
      const identifier='production-probe-'+(vip?'vip':'free'),email=identifier+'@example.test',password='Synthetic-only-'+secret(),salt=secret();
      const row=await reader.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,identifier).first();
      await reader.prepare('INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations,password_algorithm) VALUES(?,?,?,?,?,100000,?)')
        .bind(row.id,identifier,identifier,pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'),salt,'PBKDF2-SHA256').run();
      if(vip)await reader.prepare('INSERT INTO reader_memberships(account_id,started_at,expires_at) VALUES(?,?,?)')
        .bind(row.id,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+3600000).toISOString()).run();
      return {id:String(row.id),identifier,password};
    }
    const account=await identity(false),vipAccount=await identity(true);
    async function seed(mode) {
      const trackId=randomUUID(),entries=JSON.parse(readFileSync(path.join(root,'tests/fixtures/music-mp3/manifest.json'))).files;
      async function asset(file,kind) {
        const data=readFileSync(path.join(root,'tests/fixtures/music-mp3',file)),entry=entries.find(row=>row.file===file);
        if(!entry || createHash('sha256').update(data).digest('hex')!==entry.sha256)throw new Error('SYNTHETIC_AUDIO_DIGEST');
        const id=randomUUID(),key=`music/${kind==='audio'?'audio':'previews'}/${trackId}/${id}.mp3`;
        const object=await bucket.put(key,data,{httpMetadata:{contentType:'audio/mpeg'}});
        return {id,owner_track_id:trackId,kind,object_key:key,state:'validated',format:'mp3',content_type:'audio/mpeg',byte_size:data.length,duration_ms:entry.packetDurationMs,sha256:entry.sha256,etag:object.etag};
      }
      const audio=await asset('cbr-stereo.mp3','audio'),preview=await asset('preview.mp3','preview');
      Object.assign(preview,{derived_from_asset_id:audio.id,source_start_ms:0,source_end_ms:1000});
      const response=await mf.dispatchFetch(profile.origin+'/fixture/seed',{method:'POST',headers:{'x-production-internal-proof':internalProof},body:JSON.stringify({audio,preview,accessMode:mode})});
      if(response.status!==200)throw new Error('SYNTHETIC_SEED_FAILED');
      const command=await response.json();
      await music.prepare("UPDATE music_track_revisions SET state='sealed' WHERE id=?").bind(command.revisionId).run();
      await music.prepare("UPDATE music_tracks SET lifecycle='published',draft_revision_id=NULL,published_revision_id=?,first_published_at=?,published_at=? WHERE id=?")
        .bind(command.revisionId,Date.now()-1000,Date.now()-1000,trackId).run();
      return trackId;
    }
    const freeTrackId=await seed('free'),vipTrackId=await seed('vip'),collectionSlug='production-contract-album',collectionId=randomUUID();
    await music.prepare("INSERT INTO music_collections(id,slug,status,original_locale,title_json,description_json,created_at,updated_at,collection_type,listening_mode) VALUES(?,?,'published','en',?,?,?,?,'album','mixed')")
      .bind(collectionId,collectionSlug,JSON.stringify({en:'Synthetic production contract album'}),JSON.stringify({en:'Local only'}),Date.now(),Date.now()).run();
    for(const [index,id] of [freeTrackId,vipTrackId].entries())await music.prepare('INSERT INTO music_collection_tracks(collection_id,track_id,position) VALUES(?,?,?)').bind(collectionId,id,index).run();
    await music.prepare("INSERT INTO music_featured_items(slot_kind,position,track_id) VALUES('primary',0,?)").bind(freeTrackId).run();
    await music.prepare("INSERT INTO music_featured_items(slot_kind,position,collection_id) VALUES('collection',0,?)").bind(collectionId).run();
    const bootstrap={schemaVersion:1,origin:profile.origin,account,vipAccount,tracks:{freeTrackId,vipTrackId},collectionSlug};
    return {
      bootstrap,
      async dispatch(request) {
        const url=new URL(request.url);
        if(url.origin!==profile.origin || url.username || url.password || url.hash || requests.length>=512)throw new Error('PROBE_DISPATCH_REJECTED');
        if(!(url.pathname.startsWith('/api/mobile/v1/')||['/auth/mobile/authorize','/auth/mobile/callback','/.well-known/apple-app-site-association'].includes(url.pathname)))throw new Error('PROBE_ROUTE_REJECTED');
        const headers=new Headers(request.headers);headers.set('x-production-internal-proof',internalProof);
        headers.set('CF-Connecting-IP','192.0.2.10');
        const response=await mf.dispatchFetch(request.url,{method:request.method,headers,redirect:'manual',body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer()});
        requests.push({method:request.method,route:evidenceRoute(request.url),status:response.status,range:headers.has('range')});
        return response;
      },
      async evidence() {
        const scalar=async sql=>(await reader.prepare(sql).first()).n;
        const counts={sessions:await scalar('SELECT count(*) n FROM mobile_sessions'),revokedSessions:await scalar('SELECT count(*) n FROM mobile_sessions WHERE revoked=1'),
          refreshOperations:await scalar('SELECT count(*) n FROM mobile_refresh_operations'),favorites:await scalar('SELECT count(*) n FROM mobile_music_favorites'),recent:await scalar('SELECT count(*) n FROM mobile_music_recent')};
        return {schemaVersion:1,scope:'local-production-profile-e2e',requests:requests.map(row=>({...row})),requestCount:requests.length,outboundRequests,counts,hasProductionSideEffects:false};
      },
      close:()=>mf.dispose()
    };
  } catch(error) {await mf.dispose();throw error;}
}
