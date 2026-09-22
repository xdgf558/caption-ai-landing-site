import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash,pbkdf2Sync,createHmac} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const origin='https://native.local.test', redirect=origin+'/auth/mobile/callback';
const secret=()=>randomBytes(32).toString('base64url'), hash=s=>createHash('sha256').update(s).digest('hex');
const pass='Synthetic-M2-only!';let mf,db,ip=0,bundle,dir,runtimeOptions;
before(async()=>{
 bundle=await build({entryPoints:['scripts/helpers/mobile-runtime-worker.js'],bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
 dir=mkdtempSync(tmpdir()+'/station-m2-d1-');
 runtimeOptions={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,
  d1Databases:{WAITLIST_DB:'m2-isolated-only'},d1Persist:dir,bindings:{MOBILE_ENVIRONMENT:'isolated',MOBILE_AUTH_ENABLED:'true',MOBILE_AUTH_ORIGIN:origin,MOBILE_REDIRECT_URI:redirect,
   MOBILE_RESULT_KEY_VERSION:'test-v1',MOBILE_RESULT_KEYS_JSON:JSON.stringify({'test-v1':secret()})},outboundService:()=>new Response('Outbound disabled',{status:503})};
 mf=new Miniflare(runtimeOptions);
 db=await mf.getD1Database('WAITLIST_DB');const parser=new DatabaseSync(':memory:');
 for(const file of ['migrations/0003_reader_accounts.sql','migrations/0011_reader_password_credentials.sql','migrations/0012_reader_totp_credentials.sql','migrations/0013_reader_totp_reset_attempts.sql','migrations-mobile/0001_native_auth.sql']) {
  let sql=readFileSync(file,'utf8');const statements=[];
  while(sql.trim()){const st=parser.prepare(sql),source=st.sourceSQL;st.run();statements.push(db.prepare(source));sql=sql.slice(source.length);}
  await db.batch(statements);
 }parser.close();
},{timeout:60000});
after(async()=>{await mf?.dispose();if(dir)rmSync(dir,{recursive:true,force:true});});
async function call(path,body,headers={}){const r=await mf.dispatchFetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{'CF-Connecting-IP':`192.0.2.${++ip}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text();return {status:r.status,headers:r.headers,body:r.headers.get('content-type')?.includes('json')?JSON.parse(text):text};}
async function account(){const name='fixture-'+randomUUID();const salt='fixture-salt';const a=await db.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(name+'@example.test',name+'@example.test',name).first();
 await db.prepare('INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations,password_algorithm) VALUES(?,?,?,?,?,100000,?)').bind(a.id,name,name,pbkdf2Sync(pass,salt,100000,32,'sha256').toString('hex'),salt,'PBKDF2-SHA256').run();return {id:a.id,name};}
async function browser(a,{password=pass,totpCode='',state=secret(),verifier=secret()}={}){
 const challenge=createHash('sha256').update(verifier).digest('base64url');const r=await call('/auth/mobile/authorize?'+new URLSearchParams({client_id:'station-cat-ios',redirect_uri:redirect,state,code_challenge:challenge,code_challenge_method:'S256'}));assert.equal(r.status,200);
 const flow=/name="flow" value="([^"]+)"/.exec(r.body)[1],cookie=r.headers.get('set-cookie').split(';')[0];
 const post=await mf.dispatchFetch(origin+'/auth/mobile/authorize',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':`192.0.2.${++ip}`},body:new URLSearchParams({flow,identifier:a.name,password,totpCode,locale:'en'}).toString()});
 return {post,verifier,state,cookie,flow};}
async function login(a) {a ??= await account();const b=await browser(a);assert.equal(b.post.status,302,await b.post.clone().text());const u=new URL(b.post.headers.get('location'));assert.equal(u.searchParams.get('state'),b.state);
 const body={clientId:'station-cat-ios',code:u.searchParams.get('code'),codeVerifier:b.verifier,redirectUri:redirect};const r=await call('/api/mobile/v1/auth/token',body);assert.equal(r.status,200,JSON.stringify(r.body));return {a,t:r.body.data,body};}
const auth=t=>({Authorization:'Bearer '+t.accessToken});
const refreshBody=(t,id=randomUUID())=>({clientId:'station-cat-ios',refreshToken:t.refreshToken,refreshRequestId:id,generation:t.generation});
async function reauth(t){const r=await call('/api/mobile/v1/auth/reauth',{password:pass,totpCode:''},auth(t));assert.equal(r.status,200);}
async function prepare(t){await reauth(t);const receipt=secret(),id=randomUUID(),key=randomUUID(),body={deletionRequestId:id,deletionReceiptHash:hash(Buffer.from(receipt,'base64url')),scopeVersion:'station-account-v1'};const r=await call('/api/mobile/v1/me/deletion-requests/prepare',body,{...auth(t),'Idempotency-Key':key});assert.equal(r.status,200,JSON.stringify(r.body));return {id,receipt,key,body};}
const status=d=>call(`/api/mobile/v1/deletion-requests/${d.id}/status`,undefined,{Authorization:'DeletionReceipt '+d.receipt});
const confirm=(t,d,key=randomUUID())=>call(`/api/mobile/v1/me/deletion-requests/${d.id}/confirm`,{confirmedScopeVersion:'station-account-v1'},{...auth(t),'Idempotency-Key':key});

test('closed gate, exact redirects and S256 required',async()=>{
 assert.equal((await call('/fixture/disabled')).status,503);
 const query={client_id:'station-cat-ios',redirect_uri:'https://evil.example/callback',state:secret(),code_challenge:secret(),code_challenge_method:'S256'};
 assert.equal((await call('/auth/mobile/authorize?'+new URLSearchParams(query))).status,400);
 query.redirect_uri=redirect;query.code_challenge_method='plain';assert.equal((await call('/auth/mobile/authorize?'+new URLSearchParams(query))).status,400);
});
test('mobile browser forms keep legible inherited control text without disabling user zoom',async()=>{
 for(const locale of ['zh-Hans','zh-Hant','en','ja']){
  const query={client_id:'station-cat-ios',redirect_uri:redirect,state:secret(),code_challenge:secret(),code_challenge_method:'S256',locale};
  const r=await call('/auth/mobile/authorize?'+new URLSearchParams(query));assert.equal(r.status,200);
  assert.equal(r.headers.get('referrer-policy'),'strict-origin');
  const viewport=/<meta name="viewport" content="([^"]+)">/.exec(r.body)?.[1];
  assert.equal(viewport,'width=device-width,initial-scale=1');
  assert.doesNotMatch(r.body,/user-scalable\s*=\s*no|maximum-scale\s*=|touch-action\s*:\s*none/i);
  // 16px is the iOS focus-zoom threshold; larger inherited user text must still win.
  const controls=/input,button\{([^}]+)\}/.exec(r.body)?.[1];
  assert.match(controls,/font:inherit(?:;|$)/);assert.match(controls,/font-size:max\(1em,16px\)(?:;|$)/);
  assert.match(r.body,/input\{[^}]*box-sizing:border-box;[^}]*width:100%/);
 }
});
test('password login, code bound to verifier and single-use; no tokens in redirect',async()=>{
 const a=await account(),b=await browser(a);assert.equal(b.post.status,302);const u=new URL(b.post.headers.get('location'));assert.deepEqual([...u.searchParams.keys()],['code','state']);
 const body={clientId:'station-cat-ios',code:u.searchParams.get('code'),codeVerifier:secret(),redirectUri:redirect};assert.equal((await call('/api/mobile/v1/auth/token',body)).status,401);
 body.codeVerifier=b.verifier;const responses=await Promise.all([call('/api/mobile/v1/auth/token',body),call('/api/mobile/v1/auth/token',body)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);
 const t=responses.find(r=>r.status===200).body.data;assert.equal((await call('/api/mobile/v1/me',undefined,auth(t))).body.data.accountId,String(a.id));
});
test('no Cookie fallback; unknown Bearer rejected; response never cacheable',async()=>{
 const {t}=await login();const r=await call('/api/mobile/v1/me',undefined,{Cookie:'reader_session='+t.accessToken,Authorization:'Bearer '+secret()});assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('access-control-allow-origin'),null);
});
test('browser flow cookie and Origin required; blocked account cannot login',async()=>{
 const a=await account();await db.prepare("UPDATE reader_accounts SET status='blocked' WHERE id=?").bind(a.id).run();assert.equal((await browser(a)).post.status,401);
 const r=await mf.dispatchFetch(origin+'/auth/mobile/authorize',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/x-www-form-urlencoded'},body:'flow=invalid'});assert.equal(r.status,403);
});
test('browser form rejects missing null and foreign Origin without consuming its flow',async()=>{
 const a=await account();
 const query={client_id:'station-cat-ios',redirect_uri:redirect,state:secret(),code_challenge:secret(),code_challenge_method:'S256',locale:'en'};
 const page=await call('/auth/mobile/authorize?'+new URLSearchParams(query));assert.equal(page.status,200);
 assert.equal(page.headers.get('referrer-policy'),'strict-origin');
 const flow=/name="flow" value="([^"]+)"/.exec(page.body)[1],cookie=page.headers.get('set-cookie').split(';')[0];
 for(const path of ['sign-in','register','reset']){
  const support=await call('/auth/mobile/'+path+'?'+new URLSearchParams({flow,locale:'en'}),undefined,{Cookie:cookie});
  assert.equal(support.status,200);assert.equal(support.headers.get('referrer-policy'),'strict-origin');
 }
 const post=async source=>mf.dispatchFetch(origin+'/auth/mobile/authorize',{method:'POST',redirect:'manual',
  headers:{...(source===undefined?{}:{Origin:source}),Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':`192.0.2.${++ip}`},
  body:new URLSearchParams({flow,identifier:a.name,password:pass,totpCode:'',locale:'en'}).toString()});
 for(const source of [undefined,'null','https://evil.example']){
  const rejected=await post(source);assert.equal(rejected.status,403);
  assert.equal((await rejected.json()).error.code,'ACCESS_DENIED');assert.equal(rejected.headers.get('referrer-policy'),'no-referrer');
  assert.equal((await db.prepare('SELECT used FROM mobile_browser_flows WHERE id=?').bind(flow).first()).used,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM mobile_codes WHERE account_id=?').bind(a.id).first()).n,0);
 }
 const accepted=await post(origin);assert.equal(accepted.status,302);assert.equal(accepted.headers.get('referrer-policy'),'no-referrer');
 const callback=new URL(accepted.headers.get('location'));
 assert.equal(callback.origin,origin);assert.deepEqual([...callback.searchParams.keys()],['code','state']);
 const result=await call(callback.pathname+callback.search);assert.equal(result.status,200);
 assert.equal(result.headers.get('referrer-policy'),'no-referrer');assert.doesNotMatch(result.body,/<form\b/i);
 const config=await call('/api/mobile/v1/config');assert.equal(config.headers.get('referrer-policy'),'no-referrer');
});
test('TOTP required and cannot replay consumed step',async()=>{
 const a=await account();const base32='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';await db.prepare('INSERT INTO reader_totp_credentials(account_id,secret_base32,verified_at,enabled_at) VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(a.id,base32).run();
 assert.equal((await browser(a)).post.status,401);
 const step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const mac=createHmac('sha1',Buffer.from('12345678901234567890')).update(step).digest();const offset=mac[19]&15;const code=String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
 assert.equal((await browser(a,{totpCode:code})).post.status,302);assert.equal((await browser(a,{totpCode:code})).post.status,401);
});
test('same refresh operation returns same encrypted result and original expiration',async()=>{
 const {t}=await login();const body=refreshBody(t);const [a,b]=await Promise.all([call('/api/mobile/v1/auth/refresh',body),call('/api/mobile/v1/auth/refresh',body)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.deepEqual(a.body.data,b.body.data);assert.equal(a.body.data.sessionId,t.sessionId);
 const row=await db.prepare('SELECT result FROM mobile_refresh_operations WHERE family_id=?').bind(t.tokenFamilyId).first();assert.ok(!row.result.includes(a.body.data.refreshToken));assert.ok(row.result.includes('test-v1'));
});
test('refresh with same ID changed body conflicts without revoking current session',async()=>{
 const {t}=await login();const body=refreshBody(t);const a=await call('/api/mobile/v1/auth/refresh',body);assert.equal(a.status,200);
 assert.equal((await call('/api/mobile/v1/auth/refresh',{...body,generation:2})).status,409);assert.equal((await call('/api/mobile/v1/me',undefined,auth(a.body.data))).status,200);
});
test('old operation superseded by next generation cannot return stale credentials',async()=>{
 const {t}=await login();const old=refreshBody(t);const first=(await call('/api/mobile/v1/auth/refresh',old)).body.data;const next=(await call('/api/mobile/v1/auth/refresh',refreshBody(first))).body.data;
 assert.equal((await call('/api/mobile/v1/auth/refresh',old)).status,409);assert.equal((await call('/api/mobile/v1/me',undefined,auth(next))).status,200);
});
test('spent token with new request ID revokes only its family; unknown token revokes none',async()=>{
 const {t}=await login(),other=await login();const first=(await call('/api/mobile/v1/auth/refresh',refreshBody(t))).body.data;
 assert.equal((await call('/api/mobile/v1/auth/refresh',refreshBody(t))).status,401);assert.equal((await call('/api/mobile/v1/me',undefined,auth(first))).status,401);
 assert.equal((await call('/api/mobile/v1/auth/refresh',{...refreshBody(other.t),refreshToken:secret()})).status,401);assert.equal((await call('/api/mobile/v1/me',undefined,auth(other.t))).status,200);
});
test('result expiry keeps operation tombstone; fixed-ID late retry does not revoke',async()=>{
 const {t}=await login(),body=refreshBody(t);const r=await call('/api/mobile/v1/auth/refresh',body);await db.prepare('UPDATE mobile_refresh_operations SET result_until=? WHERE family_id=?').bind(Date.now()-1,t.tokenFamilyId).run();await call('/fixture/maintenance',{now:Date.now()});
 assert.equal((await call('/api/mobile/v1/auth/refresh',body)).status,409);const row=await db.prepare('SELECT result FROM mobile_refresh_operations WHERE family_id=?').bind(t.tokenFamilyId).first();assert.equal(row.result,null);assert.equal((await call('/api/mobile/v1/me',undefined,auth(r.body.data))).status,200);
});
test('logout and password change reject replay and access',async()=>{
 const {t,a}=await login(),body=refreshBody(t);const r=await call('/api/mobile/v1/auth/refresh',body);await call('/api/mobile/v1/auth/logout',{},auth(r.body.data));assert.equal((await call('/api/mobile/v1/auth/refresh',body)).status,401);
 const again=await login(a);await db.prepare("UPDATE reader_password_credentials SET password_hash='fixture-changed-hash' WHERE account_id=?").bind(a.id).run();assert.equal((await call('/api/mobile/v1/me',undefined,auth(again.t))).status,401);
});
test('failure during refresh batch rolls back generation, token and operation',async()=>{
 const {t}=await login(),body=refreshBody(t);await db.prepare("CREATE TRIGGER fixture_refresh_failure BEFORE INSERT ON mobile_refresh_operations BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
 try{assert.equal((await call('/api/mobile/v1/auth/refresh',body)).status,503);const row=await db.prepare('SELECT generation FROM mobile_sessions WHERE id=?').bind(t.sessionId).first();assert.equal(row.generation,0);}finally{await db.prepare('DROP TRIGGER fixture_refresh_failure').run();}
 assert.equal((await call('/api/mobile/v1/auth/refresh',body)).status,200);
});
test('recent auth required before deletion prepare; no side effects',async()=>{
 const {t}=await login();const r=await call('/api/mobile/v1/me/deletion-requests/prepare',{deletionRequestId:randomUUID(),deletionReceiptHash:hash(randomBytes(32)),scopeVersion:'station-account-v1'},{...auth(t),'Idempotency-Key':randomUUID()});assert.equal(r.status,403);assert.equal(r.body.error.code,'RECENT_AUTH_REQUIRED');
});
test('lost prepare response recoverable with receipt; second device cannot replace task',async()=>{
 const {t,a}=await login(),d=await prepare(t);assert.equal((await status(d)).body.data.status,'prepared');assert.equal((await call('/api/mobile/v1/me',undefined,auth(t))).status,200);
 const again=await call('/api/mobile/v1/me/deletion-requests/prepare',d.body,{...auth(t),'Idempotency-Key':d.key});assert.equal(again.status,200);
 const other=(await login(a)).t;await reauth(other);const r=await call('/api/mobile/v1/me/deletion-requests/prepare',{...d.body,deletionRequestId:randomUUID()},{...auth(other),'Idempotency-Key':randomUUID()});assert.equal(r.status,409);
});
test('confirm atomically blocks account, web/native sessions and writes recoverable outbox',async()=>{
 const {t,a}=await login(),other=(await login(a)).t,d=await prepare(t);await db.prepare("INSERT INTO reader_sessions(account_id,session_hash,expires_at) VALUES(?,?,'2099-01-01')").bind(a.id,hash(secret())).run();
 assert.equal((await confirm(t,d)).status,202);assert.equal((await status(d)).body.data.status,'accepted');assert.equal((await call('/api/mobile/v1/me',undefined,auth(other))).status,401);
 const row=await db.prepare('SELECT status FROM reader_accounts WHERE id=?').bind(a.id).first();assert.equal(row.status,'deletion_pending');assert.equal((await db.prepare('SELECT count(*) AS n FROM reader_sessions WHERE account_id=? AND revoked_at IS NULL').bind(a.id).first()).n,0);
 await call('/fixture/maintenance',{now:Date.now()});const state=(await status(d)).body.data;assert.equal(state.status,'attention_required');assert.equal(state.stage,'retention_policy_review');assert.ok(!('accountId' in state));assert.equal(state.completedAt,null);
});
test('receipt query cannot access account or confirm; wrong receipt indistinguishable',async()=>{
 const {t}=await login(),d=await prepare(t);assert.equal((await call('/api/mobile/v1/me',undefined,{Authorization:'DeletionReceipt '+d.receipt})).status,401);
 assert.equal((await call(`/api/mobile/v1/me/deletion-requests/${d.id}/confirm`,{confirmedScopeVersion:'station-account-v1'},{Authorization:'DeletionReceipt '+d.receipt,'Idempotency-Key':randomUUID()})).status,401);
 assert.equal((await status({...d,receipt:secret()})).status,404);assert.equal((await status({...d,id:randomUUID()})).status,404);
});
test('outbox insert failure rolls back account block and all revocations',async()=>{
 const {t,a}=await login(),d=await prepare(t);await db.prepare("CREATE TRIGGER fixture_delete_failure BEFORE INSERT ON mobile_deletion_outbox BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
 try{assert.equal((await confirm(t,d)).status,503);assert.equal((await status(d)).body.data.status,'prepared');assert.equal((await call('/api/mobile/v1/me',undefined,auth(t))).status,200);assert.equal((await db.prepare('SELECT status FROM reader_accounts WHERE id=?').bind(a.id).first()).status,'active');}finally{await db.prepare('DROP TRIGGER fixture_delete_failure').run();}
 assert.equal((await confirm(t,d)).status,202);
});
test('expired preparation never deletes account; expired receipt always 404',async()=>{
 const {t}=await login(),d=await prepare(t);await db.prepare('UPDATE mobile_deletions SET prepare_until=? WHERE id=?').bind(Date.now()-1,d.id).run();assert.equal((await status(d)).body.data.status,'preparation_expired');assert.equal((await confirm(t,d)).status,409);assert.equal((await call('/api/mobile/v1/me',undefined,auth(t))).status,200);
 await db.prepare('UPDATE mobile_deletions SET receipt_until=? WHERE id=?').bind(Date.now()-1,d.id).run();assert.equal((await status(d)).status,404);
});
test('receipt survives account removal; query DB failure is not completion',async()=>{
 const {t,a}=await login(),d=await prepare(t);await confirm(t,d);await db.prepare('DELETE FROM mobile_codes WHERE account_id=?').bind(a.id).run();await db.prepare('DELETE FROM mobile_sessions WHERE account_id=?').bind(a.id).run();await db.prepare('DELETE FROM reader_accounts WHERE id=?').bind(a.id).run();assert.equal((await status(d)).body.data.status,'accepted');
});
test('body limit and login rate limiter reject before credential work',async()=>{
 assert.equal((await call('/api/mobile/v1/auth/token',{payload:'x'.repeat(9000)})).status,413);
 const a=await account();for(let i=0;i<5;i++)assert.equal((await browser(a,{password:'wrong'})).post.status,401);assert.equal((await browser(a,{password:'wrong'})).post.status,429);
});
test('refresh-proof logout revokes the family even after access token rotates',async()=>{
 const {t}=await login();const next=(await call('/api/mobile/v1/auth/refresh',refreshBody(t))).body.data;
 assert.equal((await call('/api/mobile/v1/auth/logout',{refreshToken:t.refreshToken})).status,200);
 assert.equal((await call('/api/mobile/v1/me',undefined,auth(next))).status,401);
 assert.equal((await call('/api/mobile/v1/auth/logout',{refreshToken:secret()})).status,200);
});
test('factor configuration changes revoke native access and refresh',async()=>{
 const {t,a}=await login();await db.prepare("INSERT INTO reader_totp_credentials(account_id,secret_base32,enabled_at) VALUES(?,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',CURRENT_TIMESTAMP)").bind(a.id).run();
 assert.equal((await call('/api/mobile/v1/me',undefined,auth(t))).status,401);assert.equal((await call('/api/mobile/v1/auth/refresh',refreshBody(t))).status,401);
});
test('JSON parse errors are 400; malformed or oversized credentials never authorize',async()=>{
 const r=await mf.dispatchFetch(origin+'/api/mobile/v1/auth/token',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);
 assert.equal((await call('/api/mobile/v1/auth/token',{clientId:'station-cat-ios',code:secret(),codeVerifier:secret(),redirectUri:redirect,extra:'ignored?'})).status,400);
});
test('query failure is 503 and cannot imply deletion completed',async()=>{
 const {t}=await login(),d=await prepare(t);await db.prepare('ALTER TABLE mobile_deletions RENAME TO mobile_deletions_unavailable').run();
 try{const r=await status(d);assert.equal(r.status,503);assert.equal(r.body.error.code,'SERVICE_UNAVAILABLE');assert.equal(r.body.data,undefined);}finally{await db.prepare('ALTER TABLE mobile_deletions_unavailable RENAME TO mobile_deletions').run();}
});
test('cross-account confirmation fails without blocking either account',async()=>{
 const a=await login(),b=await login(),d=await prepare(a.t);await reauth(b.t);assert.equal((await confirm(b.t,d)).status,409);
 assert.equal((await call('/api/mobile/v1/me',undefined,auth(a.t))).status,200);assert.equal((await call('/api/mobile/v1/me',undefined,auth(b.t))).status,200);
});
test('native registration uses existing rules without issuing a web or native session',async()=>{
 const fake={name:'register-'+randomUUID()},b=await browser(fake,{password:'wrong'});assert.equal(b.post.status,401);
 const name='new-'+randomUUID().slice(0,16);
 const r=await mf.dispatchFetch(origin+'/auth/mobile/register',{method:'POST',headers:{Origin:origin,Cookie:b.cookie,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':`192.0.2.${++ip}`},body:new URLSearchParams({flow:b.flow,locale:'en',username:name,email:name+'@example.test',password:pass}).toString()});
 assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);const a=await db.prepare('SELECT id FROM reader_accounts WHERE normalized_email=?').bind(name+'@example.test').first();assert.ok(a);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM reader_sessions WHERE account_id=?').bind(a.id).first()).n,0);assert.equal((await db.prepare('SELECT count(*) AS n FROM mobile_sessions WHERE account_id=?').bind(a.id).first()).n,0);
 await login({id:a.id,name});
});
test('native password recovery cannot bypass existing TOTP rules',async()=>{
 const {t,a}=await login(),b=await browser(a,{password:'wrong'});const r=await mf.dispatchFetch(origin+'/auth/mobile/reset',{method:'POST',headers:{Origin:origin,Cookie:b.cookie,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':`192.0.2.${++ip}`},body:new URLSearchParams({flow:b.flow,locale:'en',identifier:a.name,password:'Different-fixture!',totpCode:'123456',token:'untrusted-token'}).toString()});
 assert.equal(r.status,400);assert.equal((await call('/api/mobile/v1/me',undefined,auth(t))).status,200);
});

test('durable refresh result survives isolate restart and encryption key rotation',async()=>{
 const {t}=await login(),body=refreshBody(t);
 const first=await call('/api/mobile/v1/auth/refresh',body);assert.equal(first.status,200);
 const keys=JSON.parse(runtimeOptions.bindings.MOBILE_RESULT_KEYS_JSON);keys['test-v2']=secret();
 await mf.dispose();
 runtimeOptions={...runtimeOptions,bindings:{...runtimeOptions.bindings,MOBILE_RESULT_KEY_VERSION:'test-v2',MOBILE_RESULT_KEYS_JSON:JSON.stringify(keys)}};
 mf=new Miniflare(runtimeOptions);db=await mf.getD1Database('WAITLIST_DB');
 const replay=await call('/api/mobile/v1/auth/refresh',body);assert.equal(replay.status,200);assert.deepEqual(replay.body.data,first.body.data);
 const nextBody=refreshBody(replay.body.data);const next=await call('/api/mobile/v1/auth/refresh',nextBody);assert.equal(next.status,200);
 const rows=await db.prepare('SELECT request_id,result FROM mobile_refresh_operations WHERE family_id=?').bind(t.tokenFamilyId).all();
 assert.equal(JSON.parse(rows.results.find(r=>r.request_id===nextBody.refreshRequestId).result).keyVersion,'test-v2');
 assert.equal((await call('/api/mobile/v1/me',undefined,auth(next.body.data))).status,200);
});

test('native TOTP password reset changes password and creates no replacement web session',async()=>{
 const a=await account(),b=await browser(a,{password:'wrong'});
 await db.prepare('INSERT INTO reader_totp_credentials(account_id,secret_base32,verified_at,enabled_at) VALUES(?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').bind(a.id,'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').run();
 await db.prepare("INSERT INTO reader_sessions(account_id,session_hash,expires_at) VALUES(?,?,'2099-01-01')").bind(a.id,hash(secret())).run();
 const step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const mac=createHmac('sha1',Buffer.from('12345678901234567890')).update(step).digest(),offset=mac[19]&15;
 const code=String((mac.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0'),password='Replacement-fixture!';
 const r=await mf.dispatchFetch(origin+'/auth/mobile/reset',{method:'POST',headers:{Origin:origin,Cookie:b.cookie,'Content-Type':'application/x-www-form-urlencoded','CF-Connecting-IP':`192.0.2.${++ip}`},body:new URLSearchParams({flow:b.flow,locale:'en',identifier:a.name,password,totpCode:code}).toString()});
 assert.equal(r.status,200,await r.clone().text());assert.equal(r.headers.get('set-cookie'),null);
 const credential=await db.prepare('SELECT * FROM reader_password_credentials WHERE account_id=?').bind(a.id).first();
 assert.equal(credential.password_hash,pbkdf2Sync(password,credential.password_salt,credential.password_iterations,32,'sha256').toString('hex'));
 assert.equal((await db.prepare('SELECT count(*) AS n FROM reader_sessions WHERE account_id=? AND revoked_at IS NULL').bind(a.id).first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM mobile_sessions WHERE account_id=?').bind(a.id).first()).n,0);
});
