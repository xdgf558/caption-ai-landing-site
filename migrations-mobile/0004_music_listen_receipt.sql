-- Isolated native reader DB only. Preserve receipt separately from event occurrence.
ALTER TABLE mobile_music_recent ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0;
UPDATE mobile_music_recent SET received_at=played_at;
