// Actual, persistent, loopback-only D1 scale regression. No production bindings.
// We simulate only the already-completed replay checkpoint of an empty reader;
// every one of the 1,000 tombstones must still pass the real bounded verifier.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,mkdirSync,rmSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import inventory from '../docs/mobile-ios-m2/deletion-plan/schema-inventory.json' with {type:'json'};
import {controlSchemaSQL,controlHash,controlPageLimit,initializeControlLedger,readControlSnapshot} from './isolated-lifecycle/control-ledger.js';
import {beginControlledRestore,verifyControlledRestore,assertRestoreAdmission,withControlledRestoreRead} from './isolated-lifecycle/restore-control.js';

const directory=mkdtempSync(join(tmpdir(),'r1-restore-scale-'));
const namespace='synthetic-reader-scale',instances=new Map(),registry=new Map();
const schemaSQL=[...['migrations','migrations-mobile'].flatMap(path=>readdirSync(path).filter(name=>name.endsWith('.sql')).sort().map(name=>readFileSync(join(path,name),'utf8'))),
 readFileSync('scripts/isolated-lifecycle/schema.sql','utf8'),"INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1');"].join('\n');
const snapshotDigest=createHash('sha256').update(schemaSQL).digest('hex');
const allReaderNames=new Set(Object.keys(inventory.databases.reader));
const verificationNames=new Set([...Object.entries(inventory.databases.reader).filter(([,spec])=>spec.category==='private_data_purge').map(([name])=>name),
 'mobile_refresh_operations','mobile_refresh_tokens','mobile_playback_grants','mobile_codes','mobile_sessions','reader_sessions','reader_login_tokens',
 'reader_totp_credentials','reader_password_credentials','reader_comments','reader_totp_reset_attempts','reader_accounts']);
const canonical=sql=>sql.replace(/\s+/g,' ').trim();

