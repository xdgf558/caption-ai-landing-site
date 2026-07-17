-- One-shot D1 migration. Apply through `wrangler d1 migrations apply` so Wrangler records it once;
-- SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for these additions.
ALTER TABLE signal_sources ADD COLUMN http_etag TEXT NOT NULL DEFAULT '';
ALTER TABLE signal_sources ADD COLUMN http_last_modified TEXT NOT NULL DEFAULT '';
ALTER TABLE signal_sources ADD COLUMN last_http_status INTEGER;
ALTER TABLE signal_sources ADD COLUMN last_item_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signal_sources ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;

ALTER TABLE signal_collection_runs ADD COLUMN processed_source_count INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_collection_runs_single_active
  ON signal_collection_runs ((1))
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS signal_collection_tasks (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  response_not_modified INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES signal_collection_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES signal_sources(id) ON DELETE RESTRICT,
  UNIQUE (run_id, source_id),
  CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  CHECK (response_not_modified IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_signal_collection_tasks_run_status
  ON signal_collection_tasks (run_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_signal_collection_tasks_source_created
  ON signal_collection_tasks (source_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_candidates_content_hash_unique
  ON signal_candidates (content_hash)
  WHERE content_hash <> '';

UPDATE signal_sources
SET endpoint_url = 'https://blog.google/rss/', updated_at = CURRENT_TIMESTAMP
WHERE id = 'google-company-news' AND endpoint_url = 'https://blog.google/feed/';

UPDATE signal_sources
SET max_items_per_run = 12, updated_at = CURRENT_TIMESTAMP
WHERE id = 'hacker-news-top' AND max_items_per_run > 12;
