CREATE TABLE IF NOT EXISTS product_feedback (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL DEFAULT '',
  issue_type TEXT NOT NULL,
  impact TEXT NOT NULL DEFAULT 'normal',
  summary TEXT NOT NULL,
  details TEXT NOT NULL,
  reproduction_steps TEXT NOT NULL DEFAULT '',
  environment TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  admin_note TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'zh-Hant',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_feedback_product_status_created
  ON product_feedback (product, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_feedback_platform_issue_created
  ON product_feedback (platform, issue_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_feedback_ip_created
  ON product_feedback (ip_hash, created_at DESC);
