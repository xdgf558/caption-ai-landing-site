import assert from 'node:assert/strict';
import test,{before,after} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,stat,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,pbkdf2Sync,createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import worker from '../src/worker.js';
import {configuration} from '../src/mobile/security.js';
import {PRODUCTION_MOBILE_PROFILE as profile,PRODUCTION_ACCOUNT_ID,PRODUCTION_READER_DATABASE_ID,PRODUCTION_MUSIC_BUCKET,
  NONPRODUCTION_DATABASE_IDS,PRODUCTION_BINDING_MARKER_KEY} from '../src/mobile/environment.js';
import {mobileProductionCandidate,assertMobileProductionCandidate,productionBindingMarkerMaterials,
  writeMobileProductionCandidate,closedMobileVariables} from './build-mobile-production-candidate.mjs';
import {productionRoot,musicProductionCandidate} from './build-music-production-candidate.mjs';

const secret=()=>randomBytes(32).toString('base64url'),hash=value=>createHash('sha256').update(value).digest('hex');
const manifest={profileId:profile.id,accountId:PRODUCTION_ACCOUNT_ID,
  reader:{id:PRODUCTION_READER_DATABASE_ID,nonce:secret()},catalog:{id:'11111111-1111-4111-8111-111111111111',nonce:secret()},
  audio:{name:PRODUCTION_MUSIC_BUCKET,nonce:secret()}};
const resources={account_id:PRODUCTION_ACCOUNT_ID,compatibility_date:'2026-05-17',
  d1_databases:[{binding:'MUSIC_DB',database_name:'station-cat-music-production',database_id:manifest.catalog.id,migrations_dir:path.resolve(productionRoot,'migrations-music')}],
  r2_buckets:[{binding:'MUSIC_BUCKET',bucket_name:PRODUCTION_MUSIC_BUCKET}]};
const source=readFileSync('wrangler.toml','utf8'),materials=productionBindingMarkerMaterials(manifest);
const bindings={...closedMobileVariables,MOBILE_AUTH_ENABLED:'true',MOBILE_MUSIC_ENABLED:'true',MOBILE_PERSONAL_SYNC_ENABLED:'true',
  MOBILE_AUTH_ORIGIN:profile.origin,MOBILE_REDIRECT_URI:profile.redirect,MOBILE_RESULT_KEY_VERSION:'production-v1',
  MOBILE_RESULT_KEYS_JSON:JSON.stringify({'production-v1':secret()}),MOBILE_BINDING_MANIFEST_JSON:JSON.stringify(manifest),
  MUSIC_PUBLIC_ENABLED:'true',MUSIC_VIP_DELIVERY_ENABLED:'true'};
const noBindings=vars=>{const env={...vars};for(const name of ['WAITLIST_DB','MUSIC_DB','MUSIC_BUCKET','ASSETS'])Object.defineProperty(env,name,{get(){assert.fail('Unexpected binding read: '+name);}});return env;};

test('production candidate preserves website boundaries and is closed with empty origins and no result secret',()=>{
  const c=mobileProductionCandidate(source,resources,manifest),baseline=musicProductionCandidate(source,resources);
  assert.deepEqual({...c,vars:baseline.vars},baseline);
  for(const [key,value] of Object.entries(closedMobileVariables))assert.equal(c.vars[key],value);
  assert.equal(c.vars.MOBILE_RESULT_KEYS_JSON,undefined);
  assert.equal(c.vars.MOBILE_AUTH_ORIGIN,'');assert.equal(c.vars.MOBILE_REDIRECT_URI,'');
  for(const key of Object.keys(closedMobileVariables)) {
    const changed=structuredClone(c);changed.vars[key]='changed';
    assert.throws(()=>assertMobileProductionCandidate(changed,source,resources,manifest),/MOBILE_PRODUCTION_CANDIDATE_CHANGED/);
  }
});

test('candidate rejects all known isolated resources, wrong account and mismatched proof',()=>{
  for(const id of [...NONPRODUCTION_DATABASE_IDS,PRODUCTION_READER_DATABASE_ID]) {
    const changed=structuredClone(resources);changed.d1_databases[0].database_id=id;
    assert.throws(()=>musicProductionCandidate(source,changed),/MUSIC_PRODUCTION_DATABASE_ID/);
  }
  for(const alter of [m=>m.accountId='wrong',m=>m.reader.id=manifest.catalog.id,m=>m.audio.name='station-cat-music-r2-audio',
    m=>m.catalog.nonce=m.reader.nonce,m=>m.catalog.id='22222222-2222-4222-8222-222222222222',m=>m.remote=true]) {
    const changed=structuredClone(manifest);alter(changed);
    assert.throws(()=>mobileProductionCandidate(source,resources,changed),/MOBILE_PRODUCTION_(BINDING_MANIFEST|RESOURCE_MISMATCH)/);
  }
});

