// Shared synthetic-only test fixture; never serves an execution endpoint.
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Miniflare} from 'miniflare';
import {claimDeletion,runDeletionStep} from '../isolated-lifecycle/executor.js';
import {retentionSpecs,financialJsonShape} from '../isolated-lifecycle/retention-plan.js';
import {prepareSyntheticCompletion} from '../isolated-lifecycle/finalizer.js';
import {createSyntheticCleanupAdapter} from '../isolated-lifecycle/external-cleanup.js';

export const executionOptions=Object.freeze({environment:'isolated',dataset:'synthetic-r1',completionProfile:'synthetic-finality-v1',executionProfile:'synthetic-erasure-v1'});
export function executionPolicy() {return {
 version:'synthetic-execution-integration-v1',approved:true,environment:'isolated',dataset:'synthetic-r1',
 jurisdiction:'fictional-fixture',basis:'test-only-not-an-operational-policy',financialDays:30,receiptDays:14,
 tables:Object.fromEntries(Object.entries(retentionSpecs).map(([table,s])=>[table,{scope:'exact-account-links',retainColumns:[...s.retainColumns],reviewColumns:[...s.reviewColumns]}])),
 jsonShapes:Object.fromEntries(Object.entries(retentionSpecs).flatMap(([table,s])=>s.reviewColumns.filter(c=>s.classifications[c]==='raw_json')
  .map(c=>[`${table}.${c}`,[financialJsonShape({}),financialJsonShape(null),financialJsonShape({email:'shape-only'})]])))
};}
export async function migrateFixture(db,paths) {
 const parser=new DatabaseSync(':memory:');
 try {for(const path of paths){let sql=readFileSync(path,'utf8');while(sql.trim()){
  const st=parser.prepare(sql);st.run();await db.prepare(st.sourceSQL).run();sql=sql.slice(st.sourceSQL.length);
 }}} finally {parser.close();}
}
export async function createExecutionFixture() {
 const persist=mkdtempSync(join(tmpdir(),'r1-execution-suite-'));
 const f={now:Date.now(),options:executionOptions,externalIdentity:{adapterId:'synthetic-test-provider',storeId:randomUUID()}};
 f.start=async()=>{
  f.mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("No execution HTTP entry",{status:404})}}',
   compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,d1Databases:{READER:'execution-reader',EXTERNAL:'execution-provider',CONTROL:'execution-control'},
   d1Persist:persist,outboundService:()=>new Response('',{status:503})});
  f.reader=await f.mf.getD1Database('READER');f.external=await f.mf.getD1Database('EXTERNAL');f.control=await f.mf.getD1Database('CONTROL');
 };
 f.restart=async()=>{await f.mf.dispose();await f.start();};
 f.close=async()=>{await f.mf?.dispose();rmSync(persist,{recursive:true,force:true});};
 try {
  await f.start();
  await migrateFixture(f.reader,[...['migrations','migrations-mobile'].flatMap(dir=>readdirSync(dir).filter(x=>x.endsWith('.sql')).sort().map(x=>dir+'/'+x)),
   'scripts/isolated-lifecycle/schema.sql','scripts/isolated-lifecycle/completion-schema.sql','scripts/isolated-lifecycle/financial-schema.sql','scripts/isolated-lifecycle/external-schema.sql']);
  await f.reader.prepare("INSERT INTO r1_fixture_provenance VALUES(1,'synthetic-r1')").run();
  await migrateFixture(f.external,['scripts/isolated-lifecycle/external-fixture-schema.sql']);
  await f.external.prepare("INSERT INTO r1_external_fixture_meta VALUES(1,'synthetic-r1-external',?,?)").bind(f.externalIdentity.adapterId,f.externalIdentity.storeId).run();
  await migrateFixture(f.control,['scripts/isolated-lifecycle/control-schema.sql']);
 } catch(error) {await f.close();throw error;}
 f.adapters=async(db=f.external)=>({[f.externalIdentity.adapterId]:await createSyntheticCleanupAdapter(db,f.externalIdentity)});
 f.account=async({dirty=false,balance=100,personal=true}={})=>{
  const id=randomUUID(),email=id+'@example.test',db=f.reader;
  const account=(await db.prepare('INSERT INTO reader_accounts(email,normalized_email,display_name) VALUES(?,?,?) RETURNING id').bind(email,email,'Synthetic').first()).id;
  await db.prepare('INSERT INTO reader_credit_accounts(account_id,balance_credits) VALUES(?,?)').bind(account,balance).run();
  await db.prepare("INSERT INTO reader_credit_ledger(account_id,entry_type,credits_delta,balance_after,source,metadata_json,note) VALUES(?,'purchase',100,?,'synthetic',?,?)")
   .bind(account,balance,dirty?JSON.stringify({email}):'{}',dirty?'private-synthetic-note':'').run();
  await db.prepare('INSERT INTO mobile_music_state(account_id) VALUES(?)').bind(account).run();
  await db.prepare(`INSERT INTO mobile_deletions(id,account_id,prepare_id,receipt_hash,scope_version,prepare_until,receipt_until,status,confirm_id,confirmed_at,stage)
   VALUES(?,?,?,'synthetic-receipt-hash','station-account-v1',?,?,'accepted',?,?,'queued')`).bind(id,account,randomUUID(),f.now+600_000,f.now+14*86400_000,randomUUID(),f.now).run();
  await db.prepare('INSERT INTO mobile_deletion_outbox(job_id,updated_at) VALUES(?,?)').bind(id,f.now).run();
  await db.prepare("UPDATE reader_accounts SET status='deletion_pending' WHERE id=?").bind(account).run();
  const a={id,account,policy:executionPolicy()};
  if(personal)await f.personal(a);
  return a;
 };
 f.personal=async a=>{
  for(let i=0;i<80;i++){
   const t=await claimDeletion(f.reader,a.id,randomUUID(),f.now,f.options);
   const r=await runDeletionStep(f.reader,t,f.now,f.options);if(r.personalCleanupVerified)return;
  }throw Error('PERSONAL_FIXTURE_STALLED');
 };
 f.prepare=async a=>prepareSyntheticCompletion(f.reader,a.id,a.policy,f.now,f.options);
 f.resources=async a=>{
  const manifest=[];
  for(const category of ['soft_links','admin_audit','providers','backups']){
   const resourceRef='fixture-'+randomUUID();
   await f.external.prepare('INSERT INTO r1_external_fixture_resources VALUES(?,?,?)').bind(resourceRef,a.account,category).run();
   await f.external.prepare('INSERT INTO r1_external_fixture_records VALUES(?,?,?)').bind(randomUUID(),resourceRef,'private synthetic payload').run();
   manifest.push({category,resourceRef,adapterId:f.externalIdentity.adapterId,storeId:f.externalIdentity.storeId});
  }return manifest;
 };
 return f;
}
