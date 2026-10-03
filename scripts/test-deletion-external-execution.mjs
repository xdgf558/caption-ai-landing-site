import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createExecutionFixture} from './fixtures/deletion-execution.mjs';
import {createSyntheticCleanupAdapter,prepareExternalCleanup,claimExternalCleanup,runExternalCleanupStep,verifyExternalCleanup} from './isolated-lifecycle/external-cleanup.js';
let f;
before(async()=>{f=await createExecutionFixture();},{timeout:120000});
after(async()=>{await f?.close();},{timeout:30000});
async function setup(){const a=await f.account();await f.prepare(a);const registry=await f.adapters(),manifest=await f.resources(a);
 await prepareExternalCleanup(f.reader,a.id,manifest,registry,f.options);return {...a,registry,manifest};}
async function drain(a,now=f.now){for(let i=0;i<8;i++){
 const ticket=await claimExternalCleanup(f.reader,a.id,randomUUID(),now,f.options);if(!ticket)return;
 assert.equal((await runExternalCleanupStep(f.reader,ticket,now,a.registry,f.options)).verified,true);
}throw Error('EXTERNAL_FIXTURE_STALLED');}
async function rows(id){return (await f.reader.prepare('SELECT * FROM r1_external_cleanup_tasks WHERE job_id=? ORDER BY id').bind(id).all()).results;}

