import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createExecutionFixture} from './fixtures/deletion-execution.mjs';
import {initializeControlLedger,registerDeletionTombstone} from './isolated-lifecycle/control-ledger.js';
import {prepareFinancialErasure,claimFinancialErasure,runFinancialErasureStep} from './isolated-lifecycle/financial-executor.js';
import {prepareExternalCleanup,claimExternalCleanup,runExternalCleanupStep} from './isolated-lifecycle/external-cleanup.js';
import {completeSyntheticExecution} from './isolated-lifecycle/execution-orchestrator.js';
let f,ctx,anchor;
before(async()=>{
 f=await createExecutionFixture();
 // Independently held protected anchor, deliberately not restored with D1.
 // Durable anchor/restart/CAS failures have separate disk-backed CONTROL tests.
 ctx={...f.options,controlProfile:'synthetic-control-v1',namespace:'synthetic-integration',
  anchorStore:{async load(){return structuredClone(anchor??null);},async compareAndSwap(expected,next){
   if(JSON.stringify(anchor??null)!==JSON.stringify(expected))return false;anchor=structuredClone(next);return true;
  }},async assertReaderNamespace(db,namespace){return db===f.reader&&namespace==='synthetic-integration';}};
 await initializeControlLedger(f.control,randomUUID(),ctx);
},{timeout:120000});
after(async()=>{await f?.close();},{timeout:30000});
async function setup({barrier=true}={}) {
 const a=await f.account({dirty:true,personal:false});
 if(barrier)await registerDeletionTombstone(f.control,f.reader,a.id,ctx);
 await f.personal(a);await f.prepare(a);
 await prepareFinancialErasure(f.reader,a.id,a.policy,f.now,f.options);
 const registry=await f.adapters(),manifest=await f.resources(a);
 await prepareExternalCleanup(f.reader,a.id,manifest,registry,f.options);
 return {...a,registry};
}
async function minimize(a){for(let i=0;i<60;i++){
 const t=await claimFinancialErasure(f.reader,a.id,randomUUID(),f.now,f.options);
 if(!t)return;
 const result=await runFinancialErasureStep(f.reader,t,f.now,f.options);if(result.stage==='retained')return;
}throw Error('FINANCIAL_STALLED');}
async function external(a){for(let i=0;i<8;i++){
 const t=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options);if(!t)return;
 assert.equal((await runExternalCleanupStep(f.reader,t,f.now,a.registry,f.options)).verified,true);
}throw Error('EXTERNAL_STALLED');}
const task=id=>f.reader.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(id).first();
const finish=a=>completeSyntheticExecution(f.reader,f.control,a.id,a.registry,f.now+120_000,ctx);

test('completion needs real financial minimization, external readbacks and the independent control barrier',async()=>{
 const a=await setup(),b=await f.account();const original=await task(a.id);
 await assert.rejects(()=>finish(a),/FINANCIAL_EXECUTION_REQUIRED/);
 await minimize(a);await assert.rejects(()=>finish(a),/EXTERNAL_TASK_NOT_VERIFIED/);
 assert.equal((await task(a.id)).status,'attention_required');
 await external(a);const result=await finish(a);assert.equal(result.accountDeletionCompleted,true);assert.equal(result.productionEnabled,false);
 const completed=await task(a.id);assert.equal(completed.status,'completed');
 for(const key of ['id','receipt_hash','confirmed_at','scope_version'])assert.equal(completed[key],original[key]);
 assert.equal((await f.reader.prepare('SELECT balance_credits n FROM reader_credit_accounts WHERE account_id=?').bind(a.account).first()).n,100);
 assert.equal((await f.reader.prepare('SELECT metadata_json,note FROM reader_credit_ledger WHERE account_id=?').bind(a.account).first()).metadata_json,'{}');
 assert.equal((await task(b.id)).status,'attention_required');
 await f.restart();a.registry=await f.adapters();
 const replay=await finish(a);assert.equal(replay.alreadyCompleted,true);assert.equal(replay.completedAt,completed.completed_at);
 assert.deepEqual(await task(a.id),completed);
});

test('a local backup barrier or reviews cannot substitute for a missing protected deletion ledger',async()=>{
 const a=await setup({barrier:false});
 await assert.rejects(()=>finish(a),/INDEPENDENT_DELETION_BARRIER_REQUIRED/);
 assert.equal((await task(a.id)).status,'attention_required');
 await registerDeletionTombstone(f.control,f.reader,a.id,ctx);
 const saved=anchor;anchor=null;
 await assert.rejects(()=>finish(a),/CONTROL_ANCHOR_MISMATCH/);anchor=saved;
 await assert.rejects(()=>completeSyntheticExecution(f.reader,f.control,a.id,a.registry,f.now+120_000,{...ctx,environment:'production'}),/ISOLATION/);
 await assert.rejects(()=>completeSyntheticExecution(f.reader,f.control,a.id,a.registry,f.now+120_000,{...ctx,assertReaderNamespace:async()=>false}),/READER_NAMESPACE_MISMATCH/);
 assert.equal((await task(a.id)).status,'attention_required');
});

test('final receipt transaction failure preserves attention_required and can resume after lease expiry',async()=>{
 const a=await setup();await minimize(a);await external(a);let fail=true;
 const reader={prepare:sql=>f.reader.prepare(sql),batch:statements=>f.reader.batch(statements)};
 // Intercept finalizer's distinctive lease update through its public prepare API.
 reader.prepare=sql=>{
  if(fail&&sql.startsWith('UPDATE r1_completion_jobs SET owner=NULL'))throw Error('final commit failed');
  return f.reader.prepare(sql);
 };
 const wrappedCtx={...ctx,assertReaderNamespace:async(db,namespace)=>(db===reader||db===f.reader)&&namespace===ctx.namespace};
 await assert.rejects(()=>completeSyntheticExecution(reader,f.control,a.id,a.registry,f.now+120_000,wrappedCtx),/final commit failed/);
 assert.equal((await task(a.id)).status,'attention_required');
 fail=false;const result=await completeSyntheticExecution(f.reader,f.control,a.id,a.registry,f.now+180_000,ctx);
 assert.equal(result.accountDeletionCompleted,true);
});
