CREATE TABLE IF NOT EXISTS reader_credit_accounts (
  account_id INTEGER PRIMARY KEY,
  balance_credits INTEGER NOT NULL DEFAULT 0,
  lifetime_purchased_credits INTEGER NOT NULL DEFAULT 0,
  lifetime_spent_credits INTEGER NOT NULL DEFAULT 0,
  currency_label TEXT NOT NULL DEFAULT 'SC Credits',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reader_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  credits_delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  series_slug TEXT NOT NULL DEFAULT '',
  chapter_slug TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reader_credit_ledger_account
  ON reader_credit_ledger (account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reader_credit_ledger_source
  ON reader_credit_ledger (source, source_ref);
