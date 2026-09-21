import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {__readerTotpTestHooks as commentHooks} from '../src/worker.js';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {claimDeletion,runDeletionStep,planDeletion} from './isolated-lifecycle/executor.js';
import {deletionDTO,confirmDeletion} from '../src/mobile/deletion.js';
const options={environment:'isolated',dataset:'synthetic-r1'};let mf,db;
const now=Date.now(),owner=()=>randomUUID(),persist=mkdtempSync(join(tmpdir(),'r1-lifecycle-'));
async function start(){
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No HTTP execution entry",{status:404})}}',compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{DB:'synthetic-lifecycle'},d1Persist:persist,outboundService:()=>new Response('',{status:503})});
 db=await mf.getD1Database('DB');
}
async function migrate(files){
 const parser=new DatabaseSync(':memory:');
 for(const file of files){let sql=readFileSync(file,'utf8');while(sql.trim()){
  const statement=parser.prepare(sql);statement.run();await db.prepare(statement.sourceSQL).run();sql=sql.slice(statement.sourceSQL.length);
 }}parser.close();
}
before(async()=>{
 await start();
 await migrate([...['migrations','migrations-mobile'].flatMap(dir=>readdirSync(dir).filter(x=>x.endsWith('.sql')).sort().map(x=>dir+'/'+x)),'scripts/isolated-lifecycle/schema.sql']);
 await db.prepare("INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1')").run();
});
after(async()=>{await mf?.dispose();rmSync(persist,{recursive:true,force:true});});
async function fixture({bulk=0}={}){
 const id=randomUUID(),email=id+'@example.test';
 const account=(await db.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,'Synthetic').first()).id;
 await db.prepare("INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(?,?,?,'fixture','salt',100000)").bind(account,id,id).run();
 await db.prepare("INSERT INTO reader_credit_accounts(account_id,balance_credits) VALUES(?,100)").bind(account).run();
 await db.prepare("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,source) VALUES(?,'purchase',100,100,'fixture')").bind(account).run();
 await db.prepare('INSERT INTO mobile_music_state(account_id) VALUES(?)').bind(account).run();
 await db.prepare("INSERT INTO mobile_music_operations VALUES(?,'op','digest','{}',?)").bind(account,now).run();
 await db.prepare("INSERT INTO mobile_music_favorites VALUES(?,'track',0,1,?)").bind(account,now).run();
 for(const status of ['approved','pending','hidden'])await db.prepare("INSERT INTO reader_comments(id,account_id,series_slug,chapter_slug,body,status,metadata_json,ip_hash,reviewed_by) VALUES(?,?,'s','c','Synthetic comment',?,'{\"email\":\"private\"}','ip','admin')").bind(id+status,account,status).run();
 await db.prepare("INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,confirm_id,confirmed_at,stage) VALUES(?,?,?,'hash','station-account-v1',?,?,'accepted',?,?,'queued')").bind(id,account,randomUUID(),now+1000,now+100000,randomUUID(),now).run();
 if(bulk)await db.batch(Array.from({length:bulk},(_,i)=>db.prepare("INSERT INTO mobile_music_operations VALUES(?,?,?,'{}',?)").bind(account,'bulk-'+i,'digest-'+i,now)));
 await db.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").bind(account).run();
 await db.prepare('INSERT INTO mobile_deletion_outbox(job_id,updated_at) VALUES(?,?)').bind(id,now).run();
 return {id,account,email};
}
async function finish(f){for(let i=0;i<80;i++){const t=await claimDeletion(db,f.id,owner(),now,options);if(!t)return;const r=await runDeletionStep(db,t,now,options);if(r.personalCleanupVerified)return;}throw Error('No progress');}
test('dry run is read only; isolation and explicit confirmation required',async()=>{
 const f=await fixture();const plan=await planDeletion(db,f.id,options);assert.equal(plan.counts.reader_comments,3);
 assert.equal((await db.prepare('SELECT count(*) n FROM r1_deletion_jobs').first()).n,0);
 await assert.rejects(()=>claimDeletion(db,f.id,owner(),now,{...options,environment:'production'}),/ISOLATION/);
 await db.prepare("UPDATE mobile_deletions SET status='prepared',confirmed_at=NULL WHERE id=?").bind(f.id).run();
 await assert.rejects(()=>claimDeletion(db,f.id,owner(),now,options),/CONFIRMATION/);
});
test('exact account cleanup, anonymous moderation states, finances unchanged, receipt remains incomplete',async()=>{
 const a=await fixture(),b=await fixture();await finish(a);
 for(const table of ['reader_password_credentials','mobile_music_state','mobile_music_operations','mobile_music_favorites']){
  assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE account_id=?`).bind(a.account).first()).n,0);
  assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE account_id=?`).bind(b.account).first()).n,1);
 }
 const comments=(await db.prepare('SELECT * FROM reader_comments WHERE id LIKE ? ORDER BY status').bind(a.id+'%').all()).results;
 assert.deepEqual(comments.map(x=>x.status),['approved','hidden','pending']);
 assert.ok(comments.every(x=>x.account_id===null&&x.metadata_json==='{}'&&x.ip_hash===''&&x.reviewed_by===''&&x.body==='Synthetic comment'));
 const publicRows=(await db.prepare(`SELECT reader_comments.*,reader_accounts.display_name,reader_accounts.email FROM reader_comments LEFT JOIN reader_accounts ON reader_accounts.id=reader_comments.account_id WHERE reader_comments.id LIKE ? AND reader_comments.status='approved'`).bind(a.id+'%').all()).results;
 assert.equal(publicRows.length,1);const publicComment=commentHooks.readerCommentToJson(publicRows[0]);assert.equal(publicComment.displayName,'匿名讀者');assert.equal(publicComment.body,'Synthetic comment');assert.equal(publicComment.accountId,undefined);
 assert.equal((await db.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=?').bind(a.account).first()).balance_credits,100);
 assert.equal((await db.prepare('SELECT credits_delta FROM reader_credit_ledger WHERE account_id=?').bind(a.account).first()).credits_delta,100);
 const dto=deletionDTO(await db.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(a.id).first(),now);
 assert.equal(dto.status,'attention_required');assert.equal(dto.completedAt,null);
 assert.equal((await db.prepare('SELECT personal_completed_at FROM r1_deletion_jobs WHERE id=?').bind(a.id).first()).personal_completed_at,now);
 const fresh=await db.prepare('INSERT INTO reader_accounts(email,normalized_email) VALUES(?,?) RETURNING id').bind(a.email,a.email).first();assert.notEqual(fresh.id,a.account);
 for(const sql of ["UPDATE reader_accounts SET status='active' WHERE id=?",'UPDATE reader_credit_accounts SET balance_credits=200 WHERE account_id=?','INSERT INTO mobile_music_state(account_id) VALUES(?)','DELETE FROM reader_accounts WHERE id=?'])await assert.rejects(()=>db.prepare(sql).bind(a.account).run());
});
test('expired lease and concurrent claim cannot double apply; new claimant resumes',async()=>{
 const f=await fixture();const claims=await Promise.all([claimDeletion(db,f.id,owner(),now,options),claimDeletion(db,f.id,owner(),now,options)]);
 assert.equal(claims.filter(Boolean).length,1);const old=claims.find(Boolean);
 const fresh=await claimDeletion(db,f.id,owner(),now+30001,options);assert.ok(fresh);
 await assert.rejects(()=>runDeletionStep(db,old,now+30001,options));
 await runDeletionStep(db,fresh,now+30001,options);
 assert.equal((await db.prepare('SELECT count(*) n FROM reader_password_credentials WHERE account_id=?').bind(f.account).first()).n,0);
 await assert.rejects(()=>runDeletionStep(db,fresh,now+30001,options));
 await finish(f);
});
test('injected database failure rolls back rows and checkpoint; restart retries same stage',async()=>{
 const f=await fixture(),t=await claimDeletion(db,f.id,owner(),now,options);
 await db.prepare(`CREATE TRIGGER r1_fault BEFORE DELETE ON reader_password_credentials WHEN OLD.account_id=${f.account} BEGIN SELECT RAISE(ABORT,'INJECTED'); END`).run();
 await assert.rejects(()=>runDeletionStep(db,t,now,options));
 assert.equal((await db.prepare('SELECT version FROM r1_deletion_jobs WHERE id=?').bind(f.id).first()).version,t.version);
 assert.ok(await db.prepare('SELECT account_id FROM reader_password_credentials WHERE account_id=?').bind(f.account).first());
 await db.prepare('DROP TRIGGER r1_fault').run();await runDeletionStep(db,t,now,options);await finish(f);
});
test('unknown schema fails before any mutation',async()=>{
 const f=await fixture();await db.prepare('CREATE TABLE unreviewed_private_data(account_id INTEGER)').run();
 await assert.rejects(()=>claimDeletion(db,f.id,owner(),now,options),/SCHEMA_DRIFT/);
 assert.equal(await db.prepare('SELECT id FROM r1_deletion_jobs WHERE id=?').bind(f.id).first(),null);
 await db.prepare('DROP TABLE unreviewed_private_data').run();
});
test('real confirmation still atomically freezes credentials under isolated write fences',async()=>{
 const id=randomUUID(),email=id+'@example.test';const account=(await db.prepare('INSERT INTO reader_accounts(email,normalized_email) VALUES(?,?) RETURNING id').bind(email,email).first()).id;
 await db.prepare("INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(?,?,?,'pw','s',100000)").bind(account,id,id).run();
 await db.prepare(`INSERT INTO mobile_sessions(id,family_id,account_id,generation,access_hash,access_until,refresh_until,absolute_until,authenticated_at,password_version,totp_version,recent_auth_at,recent_auth_totp_version) VALUES(?,?,?,0,?,?,?, ?,?,'pw','["",""]',?,'["",""]')`).bind(id,id,account,id,now+5000,now+10000,now+20000,now,now).run();
 await db.prepare("INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status) VALUES(?,?,?,'hash','station-account-v1',?,?,'prepared')").bind(id,account,id,now+1000,now+2000).run();
 const s=await db.prepare('SELECT * FROM mobile_sessions WHERE id=?').bind(id).first();
 const result=await confirmDeletion(db,s,id,{confirmedScopeVersion:'station-account-v1'},randomUUID(),now);
 assert.equal(result.status,'accepted');assert.equal((await db.prepare('SELECT revoked FROM mobile_sessions WHERE id=?').bind(id).first()).revoked,1);
 await finish({id,account});
});

