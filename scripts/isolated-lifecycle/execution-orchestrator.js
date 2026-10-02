// Synthetic execution coordinator. This is not a production deletion endpoint.
// CONTROL, protected anchor, reader and external service are separate stores;
// no transaction spanning those stores is claimed or attempted.
import {verifyPersonalDeletion} from './executor.js';
import {readControlSnapshot,readControlTombstones,assertControlSnapshot,controlHash} from './control-ledger.js';
import {planFinancialErasure} from './financial-executor.js';
import {verifyExternalCleanup} from './external-cleanup.js';
import {recordSyntheticCompletionReview,installSyntheticRestoreBarrier,claimSyntheticCompletion,finishSyntheticCompletion} from './finalizer.js';

const check=(ok,code)=>{if(!ok)throw Error(code);};
async function executionEvidence(reader,control,id,registry,now,ctx) {
 check(ctx?.executionProfile==='synthetic-erasure-v1'&&reader!==control,'EXECUTION_PROFILE_REQUIRED');
 check(await ctx.assertReaderNamespace?.(reader,ctx.namespace),'READER_NAMESPACE_MISMATCH');
 const task=await verifyPersonalDeletion(reader,id,ctx);
 const snapshot=await readControlSnapshot(control,ctx);
 const tombstones=await readControlTombstones(control,snapshot,ctx);
 const tombstone=tombstones.find(row=>row.job_id===id&&row.account_id===task.account_id&&
  row.scope_version===task.scope_version&&row.confirmed_at===task.confirmed_at);
 check(tombstone,'INDEPENDENT_DELETION_BARRIER_REQUIRED');
 const completion=await reader.prepare('SELECT * FROM r1_completion_jobs WHERE id=?').bind(id).first();
 const financial=await reader.prepare('SELECT * FROM r1_financial_jobs WHERE id=?').bind(id).first();
 check(completion&&financial?.stage==='retained'&&financial.minimized_at!==null&&
  financial.confirmed_at===task.confirmed_at&&financial.account_id===task.account_id&&
  financial.policy_digest===completion.policy_digest&&financial.financial_until===completion.financial_until,
  'FINANCIAL_EXECUTION_REQUIRED');
 check(now>=financial.minimized_at&&now<financial.financial_until,'RETENTION_PERIOD_INVALID');
 // Recheck schema, pinned policy, JSON and exact account links. The expected
 // retention/case blockers concern later expiry purge, not personal completion.
 await planFinancialErasure(reader,id,now,ctx);
 const external=await verifyExternalCleanup(reader,id,registry,ctx);
 check(external.policyDigest===completion.policy_digest,'EXECUTION_POLICY_MISMATCH');
 await assertControlSnapshot(control,snapshot,ctx);
 return {task,snapshot,tombstone,external,financial};
}

export async function completeSyntheticExecution(reader,control,id,registry,now,ctx) {
 check(Number.isSafeInteger(now),'INVALID_TIME');
 const started=performance.now();
 const evidence=await executionEvidence(reader,control,id,registry,now,ctx);
 if(evidence.task.status==='completed')return {
  accountDeletionCompleted:true,alreadyCompleted:true,completedAt:evidence.task.completed_at,productionEnabled:false
 };
 // These references are derived from actual effect readbacks; caller-supplied
 // digests/worker success booleans are never accepted by this coordinator.
 for(const [category,effectDigest] of Object.entries(evidence.external.categories)) {
  const evidenceDigest=await controlHash([category,effectDigest,evidence.external.manifestDigest,
   evidence.snapshot.ledgerId,evidence.tombstone.digest]);
  await recordSyntheticCompletionReview(reader,id,{
   category,confirmedAt:evidence.task.confirmed_at,scopeVersion:evidence.task.scope_version,
   policyDigest:evidence.external.policyDigest,evidenceDigest,reviewerRef:'synthetic-review-execution-readback'
  },now,ctx);
 }
 // Retain the legacy local barrier required by finalizer, in addition to the
 // independent CONTROL barrier above. It is never used as the current ledger.
 await installSyntheticRestoreBarrier(reader,id,now,ctx);
 await executionEvidence(reader,control,id,registry,now+Math.ceil(performance.now()-started),ctx);
 const claimAt=now+Math.ceil(performance.now()-started);
 const ticket=await claimSyntheticCompletion(reader,id,crypto.randomUUID(),claimAt,ctx);
 check(ticket,'COMPLETION_BUSY');
 const result=await finishSyntheticCompletion(reader,ticket,now+Math.ceil(performance.now()-started),ctx);
 return {...result,alreadyCompleted:false,productionEnabled:false};
}