test('all categories require actual distinct-store erasure and independent readback; another account survives',async()=>{
 const a=await setup(),b=await setup();
 await assert.rejects(()=>verifyExternalCleanup(f.reader,a.id,a.registry,f.options),/EXTERNAL_TASK_NOT_VERIFIED/);
 await drain(a);const proof=await verifyExternalCleanup(f.reader,a.id,a.registry,f.options);
 assert.deepEqual(Object.keys(proof.categories).sort(),['admin_audit','backups','providers','soft_links']);
 assert.equal(proof.productionEnabled,false);
 for(const r of a.manifest)assert.equal((await f.external.prepare('SELECT count(*) n FROM r1_external_fixture_records WHERE resource_ref=?').bind(r.resourceRef).first()).n,0);
 for(const r of b.manifest)assert.equal((await f.external.prepare('SELECT count(*) n FROM r1_external_fixture_records WHERE resource_ref=?').bind(r.resourceRef).first()).n,1);
 assert.equal((await f.reader.prepare('SELECT status FROM mobile_deletions WHERE id=?').bind(a.id).first()).status,'attention_required');
});
test('sealed scope, store identity and operation IDs cannot be replaced on retry; forged adapters are rejected',async()=>{
 const a=await setup(),before=await rows(a.id);
 await prepareExternalCleanup(f.reader,a.id,a.manifest,a.registry,f.options);assert.deepEqual(await rows(a.id),before);
 const altered=structuredClone(a.manifest);altered[0].resourceRef='fixture-'+randomUUID();
 await assert.rejects(()=>prepareExternalCleanup(f.reader,a.id,altered,a.registry,f.options));assert.deepEqual(await rows(a.id),before);
 for(const manifest of [a.manifest.slice(1),a.manifest.map((r,i)=>i? r:{...r,storeId:randomUUID()})])
  await assert.rejects(()=>prepareExternalCleanup(f.reader,a.id,manifest,a.registry,f.options));
 const forged={[f.externalIdentity.adapterId]:{...a.registry[f.externalIdentity.adapterId],erase:async()=>{},inspect:async()=>({effectDigest:'a'.repeat(64)})}};
 await assert.rejects(()=>prepareExternalCleanup(f.reader,a.id,a.manifest,forged,f.options),/UNSUPPORTED_EXTERNAL_ADAPTER/);
 await assert.rejects(()=>prepareExternalCleanup(f.reader,a.id,a.manifest,a.registry,{...f.options,environment:'production'}),/ISOLATION/);
 await assert.rejects(()=>createSyntheticCleanupAdapter(f.reader,f.externalIdentity),/EXTERNAL_SCHEMA_DRIFT/);
});
test('provider transport failure preserves operation and retries only after its durable backoff',async()=>{
 const a=await setup();let fail=true;
 const transport={prepare:sql=>f.external.prepare(sql),async batch(statements){if(fail)throw Error('private credential must never escape');return f.external.batch(statements);}};
 const registry=await f.adapters(transport),ticket=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options);
 const result=await runExternalCleanupStep(f.reader,ticket,f.now,registry,f.options);
 assert.equal(result.verified,false);assert.ok(result.retryAt>f.now);
 const failed=(await rows(a.id)).find(r=>r.id===ticket.id);assert.equal(failed.last_error,'EXTERNAL_EFFECT_UNVERIFIED');assert.equal(failed.operation_id,ticket.operationId);
 // Finish unrelated ready tasks, then only the delayed original remains.
 await drain(a);assert.equal(await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options),null);
 fail=false;const retry=await claimExternalCleanup(f.reader,a.id,randomUUID(),result.retryAt,f.options);
 assert.equal(retry.operationId,ticket.operationId);assert.equal((await runExternalCleanupStep(f.reader,retry,result.retryAt,registry,f.options)).verified,true);
 await verifyExternalCleanup(f.reader,a.id,registry,f.options);
});
test('effect committed but checkpoint lost is replayed under the same operation after restart',async()=>{
 const a=await setup(),ticket=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options);
 const crashDB={prepare(sql){
  if(sql.startsWith('UPDATE r1_external_cleanup_tasks SET status='))throw Error('simulated crash before checkpoint');
  return f.reader.prepare(sql);
 },batch:statements=>f.reader.batch(statements)};
 await assert.rejects(()=>runExternalCleanupStep(crashDB,ticket,f.now,a.registry,f.options),/simulated crash/);
 const saved=await f.external.prepare('SELECT * FROM r1_external_fixture_deletions WHERE operation_id=?').bind(ticket.operationId).first();assert.ok(saved);
 assert.equal((await rows(a.id)).find(r=>r.id===ticket.id).status,'working');
 await f.restart();a.registry=await f.adapters();
 const retry=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now+31_000,f.options);assert.equal(retry.operationId,ticket.operationId);
 await runExternalCleanupStep(f.reader,retry,f.now+31_000,a.registry,f.options);
 assert.deepEqual(await f.external.prepare('SELECT * FROM r1_external_fixture_deletions WHERE operation_id=?').bind(ticket.operationId).first(),saved);
 await drain(a,f.now+31_000);await verifyExternalCleanup(f.reader,a.id,a.registry,f.options);
});
test('independent readback failure cannot publish verified; retry observes the durable erasure',async()=>{
 const a=await setup();let deny=false;
 const transport={prepare(sql){if(deny&&sql.startsWith('SELECT * FROM r1_external_fixture_deletions'))throw Error('readback unavailable');return f.external.prepare(sql);},async batch(statements){const r=await f.external.batch(statements);deny=true;return r;}};
 const registry=await f.adapters(transport),ticket=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options);
 const result=await runExternalCleanupStep(f.reader,ticket,f.now,registry,f.options);assert.equal(result.verified,false);
 assert.ok(await f.external.prepare('SELECT 1 FROM r1_external_fixture_deletions WHERE operation_id=?').bind(ticket.operationId).first());
 await assert.rejects(()=>verifyExternalCleanup(f.reader,a.id,registry,f.options));
 deny=false;await drain(a);const retry=await claimExternalCleanup(f.reader,a.id,randomUUID(),result.retryAt,f.options);assert.equal(retry.operationId,ticket.operationId);
 await runExternalCleanupStep(f.reader,retry,result.retryAt,a.registry,f.options);await verifyExternalCleanup(f.reader,a.id,a.registry,f.options);
});
test('expired and superseded leases cannot perform an external effect',async()=>{
 const a=await setup(),old=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options);
 const current=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now+30_000,f.options);assert.equal(current.id,old.id);
 await assert.rejects(()=>runExternalCleanupStep(f.reader,old,f.now+30_000,a.registry,f.options),/STALE_EXTERNAL_TICKET/);
 assert.equal(await f.external.prepare('SELECT 1 FROM r1_external_fixture_deletions WHERE operation_id=?').bind(old.operationId).first(),null);
 await runExternalCleanupStep(f.reader,current,f.now+30_000,a.registry,f.options);
});
test('a worker success flag is insufficient without the separately persisted external effect',async()=>{
 const a=await setup();
 await f.reader.prepare("UPDATE r1_external_cleanup_tasks SET status='verified',verified_at=?,evidence_digest=? WHERE job_id=?").bind(f.now,'a'.repeat(64),a.id).run();
 await assert.rejects(()=>verifyExternalCleanup(f.reader,a.id,a.registry,f.options),/EXTERNAL_EFFECT_UNVERIFIED/);
 assert.equal((await f.reader.prepare('SELECT status FROM mobile_deletions WHERE id=?').bind(a.id).first()).status,'attention_required');
});
test('external tombstones survive restart and prevent late recreation or resource reassignment',async()=>{
 const a=await setup();await drain(a);await f.restart();a.registry=await f.adapters();
 await verifyExternalCleanup(f.reader,a.id,a.registry,f.options);
 for(const r of a.manifest){
  await assert.rejects(()=>f.external.prepare('INSERT INTO r1_external_fixture_records VALUES(?,?,?)').bind(randomUUID(),r.resourceRef,'late private data').run(),/R1_EXTERNAL_ERASED/);
  await assert.rejects(()=>f.external.prepare('UPDATE r1_external_fixture_resources SET account_id=? WHERE resource_ref=?').bind(a.account+10000,r.resourceRef).run(),/R1_EXTERNAL_IDENTITY_IMMUTABLE/);
  await assert.rejects(()=>f.external.prepare('DELETE FROM r1_external_fixture_deletions WHERE resource_ref=?').bind(r.resourceRef).run(),/R1_EXTERNAL_ERASED/);
 }
 await assert.rejects(()=>f.external.prepare('INSERT INTO r1_external_fixture_resources VALUES(?,?,?)').bind('fixture-'+randomUUID(),a.account,'providers').run(),/R1_EXTERNAL_ERASED/);
});

