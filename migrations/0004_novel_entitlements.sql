CREATE TABLE IF NOT EXISTS novel_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'chapter',
  access_level TEXT NOT NULL DEFAULT 'paid',
  source TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL DEFAULT 'admin',
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, series_slug, chapter_slug, scope, access_level, source)
);

CREATE INDEX IF NOT EXISTS idx_novel_entitlements_account
  ON novel_entitlements (account_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_novel_entitlements_target
  ON novel_entitlements (series_slug, chapter_slug, scope, access_level);

CREATE INDEX IF NOT EXISTS idx_novel_entitlements_updated
  ON novel_entitlements (updated_at);
