CREATE TABLE IF NOT EXISTS game_commerce_rate_limits (
  account_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  window_started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, action)
);

CREATE INDEX IF NOT EXISTS idx_game_commerce_rate_limits_updated
  ON game_commerce_rate_limits (updated_at);