async function start(name){
 const instance=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No scale fixture HTTP entry",{status:404})}}',
  compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{DB:'synthetic-'+name},d1Persist:join(directory,name),
  outboundService:()=>new Response('',{status:503})});
 instances.set(name,instance);const db=await instance.getD1Database('DB');registry.set(db,namespace);return db;
}
async function restart(name){await instances.get(name).dispose();return start(name);}
async function applySchema(db,sql){
 const parser=new DatabaseSync(':memory:'),statements=[];
 try{while(sql.trim()){
  const statement=parser.prepare(sql);statement.run();statements.push(statement.sourceSQL);sql=sql.slice(statement.sourceSQL.length);
 }}finally{parser.close();}
 // Batch provisioning only; the same actual SQL constraints/triggers execute in D1.
 for(let offset=0;offset<statements.length;offset+=100)await db.batch(statements.slice(offset,offset+100).map(sql=>db.prepare(sql)));
}
function anchorStore(name){
 const path=join(directory,'protected-anchors',name+'.json');
 return {
  async load(){return existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;},
  async compareAndSwap(expected,next){
   const current=await this.load();if(JSON.stringify(current)!==JSON.stringify(expected))return false;
   writeFileSync(path+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(path+'.tmp',path);return true;
  }
 };
}
function context(store){return {environment:'isolated',dataset:'synthetic-r1',controlProfile:'synthetic-control-v1',namespace,
 anchorStore:store,assertReaderNamespace:async(db,expected)=>registry.get(db)===expected};}
async function appendFixtureRows(fixture,count){
 const expected=await fixture.ctx.anchorStore.load();let previous=expected.digest;const statements=[],rows=[];
 for(let index=0;index<count;index++){
  const seq=expected.watermark+index+1,row={seq,namespace,account_id:seq,scope_version:'station-account-v1',job_id:randomUUID(),
   confirmed_at:Date.now()-100000,previous_digest:previous};
  row.digest=await controlHash(['tombstone-v1',fixture.ledgerId,row.seq,row.namespace,row.account_id,row.scope_version,row.job_id,row.confirmed_at,row.previous_digest]);
  statements.push(fixture.control.prepare('INSERT INTO r1_control_tombstones VALUES(?,?,?,?,?,?,?,?)')
   .bind(row.seq,row.namespace,row.account_id,row.scope_version,row.job_id,row.confirmed_at,row.previous_digest,row.digest));
  statements.push(fixture.control.prepare('UPDATE r1_control_head SET watermark=?,digest=? WHERE id=1 AND watermark=? AND digest=?')
   .bind(row.seq,row.digest,row.seq-1,previous));
  rows.push(row);previous=row.digest;
 }
 // Preserve every immutable sequence/head guard. No trigger is dropped, and no
 // per-row API scans are replaced with a fake reader/control binding callback.
 for(let offset=0;offset<statements.length;offset+=100)await fixture.control.batch(statements.slice(offset,offset+100));
 const next={...expected,watermark:expected.watermark+count,digest:previous};
 assert.equal(await fixture.ctx.anchorStore.compareAndSwap(expected,next),true);
 assert.deepEqual(await readControlSnapshot(fixture.control,fixture.ctx),next); // Full real chain audit before restore.
 fixture.rows.push(...rows);return next;
}
async function fixture(name,count){
 const value={name,reader:await start(name+'-reader'),control:await start(name+'-control'),ctx:context(anchorStore(name)),
  ledgerId:randomUUID(),restoreId:randomUUID(),readerRef:randomUUID(),rows:[]};
 await applySchema(value.reader,schemaSQL);await applySchema(value.control,controlSchemaSQL);
 await initializeControlLedger(value.control,value.ledgerId,value.ctx);await appendFixtureRows(value,count);
 const begun=await beginControlledRestore(value.control,value.reader,{restoreId:value.restoreId,readerRef:value.readerRef,snapshotDigest},value.ctx);
 assert.equal(begun.ready,false);
 // Empty account/private tables are a legal restored state. This skips only the
 // destructive replay schedule, never CONTROL verification or readiness checks.
 await value.reader.prepare("UPDATE r1_restore_gate SET cursor=?,phase=0,revision=revision+1 WHERE id=1 AND state='replaying'").bind(count).run();
 return value;
}
function measured(db,label,log){
 function statement(raw,sql,args=[]){
  const wrapped={rawStatement:raw,sql,args,bind(...values){return statement(raw.bind(...values),sql,values);}};
  for(const method of ['all','first','run','raw'])wrapped[method]=async(...values)=>{
   const result=await raw[method](...values);record(wrapped,method,result);return result;
  };
  return wrapped;
 }
 function record(item,method,result){
  log.push({db:label,sql:canonical(item.sql),args:item.args,method,
   rowCount:result?.results?.length??(result?1:0),sequences:(result?.results||[]).filter(row=>Number.isSafeInteger(row.seq)).map(row=>row.seq)});
 }
 const wrapper={prepare(sql){return statement(db.prepare(sql),sql);},async batch(items){
  const results=await db.batch(items.map(item=>item.rawStatement));for(let index=0;index<items.length;index++)record(items[index],'batch',results[index]);return results;
 }};
 registry.set(wrapper,namespace);return wrapper;
}
function referencedReaderTables(log){
 return log.filter(row=>row.db==='reader').flatMap(row=>[...row.sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z][a-z0-9_]*)/gi)].map(match=>match[1]))
  .filter(name=>allReaderNames.has(name));
}
async function boundedVerification(value){
 const log=[],reader=measured(value.reader,'reader',log),control=measured(value.control,'control',log);
 const before=await value.control.prepare('SELECT verification_cursor FROM r1_control_restore_verifications WHERE restore_id=?').bind(value.restoreId).first();
 const result=await verifyControlledRestore(control,reader,value.restoreId,Date.now(),value.ctx);
 const after=await value.control.prepare('SELECT * FROM r1_control_restore_verifications WHERE restore_id=?').bind(value.restoreId).first();
 assert.ok(after,'the independent CONTROL database must persist verification, not just an in-memory cursor');
 assert.ok(after.verification_cursor-(before?.verification_cursor||0)<=controlPageLimit,'one verifier call exceeded its fixed account bound');
 const pages=log.filter(row=>row.db==='control'&&/FROM r1_control_tombstones WHERE seq>/.test(row.sql));
 assert.ok(pages.length<=1,'one step may read only one tombstone page');
 for(const page of pages)assert.ok(page.rowCount<=controlPageLimit,'a tombstone page exceeded the bound');
 const checkedAccounts=new Set(log.filter(row=>row.db==='reader'&&/FROM reader_accounts WHERE id=\?/.test(row.sql)).map(row=>row.args[0]));
 assert.ok(checkedAccounts.size<=controlPageLimit,'one step queried personal state for more accounts than its tombstone page');
 assert.equal(log.some(row=>/FROM r1_control_tombstones ORDER BY/.test(row.sql)),false,'bounded verification must not retrieve the complete ledger');
 return {result,checkpoint:after,log,pages};
}
async function admission(value,proof){
 const log=[],reader=measured(value.reader,'reader',log),control=measured(value.control,'control',log),started=performance.now();
 const result=await assertRestoreAdmission(control,reader,proof,proof.issuedAt+1,value.ctx),duration=performance.now()-started;
 assert.ok(duration<30000,`ordinary admission consumed the 30-second proof (${duration} ms)`);
 assert.ok(log.length<=80,`admission performed ${log.length} SQL operations instead of a small fixed bound`);
 assert.deepEqual(referencedReaderTables(log),[],'ready admission must not query any personal or financial reader table');
 const tombstoneReads=log.filter(row=>row.db==='control'&&/FROM r1_control_tombstones\b/.test(row.sql));
 for(const row of tombstoneReads){assert.match(row.sql,/WHERE seq=\?/);assert.ok(row.rowCount<=1);assert.equal(row.method,'first');}
 assert.equal(log.some(row=>row.db==='reader'&&/PRAGMA (?:foreign_key_check|table_info)/i.test(row.sql)),false,'admission must not perform per-table data verification');
 return {result,duration,count:log.length};
}
after(async()=>{for(const instance of instances.values())await instance.dispose();rmSync(directory,{recursive:true,force:true});},{timeout:30000});

