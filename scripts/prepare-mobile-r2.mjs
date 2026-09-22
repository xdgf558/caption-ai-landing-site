// Prepare local migration copies only. Remote commands must use the dedicated config.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const config=JSON.parse(readFileSync('wrangler.mobile-r2.jsonc'));
assert.equal(config.name,'station-cat-music-r2');
assert.equal(config.main,'src/mobile/isolatedWorker.js');
assert.equal(config.vars.MOBILE_ENVIRONMENT,'isolated');
assert.equal(config.vars.MOBILE_AUTH_ORIGIN,'https://station-cat-music-r2.yehao1105.workers.dev');
assert.equal(config.vars.MOBILE_REDIRECT_URI,config.vars.MOBILE_AUTH_ORIGIN+'/auth/mobile/callback');
assert.equal(config.preview_urls,false);
assert.equal(config.routes,undefined);
assert.equal(config.assets,undefined);
assert.deepEqual(config.r2_buckets,[{binding:'MUSIC_BUCKET',bucket_name:'station-cat-music-r2-audio'}]);
assert.equal(config.d1_databases.length,2);
for(const [index,kind] of ['reader','catalog'].entries()){
 const db=config.d1_databases[index];
 assert.equal(db.database_name,'station-cat-music-r2-'+kind);
 assert.equal(db.binding,index===0?'WAITLIST_DB':'MUSIC_DB');
 if(process.argv.includes('--require-provisioned'))assert.match(db.database_id,/^[a-f0-9-]{36}$/,'Unprovisioned R2 database; do not deploy.');
}
assert.notEqual(config.d1_databases[0].database_id,config.d1_databases[1].database_id);
const files=['migrations/0003_reader_accounts.sql','migrations/0009_reader_memberships.sql','migrations/0011_reader_password_credentials.sql','migrations/0012_reader_totp_credentials.sql','migrations/0013_reader_totp_reset_attempts.sql',...readdirSync('migrations-mobile').filter(x=>x.endsWith('.sql')).sort().map(x=>'migrations-mobile/'+x)];
mkdirSync('.generated/r2/reader-migrations',{recursive:true});
for(const [index,file] of files.entries())copyFileSync(file,`.generated/r2/reader-migrations/${String(index+1).padStart(4,'0')}_${file.replaceAll('/','_')}`);
writeFileSync('.generated/r2/migration-sources.json',JSON.stringify(files,null,2)+'\n');
console.log('R2 resource boundary checked; reader migration copies prepared. No remote writes.');
