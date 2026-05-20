CREATE TABLE IF NOT EXISTS download_rate_limits (
  download_key TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  day_key TEXT NOT NULL,
  window_key INTEGER NOT NULL,
  daily_count INTEGER NOT NULL DEFAULT 0,
  window_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (download_key, ip_hash, day_key)
);

CREATE INDEX IF NOT EXISTS idx_download_rate_limits_updated
  ON download_rate_limits (updated_at);

