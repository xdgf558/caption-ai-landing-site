// Quarantined restored-reader experiment, separate from the ordinary R1 executor.
// Triggers cannot block SELECT. Every read/admission must use assertRestoreAdmission.
import inventory from '../../docs/mobile-ios-m2/deletion-plan/schema-inventory.json' with {type:'json'};
import guards from './guard-manifest.json' with {type:'json'};
import {completionTables} from './completion-contract.js';
import {controlCheck as check,controlContext,readControlSnapshot,assertControlSnapshot,readControlCheckpoint,assertControlCheckpoint,readControlTombstonePage,controlGenesisDigest,controlPageLimit} from './control-ledger.js';
import {assertChanged,clearAssert} from '../../src/mobile/security.js';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const reviewed=inventory.databases.reader;
const extra=['r1_fixture_provenance','r1_deletion_jobs','r1_financial_reviews'];
const credentials=['mobile_refresh_operations','mobile_refresh_tokens','mobile_playback_grants','mobile_codes','mobile_sessions','reader_sessions','reader_login_tokens','reader_totp_credentials','reader_password_credentials'];
const privateTables=Object.entries(reviewed).filter(([,s])=>s.category==='private_data_purge').map(([name])=>name);
const financialTables=Object.entries(reviewed).filter(([,s])=>s.category==='financial_review').map(([name])=>name);
const stages=[...credentials,...privateTables,'reader_comments','reader_totp_reset_attempts','identity','verify'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=/^[a-f0-9]{64}$/;
const elapsedClock=now=>{const started=performance.now();return ()=>now+Math.max(0,Math.ceil(performance.now()-started));};
function assertProofFresh(proof,now){
 check(proof?.ready===true&&Number.isSafeInteger(now)&&Number.isSafeInteger(proof.issuedAt)&&proof.issuedAt<=now&&proof.expiresAt===proof.issuedAt+30000&&proof.expiresAt>now,'RESTORE_PROOF_EXPIRED');
}
const normalize=sql=>sql.replace(/;$/,'').replace(/\s+/g,' ').trim();
const gateSQL=`CREATE TABLE r1_restore_gate (
 id INTEGER PRIMARY KEY CHECK(id=1), restore_id TEXT NOT NULL, reader_ref TEXT NOT NULL, namespace TEXT NOT NULL,
 snapshot_digest TEXT NOT NULL,
 watermark INTEGER NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('blocked','replaying','ready')),
 cursor INTEGER NOT NULL DEFAULT 0, phase INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
 data_revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(data_revision)='integer' AND data_revision>=0)
)`;
const restoreTriggers={
 r1_restore_gate_monotonic:"CREATE TRIGGER r1_restore_gate_monotonic BEFORE UPDATE ON r1_restore_gate WHEN NEW.revision<OLD.revision OR NEW.data_revision<OLD.data_revision BEGIN SELECT RAISE(ABORT,'RESTORE_REVISION_ROLLBACK'); END"
};
const controlledTables=[...new Set([...credentials,...privateTables,...financialTables,'reader_comments','reader_totp_reset_attempts','reader_accounts'])];
for(const table of controlledTables){
 for(const operation of ['INSERT','UPDATE']){
  // Internal anonymization preserves comment body/moderation; account freezing never reactivates.
  const exception=operation==='UPDATE'&&table==='reader_comments'?" AND NOT (NEW.account_id IS NULL AND NEW.body=OLD.body AND NEW.status=OLD.status AND NEW.source_path='' AND NEW.metadata_json='{}' AND NEW.ip_hash='' AND NEW.user_agent_hash='' AND NEW.reviewed_by='' AND NEW.hidden_reason='')":
   operation==='UPDATE'&&table==='reader_accounts'?" AND NEW.status='active'":'';
  const name=`r1_restore_block_${table}_${operation.toLowerCase()}`;
  restoreTriggers[name]=`CREATE TRIGGER ${name} BEFORE ${operation} ON ${table} WHEN NOT EXISTS(SELECT 1 FROM r1_restore_gate WHERE id=1 AND state='ready')${exception} BEGIN SELECT RAISE(ABORT,'RESTORE_QUARANTINED'); END`;
 }
 for(const operation of ['INSERT','UPDATE','DELETE']){
  const name=`r1_restore_data_${table}_${operation.toLowerCase()}`;
  restoreTriggers[name]=`CREATE TRIGGER ${name} AFTER ${operation} ON ${table} BEGIN UPDATE r1_restore_gate SET data_revision=data_revision+1 WHERE id=1; SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'RESTORE_GATE_REQUIRED') END; END`;
 }
}
const expectedSchemas=new Map();
function expectedSchema(complete,hasGate){
 const key=`${complete}:${hasGate}`;if(expectedSchemas.has(key))return expectedSchemas.get(key);
 const oracle=new DatabaseSync(':memory:');
 try{
  for(const path of ['../../migrations/','../../migrations-mobile/']){
   const directory=new URL(path,import.meta.url);
   for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())oracle.exec(readFileSync(new URL(name,directory),'utf8'));
  }
  oracle.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  if(complete)oracle.exec(readFileSync(new URL('./completion-schema.sql',import.meta.url),'utf8'));
  if(hasGate){oracle.exec(gateSQL);for(const sql of Object.values(restoreTriggers))oracle.exec(sql);}
  const schema=oracle.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>[row.type,row.name,normalize(row.sql)]);
  expectedSchemas.set(key,schema);return schema;
 }finally{oracle.close();}
}
export async function validateRestoredReaderSchema(reader,ctx,{allowGate=true,checkData=true}={}){
 controlContext(ctx);check(await ctx.assertReaderNamespace(reader,ctx.namespace),'READER_NAMESPACE_MISMATCH');
 check((await reader.prepare('SELECT dataset FROM r1_fixture_provenance WHERE id=1').first())?.dataset==='synthetic-r1','SYNTHETIC_DATA_REQUIRED');
 const schema=(await reader.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name!='_cf_METADATA' ORDER BY type,name").all()).results;
 const tables=schema.filter(x=>x.type==='table').map(x=>x.name).sort();
 const additions=ctx.completionProfile==='synthetic-finality-v1'?Object.keys(completionTables):[];
 const hasGate=tables.includes('r1_restore_gate');check(allowGate||!hasGate,'RESTORE_GATE_UNEXPECTED');
 check(JSON.stringify(tables)===JSON.stringify([...Object.keys(reviewed),...extra,...additions,...(hasGate?['r1_restore_gate']:[])].sort()),'RESTORE_SCHEMA_DRIFT');
 check(JSON.stringify(schema.map(row=>[row.type,row.name,normalize(row.sql)]))===JSON.stringify(expectedSchema(Boolean(additions.length),hasGate)),'RESTORE_SCHEMA_DRIFT');
 // The exact SQL oracle includes column order/types and every constraint/index.
 // Admission therefore needs no per-table PRAGMA or personal-data scan.
 for(const [name,sql] of Object.entries(guards))check(schema.some(x=>x.name===name&&x.type==='trigger'&&normalize(x.sql)===sql),'RESTORE_GUARD_DRIFT');
 if(hasGate){
  check(schema.some(x=>x.name==='r1_restore_gate'&&normalize(x.sql)===normalize(gateSQL)),'RESTORE_GATE_DRIFT');
  for(const [name,sql] of Object.entries(restoreTriggers))check(schema.some(x=>x.name===name&&normalize(x.sql)===normalize(sql)),'RESTORE_GATE_DRIFT');
 }
 if(checkData)check(!(await reader.prepare('PRAGMA foreign_key_check').all()).results.length,'RESTORE_FOREIGN_KEY_DRIFT');
 return hasGate;
}
const gate=reader=>reader.prepare('SELECT * FROM r1_restore_gate WHERE id=1').first();
const snapshotOf=(g,ledgerId)=>({schemaVersion:1,ledgerId,namespace:g.namespace,watermark:g.watermark,digest:g.digest});
const response=(g,ready=false,blockers=[])=>({restoreId:g.restore_id,readerRef:g.reader_ref,watermark:g.watermark,ready,blockers,productionEnabled:false});
export async function beginControlledRestore(control,reader,input,ctx){
 controlContext(ctx);check(control!==reader&&uuid.test(input?.restoreId)&&uuid.test(input?.readerRef)&&hash.test(input?.snapshotDigest),'INVALID_RESTORE_INPUT');
 const hadGate=await validateRestoredReaderSchema(reader,ctx);
 if(!hadGate)await reader.batch([reader.prepare(gateSQL),...Object.values(restoreTriggers).map(sql=>reader.prepare(sql))]);
 // Persist quarantine before contacting CONTROL; even a missing control DB remains closed.
 await reader.prepare(`INSERT INTO r1_restore_gate(id,restore_id,reader_ref,namespace,snapshot_digest,watermark,digest,state) VALUES(1,?,?,?,?,0,'','blocked')
  ON CONFLICT(id) DO UPDATE SET state='blocked',revision=revision+1`).bind(input.restoreId,input.readerRef,ctx.namespace,input.snapshotDigest).run();
 const snapshot=await readControlSnapshot(control,ctx);
 const old=await control.prepare('SELECT * FROM r1_control_restores WHERE restore_id=?').bind(input.restoreId).first();
 if(old)check(old.reader_ref===input.readerRef&&old.namespace===ctx.namespace&&old.snapshot_digest===input.snapshotDigest&&old.watermark===snapshot.watermark&&old.digest===snapshot.digest,'RESTORE_PLAN_STALE');
 else await control.prepare("INSERT INTO r1_control_restores VALUES(?,?,?,?,?,?,'replaying')").bind(input.restoreId,input.readerRef,ctx.namespace,input.snapshotDigest,snapshot.watermark,snapshot.digest).run();
 const current=await gate(reader);
 if(current.restore_id!==input.restoreId||current.watermark!==snapshot.watermark||current.digest!==snapshot.digest){
  await reader.prepare(`UPDATE r1_restore_gate SET restore_id=?,reader_ref=?,namespace=?,snapshot_digest=?,watermark=?,digest=?,state='replaying',cursor=0,phase=0,revision=revision+1 WHERE id=1`)
   .bind(input.restoreId,input.readerRef,ctx.namespace,input.snapshotDigest,snapshot.watermark,snapshot.digest).run();
 }else await reader.prepare("UPDATE r1_restore_gate SET state='replaying',revision=revision+1 WHERE id=1").run();
 await assertControlSnapshot(control,snapshot,ctx);return response(await gate(reader));
}
async function context(control,reader,id,ctx){
 await validateRestoredReaderSchema(reader,ctx,{checkData:false});const g=await gate(reader);check(g?.restore_id===id&&g.namespace===ctx.namespace,'RESTORE_PLAN_REQUIRED');
 check(Number.isSafeInteger(g.data_revision)&&g.data_revision>=0&&Number.isSafeInteger(g.revision)&&g.revision>=0,'RESTORE_CHECKPOINT_INVALID');
 const snapshot=await readControlCheckpoint(control,ctx);
 check(g.watermark===snapshot.watermark&&g.digest===snapshot.digest,'RESTORE_PLAN_STALE');
 const plan=await control.prepare('SELECT * FROM r1_control_restores WHERE restore_id=?').bind(id).first();
 check(plan&&plan.reader_ref===g.reader_ref&&plan.namespace===g.namespace&&plan.snapshot_digest===g.snapshot_digest&&plan.watermark===g.watermark&&plan.digest===g.digest&&plan.state!=='blocked','RESTORE_PLAN_STALE');
 return {g,snapshot,plan};
}
const predicate=table=>table.startsWith('mobile_refresh_')?'family_id IN (SELECT family_id FROM mobile_sessions WHERE account_id=?)':table==='reader_totp_reset_attempts'?"scope='account' AND scope_key=?":'account_id=?';
const count=(reader,table,account)=>reader.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${predicate(table)}`).bind(table==='reader_totp_reset_attempts'?String(account):account).first();
async function verified(reader,row){
 for(const table of [...credentials,...privateTables,'reader_comments','reader_totp_reset_attempts'])check((await count(reader,table,row.account_id)).n===0,'RESTORE_PERSONAL_RESIDUAL');
 const account=await reader.prepare('SELECT * FROM reader_accounts WHERE id=?').bind(row.account_id).first();
 if(account)check(account.status==='deleted_pending_review'&&account.email===`deleted+${row.job_id}@invalid`&&account.normalized_email===account.email&&account.display_name===''&&account.last_login_at===null,'RESTORE_IDENTITY_RESIDUAL');
}
export async function replayControlledRestoreStep(control,reader,id,ctx){
 const {g,snapshot}=await context(control,reader,id,ctx);
 if(g.cursor>=snapshot.watermark)return response(g,false,['READINESS_VERIFICATION_REQUIRED']);
 check(g.state==='replaying'&&Number.isSafeInteger(g.cursor)&&g.cursor>=0&&g.phase>=0&&g.phase<stages.length,'RESTORE_CHECKPOINT_INVALID');
 const rows=await readControlTombstonePage(control,snapshot,g.cursor,1,ctx);
 check(rows.length===1,'RESTORE_CHECKPOINT_INVALID');
 const row=rows[0],stage=stages[g.phase],writes=[];
 // Reapply the frozen state from CONTROL rather than trusting a snapshot's task flags.
 writes.push(reader.prepare("UPDATE reader_accounts SET status='deletion_pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'").bind(row.account_id));
 let phase=g.phase,cursor=g.cursor;
 if(stage==='identity'){
  const account=await reader.prepare('SELECT * FROM reader_accounts WHERE id=?').bind(row.account_id).first();
  if(account?.status!=='deleted_pending_review')writes.push(reader.prepare("UPDATE reader_accounts SET email=?,normalized_email=?,display_name='',last_login_at=NULL,status='deleted_pending_review',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='deletion_pending'").bind(`deleted+${row.job_id}@invalid`,`deleted+${row.job_id}@invalid`,row.account_id));
  phase++;
 }else if(stage==='verify'){
  await verified(reader,row);cursor++;phase=0;
 }else if((await count(reader,stage,row.account_id)).n){
  if(stage==='reader_comments')writes.push(reader.prepare("UPDATE reader_comments SET account_id=NULL,source_path='',metadata_json='{}',ip_hash='',user_agent_hash='',reviewed_by='',hidden_reason='',updated_at=CURRENT_TIMESTAMP WHERE rowid IN(SELECT rowid FROM reader_comments WHERE account_id=? LIMIT 200)").bind(row.account_id));
  else writes.push(reader.prepare(`DELETE FROM ${stage} WHERE rowid IN(SELECT rowid FROM ${stage} WHERE ${predicate(stage)} LIMIT 200)`).bind(stage==='reader_totp_reset_attempts'?String(row.account_id):row.account_id));
 }else phase++;
 await reader.batch([
  reader.prepare("UPDATE r1_restore_gate SET cursor=?,phase=?,revision=revision+1 WHERE id=1 AND restore_id=? AND revision=? AND state='replaying'").bind(cursor,phase,id,g.revision),assertChanged(reader),...writes,clearAssert(reader)
 ]);
 await assertControlCheckpoint(control,snapshot,ctx);return response(await gate(reader));
}
const verification= (control,id)=>control.prepare('SELECT * FROM r1_control_restore_verifications WHERE restore_id=?').bind(id).first();
const sameGate=(a,b)=>a&&b&&['restore_id','reader_ref','namespace','snapshot_digest','watermark','digest','state','cursor','phase','revision','data_revision'].every(key=>a[key]===b[key]);
function matchesVerification(v,g,snapshot){
 return v&&v.restore_id===g.restore_id&&v.reader_ref===g.reader_ref&&v.namespace===g.namespace&&v.snapshot_digest===g.snapshot_digest&&
  v.ledger_id===snapshot.ledgerId&&v.watermark===snapshot.watermark&&v.digest===snapshot.digest&&v.data_revision===g.data_revision&&
  Number.isSafeInteger(v.version)&&v.version>=0&&Number.isSafeInteger(v.verification_cursor)&&v.verification_cursor>=0&&v.verification_cursor<=snapshot.watermark&&hash.test(v.chain_digest);
}
async function assertReaderCheckpoint(reader,expected){const current=await gate(reader);check(sameGate(current,expected),'RESTORE_DATA_CHANGED');return current;}
const currentControlSQL=`EXISTS(SELECT 1 FROM r1_control_head WHERE id=1 AND watermark=? AND digest=?) AND
 EXISTS(SELECT 1 FROM r1_control_restores WHERE restore_id=? AND reader_ref=? AND namespace=? AND snapshot_digest=? AND watermark=? AND digest=? AND state!='blocked')`;
const controlBindings=(g,snapshot)=>[snapshot.watermark,snapshot.digest,g.restore_id,g.reader_ref,g.namespace,g.snapshot_digest,snapshot.watermark,snapshot.digest];
async function startVerification(control,g,snapshot,old,ctx){
 const genesis=await controlGenesisDigest(snapshot.ledgerId,snapshot.namespace);
 const row=await control.prepare(`INSERT INTO r1_control_restore_verifications
  (restore_id,ledger_id,reader_ref,namespace,snapshot_digest,watermark,digest,data_revision,workflow_revision,verification_cursor,chain_digest,state,version)
  SELECT ?,?,?,?,?,?,?,?,?,0,?,'verifying',0 WHERE ${currentControlSQL}
  ON CONFLICT(restore_id) DO UPDATE SET ledger_id=excluded.ledger_id,reader_ref=excluded.reader_ref,namespace=excluded.namespace,
   snapshot_digest=excluded.snapshot_digest,watermark=excluded.watermark,digest=excluded.digest,data_revision=excluded.data_revision,
   workflow_revision=excluded.workflow_revision,verification_cursor=0,chain_digest=excluded.chain_digest,state='verifying',version=version+1
  WHERE r1_control_restore_verifications.version=? RETURNING *`)
  .bind(g.restore_id,snapshot.ledgerId,g.reader_ref,g.namespace,g.snapshot_digest,snapshot.watermark,snapshot.digest,g.data_revision,g.revision,genesis,
   ...controlBindings(g,snapshot),old?.version??-1).first();
 check(row,'RESTORE_VERIFICATION_STALE');await assertControlCheckpoint(control,snapshot,ctx);return row;
}
async function sealedContext(control,reader,id,ctx){
 const {g,snapshot,plan}=await context(control,reader,id,ctx),v=await verification(control,id);
 check(g.state==='ready'&&g.cursor===snapshot.watermark&&g.phase===0&&plan.state==='ready','RESTORE_NOT_READY');
 check(matchesVerification(v,g,snapshot)&&v.state==='sealed'&&v.workflow_revision===g.revision&&
  v.verification_cursor===snapshot.watermark&&v.chain_digest===snapshot.digest,'RESTORE_SEAL_STALE');
 await assertControlCheckpoint(control,snapshot,ctx);await assertReaderCheckpoint(reader,g);
 return {g,snapshot,v};
}
export async function verifyControlledRestore(control,reader,id,now,ctx){
 check(Number.isSafeInteger(now)&&now>0,'INVALID_READY_TIME');const clock=elapsedClock(now);
 let {g,snapshot,plan}=await context(control,reader,id,ctx),v=await verification(control,id);
 if(g.cursor!==snapshot.watermark||g.phase!==0)return response(g,false,['RESTORE_REPLAY_INCOMPLETE']);
 const alreadySealed=matchesVerification(v,g,snapshot)&&v.state==='sealed'&&v.workflow_revision===g.revision&&
  v.verification_cursor===snapshot.watermark&&v.chain_digest===snapshot.digest&&g.state==='ready'&&plan.state==='ready';
 if(!alreadySealed){
  // Recover only the adjacent ready transition after all pages were checked.
  const pendingSeal=matchesVerification(v,g,snapshot)&&v.state==='verifying'&&v.verification_cursor===snapshot.watermark&&
   v.chain_digest===snapshot.digest&&g.state==='ready'&&v.workflow_revision+1===g.revision;
  if(!pendingSeal){
   if(g.state!=='replaying'){
    await reader.batch([reader.prepare("UPDATE r1_restore_gate SET state='replaying',revision=revision+1 WHERE id=1 AND restore_id=? AND revision=? AND data_revision=?")
     .bind(id,g.revision,g.data_revision),assertChanged(reader),clearAssert(reader)]);g=await gate(reader);
   }
   if(!(matchesVerification(v,g,snapshot)&&v.state==='verifying'&&v.workflow_revision===g.revision)){
    v=await startVerification(control,g,snapshot,v,ctx);
   }
   if(v.verification_cursor<snapshot.watermark){
    const rows=await readControlTombstonePage(control,snapshot,v.verification_cursor,controlPageLimit,ctx,v.chain_digest);
    check(rows.length>0&&rows.length<=controlPageLimit,'RESTORE_VERIFICATION_PAGE_INVALID');
    for(const row of rows)await verified(reader,row);
    await assertReaderCheckpoint(reader,g);await assertControlCheckpoint(control,snapshot,ctx);
    const last=rows.at(-1);
    const next=await control.prepare(`UPDATE r1_control_restore_verifications SET verification_cursor=?,chain_digest=?,version=version+1
     WHERE restore_id=? AND version=? AND verification_cursor=? AND chain_digest=? AND data_revision=? AND workflow_revision=? AND state='verifying'
     AND ${currentControlSQL} RETURNING *`).bind(last.seq,last.digest,id,v.version,v.verification_cursor,v.chain_digest,g.data_revision,g.revision,
      ...controlBindings(g,snapshot)).first();
    check(next,'RESTORE_VERIFICATION_STALE');v=next;
    await assertReaderCheckpoint(reader,g);await assertControlCheckpoint(control,snapshot,ctx);
   }
   if(v.verification_cursor<snapshot.watermark)return {...response(g,false,['RESTORE_VERIFICATION_INCOMPLETE']),verificationCursor:v.verification_cursor};
   check(v.chain_digest===snapshot.digest,'RESTORE_VERIFICATION_CHAIN_INVALID');
   await reader.batch([reader.prepare(`UPDATE r1_restore_gate SET state='ready',revision=revision+1
    WHERE id=1 AND restore_id=? AND revision=? AND data_revision=? AND state='replaying' AND cursor=? AND phase=0`)
     .bind(id,g.revision,g.data_revision,snapshot.watermark),assertChanged(reader),clearAssert(reader)]);g=await gate(reader);
  }
  // CONTROL and reader are separate: a crash here resumes pendingSeal above.
  await assertReaderCheckpoint(reader,g);await assertControlCheckpoint(control,snapshot,ctx);
  await control.batch([
   control.prepare(`UPDATE r1_control_restore_verifications SET state='sealed',workflow_revision=?,version=CASE WHEN
    version=? AND data_revision=? AND workflow_revision=? AND verification_cursor=? AND chain_digest=? AND state='verifying' AND ${currentControlSQL}
    THEN version+1 ELSE NULL END WHERE restore_id=?`).bind(g.revision,v.version,g.data_revision,g.revision-1,snapshot.watermark,snapshot.digest,
     ...controlBindings(g,snapshot),id),
   control.prepare(`UPDATE r1_control_restores SET state='ready' WHERE restore_id=? AND reader_ref=? AND namespace=? AND snapshot_digest=? AND watermark=? AND digest=? AND state!='blocked'`)
    .bind(id,g.reader_ref,g.namespace,g.snapshot_digest,snapshot.watermark,snapshot.digest)
  ]);
 }
 const sealed=await sealedContext(control,reader,id,ctx),issuedAt=clock();
 check(Number.isSafeInteger(issuedAt+30000),'INVALID_READY_TIME');
 return {...response(sealed.g,true),...sealed.snapshot,snapshotDigest:sealed.g.snapshot_digest,dataRevision:sealed.g.data_revision,
  workflowRevision:sealed.g.revision,verificationVersion:sealed.v.version,issuedAt,expiresAt:issuedAt+30000};
}
export async function assertRestoreAdmission(control,reader,proof,now,ctx){
 const clock=elapsedClock(now);assertProofFresh(proof,now);
 const {g,snapshot,v}=await sealedContext(control,reader,proof.restoreId,ctx);
 check(g.reader_ref===proof.readerRef&&g.snapshot_digest===proof.snapshotDigest&&g.data_revision===proof.dataRevision&&g.revision===proof.workflowRevision&&
  v.version===proof.verificationVersion,'RESTORE_SEAL_STALE');
 const current=await assertControlCheckpoint(control,proof,ctx);await assertReaderCheckpoint(reader,g);assertProofFresh(proof,clock());
 return {...current,dataRevision:g.data_revision,workflowRevision:g.revision,verificationVersion:v.version};
}
export async function withControlledRestoreRead(control,reader,proof,now,ctx,read){
 check(typeof read==='function','RESTORE_READ_REQUIRED');
 const clock=elapsedClock(now);
 const admitted=await assertRestoreAdmission(control,reader,proof,now,ctx);
 // The callback must not expose/stream results or make changes before this
 // returns: a concurrent deletion after admission discards its read result.
 const result=await read(reader);
 await assertControlCheckpoint(control,admitted,ctx);
 await assertRestoreAdmission(control,reader,proof,clock(),ctx);
 assertProofFresh(proof,clock());
 return result;
}
