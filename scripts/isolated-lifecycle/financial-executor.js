// Actual field erasure in synthetic temporary D1 only. No Worker entry or production binding.
import {verifyPersonalDeletion} from './executor.js';
import {retentionSpecs,validateSyntheticRetentionPolicy,validateFinancialRetentionSchema,
 retentionPolicyDigest,planFinancialRetention,financialJsonShape} from './retention-plan.js';
import {financialPurgeOrder} from './financial-contract.js';
import {assertChanged,clearAssert} from '../../src/mobile/security.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,digest=/^[a-f0-9]{64}$/;
const tables=Object.keys(retentionSpecs),day=86400_000,lease=30_000;
const check=(ok,code)=>{if(!ok)throw Error(code);};
const binds=(s,a)=>Array(s.selectorBindings).fill(a);
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?
 Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(a,b)=>canonical(a)===canonical(b);
async function gate(db,options){
 check(options?.executionProfile==='synthetic-erasure-v1','ERASURE_PROFILE_REQUIRED');
 check(options?.environment==='isolated'&&options?.dataset==='synthetic-r1','ISOLATION_REQUIRED');
 // Each caller immediately runs verifyPersonalDeletion, which performs the full
 // schema/provenance/write-guard gate. Avoid duplicating that large read scan.
 await validateFinancialRetentionSchema(db);
 check(!(await db.prepare('SELECT 1 FROM r1_financial_write_permits LIMIT 1').first()),'FINANCIAL_PERMIT_LEAK');
}
async function taskAndJob(db,id,options){
 check(uuid.test(id),'INVALID_ID');await gate(db,options);
 const task=await verifyPersonalDeletion(db,id,options),job=await db.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(id).first();
 check(job&&job.account_id===task.account_id&&job.confirmed_at===task.confirmed_at,'FINANCIAL_JOB_REQUIRED');
 const policy=validateSyntheticRetentionPolicy(JSON.parse(job.policy_json));
 check(await retentionPolicyDigest(policy)===job.policy_digest&&policy.version===job.policy_version&&
  job.financial_until===task.confirmed_at+policy.financialDays*day,'POLICY_CHANGED');
 return {task,job,policy};
}

