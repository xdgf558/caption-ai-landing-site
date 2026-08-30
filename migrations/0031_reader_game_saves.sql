PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS reader_game_saves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game_key TEXT NOT NULL,
  save_version TEXT NOT NULL DEFAULT '',
  save_json TEXT NOT NULL,
  save_hash TEXT NOT NULL,
  save_bytes INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  client_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, game_key),
  CHECK (revision > 0),
  CHECK (save_bytes >= 0 AND save_bytes <= 750000)
);

CREATE INDEX IF NOT EXISTS idx_reader_game_saves_account_updated
  ON reader_game_saves (account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reader_game_save_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game_key TEXT NOT NULL,
  save_version TEXT NOT NULL DEFAULT '',
  save_json TEXT NOT NULL,
  save_hash TEXT NOT NULL,
  save_bytes INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL,
  client_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, game_key, revision),
  CHECK (revision > 0),
  CHECK (save_bytes >= 0 AND save_bytes <= 750000)
);

CREATE INDEX IF NOT EXISTS idx_reader_game_save_backups_account_game_revision
  ON reader_game_save_backups (account_id, game_key, revision DESC);
