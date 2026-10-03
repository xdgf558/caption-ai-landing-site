// Persistent retry/readback experiment over a distinct synthetic service DB.
// No URLs, fetch(), credentials, production binding or user-supplied callbacks.
import { readFileSync } from 'node:fs';
import { assertSyntheticIsolation, verifyPersonalDeletion } from './executor.js';
import { requiredReviews } from './completion-contract.js';
import { assertChanged, clearAssert } from '../../src/mobile/security.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = /^[a-f0-9]{64}$/;
const adapterName = /^synthetic-[a-z0-9-]{1,40}$/;
const reference = /^fixture-[0-9a-f-]{36}$/;
const branded = new WeakSet();
const check = (value,code) => { if (!value) throw Error(code); };
const canonical = value => JSON.stringify(value,(_,item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(k => [k,item[k]])) : item);
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),x=>x.toString(16).padStart(2,'0')).join('');
const normSQL = sql => sql.trim().replace(/;$/,'').replace(/\s+/g,' ');
const fixtureSQL = readFileSync(new URL('./external-fixture-schema.sql',import.meta.url),'utf8');
const fixtureStatements = fixtureSQL.replace(/^--.*$/gm,'').split(/;(?=\s*(?:CREATE|$))/).map(s=>s.trim()).filter(Boolean).map(normSQL);

async function gate(db,options) {
  check(options?.executionProfile === 'synthetic-erasure-v1','EXECUTION_PROFILE_REQUIRED');
  await assertSyntheticIsolation(db,options);
}
async function inspectFixtureDB(db,identity) {
  check(identity && adapterName.test(identity.adapterId) && uuid.test(identity.storeId),'SYNTHETIC_ADAPTER_IDENTITY_REQUIRED');
  const rows=(await db.prepare("SELECT sql FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%' AND name!='_cf_METADATA'").all()).results;
  check(rows.length===fixtureStatements.length && rows.every(r=>fixtureStatements.includes(normSQL(r.sql))),'EXTERNAL_SCHEMA_DRIFT');
  const meta=await db.prepare('SELECT * FROM r1_external_fixture_meta WHERE id=1').first();
  check(meta?.dataset==='synthetic-r1-external' && meta.adapter_id===identity.adapterId && meta.store_id===identity.storeId,'EXTERNAL_STORE_MISMATCH');
}

