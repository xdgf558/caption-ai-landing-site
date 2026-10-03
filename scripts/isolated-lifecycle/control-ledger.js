// Local synthetic control plane. Not imported by a Worker, HTTP route or scheduler.
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {assertSyntheticIsolation} from './executor.js';

export const controlSchemaSQL=readFileSync(new URL('./control-schema.sql',import.meta.url),'utf8');
export const controlHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
export const controlCheck=(condition,code)=>{if(!condition)throw Error(code);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=/^[a-f0-9]{64}$/;
export const controlLedgerCapacity=10000;
export const controlPageLimit=25;
const normalize=sql=>sql.replace(/;$/,'').replace(/\s+/g,' ').trim();
const schema=new DatabaseSync(':memory:');schema.exec(controlSchemaSQL);
const expected=schema.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(x=>({...x,sql:normalize(x.sql)}));schema.close();
export function controlContext(ctx){
 controlCheck(ctx?.environment==='isolated'&&ctx?.dataset==='synthetic-r1'&&ctx?.controlProfile==='synthetic-control-v1','CONTROL_ISOLATION_REQUIRED');
 controlCheck(typeof ctx.namespace==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(ctx.namespace),'CONTROL_NAMESPACE_REQUIRED');
 controlCheck(ctx.anchorStore&&typeof ctx.anchorStore.load==='function'&&typeof ctx.anchorStore.compareAndSwap==='function','PROTECTED_ANCHOR_REQUIRED');
 controlCheck(typeof ctx.assertReaderNamespace==='function','READER_BINDING_REGISTRY_REQUIRED');
}
function validAnchor(a){return a&&a.schemaVersion===1&&uuid.test(a.ledgerId)&&typeof a.namespace==='string'&&Number.isSafeInteger(a.watermark)&&a.watermark>=0&&digest.test(a.digest);}
const sameAnchor=(a,b)=>validAnchor(a)&&validAnchor(b)&&['schemaVersion','ledgerId','namespace','watermark','digest'].every(k=>a[k]===b[k]);
const seedDigest=(ledgerId,namespace)=>controlHash(['synthetic-control-v1',ledgerId,namespace]);
export const controlGenesisDigest=seedDigest;
const tombstoneDigest=(ledgerId,row)=>controlHash(['tombstone-v1',ledgerId,row.seq,row.namespace,row.account_id,row.scope_version,row.job_id,row.confirmed_at,row.previous_digest]);
export async function initializeControlLedger(db,ledgerId,ctx){
 controlContext(ctx);controlCheck(uuid.test(ledgerId),'INVALID_LEDGER_ID');
 await validateControlSchema(db);
 const initial={schemaVersion:1,ledgerId,namespace:ctx.namespace,watermark:0,digest:await seedDigest(ledgerId,ctx.namespace)};
 const provenance=await db.prepare('SELECT * FROM r1_control_provenance').first(),head=await db.prepare('SELECT * FROM r1_control_head').first();
 const anchor=await ctx.anchorStore.load();
 if(!anchor){
  // Protect genesis before committing CONTROL. An already initialized database
  // with a missing protected anchor is never used to regenerate that anchor.
  controlCheck(!provenance&&!head&&!(await db.prepare('SELECT 1 FROM r1_control_tombstones').first())&&
   !(await db.prepare('SELECT 1 FROM r1_control_restores').first()),'PROTECTED_ANCHOR_LOST');
  controlCheck(await ctx.anchorStore.compareAndSwap(null,initial),'ANCHOR_CAS_FAILED');
 }else controlCheck(sameAnchor(anchor,initial),'ANCHOR_ALREADY_INITIALIZED');
 if(provenance||head){
  // A retry may complete a protected, empty genesis only. Established deletion
  // history cannot be discarded through this provisioning-only entry point.
  controlCheck(provenance?.ledger_id===ledgerId&&provenance.namespace===ctx.namespace&&head?.watermark===0&&head.digest===initial.digest&&
   !(await db.prepare('SELECT 1 FROM r1_control_tombstones').first())&&!(await db.prepare('SELECT 1 FROM r1_control_restores').first()),'CONTROL_ALREADY_INITIALIZED');
 }else await db.batch([
   db.prepare("INSERT INTO r1_control_provenance VALUES(1,'synthetic-control-r1',1,?,?)").bind(ledgerId,ctx.namespace),
   db.prepare('INSERT INTO r1_control_head VALUES(1,0,?)').bind(initial.digest)
  ]);
 return assertControlSnapshot(db,initial,ctx);
}
export async function validateControlSchema(db){
 controlCheck(db&&typeof db.prepare==='function'&&typeof db.batch==='function','CONTROL_BINDING_REQUIRED');
 const actual=(await db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name!='_cf_METADATA' ORDER BY type,name").all()).results;
 controlCheck(JSON.stringify(actual.map(x=>[x.type,x.name,normalize(x.sql)]))===JSON.stringify(expected.map(x=>[x.type,x.name,x.sql])),'CONTROL_SCHEMA_DRIFT');
}
async function state(db,ctx,{allowAhead=false}={}){
 controlContext(ctx);await validateControlSchema(db);
 const provenance=await db.prepare('SELECT * FROM r1_control_provenance WHERE id=1').first();
 const head=await db.prepare('SELECT * FROM r1_control_head WHERE id=1').first();
 controlCheck(provenance?.dataset==='synthetic-control-r1'&&provenance.schema_version===1&&uuid.test(provenance.ledger_id)&&provenance.namespace===ctx.namespace&&head,'CONTROL_PROVENANCE_REQUIRED');
 const anchor=await ctx.anchorStore.load();
 controlCheck(validAnchor(anchor)&&anchor.ledgerId===provenance.ledger_id&&anchor.namespace===ctx.namespace,'CONTROL_ANCHOR_MISMATCH');
 const rows=(await db.prepare('SELECT * FROM r1_control_tombstones ORDER BY seq LIMIT ?').bind(controlLedgerCapacity+1).all()).results;
 controlCheck(rows.length<=controlLedgerCapacity&&head.watermark===rows.length&&head.watermark>=anchor.watermark,'CONTROL_WATERMARK_ROLLBACK');
 let previous=await seedDigest(provenance.ledger_id,ctx.namespace);
 controlCheck(anchor.watermark!==0||anchor.digest===previous,'CONTROL_ANCHOR_MISMATCH');
 for(let index=0;index<rows.length;index++){
  const row=rows[index];controlCheck(row.seq===index+1&&row.namespace===ctx.namespace&&row.scope_version==='station-account-v1'&&uuid.test(row.job_id)&&Number.isSafeInteger(row.account_id)&&row.account_id>0&&Number.isSafeInteger(row.confirmed_at)&&row.confirmed_at>0&&row.previous_digest===previous&&row.digest===await tombstoneDigest(provenance.ledger_id,row),'CONTROL_CHAIN_INVALID');
  previous=row.digest;
  if(row.seq===anchor.watermark)controlCheck(row.digest===anchor.digest,'CONTROL_ANCHOR_MISMATCH');
 }
 controlCheck(head.digest===previous,'CONTROL_CHAIN_INVALID');
 const snapshot={schemaVersion:1,ledgerId:provenance.ledger_id,namespace:ctx.namespace,watermark:head.watermark,digest:head.digest};
 controlCheck(allowAhead||sameAnchor(anchor,snapshot),'CONTROL_ANCHOR_PENDING');
 return {snapshot,anchor,rows};
}
export async function readControlSnapshot(db,ctx){return (await state(db,ctx)).snapshot;}
export async function assertControlSnapshot(db,expectedSnapshot,ctx){const current=await readControlSnapshot(db,ctx);controlCheck(sameAnchor(current,expectedSnapshot),'CONTROL_SNAPSHOT_STALE');return current;}
export async function readControlTombstones(db,snapshot,ctx){const current=await state(db,ctx);controlCheck(sameAnchor(current.snapshot,snapshot),'CONTROL_SNAPSHOT_STALE');return current.rows;}

// Bounded admission checkpoint for a separately sealed, completely verified
// restore. Full-chain auditing remains readControlSnapshot(). The immutable
// CONTROL schema and protected anchor are trusted; arbitrary privileged SQL
// bypassing those guards requires a new full audit, never this fast path.
export async function readControlCheckpoint(db,ctx){
 controlContext(ctx);await validateControlSchema(db);
 const provenance=await db.prepare('SELECT * FROM r1_control_provenance WHERE id=1').first();
 const head=await db.prepare('SELECT * FROM r1_control_head WHERE id=1').first();
 controlCheck(provenance?.dataset==='synthetic-control-r1'&&provenance.schema_version===1&&uuid.test(provenance.ledger_id)&&provenance.namespace===ctx.namespace&&head,'CONTROL_PROVENANCE_REQUIRED');
 const anchor=await ctx.anchorStore.load();
 controlCheck(validAnchor(anchor)&&anchor.ledgerId===provenance.ledger_id&&anchor.namespace===ctx.namespace,'CONTROL_ANCHOR_MISMATCH');
 controlCheck(Number.isSafeInteger(head.watermark)&&head.watermark>=anchor.watermark&&head.watermark<=controlLedgerCapacity,'CONTROL_WATERMARK_ROLLBACK');
 const snapshot={schemaVersion:1,ledgerId:provenance.ledger_id,namespace:ctx.namespace,watermark:head.watermark,digest:head.digest};
 controlCheck(sameAnchor(anchor,snapshot),'CONTROL_ANCHOR_PENDING');
 if(head.watermark===0)controlCheck(head.digest===await seedDigest(snapshot.ledgerId,ctx.namespace),'CONTROL_CHAIN_INVALID');
 else{
  const tail=await db.prepare('SELECT * FROM r1_control_tombstones WHERE seq=?').bind(head.watermark).first();
  controlCheck(tail&&tail.namespace===ctx.namespace&&tail.scope_version==='station-account-v1'&&uuid.test(tail.job_id)&&
   Number.isSafeInteger(tail.account_id)&&tail.account_id>0&&Number.isSafeInteger(tail.confirmed_at)&&tail.confirmed_at>0&&
   tail.digest===head.digest&&tail.digest===await tombstoneDigest(snapshot.ledgerId,tail),'CONTROL_CHAIN_INVALID');
 }
 return snapshot;
}
export async function assertControlCheckpoint(db,snapshot,ctx){
 const current=await readControlCheckpoint(db,ctx);controlCheck(sameAnchor(current,snapshot),'CONTROL_SNAPSHOT_STALE');return current;
}
export async function readControlTombstonePage(db,snapshot,after,limit,ctx,previousDigest){
 controlCheck(Number.isSafeInteger(after)&&after>=0&&after<=snapshot.watermark&&Number.isSafeInteger(limit)&&limit>0&&limit<=controlPageLimit,'INVALID_CONTROL_PAGE');
 await assertControlCheckpoint(db,snapshot,ctx);
 let previous=previousDigest;
 if(previous===undefined)previous=after===0?await seedDigest(snapshot.ledgerId,ctx.namespace):
  (await db.prepare('SELECT digest FROM r1_control_tombstones WHERE seq=?').bind(after).first())?.digest;
 controlCheck(digest.test(previous),'CONTROL_CHAIN_INVALID');
 if(after===0)controlCheck(previous===await seedDigest(snapshot.ledgerId,ctx.namespace),'CONTROL_CHAIN_INVALID');
 const rows=(await db.prepare('SELECT * FROM r1_control_tombstones WHERE seq>? AND seq<=? ORDER BY seq LIMIT ?')
  .bind(after,snapshot.watermark,limit).all()).results;
 controlCheck(rows.length===Math.min(limit,snapshot.watermark-after),'CONTROL_CHAIN_INVALID');
 for(let i=0;i<rows.length;i++){
  const row=rows[i];
  controlCheck(row.seq===after+i+1&&row.namespace===ctx.namespace&&row.scope_version==='station-account-v1'&&uuid.test(row.job_id)&&
   Number.isSafeInteger(row.account_id)&&row.account_id>0&&Number.isSafeInteger(row.confirmed_at)&&row.confirmed_at>0&&
   row.previous_digest===previous&&row.digest===await tombstoneDigest(snapshot.ledgerId,row),'CONTROL_CHAIN_INVALID');
  previous=row.digest;
 }
 if(after+rows.length===snapshot.watermark)controlCheck(previous===snapshot.digest,'CONTROL_CHAIN_INVALID');
 await assertControlCheckpoint(db,snapshot,ctx);return rows;
}
async function sourceTask(reader,id,ctx){
 controlCheck(await ctx.assertReaderNamespace(reader,ctx.namespace),'READER_NAMESPACE_MISMATCH');
 await assertSyntheticIsolation(reader,ctx);
 const task=await reader.prepare(`SELECT d.account_id,d.scope_version,d.confirmed_at,d.confirm_id,d.status,a.status AS account_status
  FROM mobile_deletions d JOIN reader_accounts a ON a.id=d.account_id WHERE d.id=?`).bind(id).first();
 controlCheck(uuid.test(task?.confirm_id)&&Number.isSafeInteger(task.confirmed_at)&&task.confirmed_at>0&&task.scope_version==='station-account-v1'&&
  ['accepted','processing','retrying','attention_required','completed'].includes(task.status)&&['deletion_pending','deleted_pending_review'].includes(task.account_status),'CONFIRMED_FROZEN_SOURCE_REQUIRED');return task;
}
export async function reconcileControlAnchor(control,sourceReader,ctx){
 const current=await state(control,ctx,{allowAhead:true});
 for(const row of current.rows.filter(x=>x.seq>current.anchor.watermark)){
  const task=await sourceTask(sourceReader,row.job_id,ctx);
  controlCheck(task.account_id===row.account_id&&task.scope_version===row.scope_version&&task.confirmed_at===row.confirmed_at,'UNANCHORED_SOURCE_MISMATCH');
 }
 if(!sameAnchor(current.anchor,current.snapshot))controlCheck(await ctx.anchorStore.compareAndSwap(current.anchor,current.snapshot),'ANCHOR_CAS_FAILED');
 return assertControlSnapshot(control,current.snapshot,ctx);
}
export async function registerDeletionTombstone(control,sourceReader,id,ctx){
 controlContext(ctx);controlCheck(control!==sourceReader&&uuid.test(id),'SEPARATE_CONTROL_REQUIRED');
 const task=await sourceTask(sourceReader,id,ctx);
 await reconcileControlAnchor(control,sourceReader,ctx);
 const current=await state(control,ctx);
 const existing=current.rows.find(row=>row.job_id===id||row.account_id===task.account_id);
 if(existing){controlCheck(existing.job_id===id&&existing.account_id===task.account_id&&existing.scope_version===task.scope_version&&existing.confirmed_at===task.confirmed_at,'CONTROL_TOMBSTONE_CONFLICT');return current.snapshot;}
 controlCheck(current.snapshot.watermark<controlLedgerCapacity,'CONTROL_CAPACITY_REACHED');
 const row={seq:current.snapshot.watermark+1,namespace:ctx.namespace,account_id:task.account_id,scope_version:task.scope_version,job_id:id,confirmed_at:task.confirmed_at,previous_digest:current.snapshot.digest};
 row.digest=await tombstoneDigest(current.snapshot.ledgerId,row);
 await control.batch([
  control.prepare('INSERT INTO r1_control_tombstones VALUES(?,?,?,?,?,?,?,?)').bind(row.seq,row.namespace,row.account_id,row.scope_version,row.job_id,row.confirmed_at,row.previous_digest,row.digest),
  control.prepare(`UPDATE r1_control_head SET watermark=CASE WHEN watermark=? AND digest=? THEN ? ELSE NULL END,digest=? WHERE id=1`).bind(current.snapshot.watermark,current.snapshot.digest,row.seq,row.digest)
 ]);
 const next={...current.snapshot,watermark:row.seq,digest:row.digest};
 controlCheck(await ctx.anchorStore.compareAndSwap(current.anchor,next),'ANCHOR_CAS_FAILED');return assertControlSnapshot(control,next,ctx);
}
