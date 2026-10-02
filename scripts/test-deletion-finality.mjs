import {test as nodeTest,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {claimDeletion,runDeletionStep,planDeletion} from './isolated-lifecycle/executor.js';
import {retentionSpecs,financialJsonShape} from './isolated-lifecycle/retention-plan.js';
import {prepareSyntheticCompletion,recordSyntheticCompletionReview,installSyntheticRestoreBarrier,
 assertSyntheticAccountRestorable,syntheticCompletionReadiness,claimSyntheticCompletion,finishSyntheticCompletion} from './isolated-lifecycle/finalizer.js';
import {requiredReviews} from './isolated-lifecycle/completion-contract.js';
import {deletionDTO,deletionStatus} from '../src/mobile/deletion.js';
import {encode,hashBytes} from '../src/mobile/security.js';
import {__readerTotpTestHooks as totpHooks} from '../src/worker.js';

const options={environment:'isolated',dataset:'synthetic-r1',completionProfile:'synthetic-finality-v1'};
const now=Date.now(),persist=mkdtempSync(join(tmpdir(),'r1-finality-'));
let mf,db;
function test(name,fn){return nodeTest(name,{timeout:120000},async()=>{
 console.log('FINALITY_CASE_START '+name);const start=performance.now();
 try{await fn();}finally{console.log('FINALITY_CASE_END '+JSON.stringify({name,durationMs:Math.round(performance.now()-start)}));}
});}
async function start(){
 mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No deletion HTTP entry",{status:404})}}',
  compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{DB:'synthetic-finality'},d1Persist:persist,
  outboundService:()=>new Response('',{status:503})});
 db=await mf.getD1Database('DB');
}
async function migrate(paths){
 const parser=new DatabaseSync(':memory:');
 for(const path of paths){let sql=readFileSync(path,'utf8');while(sql.trim()){
  const st=parser.prepare(sql);st.run();await db.prepare(st.sourceSQL).run();sql=sql.slice(st.sourceSQL.length);
 }}parser.close();
}
before(async()=>{
 await start();await migrate([...['migrations','migrations-mobile'].flatMap(dir=>readdirSync(dir).filter(x=>x.endsWith('.sql')).sort().map(x=>dir+'/'+x)),
  'scripts/isolated-lifecycle/schema.sql','scripts/isolated-lifecycle/completion-schema.sql']);
 await db.prepare("INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1')").run();
},{timeout:60000});
after(async()=>{await mf?.dispose();rmSync(persist,{recursive:true,force:true});},{timeout:30000});

function policy(){return {
 version:'synthetic-finality-test-v1',approved:true,environment:'isolated',dataset:'synthetic-r1',
 jurisdiction:'fictional-test-jurisdiction',basis:'synthetic-only-not-an-operational-policy',financialDays:30,receiptDays:14,
 tables:Object.fromEntries(Object.entries(retentionSpecs).map(([table,s])=>[table,{scope:'exact-account-links',retainColumns:[...s.retainColumns],reviewColumns:[...s.reviewColumns]}])),
 jsonShapes:Object.fromEntries(Object.entries(retentionSpecs).flatMap(([table,s])=>s.reviewColumns.filter(c=>s.classifications[c]==='raw_json')
  .map(c=>[`${table}.${c}`,[financialJsonShape({}),financialJsonShape(null)]])))
};}
async function fixture({dirty=false,freeze=true}={}){
 const id=randomUUID(),email=id+'@example.test';
 const account=(await db.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,'Synthetic').first()).id;
 await db.prepare('INSERT INTO reader_credit_accounts(account_id,balance_credits) VALUES(?,100)').bind(account).run();
 await db.prepare("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,source,metadata_json) VALUES(?,'purchase',100,100,'synthetic',?)")
  .bind(account,dirty?' {"email":"private@example.test"}':'{}').run();
 await db.prepare("INSERT INTO mobile_music_state(account_id) VALUES(?)").bind(account).run();
 const receipt=crypto.getRandomValues(new Uint8Array(32));
 await db.prepare(`INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,confirm_id,confirmed_at,stage)
  VALUES(?,?,?,?,'station-account-v1',?,?,'accepted',?,?,'queued')`).bind(id,account,randomUUID(),await hashBytes(receipt),now+1000,now+14*86400_000,randomUUID(),now).run();
 await db.prepare('INSERT INTO mobile_deletion_outbox(job_id,updated_at) VALUES(?,?)').bind(id,now).run();
 await db.prepare("INSERT INTO reader_totp_reset_attempts(scope,scope_key) VALUES('account',?)").bind(String(account)).run();
 await db.prepare("INSERT INTO reader_totp_reset_attempts(scope,scope_key) VALUES('ip',?)").bind('unrelated-'+id).run();
 if(freeze)await db.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").bind(account).run();
 return {id,account,receipt,policy:policy()};
}
async function personal(f){for(let i=0;i<80;i++){
 const t=await claimDeletion(db,f.id,randomUUID(),now,options);assert.ok(t);
 const r=await runDeletionStep(db,t,now,options);if(r.personalCleanupVerified)return;
}throw Error('personal cleanup stalled');}
async function reviewed(f){
 const {policyDigest}=await prepareSyntheticCompletion(db,f.id,f.policy,now,options);f.policyDigest=policyDigest;
 for(const category of requiredReviews)await recordSyntheticCompletionReview(db,f.id,{
  category,policyDigest,scopeVersion:'station-account-v1',confirmedAt:now,
  evidenceDigest:createHash('sha256').update('synthetic evidence '+f.id+category).digest('hex'),reviewerRef:'synthetic-review-fixture'
 },now,options);
 await installSyntheticRestoreBarrier(db,f.id,now,options);
}
async function dto(f){return deletionDTO(await db.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(f.id).first(),now);}

