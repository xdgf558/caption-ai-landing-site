// Opt-in synthetic execution contract. These are not production migrations.
import {retentionSpecs} from './retention-plan.js';
export const financialExecutionTables=Object.freeze({
 r1_financial_jobs:['id','account_id','policy_version','policy_digest','policy_json','confirmed_at','financial_until','stage','cursor','owner','lease_until','version','minimized_at','purged_at'],
 r1_financial_case_reviews:['job_id','account_id','confirmed_at','policy_digest','status','balance_disposition','checked_at','evidence_digest','reviewer_ref'],
 r1_financial_write_permits:['job_id','account_id','table_name','mode','row_ids_json','owner','version','checked_at']
});
export const financialPurgeOrder=Object.freeze(['game_entitlement_events','game_commerce_events','game_entitlements','game_purchases',
 'membership_refund_review_items','membership_refund_reviews','reader_membership_redemptions','novel_payment_events','novel_tips',
 'novel_orders','novel_entitlements','reader_memberships','reader_credit_ledger','reader_credit_accounts']);
export const replacedFinancialGuards=Object.freeze(['r1_reader_memberships_update','r1_novel_entitlements_update','r1_game_entitlements_update']);
const literal=value=>"'"+value.replaceAll("'","''")+"'";
function ownerConditions(spec,image,account){
 const owners=[],requirements=[];
 if(spec.classifications.account_id){owners.push(`${image}.account_id`);requirements.push(`${image}.account_id IS NULL OR ${image}.account_id=${account}`);}
 for(const a of spec.associations){
  owners.push(`(SELECT account_id FROM ${a.parent} WHERE ${a.parentColumn}=${image}.${a.column})`);
  requirements.push(`${image}.${a.column} IS NULL OR EXISTS(SELECT 1 FROM ${a.parent} WHERE ${a.parentColumn}=${image}.${a.column} AND account_id=${account})`);
 }
 if(account)return requirements.map(r=>`(${r})`).join(' AND ')+
  ' AND ('+owners.map(owner=>`${owner}=${account}`).join(' OR ')+')';
 const failures=owners.map(owner=>`(${owner} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reader_accounts WHERE id=${owner} AND status='active'))`);
 for(const a of spec.associations)failures.push(`(${image}.${a.column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${a.parent} p JOIN reader_accounts a ON a.id=p.account_id WHERE p.${a.parentColumn}=${image}.${a.column} AND a.status='active'))`);
 // Synthetic execution disallows orphan ownerless financial callbacks, including NULL order IDs.
 failures.push(`NOT (${owners.map(owner=>`EXISTS(SELECT 1 FROM reader_accounts WHERE id=${owner} AND status='active')`).join(' OR ')})`);
 for(let i=0;i<owners.length;i++)for(let j=i+1;j<owners.length;j++)failures.push(`(${owners[i]} IS NOT NULL AND ${owners[j]} IS NOT NULL AND ${owners[i]}!=${owners[j]})`);
 return failures.join(' OR ');
}
const permission=(table,spec,image,mode)=>`EXISTS(SELECT 1 FROM r1_financial_write_permits p JOIN r1_financial_jobs j ON j.id=p.job_id
 WHERE p.table_name=${literal(table)} AND p.mode=${literal(mode)} AND p.account_id=j.account_id AND p.owner=j.owner AND p.version=j.version
 AND j.stage=${literal(mode==='minimize'?'minimize':'purge')} AND j.lease_until>p.checked_at
 AND (${ownerConditions(spec,image,'p.account_id')}) AND EXISTS(SELECT 1 FROM json_each(p.row_ids_json) WHERE value=${image}.rowid))`;
export const financialExecutionGuards=Object.freeze(Object.fromEntries(Object.entries(retentionSpecs).flatMap(([table,spec])=>{
 const oldInactive=ownerConditions(spec,'OLD'),newInactive=ownerConditions(spec,'NEW');
 const retained=spec.retainColumns.map(column=>`NEW.${column} IS OLD.${column}`).join(' AND ');
 const cleared=spec.reviewColumns.map(column=>`(NEW.${column} IS NULL OR NEW.${column}=${literal(spec.emptyValues[column])})`).join(' AND ');
 const allowed=spec.reviewColumns.length ? `(${permission(table,spec,'OLD','minimize')} AND NEW.rowid=OLD.rowid AND ${retained} AND ${cleared})` : '0';
 const updateName=replacedFinancialGuards.includes(`r1_${table}_update`)?`r1_${table}_update`:`r1_financial_${table}_update`;
 return [
  [`r1_financial_${table}_insert`,`CREATE TRIGGER r1_financial_${table}_insert BEFORE INSERT ON ${table} WHEN (${newInactive}) BEGIN SELECT RAISE(ABORT,'R1_FINANCIAL_INACTIVE_WRITE'); END`],
  [updateName,`CREATE TRIGGER ${updateName} BEFORE UPDATE ON ${table} WHEN ((${oldInactive}) OR (${newInactive})) AND NOT ${allowed} BEGIN SELECT RAISE(ABORT,'R1_FINANCIAL_INACTIVE_WRITE'); END`],
  [`r1_financial_${table}_delete`,`CREATE TRIGGER r1_financial_${table}_delete BEFORE DELETE ON ${table} WHEN (${oldInactive}) AND NOT (${permission(table,spec,'OLD','purge')}) BEGIN SELECT RAISE(ABORT,'R1_FINANCIAL_DELETE_PERMIT_REQUIRED'); END`]
 ];
})));
