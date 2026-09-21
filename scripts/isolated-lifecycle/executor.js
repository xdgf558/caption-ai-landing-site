// Test-only execution kernel. Intentionally not imported by src/, scheduled(), or Wrangler.
import inventory from '../../docs/mobile-ios-m2/deletion-plan/schema-inventory.json' with {type:'json'};
import guards from './guard-manifest.json' with {type:'json'};
const reviewed=inventory.databases.reader;
import {assertChanged,clearAssert} from '../../src/mobile/security.js';
const extra=['r1_fixture_provenance','r1_deletion_jobs','r1_financial_reviews'];
const credentials=['mobile_refresh_operations','mobile_refresh_tokens','mobile_playback_grants','mobile_codes','mobile_sessions','reader_sessions','reader_login_tokens','reader_totp_credentials','reader_password_credentials'];
const privateTables=Object.entries(reviewed).filter(([,x])=>x.category==='private_data_purge').map(([name])=>name);
const stages=['credentials','private_data','comments','identity','verify','retention_policy_review'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function check(value,message){if(!value)throw new Error(message);}
async function gate(db,options){
 check(options?.environment==='isolated' && options?.dataset==='synthetic-r1','ISOLATION_REQUIRED');
 check((await db.prepare('SELECT dataset FROM r1_fixture_provenance WHERE id=1').first())?.dataset==='synthetic-r1','SYNTHETIC_DATA_REQUIRED');
 const names=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='_cf_METADATA'").all()).results.map(x=>x.name).sort();
 check(JSON.stringify(names)===JSON.stringify([...Object.keys(reviewed),...extra].sort()),'SCHEMA_DRIFT:'+names.filter(x=>!reviewed[x]&&!extra.includes(x)).join(','));
 const installed=(await db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all()).results;
 for(const [name,sql] of Object.entries(guards))check(installed.some(x=>x.name===name&&x.sql.replace(/;$/, '').replace(/\s+/g,' ').trim()===sql),'GUARD_DRIFT');
 const commentColumns=(await db.prepare('PRAGMA table_info(reader_comments)').all()).results;
 check(commentColumns.find(x=>x.name==='account_id')?.notnull===0,'COMMENTS_MIGRATION_REQUIRED');
 for(const [table,spec] of Object.entries(reviewed)){
  const columns=(await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(x=>x.name);
  check(JSON.stringify(columns)===JSON.stringify(spec.columns),'SCHEMA_DRIFT');
 }
}
const predicate=table=>table.startsWith('mobile_refresh_')?'family_id IN (SELECT family_id FROM mobile_sessions WHERE account_id=?)':'account_id=?';
async function count(db,table,account){return (await db.prepare(`SELECT count(*) n FROM ${table} WHERE ${predicate(table)}`).bind(account).first()).n;}
async function eligible(db,id){
 const row=await db.prepare(`SELECT d.*,a.status account_status FROM mobile_deletions d JOIN reader_accounts a ON a.id=d.account_id WHERE d.id=?`).bind(id).first();
 check(row?.confirm_id && row.confirmed_at && ['accepted','processing','retrying','attention_required'].includes(row.status) && ['deletion_pending','deleted_pending_review'].includes(row.account_status),'CONFIRMATION_REQUIRED');return row;
}
export async function planDeletion(db,id,options){
 check(uuid.test(id),'INVALID_ID');await gate(db,options);const task=await eligible(db,id);
 const counts={};for(const table of [...credentials,...privateTables,'reader_comments'])counts[table]=await count(db,table,task.account_id);
 return {requestId:id,counts,completionBlockedBy:['financial_policy','soft_links_and_audit','provider_and_backup_verification'],productionEnabled:false};
}
export async function claimDeletion(db,id,owner,now,options){
 check(uuid.test(id)&&uuid.test(owner)&&Number.isSafeInteger(now),'INVALID_ARGUMENT');await gate(db,options);const task=await eligible(db,id);
 await db.prepare('INSERT OR IGNORE INTO r1_deletion_jobs(id,account_id) VALUES(?,?)').bind(id,task.account_id).run();
 const row=await db.prepare(`UPDATE r1_deletion_jobs SET owner=?,lease_until=?,version=version+1,attempts=attempts+1
  WHERE id=? AND lease_until<=? AND stage!='retention_policy_review' RETURNING *`).bind(owner,now+30000,id,now).first();
 return row ? {id,owner,version:row.version,stage:row.stage,account:row.account_id} : null;
}
async function guardedBatch(db,ticket,now,statements,next=ticket.stage){
 await db.batch([
  db.prepare(`UPDATE r1_deletion_jobs SET stage=?,version=version+1,lease_until=0,owner=NULL,last_error=NULL
   WHERE id=? AND owner=? AND version=? AND stage=? AND lease_until>?`).bind(next,ticket.id,ticket.owner,ticket.version,ticket.stage,now),assertChanged(db),
  ...statements,clearAssert(db)
 ]);
}
export async function runDeletionStep(db,ticket,now,options){
 await gate(db,options);check(ticket&&uuid.test(ticket.id)&&uuid.test(ticket.owner)&&stages.includes(ticket.stage),'INVALID_TICKET');
 const task=await eligible(db,ticket.id);check(task.account_id===ticket.account,'WRONG_ACCOUNT');
 const statements=[];let next=ticket.stage;
 if(ticket.stage==='credentials'||ticket.stage==='private_data'){
  const tables=ticket.stage==='credentials'?credentials:privateTables;
  // One bounded chunk from one table per claim; checkpoints and rows commit together.
  const table=await (async()=>{for(const table of tables)if(await count(db,table,task.account_id))return table;return null;})();
  if(table)statements.push(db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${predicate(table)} LIMIT 200)`).bind(task.account_id));
  else next=stages[stages.indexOf(ticket.stage)+1];
 }else if(ticket.stage==='comments'){
  if(await count(db,'reader_comments',task.account_id))statements.push(db.prepare(`UPDATE reader_comments SET account_id=NULL,source_path='',metadata_json='{}',ip_hash='',user_agent_hash='',reviewed_by='',hidden_reason='',updated_at=CURRENT_TIMESTAMP
   WHERE rowid IN (SELECT rowid FROM reader_comments WHERE account_id=? LIMIT 200)`).bind(task.account_id));
  else next='identity';
 }else if(ticket.stage==='identity'){
  statements.push(db.prepare('INSERT OR IGNORE INTO r1_financial_reviews(job_id,account_id) VALUES(?,?)').bind(ticket.id,task.account_id));
  statements.push(db.prepare(`UPDATE reader_accounts SET email=?,normalized_email=?,display_name='',last_login_at=NULL,status='deleted_pending_review',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='deletion_pending'`).bind(`deleted+${ticket.id}@invalid`, `deleted+${ticket.id}@invalid`,task.account_id));
  next='verify';
 }else if(ticket.stage==='verify'){
  for(const table of [...credentials,...privateTables,'reader_comments'])check(await count(db,table,task.account_id)===0,'RESIDUAL_PERSONAL_DATA');
  const account=await db.prepare('SELECT * FROM reader_accounts WHERE id=?').bind(task.account_id).first();
  check(account.status==='deleted_pending_review'&&account.email===`deleted+${ticket.id}@invalid`&&account.normalized_email===account.email&&account.display_name===''&&account.last_login_at===null,'RESIDUAL_IDENTITY');
  check(await db.prepare('SELECT job_id FROM r1_financial_reviews WHERE job_id=? AND account_id=?').bind(ticket.id,task.account_id).first(),'FINANCIAL_REVIEW_MISSING');
  statements.push(db.prepare('UPDATE r1_deletion_jobs SET personal_completed_at=? WHERE id=?').bind(now,ticket.id));
  statements.push(db.prepare("UPDATE mobile_deletions SET status='attention_required',stage='retention_policy_review',completed_at=NULL WHERE id=?").bind(ticket.id));
  statements.push(db.prepare("UPDATE mobile_deletion_outbox SET status='attention_required',updated_at=? WHERE job_id=?").bind(now,ticket.id));
  next='retention_policy_review';
 }else throw new Error('POLICY_REQUIRED');
 await guardedBatch(db,ticket,now,statements,next);
 return {stage:next,personalCleanupVerified:next==='retention_policy_review',accountDeletionCompleted:false};
}