test('closed, wrong-profile, bad host/callback and isolated key requests reject before data bindings',async()=>{
  const invalid=[{},mobileProductionCandidate(source,resources,manifest).vars,{...bindings,MOBILE_PRODUCTION_PROFILE:'isolated'},
    {...bindings,MOBILE_AUTH_ORIGIN:'https://stationcat.org'}, {...bindings,MOBILE_AUTH_ORIGIN:'https://wwwstationcat.org.evil.test'},
    {...bindings,MOBILE_REDIRECT_URI:profile.redirect+'?x=1'},{...bindings,MOBILE_REDIRECT_URI:profile.redirect+'/'},
    {...bindings,MOBILE_RESULT_KEY_VERSION:'r2-v1',MOBILE_RESULT_KEYS_JSON:JSON.stringify({'r2-v1':secret()})},
    {...bindings,MOBILE_ENVIRONMENT:'isolated'}, {...bindings,MOBILE_BINDING_MANIFEST_JSON:'{}'}];
  for(const env of invalid) {
    const result=await worker.fetch(new Request(profile.origin+'/api/mobile/v1/config'),noBindings(env),{});
    assert.equal(result.status,503);assert.match(result.headers.get('cache-control'),/no-store/);
  }
  const wrongOrigin=await worker.fetch(new Request('https://stationcat.org/api/mobile/v1/config'),noBindings(bindings),{});
  assert.equal(wrongOrigin.status,403);
  assert.equal(configuration(bindings).environment,'production');
});

test('production deletion prepare/confirm/status never access a data binding even when flag is true',async()=>{
  for(const [route,method] of [['/me/deletion-requests/prepare','POST'],['/me/deletion-requests/'+randomUUID()+'/confirm','POST'],['/deletion-requests/'+randomUUID()+'/status','GET']]) {
    const result=await worker.fetch(new Request(profile.origin+'/api/mobile/v1'+route,{method}),noBindings({...bindings,MOBILE_ACCOUNT_DELETION_ENABLED:'true'}),{});
    assert.equal(result.status,503);
  }
});

test('isolated configuration rejects case and trailing-dot aliases of reserved production hosts before bindings',async()=>{
  for(const origin of ['https://wwwstationcat.org','https://stationcat.org','https://WWWSTATIONCAT.ORG','https://STATIONCAT.ORG',
    'https://wwwstationcat.org.','https://stationcat.org.','https://WWWSTATIONCAT.ORG.','https://stationcat.org.:8443','https://wwwstationcat.org..']) {
    const env={...bindings,MOBILE_ENVIRONMENT:'isolated',MOBILE_AUTH_ORIGIN:origin,MOBILE_REDIRECT_URI:origin+'/auth/mobile/callback'};
    assert.throws(()=>configuration(env),/SERVICE_UNAVAILABLE/);
    const response=await worker.fetch(new Request(origin+'/api/mobile/v1/config'),noBindings(env),{});assert.equal(response.status,503);
  }
  assert.equal(configuration({...bindings,MOBILE_ENVIRONMENT:'isolated',MOBILE_AUTH_ORIGIN:'https://native.local.test',MOBILE_REDIRECT_URI:'https://native.local.test/auth/mobile/callback'}).environment,'isolated');
});

test('private writer is create-only and rejects checkout paths and symlink destinations',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'native-production-candidate-'));
  try {
    const input=path.join(dir,'resources.json'),proof=path.join(dir,'bindings.json'),output=path.join(dir,'candidate.json');
    await writeFile(input,JSON.stringify(resources));await writeFile(proof,JSON.stringify(manifest));
    await writeMobileProductionCandidate(input,proof,output);
    assert.equal((await stat(output)).mode&0o777,0o600);
    assertMobileProductionCandidate(JSON.parse(await readFile(output,'utf8')),source,resources,manifest);
    await assert.rejects(writeMobileProductionCandidate(input,proof,output));
    await symlink(productionRoot,path.join(dir,'checkout'));
    await assert.rejects(writeMobileProductionCandidate(input,proof,path.join(dir,'checkout','bad.json')),/MOBILE_PRODUCTION_PRIVATE_PATH_REQUIRED/);
    assert.equal(readFileSync('wrangler.toml','utf8'),source);
  } finally {await rm(dir,{recursive:true,force:true});}
});