// Branded, frozen adapter has a mandatory independent readback. Tests can fail
// its DB transport, but cannot replace erase()/inspect() with a success boolean.
export async function createSyntheticCleanupAdapter(db,identity) {
  await inspectFixtureDB(db,identity);
  const bound=Object.freeze({...identity});
  async function resource(context) {
    await inspectFixtureDB(db,bound);
    const row=await db.prepare('SELECT * FROM r1_external_fixture_resources WHERE resource_ref=?').bind(context.resourceRef).first();
    check(row && row.account_id===context.accountId && row.category===context.category,'EXTERNAL_RESOURCE_SCOPE_MISMATCH');
  }
  const effect = context => digest({storeId:bound.storeId,adapterId:bound.adapterId,...context});
  const adapter=Object.freeze({
    id:bound.adapterId,
    storeId:bound.storeId,
    async inventory(accountId) {
      await inspectFixtureDB(db,bound);
      check(Number.isSafeInteger(accountId)&&accountId>0,'EXTERNAL_RESOURCE_SCOPE_MISMATCH');
      const rows=(await db.prepare('SELECT resource_ref,category FROM r1_external_fixture_resources WHERE account_id=? ORDER BY resource_ref LIMIT 33').bind(accountId).all()).results;
      check(rows.length<=32,'EXTERNAL_INVENTORY_LIMIT');
      return rows.map(row=>({adapterId:bound.adapterId,storeId:bound.storeId,category:row.category,resourceRef:row.resource_ref}));
    },
    async erase(context,assertCurrent) {
      await resource(context);
      const hash=await effect(context);
      check(typeof assertCurrent==='function','EXTERNAL_LEASE_CHECK_REQUIRED');
      await assertCurrent();
      await db.batch([
        db.prepare('INSERT INTO r1_external_fixture_assert SELECT CASE WHEN EXISTS(SELECT 1 FROM r1_external_fixture_resources WHERE resource_ref=? AND account_id=? AND category=?) THEN 1 ELSE 0 END').bind(context.resourceRef,context.accountId,context.category),
        db.prepare('INSERT OR IGNORE INTO r1_external_fixture_account_barriers VALUES(?,?,?)').bind(context.accountId,context.jobId,context.policyDigest),
        db.prepare('INSERT INTO r1_external_fixture_assert SELECT CASE WHEN EXISTS(SELECT 1 FROM r1_external_fixture_account_barriers WHERE account_id=? AND job_id=? AND policy_digest=?) THEN 1 ELSE 0 END').bind(context.accountId,context.jobId,context.policyDigest),
        db.prepare('INSERT OR IGNORE INTO r1_external_fixture_deletions VALUES(?,?,?,?,?,?,?)')
          .bind(context.resourceRef,context.accountId,context.category,context.operationId,context.jobId,context.policyDigest,hash),
        db.prepare('INSERT INTO r1_external_fixture_assert SELECT CASE WHEN EXISTS(SELECT 1 FROM r1_external_fixture_deletions WHERE resource_ref=? AND account_id=? AND category=? AND operation_id=? AND job_id=? AND policy_digest=? AND effect_digest=?) THEN 1 ELSE 0 END')
          .bind(context.resourceRef,context.accountId,context.category,context.operationId,context.jobId,context.policyDigest,hash),
        db.prepare('DELETE FROM r1_external_fixture_records WHERE resource_ref=?').bind(context.resourceRef),
        db.prepare('DELETE FROM r1_external_fixture_assert')
      ]);
    },
    async inspect(context) {
      await resource(context);
      const row=await db.prepare('SELECT * FROM r1_external_fixture_deletions WHERE resource_ref=?').bind(context.resourceRef).first();
      const hash=await effect(context);
      check(row && row.account_id===context.accountId && row.category===context.category && row.operation_id===context.operationId &&
        row.job_id===context.jobId && row.policy_digest===context.policyDigest && row.effect_digest===hash,'EXTERNAL_EFFECT_UNVERIFIED');
      check(await db.prepare('SELECT 1 FROM r1_external_fixture_account_barriers WHERE account_id=? AND job_id=? AND policy_digest=?').bind(context.accountId,context.jobId,context.policyDigest).first(),'EXTERNAL_EFFECT_UNVERIFIED');
      check(!(await db.prepare('SELECT 1 FROM r1_external_fixture_records WHERE resource_ref=? LIMIT 1').bind(context.resourceRef).first()),'EXTERNAL_RESIDUAL_DATA');
      return Object.freeze({effectDigest:hash});
    }
  });
  branded.add(adapter);return adapter;
}
function getAdapter(registry,id,storeId) {
  const adapter=registry?.[id];check(adapter && branded.has(adapter) && adapter.id===id && adapter.storeId===storeId,'UNSUPPORTED_EXTERNAL_ADAPTER');return adapter;
}
function normalizeManifest(manifest,registry) {
  check(Array.isArray(manifest) && manifest.length>=requiredReviews.length && manifest.length<=32,'EXTERNAL_SCOPE_REQUIRED');
  const rows=manifest.map(row=>{
    check(row && Object.keys(row).sort().join(',')==='adapterId,category,resourceRef,storeId' && requiredReviews.includes(row.category) &&
      adapterName.test(row.adapterId) && uuid.test(row.storeId) && reference.test(row.resourceRef) && uuid.test(row.resourceRef.slice(8)),'INVALID_EXTERNAL_SCOPE');
    getAdapter(registry,row.adapterId,row.storeId);return {...row};
  }).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  check(new Set(rows.map(canonical)).size===rows.length && requiredReviews.every(c=>rows.some(r=>r.category===c)),'EXTERNAL_SCOPE_REQUIRED');
  // The same resource cannot be silently assigned to different categories.
  check(new Set(rows.map(r=>r.adapterId+':'+r.resourceRef)).size===rows.length,'EXTERNAL_RESOURCE_REUSED');
  return rows;
}
const contextFor=(task,row,scope)=>({jobId:task.id,accountId:task.account_id,category:row.category,resourceRef:row.resource_ref,
  operationId:row.operation_id,policyDigest:scope.policy_digest,scopeVersion:task.scope_version,confirmedAt:task.confirmed_at});