test('unlisted resources prevent completion even when all listed effects were verified',async()=>{
 const a=await setup();
 await f.resources(a); // Simulates new inventory found after sealing the plan.
 await drain(a);
 await assert.rejects(()=>verifyExternalCleanup(f.reader,a.id,a.registry,f.options),/EXTERNAL_INVENTORY_MISMATCH/);
 assert.equal((await f.reader.prepare('SELECT status FROM mobile_deletions WHERE id=?').bind(a.id).first()).status,'attention_required');
 const b=await f.account();await f.prepare(b);const registry=await f.adapters(),first=await f.resources(b);await f.resources(b);
 await assert.rejects(()=>prepareExternalCleanup(f.reader,b.id,first,registry,f.options),/EXTERNAL_INVENTORY_MISMATCH/);
});

test('preflight delay cannot erase a resource after the ticket lease has expired',async()=>{
 const a=await setup(),ticket=await claimExternalCleanup(f.reader,a.id,randomUUID(),f.now,f.options);
 await f.reader.prepare('UPDATE r1_external_cleanup_tasks SET lease_until=? WHERE id=?').bind(f.now+20,ticket.id).run();
 const delayed={batch:statements=>f.reader.batch(statements),prepare(sql){
  const statement=f.reader.prepare(sql);if(!sql.startsWith('SELECT * FROM r1_external_cleanup_scopes'))return statement;
  return {bind(...args){const bound=statement.bind(...args);return {async first(){await new Promise(resolve=>setTimeout(resolve,50));return bound.first();}};}};
 }};
 await assert.rejects(()=>runExternalCleanupStep(delayed,ticket,f.now,a.registry,f.options));
 assert.equal(await f.external.prepare('SELECT 1 FROM r1_external_fixture_deletions WHERE operation_id=?').bind(ticket.operationId).first(),null);
});
