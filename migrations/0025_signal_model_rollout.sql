CREATE TABLE IF NOT EXISTS signal_model_rollout (
  id TEXT PRIMARY KEY,
  rollout_mode TEXT NOT NULL DEFAULT 'off',
  deepseek_model TEXT NOT NULL DEFAULT 'deepseek-v4-pro',
  last_smoke_status TEXT NOT NULL DEFAULT 'never',
  last_smoke_at TEXT,
  last_smoke_model TEXT NOT NULL DEFAULT '',
  last_smoke_finish_reason TEXT NOT NULL DEFAULT '',
  last_smoke_message TEXT NOT NULL DEFAULT '',
  last_smoke_usage_json TEXT NOT NULL DEFAULT '{}',
  last_smoke_candidate_count INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (id = 'signal-brief'),
  CHECK (rollout_mode IN ('off', 'live')),
  CHECK (deepseek_model IN ('deepseek-v4-pro', 'deepseek-v4-flash')),
  CHECK (last_smoke_status IN ('never', 'running', 'passed', 'failed')),
  CHECK (last_smoke_candidate_count BETWEEN 0 AND 10)
);

INSERT OR IGNORE INTO signal_model_rollout (
  id,
  rollout_mode,
  deepseek_model,
  last_smoke_status,
  updated_by
) VALUES (
  'signal-brief',
  'off',
  'deepseek-v4-pro',
  'never',
  'migration-0025'
);