let mf,reader,music,bucket,readerBaselineSchema,ip=0;
// This fixture is bundled only into local Miniflare. No production request,
// deployed fixture route, test key, synthetic account or marker is created.
before(async()=>{
  const bundle=await build({stdin:{resolveDir:productionRoot,contents:`
    import worker from './src/worker.js';
    import {seedMusicRuntimeFixture} from './scripts/helpers/music-runtime-fixture.js';
    import {runMobileMaintenance} from './src/mobile/maintenance.js';
    export default {async fetch(request,env) {
      if(new URL(request.url).pathname==='/fixture/seed')return Response.json(await seedMusicRuntimeFixture(env.MUSIC_DB,await request.json()));
      let readerReads=0,catalogReads=0,audioReads=0,registrationRaceInjected=false;
      const wrap=(binding,onRead)=>new Proxy(binding,{get(target,key){
        if(key==='withSession')return name=>wrap(target.withSession(name),onRead);
        if(key==='prepare')return sql=>{if(sql.includes('station_native_binding_identity'))onRead();return target.prepare(sql);};
        if(key==='batch' && binding===env.WAITLIST_DB && request.headers.has('x-fixture-race-email'))return async statements=>{
          if(!registrationRaceInjected){registrationRaceInjected=true;const email=request.headers.get('x-fixture-race-email');
            await env.WAITLIST_DB.prepare("INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,'Race-created legacy')").bind(email,email).run();}
          return target.batch(statements);
        };
        const value=target[key];return typeof value==='function'?value.bind(target):value;
      }});
      const bound={...env,WAITLIST_DB:wrap(env.WAITLIST_DB,()=>readerReads++),MUSIC_DB:wrap(env.MUSIC_DB,()=>catalogReads++),
        MUSIC_BUCKET:{head:async(...args)=>{audioReads++;return env.MUSIC_BUCKET.head(...args);},get:(...args)=>env.MUSIC_BUCKET.get(...args)}};
      if(request.headers.get('x-fixture-swap'))[bound.WAITLIST_DB,bound.MUSIC_DB]=[bound.MUSIC_DB,bound.WAITLIST_DB];
      if(request.headers.get('x-fixture-disable'))bound[request.headers.get('x-fixture-disable')]='false';
      if(new URL(request.url).pathname==='/fixture/maintenance'){await runMobileMaintenance(bound);return Response.json({ok:true});}
      const response=await worker.fetch(request,bound,{});
      response.headers.set('x-fixture-marker-reads',[readerReads,catalogReads,audioReads].join(','));return response;
    }};`},bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
  mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-17',host:'127.0.0.1',port:0,
    d1Databases:{WAITLIST_DB:'synthetic-production-reader',MUSIC_DB:'synthetic-production-catalog'},r2Buckets:{MUSIC_BUCKET:'synthetic-production-audio'},bindings,
    outboundService:()=>new Response('No outbound requests allowed',{status:503})});
  [reader,music,bucket]=await Promise.all([mf.getD1Database('WAITLIST_DB'),mf.getD1Database('MUSIC_DB'),mf.getR2Bucket('MUSIC_BUCKET')]);
  const migrate=async(db,files)=>{const parser=new DatabaseSync(':memory:');try{for(const file of files){let sql=readFileSync(file,'utf8');while(sql.trim()){const st=parser.prepare(sql);st.run();await db.prepare(st.sourceSQL).run();sql=sql.slice(st.sourceSQL.length);}}}finally{parser.close();}};
  await migrate(reader,readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations/'+x));
  readerBaselineSchema=(await reader.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
  await migrate(reader,[...readdirSync('migrations-mobile').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations-mobile/'+x),'migrations-mobile-candidate/0001_binding_identity.sql']);
  await migrate(music,[...readdirSync('migrations-music').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations-music/'+x),'migrations-mobile-candidate/0001_binding_identity.sql']);
  await reader.prepare(materials.readerSql).run();await music.prepare(materials.catalogSql).run();
  await bucket.put(materials.audio.key,materials.audio.body,{customMetadata:materials.audio.customMetadata});
},{timeout:60000});
after(async()=>{await mf?.dispose();});

async function call(route,{body,headers={},method=body?'POST':'GET'}={}) {
  const response=await mf.dispatchFetch(route.startsWith('https:')?route:profile.origin+route,{method,redirect:'manual',
    headers:{'CF-Connecting-IP':'192.0.2.'+(++ip),'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  return response;
}
const pass='Synthetic-Production-Only!';
async function account(vip=false){const name='native-'+randomUUID(),email=name+'@example.test';
  const a=await reader.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,name).first();
  await reader.prepare('INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations,password_algorithm) VALUES(?,?,?,?,?,100000,?)')
    .bind(a.id,name,name,pbkdf2Sync(pass,'synthetic-salt',100000,32,'sha256').toString('hex'),'synthetic-salt','PBKDF2-SHA256').run();
  if(vip)await reader.prepare('INSERT INTO reader_memberships(account_id,started_at,expires_at) VALUES(?,?,?)').bind(a.id,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+3600000).toISOString()).run();
  return {...a,name};
}
async function browser(a,totpCode='') {
  const state=secret(),verifier=secret(),query={client_id:'station-cat-ios',redirect_uri:profile.redirect,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'};
  const r=await call('/auth/mobile/authorize?'+new URLSearchParams(query));assert.equal(r.status,200);
  assert.equal(r.headers.get('x-fixture-marker-reads'),'1,1,1');
  const text=await r.text(),flow=/name="flow" value="([^"]+)"/.exec(text)[1],cookie=r.headers.get('set-cookie').split(';')[0];
  assert.doesNotMatch(text,/test accounts|隔离测试/i);
  const post=await mf.dispatchFetch(profile.origin+'/auth/mobile/authorize',{method:'POST',redirect:'manual',
    headers:{Origin:profile.origin,Cookie:cookie,'CF-Connecting-IP':'192.0.2.'+(++ip),'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({flow,identifier:a.name,password:pass,totpCode,locale:'en'}).toString()});
  return {post,state,verifier,flow,cookie};
}
async function login(a=undefined,totpCode=''){a??=await account();const b=await browser(a,totpCode);assert.equal(b.post.status,302,await b.post.clone().text());
  const redirect=new URL(b.post.headers.get('location'));assert.equal(redirect.origin+redirect.pathname,profile.redirect);assert.equal(redirect.searchParams.get('state'),b.state);
  const result=await call('/api/mobile/v1/auth/token',{body:{clientId:'station-cat-ios',code:redirect.searchParams.get('code'),codeVerifier:b.verifier,redirectUri:profile.redirect}});
  assert.equal(result.status,200);assert.equal(result.headers.get('x-fixture-marker-reads'),'1,1,1');return {a,t:(await result.json()).data};
}
const auth=t=>({Authorization:'Bearer '+t.accessToken});

test('all 37 website migrations retain all 50 existing table definitions beside native and marker tables',async()=>{
  assert.equal(readerBaselineSchema.length,50);
  const current=(await reader.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all()).results;
  for(const definition of readerBaselineSchema)assert.deepEqual(current.find(row=>row.name===definition.name),definition);
  for(const name of ['mobile_sessions','mobile_music_favorites','station_native_binding_identity'])assert.ok(current.some(row=>row.name===name),name);
});

test('production-shaped runtime validates each binding exactly once; exposes honest capabilities',async()=>{
  const r=await call('/api/mobile/v1/config');assert.equal(r.status,200);assert.equal(r.headers.get('x-fixture-marker-reads'),'1,1,1');
  assert.deepEqual((await r.json()).data.capabilities,{musicCatalog:true,nativeAuthentication:true,musicPlayback:true,personalSync:true,accountDeletion:false,musicPurchases:false});
  const disabled=await call('/api/mobile/v1/config',{headers:{'x-fixture-disable':'MOBILE_AUTH_ENABLED'}});
  assert.equal(disabled.status,503);assert.equal(disabled.headers.get('x-fixture-marker-reads'),'0,0,0');
});

test('ready production AASA GET and HEAD use the same binding proof and expose only the production App ID',async()=>{
  const path='/.well-known/apple-app-site-association',before=(await reader.prepare('SELECT count(*) n FROM mobile_rate_limits').first()).n;
  const get=await call(path);assert.equal(get.status,200);assert.equal(get.headers.get('x-fixture-marker-reads'),'1,1,1');
  assert.equal(get.headers.get('content-type'),'application/json');assert.equal(get.headers.get('location'),null);
  assert.deepEqual(await get.json(),{applinks:{details:[{appIDs:[profile.appID],components:[...['/music','/music/','/en/music','/en/music/','/ja/music','/ja/music/','/zh-hans/music','/zh-hans/music/','/zh-hant/music','/zh-hant/music/','/auth/mobile/callback'].map(path=>({'/':path}))]}]},webcredentials:{apps:[profile.appID]}});
  const head=await call(path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('x-fixture-marker-reads'),'1,1,1');
  await music.prepare("UPDATE station_native_binding_identity SET binding_nonce='wrong' WHERE singleton=1").run();
  try {const denied=await call(path);assert.equal(denied.status,503);assert.doesNotMatch(await denied.text(),new RegExp(manifest.catalog.id));}
  finally {await music.prepare('UPDATE station_native_binding_identity SET binding_nonce=? WHERE singleton=1').bind(manifest.catalog.nonce).run();}
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_rate_limits').first()).n,before);
});

test('missing, changed and swapped binding proof fail before native writes and are rechecked next request',async()=>{
  const before=(await reader.prepare('SELECT count(*) n FROM mobile_rate_limits').first()).n;
  await reader.prepare("UPDATE station_native_binding_identity SET binding_nonce='wrong' WHERE singleton=1").run();
  assert.equal((await call('/api/mobile/v1/config')).status,503);
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_rate_limits').first()).n,before);
  await reader.prepare('UPDATE station_native_binding_identity SET binding_nonce=? WHERE singleton=1').bind(manifest.reader.nonce).run();
  await music.prepare('DELETE FROM station_native_binding_identity').run();assert.equal((await call('/api/mobile/v1/config')).status,503);
  await music.prepare(materials.catalogSql).run();
  assert.equal((await call('/api/mobile/v1/config',{headers:{'x-fixture-swap':'true'}})).status,503);
  await bucket.delete(PRODUCTION_BINDING_MARKER_KEY);assert.equal((await call('/api/mobile/v1/config')).status,503);
  await bucket.put(materials.audio.key,materials.audio.body,{customMetadata:{...materials.audio.customMetadata,resource_id:'station-cat-music-r2-audio'}});
  assert.equal((await call('/api/mobile/v1/config')).status,503);
  await bucket.put(materials.audio.key,materials.audio.body,{customMetadata:materials.audio.customMetadata});
  assert.equal((await call('/api/mobile/v1/config')).status,200);
});

test('production password/PKCE/refresh use existing account and never translate website cookies',async()=>{
  const {a,t}=await login();
  const me=await call('/api/mobile/v1/me',{headers:auth(t)});assert.equal((await me.json()).data.accountId,String(a.id));
  assert.equal((await call('/api/mobile/v1/me',{headers:{Cookie:'reader_session='+t.accessToken}})).status,401);
  assert.equal((await call('/api/mobile/v1/me',{headers:{...auth({...t,accessToken:secret()}),Cookie:'reader_session='+t.accessToken}})).status,401);
  const body={clientId:'station-cat-ios',refreshToken:t.refreshToken,refreshRequestId:randomUUID(),generation:t.generation};
  const first=await call('/api/mobile/v1/auth/refresh',{body}),retry=await call('/api/mobile/v1/auth/refresh',{body});
  assert.equal(first.status,200);assert.equal(retry.status,200);assert.deepEqual((await first.json()).data,(await retry.json()).data);
  assert.equal((await call('/api/mobile/v1/me',{headers:auth(t)})).status,401);
});

test('production TOTP remains mandatory and consumed codes cannot replay',async()=>{
  const a=await account();await reader.prepare('INSERT INTO reader_totp_credentials(account_id,secret_base32,verified_at,enabled_at) VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)')
    .bind(a.id,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
  assert.equal((await browser(a)).post.status,401);
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1','12345678901234567890').update(counter).digest(),offset=digest.at(-1)&15;
  const code=String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
  assert.equal((await browser(a,code)).post.status,302);assert.equal((await browser(a,code)).post.status,401);
});

test('production native registration cannot claim an existing magic-link account or its membership and points',async()=>{
  const name='legacy-'+randomUUID().slice(0,16),email=name+'@example.test';
  const legacy=await reader.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,'Existing magic-link member').first();
  await reader.prepare("INSERT INTO reader_memberships(account_id,source,source_ref,started_at,expires_at) VALUES(?,'fixture','legacy-preserve',?,?)")
    .bind(legacy.id,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+86400000).toISOString()).run();
  await reader.prepare('INSERT INTO reader_credit_accounts(account_id,balance_credits,lifetime_purchased_credits) VALUES(?,41,41)').bind(legacy.id).run();
  const membership=await reader.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(legacy.id).first();
  const points=await reader.prepare('SELECT * FROM reader_credit_accounts WHERE account_id=?').bind(legacy.id).first();
  const original=await reader.prepare('SELECT * FROM reader_accounts WHERE id=?').bind(legacy.id).first();
  const flow=await browser({name});assert.equal(flow.post.status,401);
  const registered=await mf.dispatchFetch(profile.origin+'/auth/mobile/register',{method:'POST',headers:{Origin:profile.origin,Cookie:flow.cookie,
    'CF-Connecting-IP':'192.0.2.'+(++ip),'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({flow:flow.flow,locale:'en',username:name,email,password:pass}).toString()});
  assert.equal(registered.status,400,await registered.clone().text());assert.equal(registered.headers.get('set-cookie'),null);
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_accounts WHERE normalized_email=?').bind(email).first(),original);
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(legacy.id).first(),membership);
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_credit_accounts WHERE account_id=?').bind(legacy.id).first(),points);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_sessions WHERE account_id=?').bind(legacy.id).first()).n,0);
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_sessions WHERE account_id=?').bind(legacy.id).first()).n,0);
  assert.equal(await reader.prepare('SELECT * FROM reader_password_credentials WHERE account_id=?').bind(legacy.id).first(),null);
  assert.equal((await browser({name})).post.status,401);
});

async function nativeRegistration(name,email,headers={}) {
  const flow=await browser({name});assert.equal(flow.post.status,401);
  return mf.dispatchFetch(profile.origin+'/auth/mobile/register',{method:'POST',headers:{Origin:profile.origin,Cookie:flow.cookie,
    'CF-Connecting-IP':'192.0.2.'+(++ip),'Content-Type':'application/x-www-form-urlencoded',...headers},
    body:new URLSearchParams({flow:flow.flow,locale:'en',username:name,email,password:pass}).toString()});
}

test('production native registration creates only a fresh account, without issuing a website or native session',async()=>{
  const name='fresh-'+randomUUID().slice(0,16),email=name+'@example.test';
  const response=await nativeRegistration(name,email);assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get('set-cookie'),null);
  const account=await reader.prepare('SELECT id FROM reader_accounts WHERE normalized_email=?').bind(email).first();assert.ok(account);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_sessions WHERE account_id=?').bind(account.id).first()).n,0);
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_sessions WHERE account_id=?').bind(account.id).first()).n,0);
  assert.equal((await login({...account,name})).t.accountId,String(account.id));
});

test('production registration atomically rejects a legacy account created between its read and write',async()=>{
  const name='race-'+randomUUID().slice(0,16),email=name+'@example.test';
  const response=await nativeRegistration(name,email,{'x-fixture-race-email':email});assert.equal(response.status,400,await response.clone().text());
  const account=await reader.prepare('SELECT * FROM reader_accounts WHERE normalized_email=?').bind(email).first();
  assert.equal(account.display_name,'Race-created legacy');
  assert.equal(await reader.prepare('SELECT * FROM reader_password_credentials WHERE account_id=?').bind(account.id).first(),null);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_accounts WHERE normalized_email=?').bind(email).first()).n,1);
  assert.equal((await browser({name})).post.status,401);
});

test('failed production credential insertion rolls back its newly inserted account',async()=>{
  const name='abort-'+randomUUID().slice(0,16),email=name+'@example.test';
  await reader.prepare("CREATE TRIGGER production_fixture_reject_credential BEFORE INSERT ON reader_password_credentials BEGIN SELECT RAISE(ABORT,'synthetic-write-failure'); END").run();
  try {const response=await nativeRegistration(name,email);assert.equal(response.status,503);}
  finally {await reader.prepare('DROP TRIGGER production_fixture_reject_credential').run();}
  assert.equal(await reader.prepare('SELECT * FROM reader_accounts WHERE normalized_email=?').bind(email).first(),null);
  assert.equal(await reader.prepare('SELECT * FROM reader_password_credentials WHERE normalized_username=?').bind(name).first(),null);
});

test('website registration cannot bypass the ownership guard for a legacy account even with native auth disabled',async()=>{
  const name='web-legacy-'+randomUUID().slice(0,12),email=name+'@example.test';
  const legacy=await reader.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,'Existing legacy owner').first();
  await reader.prepare("INSERT INTO reader_memberships(account_id,source,source_ref,started_at,expires_at) VALUES(?,'fixture','web-legacy-preserve',?,?)")
    .bind(legacy.id,new Date(Date.now()-60000).toISOString(),new Date(Date.now()+86400000).toISOString()).run();
  await reader.prepare('INSERT INTO reader_credit_accounts(account_id,balance_credits,lifetime_purchased_credits) VALUES(?,72,72)').bind(legacy.id).run();
  const original=await reader.prepare('SELECT * FROM reader_accounts WHERE id=?').bind(legacy.id).first();
  const membership=await reader.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(legacy.id).first();
  const points=await reader.prepare('SELECT * FROM reader_credit_accounts WHERE account_id=?').bind(legacy.id).first();
  const result=await call('/api/readers/register',{body:{username:name,email,password:pass},headers:{Origin:profile.origin,'x-fixture-disable':'MOBILE_AUTH_ENABLED'}});
  assert.equal(result.status,409);assert.equal((await result.json()).code,'EMAIL_TAKEN');assert.equal(result.headers.get('set-cookie'),null);
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_accounts WHERE id=?').bind(legacy.id).first(),original);
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(legacy.id).first(),membership);
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_credit_accounts WHERE account_id=?').bind(legacy.id).first(),points);
  assert.equal(await reader.prepare('SELECT * FROM reader_password_credentials WHERE account_id=?').bind(legacy.id).first(),null);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_sessions WHERE account_id=?').bind(legacy.id).first()).n,0);
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_sessions WHERE account_id=?').bind(legacy.id).first()).n,0);
});

test('fresh website registration retains the authenticated response and HttpOnly Cookie contract',async()=>{
  const name='web-fresh-'+randomUUID().slice(0,12),email=name+'@example.test';
  const result=await call('/api/readers/register',{body:{username:name,email,password:pass},headers:{Origin:profile.origin}});
  assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);
  const body=await result.json();assert.equal(body.ok,true);assert.equal(body.authenticated,true);assert.equal(body.message,'注册成功，已登入会员中心。');
  assert.deepEqual(Object.keys(body.account).sort(),['createdAt','displayName','email','id','normalizedEmail','username']);
  assert.equal(body.account.email,email);assert.equal(body.account.normalizedEmail,email);assert.equal(body.account.username,name);assert.equal(body.account.displayName,name);assert.ok(body.account.createdAt);
  const setCookie=result.headers.get('set-cookie');assert.match(setCookie,/^station_cat_reader_session=/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);assert.match(setCookie,/SameSite=Lax/);
  const session=await call('/api/readers/session',{headers:{Cookie:setCookie.split(';')[0]}}),state=await session.json();assert.equal(state.authenticated,true);assert.equal(state.account.id,body.account.id);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_sessions WHERE account_id=? AND revoked_at IS NULL').bind(body.account.id).first()).n,1);
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_sessions WHERE account_id=?').bind(body.account.id).first()).n,0);
  assert.equal((await login({id:body.account.id,name})).t.accountId,String(body.account.id));
});

test('website registration also rejects a legacy account created between its read and atomic write',async()=>{
  const name='web-race-'+randomUUID().slice(0,12),email=name+'@example.test';
  const result=await call('/api/readers/register',{body:{username:name,email,password:pass},headers:{Origin:profile.origin,'x-fixture-race-email':email}});
  assert.equal(result.status,409);assert.equal(result.headers.get('set-cookie'),null);
  const account=await reader.prepare('SELECT * FROM reader_accounts WHERE normalized_email=?').bind(email).first();assert.equal(account.display_name,'Race-created legacy');
  assert.equal(await reader.prepare('SELECT * FROM reader_password_credentials WHERE account_id=?').bind(account.id).first(),null);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_accounts WHERE normalized_email=?').bind(email).first()).n,1);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_sessions WHERE account_id=?').bind(account.id).first()).n,0);
});

