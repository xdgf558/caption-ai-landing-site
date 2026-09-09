-- Operation receipts, not a second membership/expiry authority.
CREATE TABLE IF NOT EXISTS reader_membership_redemptions (
  account_id INTEGER NOT NULL,
  request_key TEXT NOT NULL,
  operation_token TEXT NOT NULL UNIQUE,
  cost_credits INTEGER NOT NULL CHECK (cost_credits > 0),
  duration_months INTEGER NOT NULL CHECK (duration_months > 0),
  unit_label TEXT NOT NULL,
  covers_paid INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  previous_expires_at TEXT,
  membership_json TEXT,
  ledger_id INTEGER,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, request_key),
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ledger_id) REFERENCES reader_credit_ledger(id)
);
