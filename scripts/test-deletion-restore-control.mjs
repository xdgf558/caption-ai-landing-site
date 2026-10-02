import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {controlSchemaSQL,controlHash,controlLedgerCapacity,initializeControlLedger,registerDeletionTombstone,reconcileControlAnchor,readControlSnapshot,assertControlSnapshot} from './isolated-lifecycle/control-ledger.js';
import {beginControlledRestore,replayControlledRestoreStep,verifyControlledRestore,assertRestoreAdmission,withControlledRestoreRead} from './isolated-lifecycle/restore-control.js';

const directory=mkdtempSync(join(tmpdir(),'r1-control-')),namespace='synthetic-reader-primary',ledgerId=randomUUID();
const registry=new Map(),instances=new Map(),anchorFile=join(directory,'protected-anchor','anchor.json');
const now=Date.now(),options={environment:'isolated',dataset:'synthetic-r1',controlProfile:'synthetic-control-v1',namespace};
let source,control,restored,anchorInitial,proof,restoreId,readerRef,taskA,taskB;
let failAnchorCAS=false;
// Explicit protected-store test substitute: separate file, never included in reader/control backups.
// The binding registry uses actual D1 object identities, not an unconditional true callback.
const anchorStore={
 async load(){return existsSync(anchorFile)?JSON.parse(readFileSync(anchorFile,'utf8')):null;},
 async compareAndSwap(expected,next){
  if(failAnchorCAS){failAnchorCAS=false;throw Error('INJECTED_ANCHOR_CRASH');}
  const current=await this.load();if(JSON.stringify(current)!==JSON.stringify(expected))return false;
  writeFileSync(anchorFile+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(anchorFile+'.tmp',anchorFile);return true;
 }
};
const ctx={...options,anchorStore,assertReaderNamespace:async(db,expected)=>registry.get(db)===expected};
const sourceSQL=[...['migrations','migrations-mobile'].flatMap(path=>readdirSync(path).filter(x=>x.endsWith('.sql')).sort().map(x=>readFileSync(path+'/'+x,'utf8'))),readFileSync('scripts/isolated-lifecycle/schema.sql','utf8'),"INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1');"].join('\n');
const oldRows=Array.from([101,202,303],account=>`
 INSERT INTO reader_accounts(id,email,normalized_email,display_name) VALUES(${account},'synthetic-${account}@example.test','synthetic-${account}@example.test','Synthetic ${account}');
 INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(${account},'synthetic-${account}','synthetic-${account}','synthetic','salt',100000);
 INSERT INTO reader_credit_accounts(account_id,balance_credits) VALUES(${account},777);
 INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,source) VALUES(${account},'purchase',777,777,'synthetic');
 INSERT INTO mobile_music_state(account_id) VALUES(${account});
 INSERT INTO mobile_music_favorites VALUES(${account},'synthetic-track',1,1,${now});
 INSERT INTO reader_totp_reset_attempts(scope,scope_key,failure_count,last_failed_epoch) VALUES('account','${account}',1,${now});
 INSERT INTO reader_comments(id,account_id,series_slug,chapter_slug,body,status,metadata_json) VALUES('comment-${account}',${account},'synthetic','one','Synthetic retained comment','approved','{"synthetic":true}');
`).join('\n');
// An actual old SQL snapshot of the full reviewed schema, taken before either deletion.
const oldSnapshot=sourceSQL+'\n'+oldRows;
const snapshotDigest=createHash('sha256').update(oldSnapshot).digest('hex');
async function start(name){
 const instance=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No external restore entry",{status:404})}}',compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{DB:'synthetic-'+name},d1Persist:join(directory,name),outboundService:()=>new Response('',{status:503})});
 instances.set(name,instance);const db=await instance.getD1Database('DB');if(name!=='control'&&name!=='old-control')registry.set(db,namespace);return db;
}
async function apply(db,sql){
 const parser=new DatabaseSync(':memory:');
 try{while(sql.trim()){
  const statement=parser.prepare(sql);statement.run();await db.prepare(statement.sourceSQL).run();sql=sql.slice(statement.sourceSQL.length);
 }}finally{parser.close();}
}
async function freeze(account,id=randomUUID()){
 await source.prepare("INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,confirm_id,confirmed_at,stage) VALUES(?,?,?,'synthetic-hash','station-account-v1',?,?, 'accepted',?,?,'queued')").bind(id,account,randomUUID(),now+1000,now+14*86400000,randomUUID(),now).run();
 await source.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").bind(account).run();return id;
}
async function finish(id=restoreId){
 for(let index=0;index<150;index++){
  const row=await restored.prepare('SELECT * FROM r1_restore_gate WHERE id=1').first();
  if(row.cursor===row.watermark&&row.phase===0)return verifyControlledRestore(control,restored,id,now,ctx);
  const step=await replayControlledRestoreStep(control,restored,id,ctx);assert.equal(step.ready,false);
 }throw Error('RESTORE_DID_NOT_PROGRESS');
}
before(async()=>{
 const {mkdirSync}=await import('node:fs');mkdirSync(join(directory,'protected-anchor'));
 source=await start('source');control=await start('control');restored=await start('restored');
 await apply(source,oldSnapshot);await apply(restored,oldSnapshot);await apply(control,controlSchemaSQL);
 const crashAtBootstrap={prepare:control.prepare.bind(control),batch:async()=>{throw Error('INJECTED_CONTROL_BOOTSTRAP_CRASH');}};
 await assert.rejects(()=>initializeControlLedger(crashAtBootstrap,ledgerId,ctx),/INJECTED_CONTROL_BOOTSTRAP_CRASH/);
 await assert.rejects(()=>initializeControlLedger(control,randomUUID(),ctx),/ANCHOR_ALREADY_INITIALIZED/);
 anchorInitial=await initializeControlLedger(control,ledgerId,ctx);
},{timeout:120000});
after(async()=>{for(const instance of instances.values())await instance.dispose();rmSync(directory,{recursive:true,force:true});},{timeout:30000});

test('independent CONTROL rejects unconfirmed task, wrong namespace, same database and schema drift',async()=>{
 assert.notEqual(source,control);assert.notEqual(restored,control);
 await assert.rejects(()=>registerDeletionTombstone(control,source,randomUUID(),ctx),/CONFIRMED_FROZEN_SOURCE/);
 await assert.rejects(()=>registerDeletionTombstone(source,source,randomUUID(),ctx),/SEPARATE_CONTROL/);
 registry.set(source,'other-reader');
 await assert.rejects(()=>registerDeletionTombstone(control,source,randomUUID(),ctx),/READER_NAMESPACE_MISMATCH/);
 registry.set(source,namespace);
 await assert.rejects(()=>readControlSnapshot(control,{...ctx,namespace:'other-reader'}),/CONTROL_PROVENANCE/);
 await control.prepare('CREATE TABLE unknown_control_data(value TEXT)').run();
 await assert.rejects(()=>readControlSnapshot(control,ctx),/CONTROL_SCHEMA_DRIFT/);
 await control.prepare('DROP TABLE unknown_control_data').run();
 assert.deepEqual(await readControlSnapshot(control,ctx),anchorInitial);
},{timeout:120000});

test('commit before anchor CAS interruption resumes only the verified continuous append',async()=>{
 taskA=await freeze(101);failAnchorCAS=true;
 await assert.rejects(()=>registerDeletionTombstone(control,source,taskA,ctx),/INJECTED_ANCHOR_CRASH/);
 assert.equal((await control.prepare('SELECT watermark FROM r1_control_head').first()).watermark,1);
 assert.equal((await anchorStore.load()).watermark,0);
 await assert.rejects(()=>readControlSnapshot(control,ctx),/CONTROL_ANCHOR_PENDING/);
 const snapshot=await registerDeletionTombstone(control,source,taskA,ctx);
 assert.equal(snapshot.watermark,1);assert.deepEqual(await reconcileControlAnchor(control,source,ctx),snapshot);
 assert.equal((await control.prepare('SELECT count(*) n FROM r1_control_tombstones').first()).n,1);
 await assert.rejects(()=>control.prepare('DELETE FROM r1_control_tombstones').run(),/CONTROL_IMMUTABLE/);
},{timeout:120000});

test('old restored reader begins blocked, replay cleans only tombstoned account and preserves financial rows',async()=>{
 restoreId=randomUUID();readerRef=randomUUID();
 const started=await beginControlledRestore(control,restored,{restoreId,readerRef,snapshotDigest},ctx);assert.equal(started.ready,false);
 assert.equal((await verifyControlledRestore(control,restored,restoreId,now,ctx)).ready,false);
 await assert.rejects(()=>restored.prepare('UPDATE reader_credit_accounts SET balance_credits=778 WHERE account_id=101').run(),/RESTORE_QUARANTINED/);
 await assert.rejects(()=>restored.prepare("INSERT INTO reader_password_credentials(account_id,username,normalized_username,password_hash,password_salt,password_iterations) VALUES(202,'late','late','p','s',100000)").run(),/RESTORE_QUARANTINED/);
 await replayControlledRestoreStep(control,restored,restoreId,ctx);
 assert.equal((await restored.prepare('SELECT status FROM reader_accounts WHERE id=101').first()).status,'deletion_pending');
 proof=await finish();assert.equal(proof.ready,true);await assertRestoreAdmission(control,restored,proof,now+1,ctx);
 for(const table of ['reader_password_credentials','mobile_music_state','mobile_music_favorites']){
  assert.equal((await restored.prepare(`SELECT count(*) n FROM ${table} WHERE account_id=101`).first()).n,0);
  assert.equal((await restored.prepare(`SELECT count(*) n FROM ${table} WHERE account_id=202`).first()).n,1);
 }
 const comment=await restored.prepare("SELECT * FROM reader_comments WHERE id='comment-101'").first();
 assert.equal(comment.account_id,null);assert.equal(comment.body,'Synthetic retained comment');assert.equal(comment.status,'approved');assert.equal(comment.metadata_json,'{}');
 assert.equal((await restored.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=101').first()).balance_credits,777);
 assert.equal((await restored.prepare('SELECT credits_delta FROM reader_credit_ledger WHERE account_id=101').first()).credits_delta,777);
 await assert.rejects(()=>restored.prepare("UPDATE reader_accounts SET status='active' WHERE id=101").run(),/R1_DELETED_ACCOUNT/);
},{timeout:120000});

test('persisted reader/control restart requires current CONTROL and a fresh readiness proof',async()=>{
 await instances.get('restored').dispose();await instances.get('control').dispose();
 restored=await start('restored');control=await start('control');
 await assertRestoreAdmission(control,restored,proof,now+2,ctx);
 await assert.rejects(()=>assertRestoreAdmission(control,restored,proof,now+30000,ctx),/RESTORE_PROOF_EXPIRED/);
 proof=await verifyControlledRestore(control,restored,restoreId,now+30000,ctx);
 await assertRestoreAdmission(control,restored,proof,now+30001,ctx);
 // A permanent anchor survives time; the admission certificate does not.
 assert.equal((await readControlSnapshot(control,ctx)).watermark,1);
},{timeout:120000});

test('old or tampered control cannot satisfy the independent protected anchor',async()=>{
 const old=await start('old-control');await apply(old,controlSchemaSQL);
 await old.prepare("INSERT INTO r1_control_provenance VALUES(1,'synthetic-control-r1',1,?,?)").bind(ledgerId,namespace).run();
 await old.prepare('INSERT INTO r1_control_head VALUES(1,0,?)').bind(anchorInitial.digest).run();
 await assert.rejects(()=>assertRestoreAdmission(old,restored,proof,now+30001,ctx),/CONTROL_WATERMARK_ROLLBACK/);
 const immutable=await control.prepare("SELECT sql FROM sqlite_master WHERE name='r1_control_tombstones_update'").first();
 await control.prepare('DROP TRIGGER r1_control_tombstones_update').run();
 await control.prepare('UPDATE r1_control_tombstones SET confirmed_at=confirmed_at+1 WHERE seq=1').run();
 await control.prepare(immutable.sql).run();
 await assert.rejects(()=>readControlSnapshot(control,ctx),/CONTROL_CHAIN_INVALID/);
 await control.prepare('DROP TRIGGER r1_control_tombstones_update').run();
 await control.prepare('UPDATE r1_control_tombstones SET confirmed_at=confirmed_at-1 WHERE seq=1').run();await control.prepare(immutable.sql).run();
 await assertRestoreAdmission(control,restored,proof,now+30001,ctx);
},{timeout:120000});

test('a concurrent newly confirmed deletion invalidates all old restore plans and requires replay again',async()=>{
 // Keep this race test independently runnable with --test-name-pattern.
 if(!proof){
  taskA=await freeze(101);await registerDeletionTombstone(control,source,taskA,ctx);
  restoreId=randomUUID();readerRef=randomUUID();
  await beginControlledRestore(control,restored,{restoreId,readerRef,snapshotDigest},ctx);proof=await finish();
 }
 const readTime=proof.issuedAt+1;
 const oldSnapshot=await readControlSnapshot(control,ctx);taskB=await freeze(202);
 let latest,readEntered,releaseRead;
 const entered=new Promise(resolve=>{readEntered=resolve;});
 const race=withControlledRestoreRead(control,restored,proof,readTime,ctx,async db=>{
  const result=await db.prepare('SELECT count(*) n FROM reader_password_credentials WHERE account_id=202').first();
  await new Promise(resolve=>{releaseRead=resolve;readEntered();});return result;
 });
 const rejected=assert.rejects(race,/CONTROL_SNAPSHOT_STALE/);
 await entered;latest=await registerDeletionTombstone(control,source,taskB,ctx);releaseRead();await rejected;
 assert.equal(latest.watermark,2);
 await assert.rejects(()=>assertControlSnapshot(control,oldSnapshot,ctx),/CONTROL_SNAPSHOT_STALE/);
 await assert.rejects(()=>assertRestoreAdmission(control,restored,proof,readTime,ctx),/RESTORE_PLAN_STALE/);
 assert.equal((await control.prepare('SELECT state FROM r1_control_restores WHERE restore_id=?').bind(restoreId).first()).state,'blocked');
 restoreId=randomUUID();const start=await beginControlledRestore(control,restored,{restoreId,readerRef,snapshotDigest},ctx);assert.equal(start.ready,false);
 await replayControlledRestoreStep(control,restored,restoreId,ctx);
 await instances.get('restored').dispose();restored=await startReaderAgain();
 assert.equal((await restored.prepare('SELECT state FROM r1_restore_gate').first()).state,'replaying');
 await assert.rejects(()=>assertRestoreAdmission(control,restored,{...proof,restoreId},readTime,ctx),/RESTORE_NOT_READY/);
 proof=await finish();assert.equal(proof.watermark,2);
 assert.equal((await restored.prepare('SELECT count(*) n FROM reader_password_credentials WHERE account_id=202').first()).n,0);
 assert.equal((await restored.prepare('SELECT count(*) n FROM reader_password_credentials WHERE account_id=303').first()).n,1);
 await assertRestoreAdmission(control,restored,proof,now+1,ctx);
},{timeout:120000});
async function startReaderAgain(){return start('restored');}

test('missing CONTROL or anchor leaves the restored reader inaccessible even after earlier success',async()=>{
 await assert.rejects(()=>assertRestoreAdmission(undefined,restored,proof,now+1,ctx));
 const saved=readFileSync(anchorFile,'utf8');rmSync(anchorFile);
 await assert.rejects(()=>assertRestoreAdmission(control,restored,proof,now+1,ctx),/CONTROL_ANCHOR_MISMATCH/);
 await assert.rejects(()=>initializeControlLedger(control,ledgerId,ctx),/PROTECTED_ANCHOR_LOST/);
 writeFileSync(anchorFile,saved,{mode:0o600});await assertRestoreAdmission(control,restored,proof,now+1,ctx);
 const missingRestore=await start('missing-restore');await apply(missingRestore,oldSnapshot);
 await assert.rejects(()=>beginControlledRestore(undefined,missingRestore,{restoreId:randomUUID(),readerRef:randomUUID(),snapshotDigest:'b'.repeat(64)},ctx));
 assert.equal((await missingRestore.prepare('SELECT state FROM r1_restore_gate').first()).state,'blocked');
 await assert.rejects(()=>missingRestore.prepare("INSERT INTO reader_login_tokens(token_hash,account_id,normalized_email,expires_at) VALUES('late',303,'synthetic-303@example.test','2027-01-01')").run(),/RESTORE_QUARANTINED/);
},{timeout:120000});

test('restore proof expiry during slow admission or awaited pure read never returns a result',async()=>{
 if(!proof){
  taskA=await freeze(101);await registerDeletionTombstone(control,source,taskA,ctx);
  restoreId=randomUUID();readerRef=randomUUID();
  await beginControlledRestore(control,restored,{restoreId,readerRef,snapshotDigest},ctx);proof=await finish();
 }
 let delayed=false;
 const slowCtx={...ctx,anchorStore:{
  async load(){if(!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,80));}return anchorStore.load();},
  compareAndSwap:(expected,next)=>anchorStore.compareAndSwap(expected,next)
 }};
 await assert.rejects(()=>assertRestoreAdmission(control,restored,proof,proof.expiresAt-20,slowCtx),/RESTORE_PROOF_EXPIRED/);
 assert.equal(delayed,true);
 // Measure actual D1 admission to give the callback enough room to start;
 // contention may still consume that room, which must reject at admission.
 const started=performance.now();await assertRestoreAdmission(control,restored,proof,proof.issuedAt+1,ctx);
 const budget=Math.min(20000,Math.max(2000,Math.ceil((performance.now()-started)*4)+200));
 let entered=false,callbackFinished=false,resultReturned=false;
 const pending=withControlledRestoreRead(control,restored,proof,proof.expiresAt-budget,ctx,async db=>{
  entered=true;const result=await db.prepare('SELECT count(*) n FROM reader_accounts').first();
  await new Promise(resolve=>setTimeout(resolve,budget+40));callbackFinished=true;return result;
 }).then(value=>{resultReturned=true;return value;});
 await assert.rejects(pending,/RESTORE_PROOF_EXPIRED/);assert.equal(resultReturned,false);
 assert.equal(callbackFinished,entered); // Distinguish admission expiry from callback expiry.
},{timeout:120000});

test('ledger capacity rejects before commit and keeps the anchored prefix readable and idempotent',async()=>{
 // A real persistent SQLite CONTROL complements the persistent D1 restore tests.
 const raw=new DatabaseSync(join(directory,'capacity-control.sqlite'));
 const db={
  prepare(sql){let args=[];const statement=raw.prepare(sql);return {
   bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},
   async all(){return {results:statement.all(...args)};},async run(){const result=statement.run(...args);return {success:true,meta:{changes:Number(result.changes)}};}
  };},
  async batch(statements){raw.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());raw.exec('COMMIT');return result;}catch(error){raw.exec('ROLLBACK');throw error;}}
 };
 const protectedFile=join(directory,'protected-anchor','capacity.json');
 const protectedStore={
  async load(){return existsSync(protectedFile)?JSON.parse(readFileSync(protectedFile,'utf8')):null;},
  async compareAndSwap(expected,next){const current=await this.load();if(JSON.stringify(current)!==JSON.stringify(expected))return false;writeFileSync(protectedFile+'.tmp',JSON.stringify(next));renameSync(protectedFile+'.tmp',protectedFile);return true;}
 };
 const capacityCtx={...ctx,anchorStore:protectedStore},capacityId=randomUUID();
 try{
  raw.exec(controlSchemaSQL);let expected=await initializeControlLedger(db,capacityId,capacityCtx),previous=expected.digest,lastJob;
  // Certified synthetic history at the exact bound; all SQL guards stay installed.
  raw.exec('BEGIN');
  for(let seq=1;seq<=controlLedgerCapacity;seq++){
   const jobId=randomUUID(),account=controlLedgerCapacity+seq;
   const digest=await controlHash(['tombstone-v1',capacityId,seq,namespace,account,'station-account-v1',jobId,now,previous]);
   raw.prepare('INSERT INTO r1_control_tombstones VALUES(?,?,?,?,?,?,?,?)').run(seq,namespace,account,'station-account-v1',jobId,now,previous,digest);
   raw.prepare('UPDATE r1_control_head SET watermark=?,digest=? WHERE id=1').run(seq,digest);previous=digest;lastJob=jobId;
  }
  raw.exec('COMMIT');
  const anchored={...expected,watermark:controlLedgerCapacity,digest:previous};assert.equal(await protectedStore.compareAndSwap(expected,anchored),true);
  expected=await readControlSnapshot(db,capacityCtx);assert.equal(expected.watermark,controlLedgerCapacity);
  if(!taskA)taskA=await freeze(101);
  await assert.rejects(()=>registerDeletionTombstone(db,source,taskA,capacityCtx),/CONTROL_CAPACITY_REACHED/);
  assert.deepEqual(await protectedStore.load(),expected);assert.deepEqual(await readControlSnapshot(db,capacityCtx),expected);
  assert.equal(raw.prepare('SELECT count(*) n FROM r1_control_tombstones').get().n,controlLedgerCapacity);
  assert.deepEqual(await reconcileControlAnchor(db,source,capacityCtx),expected);
  const lastAccount=controlLedgerCapacity*2;
  await source.prepare("INSERT INTO reader_accounts(id,email,normalized_email) VALUES(?,'synthetic-capacity@example.test','synthetic-capacity@example.test')").bind(lastAccount).run();
  await freeze(lastAccount,lastJob);
  assert.deepEqual(await registerDeletionTombstone(db,source,lastJob,capacityCtx),expected);
 }finally{raw.close();}
},{timeout:120000});
