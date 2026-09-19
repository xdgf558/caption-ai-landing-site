-- Isolated native reader DB only; never part of production migrations.
CREATE TABLE mobile_music_state (
 account_id INTEGER PRIMARY KEY REFERENCES reader_accounts(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0, history_enabled INTEGER NOT NULL DEFAULT 1,
 history_epoch INTEGER NOT NULL DEFAULT 0, preference_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mobile_music_favorites (
 account_id INTEGER NOT NULL REFERENCES reader_accounts(id) ON DELETE CASCADE,
 track_id TEXT NOT NULL, favorite INTEGER NOT NULL CHECK(favorite IN (0,1)),
 version INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,track_id)
);
-- Tombstones and dedup records are retained until account cleanup in this isolated stage.
CREATE TABLE mobile_music_operations (
 account_id INTEGER NOT NULL REFERENCES reader_accounts(id) ON DELETE CASCADE,
 id TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(account_id,id)
);
CREATE TABLE mobile_music_recent (
 account_id INTEGER NOT NULL REFERENCES reader_accounts(id) ON DELETE CASCADE,
 track_id TEXT NOT NULL, played_at INTEGER NOT NULL, position REAL NOT NULL,
 PRIMARY KEY(account_id,track_id)
);
CREATE INDEX mobile_music_recent_order ON mobile_music_recent(account_id,played_at DESC,track_id);
