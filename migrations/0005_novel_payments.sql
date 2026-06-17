CREATE TABLE IF NOT EXISTS novel_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_token TEXT NOT NULL UNIQUE,
  account_id INTEGER,
  provider TEXT NOT NULL DEFAULT 'nowpayments',
  provider_order_id TEXT NOT NULL DEFAULT '',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  provider_invoice_id TEXT NOT NULL DEFAULT '',
  order_type TEXT NOT NULL DEFAULT 'chapter',
  series_slug TEXT NOT NULL DEFAULT '',
  chapter_slug TEXT NOT NULL DEFAULT '',
  entitlement_scope TEXT NOT NULL DEFAULT 'chapter',
  entitlement_access_level TEXT NOT NULL DEFAULT 'paid',
  price_amount TEXT NOT NULL DEFAULT '',
  price_currency TEXT NOT NULL DEFAULT 'USD',
  pay_amount TEXT NOT NULL DEFAULT '',
  pay_currency TEXT NOT NULL DEFAULT '',
  payment_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  provider_status TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  confirmed_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_novel_orders_account
  ON novel_orders (account_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_novel_orders_provider_payment
  ON novel_orders (provider, provider_payment_id);

CREATE INDEX IF NOT EXISTS idx_novel_orders_provider_order
  ON novel_orders (provider, provider_order_id);

CREATE INDEX IF NOT EXISTS idx_novel_orders_target
  ON novel_orders (series_slug, chapter_slug, order_type, status);

CREATE TABLE IF NOT EXISTS novel_tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  account_id INTEGER,
  provider TEXT NOT NULL DEFAULT 'nowpayments',
  provider_order_id TEXT NOT NULL DEFAULT '',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  series_slug TEXT NOT NULL DEFAULT '',
  amount TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES novel_orders(id) ON DELETE SET NULL,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_novel_tips_order
  ON novel_tips (order_id);

CREATE INDEX IF NOT EXISTS idx_novel_tips_series
  ON novel_tips (series_slug, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_novel_tips_provider_payment
  ON novel_tips (provider, provider_payment_id);

CREATE TABLE IF NOT EXISTS novel_payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'nowpayments',
  order_id INTEGER,
  provider_order_id TEXT NOT NULL DEFAULT '',
  provider_payment_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT 'ipn',
  status TEXT NOT NULL DEFAULT '',
  signature_valid INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES novel_orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_novel_payment_events_order
  ON novel_payment_events (order_id, received_at);

CREATE INDEX IF NOT EXISTS idx_novel_payment_events_provider_payment
  ON novel_payment_events (provider, provider_payment_id, received_at);