test('existing website password session survives native login and the two credential types never substitute for each other',async()=>{
  const a=await account(true),webLogin=await call('/api/readers/login',{body:{identifier:a.name,password:pass}});
  assert.equal(webLogin.status,200);const webBody=await webLogin.json();assert.equal(webBody.account.id,a.id);
  const setCookie=webLogin.headers.get('set-cookie'),cookie=setCookie.split(';')[0],rawCookie=cookie.slice(cookie.indexOf('=')+1);
  assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/Secure/);
  const original=await reader.prepare('SELECT * FROM reader_sessions WHERE account_id=?').bind(a.id).first();
  const {t}=await login(a);assert.equal(t.accountId,String(a.id));
  assert.equal((await reader.prepare('SELECT revoked_at FROM reader_sessions WHERE id=?').bind(original.id).first()).revoked_at,null);
  const web=await call('/api/readers/session',{headers:{Cookie:cookie}});const session=await web.json();assert.equal(session.authenticated,true);assert.equal(session.account.id,a.id);
  assert.equal((await call('/api/mobile/v1/me',{headers:{Cookie:cookie}})).status,401);
  assert.equal((await call('/api/mobile/v1/me',{headers:{Authorization:'Bearer '+rawCookie}})).status,401);
  for(const headers of [auth(t),{Cookie:'station_cat_reader_session='+t.accessToken}])assert.equal((await (await call('/api/readers/session',{headers})).json()).authenticated,false);
});

