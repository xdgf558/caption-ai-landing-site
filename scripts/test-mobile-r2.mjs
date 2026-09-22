import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,pbkdf2Sync} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const origin='https://station-cat-music-r2.yehao1105.workers.dev';
const secret=()=>randomBytes(32).toString('base64url');
let mf, db;
const password=secret();
const call=(path,init={})=>mf.dispatchFetch(origin+path,init);
async function migrate(db,files){const sqlite=new DatabaseSync(':memory:');try{for(const file of files){let sql=readFileSync(file,'utf8');while(sql.trim()){const s=sqlite.prepare(sql);s.run();await db.prepare(s.sourceSQL).run();sql=sql.slice(s.sourceSQL.length);}}}finally{sqlite.close();}}
before(async()=>{
 const bundle=await build({entryPoints:['src/mobile/isolatedWorker.js'],bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
 const config=JSON.parse(readFileSync('wrangler.mobile-r2.jsonc'));
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,host:'127.0.0.1',port:0,d1Databases:{WAITLIST_DB:'r2-test-reader',MUSIC_DB:'r2-test-catalog'},r2Buckets:{MUSIC_BUCKET:'r2-test-audio'},bindings:{...config.vars,MOBILE_RESULT_KEYS_JSON:JSON.stringify({'r2-v1':secret()})},outboundService:()=>new Response('Denied',{status:503})});
 db=await mf.getD1Database('WAITLIST_DB');
 await migrate(db,['migrations/0003_reader_accounts.sql','migrations/0009_reader_memberships.sql','migrations/0011_reader_password_credentials.sql','migrations/0012_reader_totp_credentials.sql','migrations/0013_reader_totp_reset_attempts.sql',...readdirSync('migrations-mobile').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations-mobile/'+x)]);
 await migrate(await mf.getD1Database('MUSIC_DB'),readdirSync('migrations-music').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations-music/'+x));
 const salt=secret(),hash=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
 await db.prepare("INSERT INTO reader_accounts(id,email,normalized_email,display_name) VALUES(1,'r2@example.test','r2@example.test','R2')").run();
 await db.prepare("INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(1,'r2tester','r2tester',?,?,100000)").bind(hash,salt).run();
});
after(async()=>await mf?.dispose());
test('AASA is JSON without redirect and only associates the registered staging App',async()=>{
 const r=await call('/.well-known/apple-app-site-association');assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.equal(r.headers.get('content-type'),'application/json');
 const a=await r.json();assert.deepEqual(a.webcredentials.apps,['2AM5S7BM2N.org.stationcat.music.staging']);assert.deepEqual(a.applinks.details[0].appIDs,a.webcredentials.apps);
 assert.deepEqual(a.applinks.details[0].components,[{'/':'/music/'},{'/':'/auth/mobile/callback'}]);
});
test('wrong host, fixture, admin, payments, signup and reset stay inaccessible',async()=>{
 assert.equal((await mf.dispatchFetch('https://wwwstationcat.org/api/mobile/v1/config')).status,404);
 for(const path of ['/fixture/seed','/admin/api/music','/api/readers/me','/auth/mobile/register','/auth/mobile/reset','/api/music/__cover-files/x.jpg'])assert.equal((await call(path)).status,404,path);
});
test('native capabilities expose only isolated functionality and no purchases',async()=>{
 const r=await call('/api/mobile/v1/config');assert.equal(r.status,200);const c=(await r.json()).data.capabilities;assert.equal(c.nativeAuthentication,true);assert.equal(c.musicPurchases,false);assert.equal(c.personalSync,true);
});
test('real password + browser cookie + PKCE exchange, refresh replay, library and logout',async()=>{
 const verifier=secret(),state=secret(),challenge=createHash('sha256').update(verifier).digest('base64url');
 const query=new URLSearchParams({client_id:'station-cat-ios',redirect_uri:origin+'/auth/mobile/callback',code_challenge_method:'S256',code_challenge:challenge,state,locale:'en'});
 const page=await call('/auth/mobile/authorize?'+query);assert.equal(page.status,200);
 const html=await page.text();assert.match(html,/Test accounts only/);assert.doesNotMatch(html,/href="\/auth\/mobile\/(register|reset)/);
 const flow=/name="flow" value="([^"]+)"/.exec(html)[1];const cookie=page.headers.get('set-cookie').split(';')[0];
 const login=await call('/auth/mobile/authorize',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({flow,locale:'en',identifier:'r2tester',password,totpCode:''}).toString()});
 assert.equal(login.status,302);const callback=new URL(login.headers.get('location'));assert.equal(callback.searchParams.get('state'),state);
 const json=(body,headers={},method='POST')=>({method,headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 const tokenBody={clientId:'station-cat-ios',code:callback.searchParams.get('code'),codeVerifier:verifier,redirectUri:origin+'/auth/mobile/callback'};
 const token=await call('/api/mobile/v1/auth/token',json(tokenBody));assert.equal(token.status,200);const initial=(await token.json()).data;
 assert.equal((await call('/api/mobile/v1/auth/token',json(tokenBody))).status,401);
 const refreshBody={clientId:'station-cat-ios',generation:initial.generation,refreshToken:initial.refreshToken,refreshRequestId:crypto.randomUUID()};
 const refreshed=await call('/api/mobile/v1/auth/refresh',json(refreshBody));assert.equal(refreshed.status,200);const tokens=(await refreshed.json()).data;
 const replay=await call('/api/mobile/v1/auth/refresh',json(refreshBody));assert.deepEqual((await replay.json()).data,tokens);
 const auth={Authorization:'Bearer '+tokens.accessToken};
 assert.equal((await call('/api/mobile/v1/me',{headers:auth})).status,200);
 assert.equal((await call('/api/mobile/v1/me/music/preferences',{headers:auth})).status,200);
 assert.equal((await call('/api/mobile/v1/me',{headers:{Cookie:cookie}})).status,401);
 assert.equal((await call('/api/mobile/v1/auth/logout',json({},auth))).status,200);
 assert.equal((await call('/api/mobile/v1/me',{headers:auth})).status,401);
});
test('empty isolated catalog uses the real catalog endpoint',async()=>{
 const r=await call('/api/mobile/v1/music/catalog?locale=en');assert.equal(r.status,200);
});
