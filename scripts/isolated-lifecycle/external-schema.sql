-- SYNTHETIC ONLY. Never installed by production migrations or a Worker.
CREATE TABLE r1_external_cleanup_scopes (
 job_id TEXT PRIMARY KEY REFERENCES r1_completion_jobs(id),
 policy_digest TEXT NOT NULL, manifest_digest TEXT NOT NULL, manifest_json TEXT NOT NULL
);
CREATE TABLE r1_external_cleanup_tasks (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES r1_external_cleanup_scopes(job_id),
 category TEXT NOT NULL CHECK(category IN ('soft_links','admin_audit','providers','backups')),
 adapter_id TEXT NOT NULL, store_id TEXT NOT NULL, resource_ref TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','working','retrying','verified')),
 owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
 verified_at INTEGER, evidence_digest TEXT, last_error TEXT,
 UNIQUE(job_id,category,adapter_id,resource_ref)
);
CREATE TRIGGER r1_external_scope_immutable BEFORE UPDATE ON r1_external_cleanup_scopes BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_SCOPE_IMMUTABLE'); END;
CREATE TRIGGER r1_external_scope_preserve BEFORE DELETE ON r1_external_cleanup_scopes BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_SCOPE_IMMUTABLE'); END;
CREATE TRIGGER r1_external_task_identity BEFORE UPDATE ON r1_external_cleanup_tasks WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.category IS NOT OLD.category OR NEW.adapter_id IS NOT OLD.adapter_id OR NEW.store_id IS NOT OLD.store_id OR NEW.resource_ref IS NOT OLD.resource_ref OR NEW.operation_id IS NOT OLD.operation_id BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_SCOPE_IMMUTABLE'); END;
