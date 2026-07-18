-- One-shot D1 migration for Signal automation phase 6 operations and alerts.
-- Apply only after migrations 0019 through 0023.
CREATE TABLE IF NOT EXISTS signal_automation_runtime (
  id TEXT PRIMARY KEY,
  last_cron_started_at TEXT,
  last_cron_finished_at TEXT,
  last_cron_scheduled_at TEXT,
  last_cron_status TEXT NOT NULL DEFAULT 'never',
  last_run_id TEXT,
  last_queued_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (last_run_id) REFERENCES signal_collection_runs(id) ON DELETE SET NULL,
  CHECK (id = 'signal-collection'),
  CHECK (last_cron_status IN ('never', 'running', 'queued', 'skipped', 'failed')),
  CHECK (last_queued_count >= 0),
  CHECK (consecutive_failures >= 0)
);

INSERT OR IGNORE INTO signal_automation_runtime (id)
VALUES ('signal-collection');

CREATE TABLE IF NOT EXISTS signal_automation_alerts (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  run_id TEXT,
  source_id TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_notified_at TEXT,
  notification_count INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES signal_collection_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (source_id) REFERENCES signal_sources(id) ON DELETE SET NULL,
  CHECK (alert_type IN (
    'scheduler_gap',
    'scheduler_failure',
    'stale_run',
    'run_failed',
    'source_failures',
    'queue_failure',
    'dead_letter'
  )),
  CHECK (severity IN ('info', 'warning', 'critical')),
  CHECK (status IN ('open', 'resolved')),
  CHECK (occurrence_count >= 1),
  CHECK (notification_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_automation_alerts_status_severity
  ON signal_automation_alerts (status, severity, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_automation_alerts_run
  ON signal_automation_alerts (run_id, last_seen_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_automation_alerts_source
  ON signal_automation_alerts (source_id, last_seen_at DESC)
  WHERE source_id IS NOT NULL;
