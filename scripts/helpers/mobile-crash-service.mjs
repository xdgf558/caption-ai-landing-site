// Test-only loopback bridge to the real isolated Worker/D1. Never deploy this file.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,mkdirSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,createHash,pbkdf2Sync,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {createDiagnostics} from './mobile-probe-diagnostics.mjs';
const state=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Pass a temporary private output directory');
mkdirSync(state,{recursive:true});
const diagnostics=createDiagnostics(join(state,'diagnostics.jsonl'));
const step=(phase,work)=>diagnostics.step(phase,work);
diagnostics.record('startup','start');
const origin='https://native.local.test',callback=origin+'/auth/mobile/callback';
const secret=()=>randomBytes(32).toString('base64url');
const sha=value=>createHash('sha256').update(value).digest('hex');
const nonce=secret(),dir=mkdtempSync(join(tmpdir(),'station-crash-d1-'));
const bundle=await build({entryPoints:['scripts/helpers/mobile-runtime-worker.js'],bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{WAITLIST_DB:'m2-crash-only'},d1Persist:dir,
 bindings:{MOBILE_ENVIRONMENT:'isolated',MOBILE_AUTH_ENABLED:'true',MOBILE_AUTH_ORIGIN:origin,MOBILE_REDIRECT_URI:callback,MOBILE_RESULT_KEY_VERSION:'probe',MOBILE_RESULT_KEYS_JSON:JSON.stringify({probe:secret()})},
 outboundService:()=>new Response('External requests disabled',{status:503})});
