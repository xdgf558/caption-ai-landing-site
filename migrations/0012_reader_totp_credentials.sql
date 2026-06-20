CREATE TABLE IF NOT EXISTS reader_totp_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  secret_base32 TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT 'Station Cat',
  label TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  enabled_at TEXT,
  disabled_at TEXT,
  last_used_step INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reader_totp_credentials_account
  ON reader_totp_credentials (account_id, enabled_at, disabled_at);