test('account-scoped TOTP reset is counted and deleted; other accounts and unrelated scopes survive',async()=>{
 const a=await fixture(),b=await fixture();
 assert.equal((await planDeletion(db,a.id,options)).counts.reader_totp_reset_attempts,1);
 let max=0;
 for(let i=0;i<80;i++){
  const before=(await db.prepare("SELECT count(*) n FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(a.account)).first()).n;
  const t=await claimDeletion(db,a.id,randomUUID(),now,options),r=await runDeletionStep(db,t,now,options);
  const after=(await db.prepare("SELECT count(*) n FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(a.account)).first()).n;
  max=Math.max(max,before-after);assert.ok(before-after<=200);if(r.personalCleanupVerified)break;
 }
 assert.equal(max,1);
 assert.ok(await db.prepare("SELECT id FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(b.account)).first());
 assert.ok(await db.prepare("SELECT id FROM reader_totp_reset_attempts WHERE scope='ip' AND scope_key=?").bind('unrelated-'+a.id).first());
 assert.equal((await dto(a)).completedAt,null);
});

test('TOTP write fences reject inactive account writes and scope moves without blocking active or non-account limits',async()=>{
 const frozen=await fixture(),active=await fixture({freeze:false}),epoch=Math.floor(now/1000);
 const row=await db.prepare("SELECT * FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(frozen.account)).first();
 // Exercise the product UPSERT and its separate lock UPDATE while an old row still exists.
 await assert.rejects(()=>totpHooks.reserveReaderTotpResetAttempt(db,[{scope:'account',key:String(frozen.account)}],epoch),/R1_INACTIVE_ACCOUNT/);
 await assert.rejects(()=>db.prepare('UPDATE reader_totp_reset_attempts SET locked_until_epoch=? WHERE id=?').bind(epoch+60,row.id).run(),/R1_INACTIVE_ACCOUNT/);
 await assert.rejects(()=>db.prepare("UPDATE reader_totp_reset_attempts SET scope='ip' WHERE id=?").bind(row.id).run(),/R1_INACTIVE_ACCOUNT/);
 await assert.rejects(()=>db.prepare("UPDATE reader_totp_reset_attempts SET scope='account',scope_key=? WHERE scope='ip' AND scope_key=?")
  .bind(String(frozen.account),'unrelated-'+frozen.id).run(),/R1_INACTIVE_ACCOUNT/);
 assert.deepEqual(await db.prepare('SELECT * FROM reader_totp_reset_attempts WHERE id=?').bind(row.id).first(),row);
 await db.prepare('DELETE FROM reader_totp_reset_attempts WHERE id=?').bind(row.id).run();
 await assert.rejects(()=>db.prepare("INSERT INTO reader_totp_reset_attempts(scope,scope_key) VALUES('account',?)").bind(String(frozen.account)).run(),/R1_INACTIVE_ACCOUNT/);
 // Active account requests still increment and eventually lock; other scopes are not account identities.
 let result;
 for(let i=0;i<=totpHooks.readerTotpResetFailureThreshold;i++)result=await totpHooks.reserveReaderTotpResetAttempt(db,[{scope:'account',key:String(active.account)}],epoch);
 assert.equal(result.ok,false);assert.ok(result.retryAfterSeconds>0);
 for(const scope of ['ip','ip_ua','identifier_ip']){
  const key='independent-'+scope+'-'+frozen.id;
  assert.equal((await totpHooks.reserveReaderTotpResetAttempt(db,[{scope,key}],epoch)).ok,true);
  assert.equal((await totpHooks.reserveReaderTotpResetAttempt(db,[{scope,key}],epoch)).ok,true);
  assert.equal((await db.prepare('SELECT failure_count FROM reader_totp_reset_attempts WHERE scope=? AND scope_key=?').bind(scope,key).first()).failure_count,2);
 }
});

test('an in-flight product TOTP reset cannot recreate account counters after completed deletion or restart',async()=>{
 const f=await fixture({freeze:false});
 // Match the product order: read the active account, then reserve its TOTP reset limit.
 const captured=await db.prepare("SELECT id FROM reader_accounts WHERE id=? AND status='active'").bind(f.account).first();
 assert.ok(captured);
 let signalEntered,release;
 const entered=new Promise(resolve=>{signalEntered=resolve;}),resume=new Promise(resolve=>{release=resolve;});
 let intercepted=false;
 const paused={prepare(sql){
  const statement=db.prepare(sql);
  if(!sql.includes('INSERT INTO reader_totp_reset_attempts'))return statement;
  return {bind(...args){const bound=statement.bind(...args);return {async run(){
   assert.equal(intercepted,false);intercepted=true;signalEntered();await resume;return bound.run();
  }};}};
 }};
 const inFlight=totpHooks.reserveReaderTotpResetAttempt(paused,[{scope:'account',key:String(captured.id)}],Math.floor(now/1000));
 // Install a rejection handler before releasing the pending request.
 const rejected=assert.rejects(inFlight,/R1_INACTIVE_ACCOUNT/);
 await entered;
 try{
  await db.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").bind(f.account).run();
  await personal(f);await reviewed(f);
  const ticket=await claimSyntheticCompletion(db,f.id,randomUUID(),now,options);
  assert.equal((await finishSyntheticCompletion(db,ticket,now,options)).accountDeletionCompleted,true);
 }finally{release();}
 await rejected;assert.equal(intercepted,true);
 const completed=await dto(f);assert.equal(completed.status,'completed');
 assert.equal((await db.prepare("SELECT count(*) n FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(f.account)).first()).n,0);
 // The database fence remains effective after the process that completed deletion exits.
 await mf.dispose();await start();
 await assert.rejects(()=>totpHooks.reserveReaderTotpResetAttempt(db,[{scope:'account',key:String(captured.id)}],Math.floor(now/1000)),/R1_INACTIVE_ACCOUNT/);
 await assert.rejects(()=>db.prepare("UPDATE reader_totp_reset_attempts SET scope='account',scope_key=? WHERE scope='ip' AND scope_key=?")
  .bind(String(f.account),'unrelated-'+f.id).run(),/R1_INACTIVE_ACCOUNT/);
 assert.equal((await db.prepare("SELECT count(*) n FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(f.account)).first()).n,0);
 assert.deepEqual(await dto(f),completed);
});

test('personal completion alone and the real unapproved draft cannot unlock finality',async()=>{
 const f=await fixture();await personal(f);
 const r=await syntheticCompletionReadiness(db,f.id,now,options);
 assert.equal(r.ready,false);assert.ok(r.blockers.includes('RETENTION_POLICY_REQUIRED'));
 const draft=JSON.parse(readFileSync('docs/mobile-ios-m2/deletion-plan/policy-draft.json','utf8'));
 await assert.rejects(()=>prepareSyntheticCompletion(db,f.id,draft,now,options),/POLICY_NOT_APPROVED/);
 await assert.rejects(()=>prepareSyntheticCompletion(db,f.id,f.policy,now,{...options,environment:'production'}),/ISOLATION/);
 await assert.rejects(()=>prepareSyntheticCompletion(db,f.id,f.policy,now,{...options,completionProfile:undefined}),/FINALITY_PROFILE/);
 assert.equal((await dto(f)).status,'attention_required');
});

test('policy pinning, receipt coverage and scoped reviews reject incorrect or future evidence',async()=>{
 const f=await fixture();await personal(f);
 const {policyDigest}=await prepareSyntheticCompletion(db,f.id,f.policy,now,options);
 const changed=structuredClone(f.policy);changed.financialDays++;
 await assert.rejects(()=>prepareSyntheticCompletion(db,f.id,changed,now,options),/POLICY_CHANGED/);
 const short=structuredClone(f.policy);short.receiptDays=1;
 const g=await fixture();await personal(g);
 await assert.rejects(()=>prepareSyntheticCompletion(db,g.id,short,now,options),/RETENTION_PERIOD/);
 const review={category:'providers',policyDigest,scopeVersion:'station-account-v1',confirmedAt:now,evidenceDigest:'a'.repeat(64),reviewerRef:'synthetic-review-fixture'};
 for(const mutation of [{confirmedAt:now-1},{policyDigest:'b'.repeat(64)},{scopeVersion:'other'},{category:'payments'},{reviewerRef:'person@example.test'}])
  await assert.rejects(()=>recordSyntheticCompletionReview(db,f.id,{...review,...mutation},now,options),/INVALID_REVIEW/);
 await assert.rejects(()=>recordSyntheticCompletionReview(db,f.id,review,now-1,options),/INVALID_REVIEW/);
 assert.equal((await db.prepare('SELECT count(*) n FROM r1_completion_reviews WHERE job_id=?').bind(f.id).first()).n,0);
});

test('missing or stale external reviews and backup barriers remain observable and incomplete',async()=>{
 const f=await fixture();await personal(f);await prepareSyntheticCompletion(db,f.id,f.policy,now,options);
 let ticket=await claimSyntheticCompletion(db,f.id,randomUUID(),now,options);
 const result=await finishSyntheticCompletion(db,ticket,now,options);
 assert.equal(result.accountDeletionCompleted,false);assert.ok(result.blockers.includes('REVIEW_REQUIRED_PROVIDERS'));
 assert.ok(result.blockers.includes('RESTORE_BARRIER_REQUIRED'));assert.equal((await dto(f)).completedAt,null);
 await reviewed(f);
 const stale=await syntheticCompletionReadiness(db,f.id,now+300001,options);
 assert.equal(stale.ready,false);assert.ok(stale.blockers.includes('REVIEW_REQUIRED_BACKUPS'));
 assert.equal((await dto(f)).status,'attention_required');
});

test('raw retained personal fields block completion without changing balance, ledger or payload',async()=>{
 const f=await fixture({dirty:true});await personal(f);
 f.policy.jsonShapes['reader_credit_ledger.metadata_json'].push(financialJsonShape({email:'shape-only'}));
 await reviewed(f);
 const before=await db.prepare('SELECT * FROM reader_credit_ledger WHERE account_id=?').bind(f.account).first();
 const ticket=await claimSyntheticCompletion(db,f.id,randomUUID(),now,options);
 const result=await finishSyntheticCompletion(db,ticket,now,options);
 assert.ok(result.blockers.includes('FINANCIAL_MINIMIZATION_REQUIRED'));assert.equal(result.accountDeletionCompleted,false);
 assert.deepEqual(await db.prepare('SELECT * FROM reader_credit_ledger WHERE account_id=?').bind(f.account).first(),before);
 assert.equal((await db.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=?').bind(f.account).first()).balance_credits,100);
});

test('synthetic minimal-data completion is atomic, receipt-only, and cannot affect another account',async()=>{
 const f=await fixture(),other=await fixture();await personal(f);await reviewed(f);
 const ticket=await claimSyntheticCompletion(db,f.id,randomUUID(),now,options),r=await finishSyntheticCompletion(db,ticket,now,options);
 assert.equal(r.accountDeletionCompleted,true);assert.equal(r.productionEnabled,false);
 const request=new Request('https://isolated.invalid/status',{headers:{authorization:'DeletionReceipt '+encode(f.receipt)}});
 const status=await deletionStatus(db,request,f.id,now);
 assert.equal(status.status,'completed');assert.equal(status.confirmAccepted,true);assert.equal(status.completedAt,new Date(now).toISOString());
 assert.deepEqual(Object.keys(status).sort(),['completedAt','confirmAccepted','confirmedAt','deletionRequestId','receiptExpiresAt','stage','status']);
 assert.equal((await dto(other)).status,'accepted');
 assert.equal((await db.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=?').bind(f.account).first()).balance_credits,100);
 assert.equal(await claimSyntheticCompletion(db,f.id,randomUUID(),now,options),null);
 await assert.rejects(()=>finishSyntheticCompletion(db,ticket,now,options));
 assert.equal((await db.prepare('SELECT status FROM mobile_deletion_outbox WHERE job_id=?').bind(f.id).first()).status,'completed');
 await assert.rejects(()=>deletionStatus(db,request,other.id,now),/DELETION_STATUS_UNAVAILABLE/);
 await assert.rejects(()=>deletionStatus(db,request,f.id,now+14*86400_000),/DELETION_STATUS_UNAVAILABLE/);
});

test('lease takeover, persisted restart and transaction failure do not report partial completion',async()=>{
 const f=await fixture();await personal(f);await reviewed(f);
 const old=await claimSyntheticCompletion(db,f.id,randomUUID(),now,options);
 assert.equal(await claimSyntheticCompletion(db,f.id,randomUUID(),now,options),null);
 await mf.dispose();await start();
 const fresh=await claimSyntheticCompletion(db,f.id,randomUUID(),now+30001,options);
 assert.ok(fresh);await assert.rejects(()=>finishSyntheticCompletion(db,old,now+30001,options));
 await db.prepare(`CREATE TRIGGER finality_fault BEFORE UPDATE ON mobile_deletion_outbox WHEN OLD.job_id='${f.id}' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_FAULT'); END`).run();
 await assert.rejects(()=>finishSyntheticCompletion(db,fresh,now+30001,options));
 assert.equal((await dto(f)).completedAt,null);assert.equal((await db.prepare('SELECT version FROM r1_completion_jobs WHERE id=?').bind(f.id).first()).version,fresh.version);
 await db.prepare('DROP TRIGGER finality_fault').run();
 assert.equal((await finishSyntheticCompletion(db,fresh,now+30001,options)).accountDeletionCompleted,true);
});

test('backup preflight uses the current control ledger and refuses deleted accounts after restart',async()=>{
 const f=await fixture();await personal(f);await reviewed(f);
 const active=(await db.prepare("INSERT INTO reader_accounts(email,normalized_email) VALUES('restore@example.test','restore@example.test') RETURNING id").first()).id;
 await assertSyntheticAccountRestorable(db,active,options);
 await assert.rejects(()=>assertSyntheticAccountRestorable(db,f.account,options),/DELETED_ACCOUNT_RESTORE_BLOCKED/);
 await mf.dispose();await start();
 await assert.rejects(()=>assertSyntheticAccountRestorable(db,f.account,options),/DELETED_ACCOUNT_RESTORE_BLOCKED/);
 await assertSyntheticAccountRestorable(db,active,options);
});

test('late cross-account financial links fail the completion transaction after the read plan',async()=>{
 const f=await fixture(),other=await fixture();await personal(f);await reviewed(f);
 const order=(await db.prepare("INSERT INTO novel_orders(order_token,account_id) VALUES(?,?) RETURNING id").bind(randomUUID(),f.account).first()).id;
 const ticket=await claimSyntheticCompletion(db,f.id,randomUUID(),now,options);
 let injected=false;
 const race={prepare:sql=>db.prepare(sql),batch:async statements=>{
  assert.equal(injected,false);injected=true;
  // A real D1 row is inserted AFTER all read checks and BEFORE the atomic batch.
  await db.prepare("INSERT INTO novel_tips(account_id,order_id,amount) VALUES(?,?,'1.00')").bind(other.account,order).run();
  return db.batch(statements);
 }};
 await assert.rejects(()=>finishSyntheticCompletion(race,ticket,now,options));
 assert.equal(injected,true);assert.equal((await dto(f)).completedAt,null);
 assert.equal((await db.prepare('SELECT version FROM r1_completion_jobs WHERE id=?').bind(f.id).first()).version,ticket.version);
 assert.equal((await db.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=?').bind(other.account).first()).balance_credits,100);
});

test('missing TOTP fences, pre-existing reset records and unknown schema cannot be hidden by old completion evidence',async()=>{
 const f=await fixture();await personal(f);await reviewed(f);
 for(const name of ['r1_reader_totp_reset_attempts_update','r1_reader_totp_reset_attempts_insert']){
  const guard=await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(name).first();
  await db.prepare('DROP TRIGGER '+name).run();
  try{
   await assert.rejects(()=>syntheticCompletionReadiness(db,f.id,now,options),/GUARD_DRIFT/);
   // Explicit fault injection models a residual written before the fence was installed.
   if(name.endsWith('_insert'))await db.prepare("INSERT INTO reader_totp_reset_attempts(scope,scope_key) VALUES('account',?)").bind(String(f.account)).run();
  }finally{await db.prepare(guard.sql).run();}
 }
 await assert.rejects(()=>syntheticCompletionReadiness(db,f.id,now,options),/RESIDUAL_PERSONAL_DATA/);
 assert.equal((await dto(f)).completedAt,null);
 await db.prepare("DELETE FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?").bind(String(f.account)).run();
 await db.prepare('ALTER TABLE r1_completion_reviews ADD COLUMN unknown_private TEXT').run();
 await assert.rejects(()=>syntheticCompletionReadiness(db,f.id,now,options),/COMPLETION_SCHEMA_DRIFT/);
 await db.prepare('ALTER TABLE r1_completion_reviews DROP COLUMN unknown_private').run();
});
