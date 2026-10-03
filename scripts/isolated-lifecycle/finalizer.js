// Conditional finality experiment, only for synthetic R1. No src/ import,
// scheduler, HTTP handler, production approval, payment or provider calls.
import {assertSyntheticIsolation,verifyPersonalDeletion} from './executor.js';
import {requiredReviews} from './completion-contract.js';
import {retentionSpecs,validateSyntheticRetentionPolicy,planFinancialRetention,retentionPolicyDigest} from './retention-plan.js';
import {assertChanged,clearAssert} from '../../src/mobile/security.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=/^[a-f0-9]{64}$/;
const day=86400_000,lease=30_000,reviewFreshness=300_000;
function check(ok,code){if(!ok)throw Error(code);}
function completionClock(now){
 const started=performance.now();
 return ()=>{const current=now+Math.max(0,Math.ceil(performance.now()-started));check(Number.isSafeInteger(current),'INVALID_ARGUMENT');return current;};
}
async function gate(db,options){
 check(options?.completionProfile==='synthetic-finality-v1','FINALITY_PROFILE_REQUIRED');
 await assertSyntheticIsolation(db,options);
}
const readJob=(db,id)=>db.prepare('SELECT * FROM r1_completion_jobs WHERE id=?').bind(id).first();
const binds=(spec,account)=>Array(spec.selectorBindings||1).fill(account);
const jobPolicy=row=>JSON.parse(row.policy_json);
function response(blockers){return {ready:blockers.length===0,blockers:[...new Set(blockers)].sort(),productionEnabled:false};}