export async function prepareFinancialErasure(db,id,policy,now,options){
 check(uuid.test(id)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');await gate(db,options);
 const task=await verifyPersonalDeletion(db,id,options),normalized=validateSyntheticRetentionPolicy(policy);
 const policyDigest=await retentionPolicyDigest(normalized),financialUntil=task.confirmed_at+normalized.financialDays*day;
 check(now>=task.confirmed_at&&Number.isSafeInteger(financialUntil),'RETENTION_PERIOD_INVALID');
 for(const shapes of Object.values(normalized.jsonShapes))check(shapes.some(s=>same(s,financialJsonShape({}))),'MINIMAL_JSON_SHAPE_REQUIRED');
 if(await db.prepare('SELECT id FROM r1_financial_jobs WHERE id=?').bind(id).first()){
  const {job}=await taskAndJob(db,id,options);check(job.policy_digest===policyDigest,'POLICY_CHANGED');
  return {requestId:id,policyDigest,financialUntil,productionEnabled:false};
 }
 const plan=await planFinancialRetention(db,id,options,normalized);
 check(plan.status==='ready_for_synthetic_review','FINANCIAL_PLAN_BLOCKED:'+plan.blockers.join(','));
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO r1_financial_jobs(id,account_id,policy_version,policy_digest,policy_json,confirmed_at,financial_until)
   VALUES(?,?,?,?,?,?,?)`).bind(id,task.account_id,normalized.version,policyDigest,JSON.stringify(normalized),task.confirmed_at,financialUntil),
  db.prepare(`INSERT OR IGNORE INTO r1_financial_case_reviews(job_id,account_id,confirmed_at,policy_digest) VALUES(?,?,?,?)`)
   .bind(id,task.account_id,task.confirmed_at,policyDigest)
 ]);
 const {job}=await taskAndJob(db,id,options);
 check(job.policy_digest===policyDigest,'POLICY_CHANGED');
 return {requestId:id,policyDigest,financialUntil,productionEnabled:false};
}

// A separate privileged synthetic case decision. It neither refunds nor zeros a balance.
export async function resolveSyntheticFinancialCase(db,id,review,now,options){
 const {job,task}=await taskAndJob(db,id,options);
 check(Number.isSafeInteger(now)&&now>=task.confirmed_at,'INVALID_ARGUMENT');
 check(review&&Object.keys(review).sort().join(',')==='balanceDisposition,confirmedAt,decision,evidenceDigest,policyDigest,reviewerRef', 'INVALID_CASE_REVIEW');
 check(review.decision==='resolved-no-open-dispute'&&review.balanceDisposition==='zero-balance-confirmed'&&
  review.confirmedAt===task.confirmed_at&&review.policyDigest===job.policy_digest&&digest.test(review.evidenceDigest)&&
  /^synthetic-case-[a-z0-9-]{1,40}$/.test(review.reviewerRef),'INVALID_CASE_REVIEW');
 await db.batch([
  // Recheck the real retained balance in the same transaction; never manufacture zero.
  db.prepare(`UPDATE r1_financial_jobs SET version=version+1 WHERE id=? AND lease_until<=?
   AND NOT EXISTS(SELECT 1 FROM reader_credit_accounts WHERE account_id=? AND balance_credits!=0)`)
   .bind(id,now,task.account_id),assertChanged(db),
  db.prepare(`UPDATE r1_financial_case_reviews SET status='resolved',balance_disposition='zero-balance-confirmed',checked_at=?,evidence_digest=?,reviewer_ref=?
   WHERE job_id=? AND account_id=? AND policy_digest=? AND confirmed_at=?`)
   .bind(now,review.evidenceDigest,review.reviewerRef,id,task.account_id,job.policy_digest,task.confirmed_at),assertChanged(db),clearAssert(db)
 ]);
 return {productionEnabled:false,automaticRefund:false,automaticZero:false};
}

async function scan(db,account,policy){
 const counts={};
 for(const [table,s] of Object.entries(retentionSpecs)){
  const args=binds(s,account),count=(await db.prepare(`SELECT count(*) n FROM ${table} WHERE ${s.selector}`).bind(...args).first()).n;
  check(Number.isSafeInteger(count)&&count>=0,'INVALID_COUNT');counts[table]=count;
  if(s.classifications.account_id)check(!(await db.prepare(`SELECT 1 FROM ${table} WHERE ${s.selector} AND account_id IS NOT NULL AND account_id!=? LIMIT 1`).bind(...args,account).first()),'FINANCIAL_ACCOUNT_LINK_MISMATCH');
  for(const a of s.associations)check(!(await db.prepare(`SELECT 1 FROM ${table} WHERE ${s.selector} AND ${table}.${a.column} IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM ${a.parent} WHERE ${a.parentColumn}=${table}.${a.column} AND account_id=?) LIMIT 1`).bind(...args,account).first()),'FINANCIAL_ACCOUNT_LINK_MISMATCH');
  const json=s.reviewColumns.filter(c=>s.classifications[c]==='raw_json');
  if(!json.length)continue;
  check(count<=200,'FINANCIAL_JSON_SCAN_LIMIT');
  const rows=(await db.prepare(`SELECT ${json.join(',')} FROM ${table} WHERE ${s.selector} LIMIT 201`).bind(...args).all()).results;
  check(rows.length===count,'FINANCIAL_REVIEW_CHANGED');
  for(const row of rows)for(const column of json){
   const raw=row[column];check(raw===null||(typeof raw==='string'&&new TextEncoder().encode(raw).length<=65536),'INVALID_JSON');
   let shape;try{shape=financialJsonShape(raw===null?null:JSON.parse(raw));}catch{throw Error('UNKNOWN_JSON_SHAPE');}
   check(policy.jsonShapes[`${table}.${column}`].some(s=>same(s,shape)),'UNKNOWN_JSON_SHAPE');
  }
 }
 return counts;
}
async function caseReady(db,task,job,now){
 const c=await db.prepare('SELECT * FROM r1_financial_case_reviews WHERE job_id=?').bind(job.id).first();
 check(c&&c.account_id===task.account_id&&c.confirmed_at===task.confirmed_at&&c.policy_digest===job.policy_digest&&
  c.status==='resolved'&&c.balance_disposition==='zero-balance-confirmed'&&Number.isSafeInteger(c.checked_at)&&c.checked_at>=task.confirmed_at&&c.checked_at<=now&&
  digest.test(c.evidence_digest)&&/^synthetic-case-[a-z0-9-]{1,40}$/.test(c.reviewer_ref),'FINANCIAL_CASE_UNRESOLVED');
 check(!(await db.prepare('SELECT 1 FROM reader_credit_accounts WHERE account_id=? AND balance_credits!=0').bind(task.account_id).first()),'NONZERO_BALANCE_REQUIRES_CASE_HANDLING');
 return c;
}
export async function planFinancialErasure(db,id,now,options){
 check(Number.isSafeInteger(now),'INVALID_ARGUMENT');const {task,job,policy}=await taskAndJob(db,id,options);
 check(now>=task.confirmed_at,'TIME_BEFORE_CONFIRMATION');const counts=await scan(db,task.account_id,policy),blockers=[];
 if(['retained','purge'].includes(job.stage)){
  if(now<job.financial_until)blockers.push('RETENTION_NOT_EXPIRED');
  try{await caseReady(db,task,job,now);}catch(error){blockers.push(error.message);}
 }
 return {stage:job.stage,counts,blockers,financialUntil:job.financial_until,productionEnabled:false,accountDeletionCompleted:false};
}
export async function claimFinancialErasure(db,id,owner,now,options){
 check(uuid.test(owner)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');const {task,job}=await taskAndJob(db,id,options);
 check(now>=task.confirmed_at,'TIME_BEFORE_CONFIRMATION');
 if(job.stage==='purged'||(job.stage==='retained'&&now<job.financial_until))return null;
 if(['retained','purge'].includes(job.stage))await caseReady(db,task,job,now);
 const row=await db.prepare(`UPDATE r1_financial_jobs SET owner=?,lease_until=?,version=version+1,
  cursor=CASE WHEN stage='retained' THEN 0 ELSE cursor END,stage=CASE WHEN stage='retained' THEN 'purge' ELSE stage END
  WHERE id=? AND lease_until<=? AND policy_digest=? AND confirmed_at=? AND stage!='purged' RETURNING *`)
  .bind(owner,now+lease,id,now,job.policy_digest,task.confirmed_at).first();
 return row?{id,owner,version:row.version,stage:row.stage,cursor:row.cursor,policyDigest:row.policy_digest,account:row.account_id}:null;
}

export async function runFinancialErasureStep(db,ticket,now,options){
 const started=performance.now();
 check(ticket&&uuid.test(ticket.id)&&uuid.test(ticket.owner)&&Number.isSafeInteger(now)&&['minimize','purge'].includes(ticket.stage),'INVALID_TICKET');
 const {task,job,policy}=await taskAndJob(db,ticket.id,options);
 check(ticket.account===task.account_id&&ticket.policyDigest===job.policy_digest&&ticket.cursor===job.cursor,'STALE_TICKET');
 check(now>=task.confirmed_at,'TIME_BEFORE_CONFIRMATION');await scan(db,task.account_id,policy);
 let caseReview;
 if(ticket.stage==='purge'){check(now>=job.financial_until&&job.minimized_at!==null,'RETENTION_NOT_EXPIRED');caseReview=await caseReady(db,task,job,now);}
 const order=ticket.stage==='minimize'?tables:financialPurgeOrder,table=order[ticket.cursor];
 check(table,'INVALID_CURSOR');const spec=retentionSpecs[table];
 const dirty=spec.reviewColumns.map(c=>`(${c} IS NOT NULL AND ${c}!=?)`).join(' OR ');
 const args=[...binds(spec,task.account_id),...(ticket.stage==='minimize'?spec.reviewColumns.map(c=>spec.emptyValues[c]):[])];
 const rows=ticket.stage==='minimize'&&!spec.reviewColumns.length?[]:(await db.prepare(`SELECT rowid __rowid FROM ${table} WHERE ${spec.selector}
  ${ticket.stage==='minimize'?`AND (${dirty})`:''} ORDER BY rowid LIMIT 200`).bind(...args).all()).results;
 const writes=[];
 if(ticket.stage==='purge')writes.push(db.prepare(`INSERT INTO mobile_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM r1_financial_case_reviews
  WHERE job_id=? AND account_id=? AND policy_digest=? AND confirmed_at=? AND status='resolved' AND balance_disposition='zero-balance-confirmed'
  AND checked_at=? AND evidence_digest=? AND reviewer_ref=?)
  AND NOT EXISTS(SELECT 1 FROM reader_credit_accounts WHERE account_id=? AND balance_credits!=0) THEN 1 ELSE 0 END`)
  .bind(ticket.id,task.account_id,job.policy_digest,task.confirmed_at,caseReview.checked_at,caseReview.evidence_digest,caseReview.reviewer_ref,task.account_id));
 // Charge every async preflight/scan to the fixed claim's lease before submission.
 const commitNow=now+Math.ceil(performance.now()-started);
 if(rows.length){
  writes.push(db.prepare('INSERT INTO r1_financial_write_permits VALUES(?,?,?,?,?,?,?,?)')
   .bind(ticket.id,task.account_id,table,ticket.stage,JSON.stringify(rows.map(r=>r.__rowid)),ticket.owner,ticket.version+1,commitNow));
  if(ticket.stage==='minimize')writes.push(db.prepare(`UPDATE ${table} SET ${spec.reviewColumns.map(c=>`${c}=CASE WHEN ${c} IS NULL THEN NULL ELSE ? END`).join(',')}
   WHERE rowid IN (SELECT value FROM json_each(?))`).bind(...spec.reviewColumns.map(c=>spec.emptyValues[c]),JSON.stringify(rows.map(r=>r.__rowid))));
  else writes.push(db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(rows.map(r=>r.__rowid))));
  writes.push(db.prepare('DELETE FROM r1_financial_write_permits WHERE job_id=?').bind(ticket.id));
 }
 const cursor=rows.length?ticket.cursor:ticket.cursor+1,finished=cursor===order.length;
 const nextStage=finished?(ticket.stage==='minimize'?'retained':'purged'):ticket.stage;
 await db.batch([
  db.prepare(`UPDATE r1_financial_jobs SET version=version+1 WHERE id=? AND owner=? AND version=? AND stage=? AND cursor=?
   AND policy_digest=? AND confirmed_at=? AND lease_until>?
   AND EXISTS(SELECT 1 FROM mobile_deletions WHERE id=? AND confirmed_at=?)
   AND (?!='purge' OR financial_until<=?)`)
   .bind(ticket.id,ticket.owner,ticket.version,ticket.stage,ticket.cursor,job.policy_digest,task.confirmed_at,commitNow,ticket.id,task.confirmed_at,ticket.stage,commitNow),assertChanged(db),
  ...writes,
  db.prepare(`UPDATE r1_financial_jobs SET stage=?,cursor=?,owner=NULL,lease_until=0,
   minimized_at=CASE WHEN ?='retained' THEN ? ELSE minimized_at END,purged_at=CASE WHEN ?='purged' THEN ? ELSE purged_at END WHERE id=?`)
   .bind(nextStage,cursor,nextStage,commitNow,nextStage,commitNow,ticket.id),clearAssert(db)
 ]);
 return {stage:nextStage,table,changedRows:rows.length,productionEnabled:false,automaticRefund:false,automaticZero:false,accountDeletionCompleted:false};
}
