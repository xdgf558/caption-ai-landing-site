PRAGMA foreign_keys = ON;

ALTER TABLE reader_game_saves
  ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0 CHECK (schema_version >= 0);

ALTER TABLE reader_game_save_backups
  ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0 CHECK (schema_version >= 0);

CREATE TABLE IF NOT EXISTS reader_game_save_recovery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game_key TEXT NOT NULL,
  source_backup_revision INTEGER NOT NULL,
  previous_revision INTEGER NOT NULL,
  restored_revision INTEGER NOT NULL,
  restored_save_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE CASCADE,
  CHECK (source_backup_revision > 0),
  CHECK (previous_revision > 0),
  CHECK (restored_revision > previous_revision)
);

CREATE INDEX IF NOT EXISTS idx_reader_game_save_recovery_events_account_game
  ON reader_game_save_recovery_events (account_id, game_key, created_at DESC);