test('persisted worker restart resumes after a committed chunk without rerunning finished work',async()=>{
 const f=await fixture(),t=await claimDeletion(db,f.id,owner(),now,options);await runDeletionStep(db,t,now,options);
 await mf.dispose();await start();
 assert.equal((await db.prepare('SELECT version FROM r1_deletion_jobs WHERE id=?').bind(f.id).first()).version,t.version+1);
 await assert.rejects(()=>runDeletionStep(db,t,now,options));await finish(f);
});
test('cleanup chunks are bounded and publisher/soft-link records remain untouched',async()=>{
 const f=await fixture({bulk:205});
 await db.prepare("INSERT INTO waitlist_entries(product,platform,email,normalized_email) VALUES('fixture','ios',?,?)").bind(f.email,f.email).run();
 const settings=(await db.prepare('SELECT * FROM waitlist_settings ORDER BY product,platform').all()).results;
 let t;for(let i=0;i<30;i++){t=await claimDeletion(db,f.id,owner(),now,options);if(t.stage==='private_data')break;await runDeletionStep(db,t,now,options);}
 // The operation table is eventually processed one chunk at a time; no claim deletes >200.
 for(let i=0;i<20;i++){
  const before=(await db.prepare('SELECT count(*) n FROM mobile_music_operations WHERE account_id=?').bind(f.account).first()).n;
  await runDeletionStep(db,t,now,options);
  const after=(await db.prepare('SELECT count(*) n FROM mobile_music_operations WHERE account_id=?').bind(f.account).first()).n;
  assert.ok(before-after<=200);if(before!==after){assert.equal(before,206);assert.equal(after,6);break;}
  t=await claimDeletion(db,f.id,owner(),now,options);
 }
 await finish(f);
 assert.ok(await db.prepare('SELECT id FROM waitlist_entries WHERE email=?').bind(f.email).first());
 assert.deepEqual((await db.prepare('SELECT * FROM waitlist_settings ORDER BY product,platform').all()).results,settings);

});

test('missing write fence prevents execution before any cleanup',async()=>{
 const f=await fixture();const guard=await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='r1_no_reactivation'").first();
 await db.prepare('DROP TRIGGER r1_no_reactivation').run();
 await assert.rejects(()=>claimDeletion(db,f.id,owner(),now,options),/GUARD_DRIFT/);
 assert.equal(await db.prepare('SELECT id FROM r1_deletion_jobs WHERE id=?').bind(f.id).first(),null);
 await db.prepare(guard.sql).run();
});
