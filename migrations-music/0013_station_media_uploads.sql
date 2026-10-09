-- T15: append-only media upload receipts. No publication, rights approval or cleanup.
-- Apply once with the normal migration ledger, never in a request handler.
CREATE TABLE station_media_upload_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL UNIQUE REFERENCES station_media_assets(id),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','uploading','uploaded','validating','completed','rejected','expired')),
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes > 0 AND declared_bytes <= 268435456),
  expected_sha256 TEXT NOT NULL CHECK (length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  actual_bytes INTEGER CHECK (actual_bytes=declared_bytes),
  write_token TEXT,
  validation_started_at INTEGER CHECK (validation_started_at >= created_at),
  error_code TEXT CHECK (length(error_code) BETWEEN 1 AND 80),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  CHECK (status='reserved' OR write_token IS NOT NULL OR status IN ('rejected','expired')),
  CHECK (status<>'completed' OR (actual_bytes IS NOT NULL AND validation_started_at IS NOT NULL AND error_code IS NULL))
) STRICT;
CREATE INDEX station_media_upload_actor ON station_media_upload_sessions(actor_id,created_at,id);
CREATE TRIGGER station_media_upload_identity BEFORE UPDATE OF id,asset_id,actor_id,declared_bytes,expected_sha256,created_at,expires_at ON station_media_upload_sessions
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_IDENTITY'); END;
CREATE TRIGGER station_media_upload_writer BEFORE UPDATE OF write_token ON station_media_upload_sessions
WHEN OLD.write_token IS NOT NULL OR NEW.write_token IS NULL OR OLD.status<>'reserved'
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_WRITER'); END;
CREATE TRIGGER station_media_upload_transition BEFORE UPDATE OF status ON station_media_upload_sessions
WHEN NOT ((OLD.status='reserved' AND NEW.status IN ('uploading','rejected','expired'))
 OR (OLD.status='uploading' AND NEW.status IN ('uploaded','validating','rejected','expired'))
 OR (OLD.status='uploaded' AND NEW.status IN ('validating','rejected','expired'))
 OR (OLD.status='validating' AND NEW.status IN ('completed','rejected','expired')))
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_TRANSITION'); END;
CREATE TRIGGER station_media_upload_terminal BEFORE UPDATE ON station_media_upload_sessions
WHEN OLD.status IN ('completed','rejected','expired')
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_TERMINAL'); END;
CREATE TRIGGER station_media_upload_replace BEFORE INSERT ON station_media_upload_sessions
WHEN EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=NEW.id OR asset_id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_IDENTITY'); END;
CREATE TRIGGER station_media_upload_retained BEFORE DELETE ON station_media_upload_sessions
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_RETAINED'); END;
CREATE TRIGGER station_media_upload_asset BEFORE INSERT ON station_media_upload_sessions
WHEN NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.asset_id AND state='reserved')
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_ASSET'); END;
CREATE TRIGGER station_media_upload_completed BEFORE UPDATE OF status ON station_media_upload_sessions
WHEN NEW.status='completed' AND NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.asset_id
 AND state='validated' AND byte_size=NEW.actual_bytes AND sha256=NEW.expected_sha256 AND etag IS NOT NULL
 AND width IS NOT NULL AND height IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'STATION_UPLOAD_ASSET'); END;

-- Every reservation stays charged, including uncertain PUTs and rejected files.
-- Existing media without an upload receipt also counts; unknown sizes charge the
-- full supported limit. No request in this batch can release or delete media.
DROP VIEW music_storage_charges;
CREATE VIEW music_storage_charges AS
-- Each compound SELECT stays within the native D1/workerd five-term limit.
SELECT asset_id,charged_bytes FROM (
SELECT u.asset_id,u.declared_bytes AS charged_bytes FROM music_upload_sessions u
WHERE NOT EXISTS(SELECT 1 FROM music_upload_cleanup c WHERE c.upload_id=u.id AND c.released_at IS NOT NULL)
UNION ALL SELECT a.id,a.byte_size FROM music_assets a WHERE NOT EXISTS(SELECT 1 FROM music_upload_sessions u WHERE u.asset_id=a.id)
UNION ALL SELECT u.asset_id,u.declared_bytes FROM music_collection_upload_sessions u
UNION ALL SELECT a.id,a.byte_size FROM music_collection_assets a WHERE NOT EXISTS(SELECT 1 FROM music_collection_upload_sessions u WHERE u.asset_id=a.id)
)
UNION ALL SELECT u.asset_id,u.declared_bytes FROM station_media_upload_sessions u
UNION ALL SELECT a.id,COALESCE(a.byte_size,CASE WHEN a.kind IN ('short_video','mv') THEN 268435456 ELSE 10485760 END)
 FROM station_media_assets a WHERE NOT EXISTS(SELECT 1 FROM station_media_upload_sessions u WHERE u.asset_id=a.id);
