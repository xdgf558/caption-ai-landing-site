import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const origin='https://native.local.test',prefix='/api/mobile/v1',secret=()=>randomBytes(32).toString('base64url'),hash=x=>createHash('sha256').update(x).digest('hex');
export let mf,db,music,bucket;let ip=0;
async function migrate(db,files){const p=new DatabaseSync(':memory:');for(const file of files){let sql=readFileSync(file,'utf8');while(sql.trim()){const st=p.prepare(sql);st.run();await db.prepare(st.sourceSQL).run();sql=sql.slice(st.sourceSQL.length);}}p.close();}
export async function setup(){
 const bundle=await build({entryPoints:['scripts/helpers/mobile-music-worker.js'],bundle:true,format:'esm',platform:'browser',write:false});
 mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,
 d1Databases:{WAITLIST_DB:'m3-reader-only',MUSIC_DB:'m3-music-only'},r2Buckets:{MUSIC_BUCKET:'m3-synthetic-only'},bindings:{
 MOBILE_AUTH_ENABLED:'true',MOBILE_MUSIC_ENABLED:'true',MOBILE_ENVIRONMENT:'isolated',MOBILE_AUTH_ORIGIN:origin,MOBILE_REDIRECT_URI:origin+'/auth/mobile/callback',
 MOBILE_RESULT_KEY_VERSION:'fixture',MOBILE_RESULT_KEYS_JSON:JSON.stringify({fixture:secret()}),MUSIC_PUBLIC_ENABLED:'true',MUSIC_VIP_DELIVERY_ENABLED:'true'},
 outboundService:()=>new Response('No outbound',{status:503})});
 db=await mf.getD1Database('WAITLIST_DB');music=await mf.getD1Database('MUSIC_DB');bucket=await mf.getR2Bucket('MUSIC_BUCKET');
 await migrate(db,['migrations/0003_reader_accounts.sql','migrations/0009_reader_memberships.sql','migrations/0011_reader_password_credentials.sql','migrations/0012_reader_totp_credentials.sql',...readdirSync('migrations-mobile').sort().map(x=>'migrations-mobile/'+x)]);
 await migrate(music,readdirSync('migrations-music').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations-music/'+x));
}
export async function close(){await mf?.dispose();}
export const call=(path,{body,headers={},method=body?'POST':'GET'}={})=>mf.dispatchFetch(path.startsWith('https:')?path:origin+prefix+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.'+(++ip),...headers},...(body?{body:JSON.stringify(body)}:{})});
export async function account(vip=true,existing){
 let id=existing;const now=Date.now();
 if(!id){const email=randomUUID()+'@example.test';id=(await db.prepare("INSERT INTO reader_accounts(email,normalized_email,display_name,status) VALUES(?,?,'Fixture','active') RETURNING id").bind(email,email).first()).id;
 await db.prepare("INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(?,?,?,'synthetic-password','salt',100000)").bind(id,'fixture-'+id,'fixture-'+id).run();
 if(vip)await db.prepare("INSERT INTO reader_memberships(account_id,started_at,expires_at) VALUES(?,?,?)").bind(id,new Date(now-60000).toISOString(),new Date(now+86400000).toISOString()).run();}
 const token=secret(),sid=randomUUID(),family=randomUUID();await db.prepare(`INSERT INTO mobile_sessions(id,family_id,account_id,generation,access_hash,access_until,refresh_until,absolute_until,authenticated_at,password_version,totp_version) VALUES(?,?,?,0,?,?,?,?,?,'synthetic-password','["",""]')`).bind(sid,family,id,hash(token),now+300000,now+3600000,now+7200000,now).run();
 return {id,sid,token,headers:{Authorization:'Bearer '+token}};
}
export async function seed(mode='vip',freeUntil=null,lyricText=null){
 const manifest=JSON.parse(readFileSync('tests/fixtures/music-mp3/manifest.json')).files;
 const owner=randomUUID();const put=async(name,kind)=>{const m=manifest.find(f=>f.file===name),id=randomUUID(),key=`music/${kind==='audio'?'audio':'previews'}/${owner}/${id}.mp3`,data=readFileSync('tests/fixtures/music-mp3/'+name),o=await bucket.put(key,data,{httpMetadata:{contentType:'audio/mpeg'}});
 return {id,owner_track_id:owner,kind,object_key:key,state:'validated',format:'mp3',content_type:'audio/mpeg',byte_size:data.length,duration_ms:m.packetDurationMs,sha256:m.sha256,etag:o.etag};};
 const audio=await put('cbr-stereo.mp3','audio'),preview=await put('preview.mp3','preview');Object.assign(preview,{derived_from_asset_id:audio.id,source_start_ms:0,source_end_ms:1000});
 const res=await mf.dispatchFetch(origin+'/fixture/seed',{method:'POST',body:JSON.stringify({audio,preview,accessMode:mode,freeUntil})});const cmd=await res.json();
 assert.equal(res.status,200);
 if(lyricText!==null){
  const id=randomUUID(),key=`music/lyrics/${owner}/${id}.lrc`,bytes=Buffer.from(lyricText),o=await bucket.put(key,bytes,{httpMetadata:{contentType:'text/plain'}});
  await music.prepare("INSERT INTO music_assets(id,owner_track_id,kind,state,object_key,format,content_type,byte_size,sha256,etag,created_at) VALUES(?,?,'lyrics','validated',?,'lrc','text/plain',?,?,?,?)").bind(id,owner,key,bytes.length,hash(bytes),o.etag,Date.now()-1000).run();
  await music.prepare('UPDATE music_track_revisions SET lyrics_asset_id=? WHERE id=?').bind(id,cmd.revisionId).run();
 }
 await music.prepare("UPDATE music_track_revisions SET state='sealed' WHERE id=?").bind(cmd.revisionId).run();
 await music.prepare("UPDATE music_tracks SET lifecycle='published',draft_revision_id=NULL,published_revision_id=?,first_published_at=?,published_at=? WHERE id=?").bind(cmd.revisionId,Date.now()-500,Date.now()-500,owner).run();
 return {id:owner,audio,preview,revision:cmd.revisionId};
}
export async function grant(t,a,variant='full'){const r=await call(`/music/tracks/${t.id}/playback-grants`,{body:{audioVersion:1,variant},headers:a?.headers});const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));return j.data;}
export async function denied(path,options,status){const r=await call(path,options);assert.equal(r.status,status,await r.text());assert.equal(r.headers.get('x-fixture-r2-reads'),'0');}