test('1,000 real D1 tombstones verify in durable bounded pages and seal constant-cost admission',async t=>{
 assert.equal(controlPageLimit,25,'this regression locks the reviewed batch size');mkdirSync(join(directory,'protected-anchors'),{recursive:true});
 const large=await fixture('large',1000),seen=new Set(),verifiedAccounts=new Set(),tableCoverage=new Map([...verificationNames].map(name=>[name,new Set()]));
 let proof,previous=0,steps=0,restarted=false;
 while(!proof){
  const checked=await boundedVerification(large);steps++;
  for(const page of checked.pages)for(const seq of page.sequences){assert.equal(seen.has(seq),false,'a checkpoint replayed an already verified prefix');seen.add(seq);}
  for(const row of checked.log){
   if(row.db==='reader'&&/FROM reader_accounts WHERE id=\?/.test(row.sql))verifiedAccounts.add(row.args[0]);
   if(row.db==='reader'&&/^SELECT /.test(row.sql)){
    const table=row.sql.match(/FROM ([a-z][a-z0-9_]*)/)?.[1];
    if(tableCoverage.has(table))tableCoverage.get(table).add(Number(row.args[0]));
   }
  }
  assert.ok(checked.checkpoint.verification_cursor>previous,'non-final verification must make bounded forward progress');
  previous=checked.checkpoint.verification_cursor;
  if(checked.result.ready){proof=checked.result;assert.equal(checked.checkpoint.state,'sealed');}
  else{
   assert.equal(checked.checkpoint.state,'verifying');assert.ok(checked.checkpoint.verification_cursor<1000);
   if(!restarted&&steps===4){
    const durable=checked.checkpoint;
    large.reader=await restart('large-reader');large.control=await restart('large-control');
    assert.deepEqual(await large.control.prepare('SELECT * FROM r1_control_restore_verifications WHERE restore_id=?').bind(large.restoreId).first(),durable);
    restarted=true;
   }
  }
  assert.ok(steps<=1000/controlPageLimit+1,'verification did not terminate within the fixed number of pages');
 }
 assert.equal(restarted,true);assert.equal(steps,40);assert.equal(seen.size,1000);assert.equal(verifiedAccounts.size,1000);
 for(const [name,accounts] of tableCoverage)assert.equal(accounts.size,1000,`the bounded verifier did not check every account in ${name}`);
 assert.equal(proof.expiresAt-proof.issuedAt,30000);assert.equal(proof.productionEnabled,false);
 const cold=await admission(large,proof),warm=await admission(large,proof);
 assert.equal(warm.count,cold.count,'warm admission must use the same durable seal checks');
 large.reader=await restart('large-reader');large.control=await restart('large-control');
 const fresh=await boundedVerification(large);assert.equal(fresh.result.ready,true);assert.equal(fresh.pages.length,0,'a sealed restart must not reverify the entire prefix');proof=fresh.result;
 const restartedAdmission=await admission(large,proof);assert.equal(restartedAdmission.count,cold.count);
 await assert.rejects(()=>assertRestoreAdmission(large.control,large.reader,{...proof,workflowRevision:proof.workflowRevision-1},proof.issuedAt+1,large.ctx),/RESTORE_SEAL_STALE/);
 await assert.rejects(()=>assertRestoreAdmission(large.control,large.reader,{...proof,verificationVersion:proof.verificationVersion-1},proof.issuedAt+1,large.ctx),/RESTORE_SEAL_STALE/);

 const small=await fixture('small',1),smallCheck=await boundedVerification(small);assert.equal(smallCheck.result.ready,true);
 const one=await admission(small,smallCheck.result);
 assert.equal(one.count,cold.count,'admission SQL count must be independent of 1 versus 1,000 tombstones');
 t.diagnostic(`verified=1000 steps=${steps} batch=${controlPageLimit} admissionSQL=${cold.count} coldMs=${cold.duration.toFixed(1)} warmMs=${warm.duration.toFixed(1)} oneMs=${one.duration.toFixed(1)}`);

 // A data change after sealing invalidates its revision; even changing it back
 // cannot make the old proof usable. This account is outside the tombstone set.
 const seal=await large.control.prepare('SELECT * FROM r1_control_restore_verifications WHERE restore_id=?').bind(large.restoreId).first();
 await large.reader.prepare("INSERT INTO reader_accounts(id,email,normalized_email,display_name) VALUES(10001,'synthetic-live@example.test','synthetic-live@example.test','Synthetic live')").run();
 await assert.rejects(()=>assertRestoreAdmission(large.control,large.reader,proof,proof.issuedAt+1,large.ctx),/RESTORE_(?:NOT_READY|VERIFICATION|SEAL|DATA|PROOF)/);
 await large.reader.prepare('DELETE FROM reader_accounts WHERE id=10001').run();
 await assert.rejects(()=>assertRestoreAdmission(large.control,large.reader,proof,proof.issuedAt+1,large.ctx),/RESTORE_(?:NOT_READY|VERIFICATION|SEAL|DATA|PROOF)/);
 const invalidated=await boundedVerification(large);assert.equal(invalidated.result.ready,false);
 assert.equal(invalidated.checkpoint.verification_cursor,controlPageLimit,'changed data revision must restart verification from genesis');
 assert.ok(invalidated.checkpoint.data_revision>seal.data_revision);

 // New CONTROL history independently invalidates the old reader plan and seal.
 await appendFixtureRows(large,1);
 await assert.rejects(()=>assertRestoreAdmission(large.control,large.reader,proof,proof.issuedAt+1,large.ctx),/RESTORE_PLAN_STALE|CONTROL_SNAPSHOT_STALE/);
 await assert.rejects(()=>verifyControlledRestore(large.control,large.reader,large.restoreId,Date.now(),large.ctx),/RESTORE_PLAN_STALE|CONTROL_SNAPSHOT_STALE/);
 assert.equal((await large.control.prepare('SELECT state FROM r1_control_restores WHERE restore_id=?').bind(large.restoreId).first()).state,'blocked');

 // Revision changes during an awaited read are checked after the read too.
 const smallProof=smallCheck.result;let release,entered;
 const waiting=new Promise(resolve=>{entered=resolve;});
 const race=withControlledRestoreRead(small.control,small.reader,smallProof,smallProof.issuedAt+1,small.ctx,async db=>{
  const result=await db.prepare('SELECT count(*) n FROM reader_accounts').first();
  await new Promise(resolve=>{release=resolve;entered();});
  return result;
 });
 const rejected=assert.rejects(race,/RESTORE_(?:NOT_READY|VERIFICATION|SEAL|DATA|PROOF)/);
 await waiting;
 await small.reader.prepare("INSERT INTO reader_accounts(id,email,normalized_email,display_name) VALUES(10002,'synthetic-race@example.test','synthetic-race@example.test','Synthetic race')").run();
 release();await rejected;
},{timeout:600000});
