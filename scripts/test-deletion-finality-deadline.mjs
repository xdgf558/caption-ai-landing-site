import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createExecutionFixture} from './fixtures/deletion-execution.mjs';
import {recordSyntheticCompletionReview,installSyntheticRestoreBarrier,claimSyntheticCompletion,finishSyntheticCompletion} from './isolated-lifecycle/finalizer.js';
import {requiredReviews} from './isolated-lifecycle/completion-contract.js';

let fixture;
before(async()=>{fixture=await createExecutionFixture();},{timeout:120000});
after(async()=>{await fixture?.close();},{timeout:30000});
async function ready(){
 const a=await fixture.account(),{policyDigest}=await fixture.prepare(a);
 for(const category of requiredReviews)await recordSyntheticCompletionReview(fixture.reader,a.id,{
  category,policyDigest,scopeVersion:'station-account-v1',confirmedAt:fixture.now,
  evidenceDigest:createHash('sha256').update(a.id+category).digest('hex'),reviewerRef:'synthetic-review-deadline'
 },fixture.now,fixture.options);
 await installSyntheticRestoreBarrier(fixture.reader,a.id,fixture.now,fixture.options);
 const ticket=await claimSyntheticCompletion(fixture.reader,a.id,randomUUID(),fixture.now,fixture.options);
 assert.ok(ticket);return {...a,ticket};
}
function delayedPrecheck(db,delayMs){
 let delayed=false;
 async function delay(){if(!delayed){delayed=true;await new Promise(resolve=>setTimeout(resolve,delayMs));}}
 const wrap=statement=>({
  rawStatement:statement,
  bind(...args){return wrap(statement.bind(...args));},
  async first(...args){await delay();return statement.first(...args);},
  async all(...args){await delay();return statement.all(...args);},
  run(...args){return statement.run(...args);}
 });
 return {prepare(sql){return wrap(db.prepare(sql));},batch:statements=>db.batch(statements.map(statement=>statement.rawStatement||statement)),didDelay:()=>delayed};
}

test('real D1 slow precheck cannot finish with a lease that expires during awaited verification',async()=>{
 const a=await ready(),db=fixture.reader;
 await db.prepare('UPDATE r1_completion_jobs SET lease_until=? WHERE id=?').bind(fixture.now+20,a.id).run();
 const before=await db.prepare('SELECT * FROM r1_completion_jobs WHERE id=?').bind(a.id).first();
 const taskBefore=await db.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(a.id).first();
 const slow=delayedPrecheck(db,80);
 await assert.rejects(()=>finishSyntheticCompletion(slow,a.ticket,fixture.now,fixture.options),/CHECK constraint failed/);
 assert.equal(slow.didDelay(),true);
 assert.deepEqual(await db.prepare('SELECT * FROM r1_completion_jobs WHERE id=?').bind(a.id).first(),before);
 assert.deepEqual(await db.prepare('SELECT * FROM mobile_deletions WHERE id=?').bind(a.id).first(),taskBefore);
 assert.equal(taskBefore.status,'attention_required');assert.equal(taskBefore.completed_at,null);
 assert.notEqual((await db.prepare('SELECT status FROM mobile_deletion_outbox WHERE job_id=?').bind(a.id).first()).status,'completed');
},{timeout:120000});

test('completion batch rechecks same-ticket reviews and retention boundaries after a ready preflight',async()=>{
 const db=fixture.reader;
 for(const mutation of ['financial_until','receipt_audit_until','stale_review','wrong_policy_review','wrong_scope_review']){
  const a=await ready(),before=await db.prepare('SELECT * FROM r1_completion_jobs WHERE id=?').bind(a.id).first();
  let injected=false,commitPrepared=false;
  const race={prepare:sql=>{if(sql.includes('UPDATE r1_completion_jobs SET owner=NULL'))commitPrepared=true;return db.prepare(sql);},batch:async statements=>{
   if(!commitPrepared)return db.batch(statements);
   assert.equal(injected,false);injected=true;
   if(mutation.endsWith('_until'))await db.prepare(`UPDATE r1_completion_jobs SET ${mutation}=? WHERE id=?`).bind(fixture.now-1,a.id).run();
   else if(mutation==='stale_review')await db.prepare("UPDATE r1_completion_reviews SET checked_at=? WHERE job_id=? AND category='providers'").bind(fixture.now-300001,a.id).run();
   else if(mutation==='wrong_policy_review')await db.prepare("UPDATE r1_completion_reviews SET policy_digest=? WHERE job_id=? AND category='providers'").bind('f'.repeat(64),a.id).run();
   else await db.prepare("UPDATE r1_completion_reviews SET scope_version='wrong-scope' WHERE job_id=? AND category='providers'").bind(a.id).run();
   return db.batch(statements);
  }};
  await assert.rejects(()=>finishSyntheticCompletion(race,a.ticket,fixture.now,fixture.options),/CHECK constraint failed/,mutation+' must be rejected inside the completion transaction');
  assert.equal(injected,true);
  const current=await db.prepare('SELECT * FROM r1_completion_jobs WHERE id=?').bind(a.id).first();
  assert.equal(current.owner,before.owner);assert.equal(current.version,before.version);assert.equal(current.lease_until,before.lease_until);
  assert.equal((await db.prepare('SELECT completed_at FROM mobile_deletions WHERE id=?').bind(a.id).first()).completed_at,null);
  assert.notEqual((await db.prepare('SELECT status FROM mobile_deletion_outbox WHERE job_id=?').bind(a.id).first()).status,'completed');
 }
},{timeout:120000});
