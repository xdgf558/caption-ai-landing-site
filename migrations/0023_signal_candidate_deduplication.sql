-- One-shot D1 migration for Signal automation phase 3 duplicate merging.
-- Apply only after 0019 through 0022. Wrangler records this migration once.
ALTER TABLE signal_candidates ADD COLUMN title_fingerprint TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_signal_candidates_title_fingerprint
  ON signal_candidates (title_fingerprint, published_at DESC, created_at DESC)
  WHERE title_fingerprint <> '';

CREATE TABLE IF NOT EXISTS signal_candidate_occurrences (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  run_id TEXT,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  content_hash TEXT NOT NULL DEFAULT '',
  title_fingerprint TEXT NOT NULL DEFAULT '',
  match_reason TEXT NOT NULL DEFAULT 'primary',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES signal_candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES signal_sources(id) ON DELETE RESTRICT,
  FOREIGN KEY (run_id) REFERENCES signal_collection_runs(id) ON DELETE SET NULL,
  UNIQUE (candidate_id, source_id, canonical_url, content_hash),
  CHECK (match_reason IN ('primary', 'canonical_url', 'content_hash', 'title_fingerprint'))
);

CREATE INDEX IF NOT EXISTS idx_signal_candidate_occurrences_candidate
  ON signal_candidate_occurrences (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_candidate_occurrences_source
  ON signal_candidate_occurrences (source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_candidate_occurrences_title
  ON signal_candidate_occurrences (title_fingerprint, published_at DESC, created_at DESC)
  WHERE title_fingerprint <> '';

INSERT OR IGNORE INTO signal_candidate_occurrences (
  id, candidate_id, source_id, run_id, canonical_url, title, summary,
  published_at, content_hash, title_fingerprint, match_reason, metadata_json, created_at
)
SELECT
  'signal-occurrence-primary-' || id,
  id,
  source_id,
  run_id,
  canonical_url,
  title,
  summary,
  published_at,
  content_hash,
  title_fingerprint,
  'primary',
  metadata_json,
  created_at
FROM signal_candidates;
