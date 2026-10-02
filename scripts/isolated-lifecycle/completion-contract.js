// Explicit opt-in extension of the synthetic R1 schema. No production bindings.
export const completionTables=Object.freeze({
 r1_completion_jobs:['id','policy_version','policy_digest','policy_json','owner','lease_until','version','financial_until','receipt_audit_until','last_checked_at','last_blockers'],
 r1_completion_reviews:['job_id','category','policy_digest','scope_version','confirmed_at','checked_at','evidence_digest','reviewer_ref'],
 r1_backup_barriers:['account_id','job_id','scope_version','confirmed_at','policy_digest','created_at']
});
export const requiredReviews=Object.freeze(['soft_links','admin_audit','providers','backups']);
