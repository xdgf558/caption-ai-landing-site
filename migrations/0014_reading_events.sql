CREATE TABLE IF NOT EXISTS reading_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_event_id TEXT NOT NULL UNIQUE,
  account_id INTEGER,
  session_id TEXT NOT NULL DEFAULT '',
  series_slug TEXT NOT NULL,
  chapter_slug TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  event_type TEXT NOT NULL,
  event_value REAL,
  progress_percent INTEGER,
  block_index INTEGER,
  duration_ms INTEGER,
  source_path TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reading_events_chapter_created
  ON reading_events (series_slug, chapter_slug, created_at);

CREATE INDEX IF NOT EXISTS idx_reading_events_account_created
  ON reading_events (account_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reading_events_session_created
  ON reading_events (session_id, created_at);

CREATE INDEX IF NOT EXISTS idx_reading_events_type_created
  ON reading_events (event_type, created_at);
