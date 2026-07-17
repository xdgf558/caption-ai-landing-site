-- One-shot D1 migration for Signal automation phase 3 candidate scoring and review.
-- Apply only after 0019_signal_automation.sql and 0020_signal_collection.sql.
ALTER TABLE signal_candidates ADD COLUMN score_breakdown_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE signal_candidates ADD COLUMN cluster_key TEXT NOT NULL DEFAULT '';
ALTER TABLE signal_candidates ADD COLUMN decision_note TEXT NOT NULL DEFAULT '';
ALTER TABLE signal_candidates ADD COLUMN scored_at TEXT;

CREATE INDEX IF NOT EXISTS idx_signal_candidates_review_queue
  ON signal_candidates (status, relevance_score DESC, published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_candidates_cluster
  ON signal_candidates (cluster_key, created_at DESC)
  WHERE cluster_key <> '';

CREATE TABLE IF NOT EXISTS signal_candidate_reviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES signal_candidates(id) ON DELETE CASCADE,
  CHECK (action IN ('shortlist', 'reject', 'restore')),
  CHECK (from_status IN ('new', 'shortlisted', 'rejected', 'used')),
  CHECK (to_status IN ('new', 'shortlisted', 'rejected', 'used'))
);

CREATE INDEX IF NOT EXISTS idx_signal_candidate_reviews_candidate
  ON signal_candidate_reviews (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_candidate_reviews_actor
  ON signal_candidate_reviews (actor_email, created_at DESC);
