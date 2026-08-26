ALTER TABLE novel_payment_events
  ADD COLUMN provider_event_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_payment_events_creem_event_unique
  ON novel_payment_events (provider, provider_event_id)
  WHERE provider = 'creem'
    AND provider_event_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_credit_ledger_creem_reversal_unique
  ON reader_credit_ledger (account_id, source, source_ref)
  WHERE entry_type = 'reversal'
    AND source = 'creem-credit-pack';
