// Explicit test-only extension. No adapter can name an arbitrary URL or service.
export const externalCleanupTables = Object.freeze({
  r1_external_cleanup_scopes: ['job_id','policy_digest','manifest_digest','manifest_json'],
  r1_external_cleanup_tasks: ['id','job_id','category','adapter_id','store_id','resource_ref','operation_id','status','owner','lease_until','version','attempts','next_attempt_at','verified_at','evidence_digest','last_error']
});
export const externalCleanupGuards = Object.freeze({
  r1_external_scope_immutable: "CREATE TRIGGER r1_external_scope_immutable BEFORE UPDATE ON r1_external_cleanup_scopes BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_SCOPE_IMMUTABLE'); END",
  r1_external_scope_preserve: "CREATE TRIGGER r1_external_scope_preserve BEFORE DELETE ON r1_external_cleanup_scopes BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_SCOPE_IMMUTABLE'); END",
  r1_external_task_identity: "CREATE TRIGGER r1_external_task_identity BEFORE UPDATE ON r1_external_cleanup_tasks WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.category IS NOT OLD.category OR NEW.adapter_id IS NOT OLD.adapter_id OR NEW.store_id IS NOT OLD.store_id OR NEW.resource_ref IS NOT OLD.resource_ref OR NEW.operation_id IS NOT OLD.operation_id BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_SCOPE_IMMUTABLE'); END"
});
