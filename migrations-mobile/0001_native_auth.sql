-- ISOLATED M2 ONLY. Apply to an isolated WAITLIST_DB after the existing reader migrations.
-- Not included in production's migrations/ directory or any deployment script.
CREATE TABLE mobile_assert (value INTEGER NOT NULL CHECK(value = 1));
CREATE TABLE mobile_browser_flows (
 id TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, challenge TEXT NOT NULL,
 state TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL,
 used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0,1))
);
CREATE TABLE mobile_codes (
 hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES reader_accounts(id),
 challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, password_version TEXT NOT NULL, totp_version TEXT NOT NULL,
 authenticated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mobile_sessions (
 id TEXT PRIMARY KEY, family_id TEXT NOT NULL UNIQUE,
 account_id INTEGER NOT NULL REFERENCES reader_accounts(id),
 generation INTEGER NOT NULL CHECK(generation >= 0),
 access_hash TEXT NOT NULL UNIQUE, access_until INTEGER NOT NULL,
 refresh_until INTEGER NOT NULL, absolute_until INTEGER NOT NULL,
 authenticated_at INTEGER NOT NULL, password_version TEXT NOT NULL, totp_version TEXT NOT NULL,
 recent_auth_at INTEGER NOT NULL DEFAULT 0, recent_auth_totp_version TEXT NOT NULL DEFAULT '',
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 CHECK(refresh_until <= absolute_until)
);
CREATE INDEX mobile_sessions_account ON mobile_sessions(account_id, revoked);
CREATE TABLE mobile_refresh_tokens (
 hash TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES mobile_sessions(family_id) ON DELETE CASCADE,
 generation INTEGER NOT NULL, UNIQUE(family_id,generation)
);
CREATE TABLE mobile_refresh_operations (
 family_id TEXT NOT NULL REFERENCES mobile_sessions(family_id) ON DELETE CASCADE,
 request_id TEXT NOT NULL, old_generation INTEGER NOT NULL, digest TEXT NOT NULL,
 result TEXT, result_until INTEGER NOT NULL, absolute_until INTEGER NOT NULL,
 PRIMARY KEY(family_id,request_id), UNIQUE(family_id,old_generation)
);
-- No account FK: the minimal receipt status must survive account cleanup.
CREATE TABLE mobile_deletions (
 id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, prepare_id TEXT NOT NULL,
 receipt_hash TEXT NOT NULL, scope_version TEXT NOT NULL,
 prepare_until INTEGER NOT NULL, receipt_until INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('prepared','preparation_expired','accepted','processing','retrying','attention_required','completed')),
 confirm_id TEXT, confirmed_at INTEGER, completed_at INTEGER,
 stage TEXT NOT NULL DEFAULT 'prepared', UNIQUE(account_id,prepare_id)
);
CREATE UNIQUE INDEX mobile_one_deletion ON mobile_deletions(account_id)
 WHERE status NOT IN ('preparation_expired','completed');
CREATE TABLE mobile_deletion_outbox (
 job_id TEXT PRIMARY KEY REFERENCES mobile_deletions(id),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','attention_required','completed')),
 attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE mobile_rate_limits (
 key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL
);
