-- The queue is derived from immutable Creem reversal ledger rows, including historical rows.
-- Decisions are audit records, not another source of VIP eligibility.
CREATE TABLE IF NOT EXISTS membership_refund_reviews (
  reversal_id INTEGER PRIMARY KEY REFERENCES reader_credit_ledger(id),
  account_id INTEGER NOT NULL REFERENCES reader_accounts(id),
  operation_token TEXT NOT NULL UNIQUE,
  intent_hash TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('keep', 'revoke')),
  actor_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_expires_at TEXT,
  removed_seconds INTEGER NOT NULL CHECK (removed_seconds >= 0),
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_membership_refund_reviews_account
  ON membership_refund_reviews(account_id, reversal_id);

CREATE TABLE IF NOT EXISTS membership_refund_review_items (
  redemption_ledger_id INTEGER PRIMARY KEY REFERENCES reader_credit_ledger(id),
  reversal_id INTEGER NOT NULL REFERENCES membership_refund_reviews(reversal_id),
  removed_seconds INTEGER NOT NULL CHECK (removed_seconds > 0)
);
