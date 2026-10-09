import {build} from 'esbuild';import {Miniflare} from 'miniflare';import {fileURLToPath} from 'node:url';
import {contentOperationsStatements,seedContentAdminFixture} from './station-content-admin-fixture.mjs';
export const contentAdminActor='content-admin-fixture@example.test';
export async function createContentAdminRuntime({assets=()=>new Response(null,{status:404}),seed=seedContentAdminFixture}={}){
 const team='https://station-content-fixture.cloudflareaccess.com',aud='station-content-fixture-only';
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'station-content-fixture-key',alg:'RS256',use:'sig'};
 const token=async(patch={})=>{const b=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),raw=b({alg:'RS256',kid:jwk.kid})+'.'+b({iss:team,aud:[aud],email:contentAdminActor,exp:Math.floor(Date.now()/1000)+3600,...patch});return raw+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(raw))).toString('base64url');};
 const output=await build({entryPoints:[fileURLToPath(new URL('station-content-admin-runtime-worker.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
 const mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-05-17',host:'127.0.0.1',port:0,
  d1Databases:{MUSIC_DB:'station-content-local',WAITLIST_DB:'station-content-reader-local',EMPTY_DB:'station-content-empty-local'},r2Buckets:{MUSIC_BUCKET:'station-content-local'},
  bindings:{MUSIC_UPLOADS_ENABLED:'true',STATION_MEDIA_UPLOADS_ENABLED:'true',STATION_CONTENT_ADMIN_ENABLED:'true',STATION_CONTENT_SCHEDULES_ENABLED:'true',STATION_CONTENT_PUBLIC_ENABLED:'true',MUSIC_RATE_LIMIT_SECRET:'isolated-content-rate-limit-not-deployed',CF_ACCESS_TEAM_DOMAIN:team,CF_ACCESS_AUD:aud,ADMIN_ALLOWED_EMAILS:contentAdminActor+',second-content-fixture@example.test'},serviceBindings:{ASSETS:assets},
  outboundService:request=>new URL(request.url).href===team+'/cdn-cgi/access/certs'?Response.json({keys:[jwk]}):new Response('Outbound network disabled in local content fixture',{status:403})});
 try{const db=await mf.getD1Database('MUSIC_DB'),bucket=await mf.getR2Bucket('MUSIC_BUCKET');
  const groups=contentOperationsStatements();for(const g of groups)for(let i=0;i<g.statements.length;i+=20)await db.batch(g.statements.slice(i,i+20).map(sql=>db.prepare(sql)));
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE,applied_at TEXT)').run();
  for(const g of groups)await db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(g.name,new Date().toISOString()).run();
  await db.prepare("UPDATE music_settings SET value_json=? WHERE key='storageQuotaBytes'").bind(JSON.stringify(512*1048576)).run();
  const content=await seed(db,bucket);return {mf,db,bucket,content,token,actorToken:await token(),close:()=>mf.dispose()};
 }catch(e){await mf.dispose();throw e;}
}
