-- Opt-in SYNTHETIC R1 finality fixture only. Never a production migration.
CREATE TABLE r1_completion_jobs (
 id TEXT PRIMARY KEY REFERENCES r1_deletion_jobs(id),
 policy_version TEXT NOT NULL, policy_digest TEXT NOT NULL, policy_json TEXT NOT NULL,
 owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 financial_until INTEGER NOT NULL, receipt_audit_until INTEGER NOT NULL,
 last_checked_at INTEGER, last_blockers TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE r1_completion_reviews (
 job_id TEXT NOT NULL REFERENCES r1_completion_jobs(id),
 category TEXT NOT NULL CHECK(category IN ('soft_links','admin_audit','providers','backups')),
 policy_digest TEXT NOT NULL, scope_version TEXT NOT NULL, confirmed_at INTEGER NOT NULL,
 checked_at INTEGER NOT NULL, evidence_digest TEXT NOT NULL, reviewer_ref TEXT NOT NULL,
 PRIMARY KEY(job_id,category)
);
-- This control ledger is logically independent of the snapshot being restored.
-- Restoring it backwards together with a snapshot would defeat the barrier.
CREATE TABLE r1_backup_barriers (
 account_id INTEGER PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES r1_completion_jobs(id),
 scope_version TEXT NOT NULL, confirmed_at INTEGER NOT NULL, policy_digest TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