async function verifyInventory(accountId,manifest,registry) {
  check(registry&&Object.keys(registry).length>0&&Object.keys(registry).length<=32,'EXTERNAL_REGISTRY_REQUIRED');
  const inventory=[];
  for(const [id,adapter] of Object.entries(registry))inventory.push(...await getAdapter(registry,id,adapter?.storeId).inventory(accountId));
  check(canonical(normalizeManifest(inventory,registry))===canonical(manifest),'EXTERNAL_INVENTORY_MISMATCH');
}

export async function prepareExternalCleanup(db,id,manifest,registry,options) {
  await gate(db,options);check(uuid.test(id),'INVALID_REQUEST_ID');
  const task=await verifyPersonalDeletion(db,id,options);
  check(task.status!=='completed','EXTERNAL_SCOPE_ALREADY_COMPLETED');
  const policy=await db.prepare('SELECT policy_digest FROM r1_completion_jobs WHERE id=?').bind(id).first();
  check(policy && hex.test(policy.policy_digest),'RETENTION_POLICY_REQUIRED');
  const rows=normalizeManifest(manifest,registry),hash=await digest(rows),writes=[];
  await verifyInventory(task.account_id,rows,registry);
  writes.push(db.prepare('INSERT OR IGNORE INTO r1_external_cleanup_scopes VALUES(?,?,?,?)').bind(id,policy.policy_digest,hash,canonical(rows)));
  writes.push(db.prepare('INSERT INTO mobile_assert SELECT CASE WHEN EXISTS(SELECT 1 FROM r1_external_cleanup_scopes WHERE job_id=? AND policy_digest=? AND manifest_digest=? AND manifest_json=?) THEN 1 ELSE 0 END').bind(id,policy.policy_digest,hash,canonical(rows)));
  for(const row of rows) writes.push(db.prepare('INSERT OR IGNORE INTO r1_external_cleanup_tasks(id,job_id,category,adapter_id,store_id,resource_ref,operation_id) VALUES(?,?,?,?,?,?,?)')
    .bind(await digest({id,...row}),id,row.category,row.adapterId,row.storeId,row.resourceRef,crypto.randomUUID()));
  writes.push(clearAssert(db));await db.batch(writes);
  return {manifestDigest:hash,taskCount:rows.length,productionEnabled:false};
}