const totpAt=step=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64BE(BigInt(step));const digest=createHmac('sha1','12345678901234567890').update(bytes).digest(),offset=digest.at(-1)&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');};
test('TOTP password reset preserves account and membership but invalidates previous web and native credentials',async()=>{
  const a=await account(true);
  await reader.prepare('INSERT INTO reader_totp_credentials(account_id,secret_base32,verified_at,enabled_at) VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(a.id,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
  const step=Math.floor(Date.now()/30000),{t}=await login(a,totpAt(step-1));
  const webLogin=await call('/api/readers/login',{body:{identifier:a.name,password:pass}});assert.equal(webLogin.status,200);const cookie=webLogin.headers.get('set-cookie').split(';')[0];
  const before=await call('/api/mobile/v1/me',{headers:auth(t)});assert.equal(before.status,200);
  const membership=await reader.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(a.id).first();
  const flow=await browser(a);assert.equal(flow.post.status,401);const password='Replacement-Production-Fixture!';
  const reset=await mf.dispatchFetch(profile.origin+'/auth/mobile/reset',{method:'POST',headers:{Origin:profile.origin,Cookie:flow.cookie,
    'CF-Connecting-IP':'192.0.2.'+(++ip),'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({flow:flow.flow,locale:'en',identifier:a.name,password,totpCode:totpAt(Math.floor(Date.now()/30000))}).toString()});
  assert.equal(reset.status,200,await reset.clone().text());assert.equal(reset.headers.get('set-cookie'),null);
  assert.equal((await call('/api/mobile/v1/me',{headers:auth(t)})).status,401);
  assert.equal((await call('/api/mobile/v1/auth/refresh',{body:{clientId:'station-cat-ios',refreshToken:t.refreshToken,refreshRequestId:randomUUID(),generation:t.generation}})).status,401);
  assert.equal((await (await call('/api/readers/session',{headers:{Cookie:cookie}})).json()).authenticated,false);
  const credential=await reader.prepare('SELECT * FROM reader_password_credentials WHERE account_id=?').bind(a.id).first();
  assert.equal(credential.password_hash,pbkdf2Sync(password,credential.password_salt,credential.password_iterations,32,'sha256').toString('hex'));
  assert.deepEqual(await reader.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(a.id).first(),membership);
  assert.equal((await reader.prepare('SELECT count(*) n FROM mobile_sessions WHERE account_id=?').bind(a.id).first()).n,1);
  assert.equal((await reader.prepare('SELECT count(*) n FROM reader_sessions WHERE account_id=? AND revoked_at IS NULL').bind(a.id).first()).n,0);
});

test('production maintenance cannot advance a deletion outbox',async()=>{
  const id=randomUUID(),now=Date.now();
  await reader.prepare("INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,stage,confirmed_at) VALUES(?,999999,?,?,'station-account-v1',?,?,'accepted','queued',?)")
    .bind(id,randomUUID(),hash('synthetic-receipt'),now+600000,now+86400000,now).run();
  await reader.prepare('INSERT INTO mobile_deletion_outbox(job_id,updated_at) VALUES(?,?)').bind(id,now).run();
  assert.equal((await call('/fixture/maintenance')).status,200);
  assert.deepEqual(await reader.prepare('SELECT status,stage FROM mobile_deletions WHERE id=?').bind(id).first(),{status:'accepted',stage:'queued'});
  assert.equal((await reader.prepare('SELECT status FROM mobile_deletion_outbox WHERE job_id=?').bind(id).first()).status,'pending');
});

async function track(accessMode){
  const trackId=randomUUID(),fixture=JSON.parse(readFileSync('tests/fixtures/music-mp3/manifest.json')).files;
  const asset=async(file,kind)=>{const f=fixture.find(item=>item.file===file),id=randomUUID(),key=`music/${kind==='audio'?'audio':'previews'}/${trackId}/${id}.mp3`,bytes=readFileSync('tests/fixtures/music-mp3/'+file);
    const object=await bucket.put(key,bytes,{httpMetadata:{contentType:'audio/mpeg'}});
    return {id,owner_track_id:trackId,kind,object_key:key,state:'validated',format:'mp3',content_type:'audio/mpeg',byte_size:bytes.length,duration_ms:f.packetDurationMs,sha256:f.sha256,etag:object.etag};};
  const audio=await asset('cbr-stereo.mp3','audio'),preview=await asset('preview.mp3','preview');Object.assign(preview,{derived_from_asset_id:audio.id,source_start_ms:0,source_end_ms:1000});
  const seed=await call('/fixture/seed',{body:{audio,preview,accessMode}}),command=await seed.json();assert.equal(seed.status,200);
  await music.prepare("UPDATE music_track_revisions SET state='sealed' WHERE id=?").bind(command.revisionId).run();
  await music.prepare("UPDATE music_tracks SET lifecycle='published',draft_revision_id=NULL,published_revision_id=?,first_published_at=?,published_at=? WHERE id=?").bind(command.revisionId,Date.now()-1000,Date.now()-1000,trackId).run();
  return {id:trackId,audio};
}

test('production catalog and R2 grants retain free/VIP access and sync remains account-scoped',async()=>{
  const free=await track('free'),vip=await track('vip'),member=await login(await account(true)),other=await login();
  const catalog=await call('/api/mobile/v1/music/catalog?locale=en');assert.equal(catalog.status,200);
  const items=(await catalog.json()).data.items;assert.equal(items.length,2);assert.equal(items.find(t=>t.id===free.id).offlineEligible,false);
  const path='/api/mobile/v1/music/tracks/'+vip.id+'/playback-grants',body={audioVersion:1,variant:'full'};
  assert.equal((await call(path,{body})).status,401);assert.equal((await call(path,{body,headers:auth(other.t)})).status,403);
  const grant=await call(path,{body,headers:auth(member.t)});assert.equal(grant.status,200);const value=(await grant.json()).data;
  assert.equal(value.authMode,'session_bearer');assert.equal(new URL(value.playbackUrl).origin,profile.origin);
  assert.equal((await call(value.playbackUrl,{headers:auth(other.t)})).status,403);
  const media=await call(value.playbackUrl,{headers:auth(member.t)});assert.equal(media.status,200);assert.equal((await media.arrayBuffer()).byteLength,vip.audio.byte_size);
  const favorite=await call('/api/mobile/v1/me/music/favorites/'+free.id,{method:'PUT',headers:auth(member.t),body:{favorite:true,mutationId:randomUUID(),expectedVersion:0}});assert.equal(favorite.status,200);
  const mine=await call('/api/mobile/v1/me/music/favorites',{headers:auth(member.t)}),theirs=await call('/api/mobile/v1/me/music/favorites',{headers:auth(other.t)});
  assert.equal((await mine.json()).data.items.length,1);assert.equal((await theirs.json()).data.items.length,0);
  const entitlements=await call('/api/mobile/v1/me/entitlements',{headers:auth(member.t)});assert.equal((await entitlements.json()).data.music.canPlayVipFull,true);
  const disabled=await call('/api/mobile/v1/me/music/favorites',{headers:{...auth(member.t),'x-fixture-disable':'MOBILE_PERSONAL_SYNC_ENABLED'}});assert.equal(disabled.status,503);
});