export async function prepareSyntheticCompletion(db,id,policy,now,options){
 check(uuid.test(id)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');await gate(db,options);
 const task=await verifyPersonalDeletion(db,id,options);
 const normalized=validateSyntheticRetentionPolicy(policy);
 const policyDigest=await retentionPolicyDigest(normalized);
 const financialUntil=task.confirmed_at+normalized.financialDays*day;
 const receiptUntil=task.confirmed_at+normalized.receiptDays*day;
 check(Number.isSafeInteger(financialUntil)&&Number.isSafeInteger(receiptUntil)&&financialUntil>now&&
  receiptUntil>now&&receiptUntil>=task.receipt_until,'RETENTION_PERIOD_INVALID');
 await db.prepare(`INSERT OR IGNORE INTO r1_completion_jobs(id,policy_version,policy_digest,policy_json,financial_until,receipt_audit_until)
  VALUES(?,?,?,?,?,?)`).bind(id,normalized.version,policyDigest,JSON.stringify(normalized),financialUntil,receiptUntil).run();
 const row=await readJob(db,id);
 check(row.policy_digest===policyDigest&&row.policy_version===normalized.version&&
  row.financial_until===financialUntil&&row.receipt_audit_until===receiptUntil,'POLICY_CHANGED');
 return {policyDigest,productionEnabled:false};
}

// Privileged, offline review registration for the synthetic demonstration.
// A digest is a reference to separately inspected evidence, not proof by itself.
// No external provider/backup adapter exists here; production must not call this.
export async function recordSyntheticCompletionReview(db,id,review,now,options){
 await gate(db,options);check(uuid.test(id)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');
 const task=await verifyPersonalDeletion(db,id,options),row=await readJob(db,id);
 check(row&&task.status!=='completed','COMPLETION_NOT_REVIEWABLE');
 check(review&&Object.keys(review).sort().join(',')===
  'category,confirmedAt,evidenceDigest,policyDigest,reviewerRef,scopeVersion','INVALID_REVIEW');
 check(requiredReviews.includes(review.category)&&review.policyDigest===row.policy_digest&&
  review.scopeVersion===task.scope_version&&review.confirmedAt===task.confirmed_at&&
  digest.test(review.evidenceDigest)&&/^synthetic-review-[a-z0-9-]{1,40}$/.test(review.reviewerRef)&&
  now>=task.personal_completed_at&&now<row.financial_until&&now<row.receipt_audit_until,'INVALID_REVIEW');
 // No current consumer holds a lease while evidence is being replaced.
 await db.batch([
  db.prepare('UPDATE r1_completion_jobs SET version=version+1 WHERE id=? AND lease_until<=?').bind(id,now),assertChanged(db),
  db.prepare(`INSERT INTO r1_completion_reviews VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(job_id,category) DO UPDATE SET
   policy_digest=excluded.policy_digest,scope_version=excluded.scope_version,confirmed_at=excluded.confirmed_at,
   checked_at=excluded.checked_at,evidence_digest=excluded.evidence_digest,reviewer_ref=excluded.reviewer_ref`)
   .bind(id,review.category,review.policyDigest,review.scopeVersion,review.confirmedAt,now,review.evidenceDigest,review.reviewerRef),clearAssert(db)
 ]);
}

export async function installSyntheticRestoreBarrier(db,id,now,options){
 await gate(db,options);const task=await verifyPersonalDeletion(db,id,options),row=await readJob(db,id);
 check(row&&Number.isSafeInteger(now)&&now>=task.confirmed_at,'POLICY_REQUIRED');
 await db.prepare('INSERT OR IGNORE INTO r1_backup_barriers VALUES(?,?,?,?,?,?)')
  .bind(task.account_id,id,task.scope_version,task.confirmed_at,row.policy_digest,now).run();
 const barrier=await db.prepare('SELECT * FROM r1_backup_barriers WHERE account_id=?').bind(task.account_id).first();
 check(barrier.job_id===id&&barrier.scope_version===task.scope_version&&barrier.confirmed_at===task.confirmed_at&&
  barrier.policy_digest===row.policy_digest,'RESTORE_BARRIER_CONFLICT');
}

// The control DB must be the current deletion ledger, NEVER the old snapshot.
// This preflight is intentionally not a platform-backup restore implementation.
export async function assertSyntheticAccountRestorable(controlDB,account,options){
 await gate(controlDB,options);check(Number.isSafeInteger(account)&&account>0,'INVALID_ACCOUNT');
 check(!(await controlDB.prepare('SELECT 1 FROM r1_backup_barriers WHERE account_id=?').bind(account).first()),'DELETED_ACCOUNT_RESTORE_BLOCKED');
 check((await controlDB.prepare('SELECT status FROM reader_accounts WHERE id=?').bind(account).first())?.status==='active','INACTIVE_ACCOUNT_RESTORE_BLOCKED');
}

async function retainedFieldsMinimal(db,account){
 for(const [table,spec] of Object.entries(retentionSpecs)){
  for(const column of spec.reviewColumns){
   const expected=spec.emptyValues[column];
   const row=await db.prepare(`SELECT 1 FROM ${table} WHERE (${spec.selector}) AND ${column} IS NOT NULL AND ${column}!=? LIMIT 1`)
    .bind(...binds(spec,account),expected).first();
   if(row)return false;
  }
 }
 return true;
}

async function completionReadiness(db,id,now,options,clock){
 await gate(db,options);check(uuid.test(id)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');
 const task=await verifyPersonalDeletion(db,id,options),row=await readJob(db,id),blockers=[];
 if(!row)return response(['RETENTION_POLICY_REQUIRED','EXTERNAL_REVIEWS_REQUIRED','RESTORE_BARRIER_REQUIRED']);
 const policy=jobPolicy(row);
 check(await retentionPolicyDigest(validateSyntheticRetentionPolicy(policy))===row.policy_digest,'POLICY_CHANGED');
 const plan=await planFinancialRetention(db,id,options,policy);
 if(plan.status!=='ready_for_synthetic_review')blockers.push('FINANCIAL_PLAN_BLOCKED');
 if(!await retainedFieldsMinimal(db,task.account_id))blockers.push('FINANCIAL_MINIMIZATION_REQUIRED');
 const reviews=(await db.prepare('SELECT * FROM r1_completion_reviews WHERE job_id=?').bind(id).all()).results;
 const b=await db.prepare('SELECT * FROM r1_backup_barriers WHERE account_id=?').bind(task.account_id).first();
 // Every awaited schema/personal/financial/barrier read consumes validity time.
 now=clock();
 if(now<task.confirmed_at||row.financial_until<=now||row.receipt_audit_until<=now)blockers.push('RETENTION_PERIOD_INVALID');
 for(const category of requiredReviews){
  if(!reviews.some(x=>x.category===category&&x.policy_digest===row.policy_digest&&x.scope_version===task.scope_version&&
   x.confirmed_at===task.confirmed_at&&x.checked_at>=Math.max(task.personal_completed_at,now-reviewFreshness)&&x.checked_at<=now&&
   digest.test(x.evidence_digest)))blockers.push('REVIEW_REQUIRED_'+category.toUpperCase());
 }
 if(!b||b.job_id!==id||b.policy_digest!==row.policy_digest||b.confirmed_at!==task.confirmed_at||b.scope_version!==task.scope_version)
  blockers.push('RESTORE_BARRIER_REQUIRED');
 return response(blockers);
}
export async function syntheticCompletionReadiness(db,id,now,options){
 check(uuid.test(id)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');
 return completionReadiness(db,id,now,options,completionClock(now));
}

export async function claimSyntheticCompletion(db,id,owner,now,options){
 await gate(db,options);check(uuid.test(id)&&uuid.test(owner)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');
 await verifyPersonalDeletion(db,id,options);
 const row=await db.prepare(`UPDATE r1_completion_jobs SET owner=?,lease_until=?,version=version+1
  WHERE id=? AND lease_until<=? AND EXISTS(SELECT 1 FROM mobile_deletions WHERE id=? AND status='attention_required') RETURNING *`)
  .bind(owner,now+lease,id,now,id).first();
 return row?{id,owner,version:row.version,policyDigest:row.policy_digest}:null;
}

export async function finishSyntheticCompletion(db,ticket,now,options){
 check(ticket&&uuid.test(ticket.id)&&uuid.test(ticket.owner)&&Number.isSafeInteger(now),'INVALID_TICKET');
 const clock=completionClock(now);
 await gate(db,options);
 const readiness=await completionReadiness(db,ticket.id,now,options,clock);
 const task=await verifyPersonalDeletion(db,ticket.id,options);
 const writes=[],timeChecks=[],completionWrites=[];
 if(readiness.ready){
  // Pin time and evidence to the same claimed ticket INSIDE the completion batch.
  // The lease CAS below advances exactly this ticket's version before these checks.
  const deadlineCheck=db.prepare(`INSERT INTO mobile_assert(value) SELECT CASE WHEN EXISTS(
   SELECT 1 FROM r1_completion_jobs c JOIN mobile_deletions d ON d.id=c.id JOIN r1_deletion_jobs j ON j.id=d.id
   WHERE c.id=? AND c.policy_digest=? AND c.version=? AND c.financial_until>? AND c.receipt_audit_until>?
   AND d.account_id=? AND d.scope_version=? AND d.confirmed_at=? AND d.confirmed_at<=?
   AND d.status='attention_required' AND j.personal_completed_at=?
   AND EXISTS(SELECT 1 FROM r1_backup_barriers b WHERE b.account_id=d.account_id AND b.job_id=d.id
    AND b.scope_version=d.scope_version AND b.confirmed_at=d.confirmed_at AND b.policy_digest=c.policy_digest)
   ) THEN 1 ELSE 0 END`);
  timeChecks.push(commitNow=>deadlineCheck.bind(ticket.id,ticket.policyDigest,ticket.version+1,commitNow,commitNow,
    task.account_id,task.scope_version,task.confirmed_at,commitNow,task.personal_completed_at));
  for(const category of requiredReviews){const reviewCheck=db.prepare(`INSERT INTO mobile_assert(value) SELECT CASE WHEN EXISTS(
   SELECT 1 FROM r1_completion_reviews r WHERE r.job_id=? AND r.category=? AND r.policy_digest=?
   AND r.scope_version=? AND r.confirmed_at=? AND r.checked_at>=MAX(?,?) AND r.checked_at<=?
   AND length(r.evidence_digest)=64 AND r.evidence_digest NOT GLOB '*[^0-9a-f]*'
   ) THEN 1 ELSE 0 END`);
   timeChecks.push(commitNow=>reviewCheck.bind(ticket.id,category,ticket.policyDigest,task.scope_version,task.confirmed_at,
    task.personal_completed_at,commitNow-reviewFreshness,commitNow));}
  // Recheck raw financial fields and account-owned reset counters INSIDE the
  // same D1 transaction as the completion flag, not just during the read plan.
  for(const [table,spec] of Object.entries(retentionSpecs)){
   // Separate assertions keep each prepared statement's binding count bounded.
   const conditions=[],args=[];
   for(const column of spec.reviewColumns){
    conditions.push(`NOT EXISTS(SELECT 1 FROM ${table} WHERE (${spec.selector}) AND ${column} IS NOT NULL AND ${column}!=?)`);
    args.push(...binds(spec,task.account_id),spec.emptyValues[column]);
   }
   if(spec.classifications.account_id){
    conditions.push(`NOT EXISTS(SELECT 1 FROM ${table} WHERE (${spec.selector}) AND account_id IS NOT NULL AND account_id!=?)`);
    args.push(...binds(spec,task.account_id),task.account_id);
   }
   for(const {column,parent,parentColumn} of spec.associations){
    conditions.push(`NOT EXISTS(SELECT 1 FROM ${table} WHERE (${spec.selector}) AND ${table}.${column} IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM ${parent} WHERE ${parent}.${parentColumn}=${table}.${column} AND ${parent}.account_id=?))`);
    args.push(...binds(spec,task.account_id),task.account_id);
   }
   if(spec.reviewColumns.some(c=>spec.classifications[c]==='raw_json')){
    conditions.push(`(SELECT count(*) FROM ${table} WHERE (${spec.selector}))<=200`);
    args.push(...binds(spec,task.account_id));
   }
   if(conditions.length)writes.push(db.prepare(`INSERT INTO mobile_assert(value) SELECT CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE 0 END`).bind(...args));
  }
  const complete=db.prepare(`UPDATE mobile_deletions SET status='completed',stage='completed',completed_at=? WHERE id=? AND status='attention_required'
   AND NOT EXISTS(SELECT 1 FROM reader_totp_reset_attempts WHERE scope='account' AND scope_key=?)`),completedCheck=assertChanged(db);
  const outbox=db.prepare("UPDATE mobile_deletion_outbox SET status='completed',updated_at=? WHERE job_id=?");
  const financialReview=db.prepare("UPDATE r1_financial_reviews SET status='independent_review' WHERE job_id=?").bind(ticket.id);
  completionWrites.push(commitNow=>complete.bind(commitNow,ticket.id,String(task.account_id)),()=>completedCheck,
   commitNow=>outbox.bind(commitNow,ticket.id),()=>financialReview);
 }
 const claimUpdate=db.prepare(`UPDATE r1_completion_jobs SET owner=NULL,lease_until=0,version=version+1,last_checked_at=?,last_blockers=?
   WHERE id=? AND owner=? AND version=? AND policy_digest=? AND lease_until>?`),claimCheck=assertChanged(db),clear=clearAssert(db);
 // Capture immediately before binding/submitting, after all awaited reads and SQL preparation.
 const commitNow=clock();
 await db.batch([
  claimUpdate.bind(commitNow,JSON.stringify(readiness.blockers),ticket.id,ticket.owner,ticket.version,ticket.policyDigest,commitNow),claimCheck,
  ...timeChecks.map(bind=>bind(commitNow)),...writes,...completionWrites.map(bind=>bind(commitNow)),clear
 ]);
 return {...readiness,accountDeletionCompleted:readiness.ready};
}
