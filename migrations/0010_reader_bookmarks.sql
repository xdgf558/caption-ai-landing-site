CREATE TABLE IF NOT EXISTS reader_bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  series_title TEXT NOT NULL DEFAULT '',
  chapter_title TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  source_path TEXT NOT NULL DEFAULT '',
  progress_percent INTEGER NOT NULL DEFAULT 0,
  position_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, series_slug, chapter_slug)
);

CREATE INDEX IF NOT EXISTS idx_reader_bookmarks_account_updated
  ON reader_bookmarks (account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reader_bookmarks_account_series
  ON reader_bookmarks (account_id, series_slug, chapter_slug);
