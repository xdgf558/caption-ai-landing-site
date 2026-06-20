CREATE TABLE IF NOT EXISTS reader_totp_reset_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until_epoch INTEGER NOT NULL DEFAULT 0,
  last_failed_epoch INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(scope, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_reader_totp_reset_attempts_scope
  ON reader_totp_reset_attempts (scope, scope_key, locked_until_epoch);