const db=await mf.getD1Database('WAITLIST_DB'),parser=new DatabaseSync(':memory:');
for(const file of ['migrations/0003_reader_accounts.sql','migrations/0011_reader_password_credentials.sql','migrations/0012_reader_totp_credentials.sql','migrations/0013_reader_totp_reset_attempts.sql','migrations-mobile/0001_native_auth.sql']){
 let sql=readFileSync(file,'utf8');const statements=[];
 while(sql.trim()){const statement=parser.prepare(sql),source=statement.sourceSQL;statement.run();statements.push(db.prepare(source));sql=sql.slice(source.length);}
 await db.batch(statements);
}
parser.close();
let active=null,ip=0,preparing=false,prepared=null;
const attemptedStages=new Set();
async function worker(path,body,headers={}){
 return mf.dispatchFetch(origin+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{'CF-Connecting-IP':`192.0.2.${++ip%250+1}`,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function seed(stage){
 if(!['A11','A12','A13'].includes(stage))throw new Error('Unsupported crash stage');
 const name='crash-'+randomUUID(),password=secret(),salt=secret();
 const a=await step('seed_account',()=>db.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(name+'@example.test',name+'@example.test',name).first());
 const passwordHash=await step('seed_password_hash',()=>pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'));
 await step('seed_password_write',()=>db.prepare('INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations,password_algorithm) VALUES(?,?,?,?,?,100000,?)').bind(a.id,name,name,passwordHash,salt,'PBKDF2-SHA256').run());
 const verifier=secret(),challenge=createHash('sha256').update(verifier).digest('base64url');
 const page=await step('authorize_get',()=>worker('/auth/mobile/authorize?'+new URLSearchParams({client_id:'station-cat-ios',redirect_uri:callback,state:secret(),code_challenge:challenge,code_challenge_method:'S256'})));
 const html=await step('authorize_body',()=>page.text()),flow=/name="flow" value="([^"]+)"/.exec(html)?.[1],cookie=page.headers.get('set-cookie')?.split(';')[0];
 if(page.status!==200||!flow||!cookie)throw new Error('Authorization setup failed');
 const authorized=await step('authorize_post',()=>mf.dispatchFetch(origin+'/auth/mobile/authorize',{method:'POST',redirect:'manual',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({flow,identifier:name,password,totpCode:'',locale:'en'}).toString()}));
 if(authorized.status!==302)throw new Error('Synthetic login failed');
 const code=new URL(authorized.headers.get('location')).searchParams.get('code');
 const r=await step('token_exchange',()=>worker('/api/mobile/v1/auth/token',{clientId:'station-cat-ios',code,codeVerifier:verifier,redirectUri:callback}));
 if(r.status!==200)throw new Error('Synthetic token exchange failed');
 const envelope=await step('token_body',()=>r.json());active={stage,family:envelope.data.tokenFamilyId,requests:[],held:false};await captureEvidence(active);return envelope;
}
async function captureEvidence(probe){
 // Read committed D1 rows once per mutation, in one batch. Never infer them from
 // the token response, and never issue D1 reads for a polling GET.
 const [sessions,operations]=await step('evidence_snapshot',()=>db.batch([
  db.prepare('SELECT generation,revoked FROM mobile_sessions WHERE family_id=?').bind(probe.family),
  db.prepare('SELECT request_id,old_generation FROM mobile_refresh_operations WHERE family_id=? ORDER BY old_generation').bind(probe.family)
 ]));
 const evidence={stage:probe.stage,held:probe.held,requests:probe.requests.map(r=>({...r})),session:sessions.results[0],operations:operations.results};
 // A single atomic replacement publishes only the complete coherent snapshot.
 writeFileSync(join(state,'evidence.tmp'),JSON.stringify(evidence),{mode:0o600});
 renameSync(join(state,'evidence.tmp'),join(state,'evidence.json'));
 probe.evidence=evidence;
}
const sockets=new Set();
function send(res,status,body,trace=true){if(trace)diagnostics.record('response','marker');res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
const server=createServer(async(req,res)=>{
 try{
  const supplied=Buffer.from(req.headers['x-probe-key']||''),expected=Buffer.from(nonce);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(res,403,{error:'Probe key required'});
  let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>16384)return send(res,413,{error:'Too large'});}
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  // One host-side preparation per stage, before launching the crash process.
  // A failed/ambiguous preparation is never replayed; terminate this fixture.
  if(path==='/fixture/prepare'&&req.method==='POST'){
   const stage=JSON.parse(body).stage;
   if(!['A11','A12','A13'].includes(stage))return send(res,400,{error:'Unsupported stage'});
   if(preparing||attemptedStages.has(stage))return send(res,409,{error:'Preparation already attempted'});
   preparing=true;attemptedStages.add(stage);prepared=null;active=null;
   try{const envelope=await seed(stage);prepared={stage,envelope};return send(res,200,{stage,ready:true});}
   finally{preparing=false;}
  }
  if(path==='/fixture/seed'&&req.method==='GET'){
   if(!prepared||prepared.stage!==url.searchParams.get('stage'))return send(res,409,{error:'Stage not prepared'});
   return send(res,200,prepared.envelope);
  }
  if(path==='/fixture/evidence'&&req.method==='GET'){
   if(!active?.evidence)return send(res,404,{error:'No probe'});
   return send(res,200,active.evidence,false);
  }
  if(path!=='/api/mobile/v1/auth/refresh'||req.method!=='POST'||!active)return send(res,404,{error:'Unsupported test route'});
  const payload=JSON.parse(body),result=await step('refresh',()=>worker(path,payload)),envelope=await step('refresh_body',()=>result.json());
  active.requests.push({requestId:payload.refreshRequestId,generation:payload.generation,status:result.status,resultFingerprint:sha(JSON.stringify(envelope.data||envelope.error)),resultGeneration:envelope.data?.generation,committedAt:Date.now()});
  const hold=active.stage==='A11'&&active.requests.length===1&&result.status===200;
  active.held ||= hold;await captureEvidence(active);
  if(hold){diagnostics.record('held','marker');return;} // Deliberately never send the committed response.
  return send(res,result.status,envelope);
 }catch(error){diagnostics.record('request','failed',error);send(res,500,{error:'Local probe failed'});}
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
writeFileSync(join(state,'ready.json'),JSON.stringify({port:server.address().port,key:nonce,origin}),{mode:0o600});
diagnostics.record('startup','done');
console.log('Local crash probe bridge ready; external traffic disabled.');
let stopping=false;
async function stop(){if(stopping)return;stopping=true;diagnostics.record('shutdown','start');for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await mf.dispose();rmSync(dir,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
