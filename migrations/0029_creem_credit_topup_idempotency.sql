CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_credit_ledger_creem_topup_unique
  ON reader_credit_ledger (account_id, source, source_ref)
  WHERE entry_type = 'topup'
    AND source = 'creem-credit-pack';