export async function claimExternalCleanup(db,id,owner,now,options) {
  await gate(db,options);check(uuid.test(id)&&uuid.test(owner)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');
  const task=await verifyPersonalDeletion(db,id,options);check(now>=task.confirmed_at,'INVALID_TIME');
  check(task.status!=='completed','EXTERNAL_SCOPE_ALREADY_COMPLETED');
  const row=await db.prepare(`UPDATE r1_external_cleanup_tasks SET status='working',owner=?,lease_until=?,version=version+1,attempts=attempts+1
    WHERE id=(SELECT id FROM r1_external_cleanup_tasks WHERE job_id=? AND status!='verified' AND lease_until<=? AND next_attempt_at<=? ORDER BY id LIMIT 1)
    AND lease_until<=? RETURNING *`).bind(owner,now+30_000,id,now,now,now).first();
  return row?{id:row.id,jobId:id,owner,version:row.version,operationId:row.operation_id}:null;
}

export async function runExternalCleanupStep(db,ticket,now,registry,options) {
  const started=performance.now();
  const currentTime=()=>now+Math.ceil(performance.now()-started);
  await gate(db,options);check(ticket&&hex.test(ticket.id)&&uuid.test(ticket.jobId)&&uuid.test(ticket.owner)&&Number.isSafeInteger(now),'INVALID_TICKET');
  const task=await verifyPersonalDeletion(db,ticket.jobId,options);
  const scope=await db.prepare('SELECT * FROM r1_external_cleanup_scopes WHERE job_id=?').bind(ticket.jobId).first();
  const row=await db.prepare("SELECT * FROM r1_external_cleanup_tasks WHERE id=? AND job_id=? AND owner=? AND version=? AND operation_id=? AND lease_until>? AND status='working'")
    .bind(ticket.id,ticket.jobId,ticket.owner,ticket.version,ticket.operationId,currentTime()).first();
  check(row&&scope&&now>=task.confirmed_at,'STALE_EXTERNAL_TICKET');
  const manifest=normalizeManifest(JSON.parse(scope.manifest_json),registry);
  check(await digest(manifest)===scope.manifest_digest && manifest.some(m=>m.category===row.category&&m.adapterId===row.adapter_id&&m.storeId===row.store_id&&m.resourceRef===row.resource_ref),'EXTERNAL_SCOPE_CHANGED');
  const adapter=getAdapter(registry,row.adapter_id,row.store_id),context=contextFor(task,row,scope);
  async function assertCurrent() {
    const lease=await db.prepare("SELECT lease_until FROM r1_external_cleanup_tasks WHERE id=? AND job_id=? AND owner=? AND version=? AND operation_id=? AND status='working'")
      .bind(ticket.id,ticket.jobId,ticket.owner,ticket.version,ticket.operationId).first();
    check(lease&&lease.lease_until>currentTime(),'STALE_EXTERNAL_TICKET');
  }
  let proof=null;
  try { await adapter.erase(context,assertCurrent);proof=await adapter.inspect(context); } catch { /* Only a fixed diagnostic leaves this boundary. */ }
  const committedAt=now+Math.ceil(performance.now()-started);
  const delay=Math.min(60_000,1_000*2**Math.min(6,row.attempts-1));
  await db.batch([
    db.prepare(`UPDATE r1_external_cleanup_tasks SET status=?,owner=NULL,lease_until=0,version=version+1,next_attempt_at=?,verified_at=?,evidence_digest=?,last_error=?
      WHERE id=? AND owner=? AND version=? AND operation_id=? AND lease_until>? AND status='working'`)
      .bind(proof?'verified':'retrying',proof?0:committedAt+delay,proof?committedAt:null,proof?.effectDigest??null,proof?null:'EXTERNAL_EFFECT_UNVERIFIED',ticket.id,ticket.owner,ticket.version,ticket.operationId,committedAt),
    assertChanged(db),clearAssert(db)
  ]);
  return {verified:!!proof,retryAt:proof?null:committedAt+delay,productionEnabled:false};
}

export async function verifyExternalCleanup(db,id,registry,options) {
  await gate(db,options);const task=await verifyPersonalDeletion(db,id,options);
  const scope=await db.prepare('SELECT * FROM r1_external_cleanup_scopes WHERE job_id=?').bind(id).first();
  check(scope,'EXTERNAL_SCOPE_REQUIRED');
  const manifest=normalizeManifest(JSON.parse(scope.manifest_json),registry);
  check(await digest(manifest)===scope.manifest_digest,'EXTERNAL_SCOPE_CHANGED');
  await verifyInventory(task.account_id,manifest,registry);
  const policy=await db.prepare('SELECT policy_digest FROM r1_completion_jobs WHERE id=?').bind(id).first();
  check(policy?.policy_digest===scope.policy_digest,'EXTERNAL_POLICY_CHANGED');
  const rows=(await db.prepare('SELECT * FROM r1_external_cleanup_tasks WHERE job_id=? ORDER BY id').bind(id).all()).results;
  check(rows.length===manifest.length,'EXTERNAL_SCOPE_CHANGED');
  const evidence={};
  for(const row of rows) {
    check(manifest.some(m=>m.category===row.category&&m.adapterId===row.adapter_id&&m.storeId===row.store_id&&m.resourceRef===row.resource_ref) && row.status==='verified' && row.verified_at>=task.confirmed_at,'EXTERNAL_TASK_NOT_VERIFIED');
    const proof=await getAdapter(registry,row.adapter_id,row.store_id).inspect(contextFor(task,row,scope));
    check(proof.effectDigest===row.evidence_digest,'EXTERNAL_EVIDENCE_CHANGED');
    (evidence[row.category]??=[]).push(proof.effectDigest);
  }
  return {policyDigest:scope.policy_digest,manifestDigest:scope.manifest_digest,
    categories:Object.fromEntries(await Promise.all(Object.entries(evidence).map(async([key,values])=>[key,await digest(values.sort())]))),productionEnabled:false};
}
