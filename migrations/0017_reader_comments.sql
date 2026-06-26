CREATE TABLE IF NOT EXISTS reader_comments (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_path TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  hidden_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reader_comments_chapter_status_created
  ON reader_comments (series_slug, chapter_slug, locale, status, created_at);

CREATE INDEX IF NOT EXISTS idx_reader_comments_account_created
  ON reader_comments (account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reader_comments_status_updated
  ON reader_comments (status, updated_at);
