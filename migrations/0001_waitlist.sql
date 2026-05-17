CREATE TABLE IF NOT EXISTS waitlist_settings (
  product TEXT NOT NULL,
  platform TEXT NOT NULL,
  public_link TEXT NOT NULL DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 0,
  distributed_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (product, platform)
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  platform TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  landing_path TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  utm_content TEXT NOT NULL DEFAULT '',
  invite_status TEXT NOT NULL DEFAULT 'waitlisted',
  invite_url TEXT NOT NULL DEFAULT '',
  invite_delivered_at TEXT,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (product, platform, normalized_email)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_product_platform
  ON waitlist_entries (product, platform, created_at);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_invite_status
  ON waitlist_entries (product, platform, invite_status);

INSERT OR IGNORE INTO waitlist_settings (product, platform)
VALUES
  ('snapcopy', 'ios'),
  ('snapcopy', 'android');
