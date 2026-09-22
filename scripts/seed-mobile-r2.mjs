// OFFLINE preparation only: fresh synthetic local D1/R2 -> private import files.
// Never imports production data and never deploys the local fixture Worker.
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes,pbkdf2Sync} from 'node:crypto';
import {setup,close,seed,music,bucket} from './helpers/mobile-music-fixture.mjs';
import {catalogImport} from './helpers/mobile-r2-import.mjs';
const dir='.generated/r2/private';
if(existsSync(dir+'/credentials.json'))throw new Error('Existing R2 seed retained. Do not regenerate IDs/passwords over an initialized environment.');
mkdirSync(dir,{recursive:true,mode:0o700});
const save=(name,data)=>writeFileSync(dir+'/'+name,data,{mode:0o600,flag:'wx'});
try {
 await setup();
 const free=await seed('free',null,'[00:00.00]R2 isolated synthetic audio\n[00:05.00]Playback and lyric verification only',true);
 const vip=await seed('vip',null,'[00:00.00]VIP authorization test\n[00:05.00]Synthetic audio only',true);
 await music.prepare("INSERT INTO music_featured_items(slot_kind,position,track_id) VALUES('primary',0,?)").bind(free.id).run();
 const tables=(await music.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'music_%' ORDER BY name").all()).results;
 const snapshot={};
 for(const {name} of tables){
  if(!/^music_[a-z_]+$/.test(name))throw new Error('Unexpected table');
  snapshot[name]=(await music.prepare(`SELECT * FROM ${name}`).all()).results;
 }
 save('catalog.sql',catalogImport(snapshot));
 const objects=[];
 for(const object of (await bucket.list()).objects){
  const stored=await bucket.get(object.key),file='object-'+objects.length;
  save(file,Buffer.from(await stored.arrayBuffer()));objects.push({key:object.key,file,contentType:stored.httpMetadata?.contentType||'application/octet-stream'});
 }
 save('objects.json',JSON.stringify(objects,null,2)+'\n');
 const credentials=[];let readerSQL='';
 for(const [index,role] of ['free','vip'].entries()){
  const id=index+1,username='r2tester-'+role,password=randomBytes(24).toString('base64url'),salt=randomBytes(24).toString('hex');
  const digest=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
  credentials.push({username,password,role});
  readerSQL+=`INSERT INTO reader_accounts(id,email,normalized_email,display_name) VALUES(${id},'${username}@example.test','${username}@example.test','R2 ${role} test');\n`;
  readerSQL+=`INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(${id},'${username}','${username}','${digest}','${salt}',100000);\n`;
  if(role==='vip')readerSQL+=`INSERT INTO reader_memberships(account_id,started_at,expires_at) VALUES(${id},'${new Date().toISOString()}','${new Date(Date.now()+7*86400000).toISOString()}');\n`;
 }
 save('reader.sql',readerSQL);save('credentials.json',JSON.stringify(credentials,null,2)+'\n');
 save('secrets.json',JSON.stringify({MOBILE_RESULT_KEYS_JSON:JSON.stringify({'r2-v1':randomBytes(32).toString('base64url')})})+'\n');
 // Public cover routes have their own HMAC-based limiter; use a separate R2-only secret.
 save('rate-limit-secrets.json',JSON.stringify({MUSIC_RATE_LIMIT_SECRET:randomBytes(32).toString('base64url')})+'\n');
 save('tracks.json',JSON.stringify({free:free.id,vip:vip.id},null,2)+'\n');
 console.log('Private offline R2 import files prepared: 2 synthetic tracks, 2 test accounts. No remote writes; secrets not printed.');
}finally{await close();}
