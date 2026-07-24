-- One-shot D1 migration for permanently retiring paused Signal sources while
-- preserving their historical candidates, collection tasks, and alerts.
ALTER TABLE signal_sources ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_signal_sources_archived_enabled
  ON signal_sources (archived_at, is_enabled, name);

UPDATE signal_sources
SET is_enabled = 0,
    archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
    consecutive_failures = 0,
    last_error = '',
    last_error_at = NULL,
    updated_by = 'migration-0026',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('fred-api', 'arxiv-ai-recent');

UPDATE signal_automation_alerts
SET status = 'resolved',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolved_by = 'migration-0026',
    updated_at = CURRENT_TIMESTAMP
WHERE source_id IN ('fred-api', 'arxiv-ai-recent')
  AND status = 'open';
