CREATE TABLE IF NOT EXISTS reader_memberships (
  account_id INTEGER PRIMARY KEY,
  membership_level TEXT NOT NULL DEFAULT 'member',
  source TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_redeemed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reader_memberships_expires
  ON reader_memberships (expires_at);
