-- MUSIC_DB only. No remote migration is authorized by merging this file.
ALTER TABLE music_upload_sessions ADD COLUMN expected_sha256 TEXT
  CHECK (expected_sha256 IS NULL OR (length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE music_upload_sessions ADD COLUMN write_token TEXT;

-- Reservations remain charged even after failure/expiry until a separately audited cleanup exists.
-- Never free quota while a late R2 write may still commit.
CREATE TRIGGER music_upload_identity BEFORE UPDATE ON music_upload_sessions
WHEN NEW.id<>OLD.id OR NEW.asset_id<>OLD.asset_id OR NEW.actor_id<>OLD.actor_id
  OR NEW.declared_bytes<>OLD.declared_bytes OR NEW.expected_sha256 IS NOT OLD.expected_sha256
  OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
  OR (OLD.write_token IS NOT NULL AND NEW.write_token IS NOT OLD.write_token)
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_IMMUTABLE'); END;
CREATE TRIGGER music_upload_no_replace BEFORE INSERT ON music_upload_sessions
WHEN EXISTS (SELECT 1 FROM music_upload_sessions WHERE id=NEW.id OR asset_id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_IMMUTABLE'); END;
CREATE TRIGGER music_upload_no_delete BEFORE DELETE ON music_upload_sessions
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_IMMUTABLE'); END;
CREATE TRIGGER music_upload_transition BEFORE UPDATE OF status ON music_upload_sessions
WHEN NOT ((OLD.status='reserved' AND NEW.status IN ('uploading','expired','rejected'))
  OR (OLD.status='uploading' AND NEW.status IN ('completed','rejected','expired')))
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_STATE'); END;

-- Zero is intentionally disabled. Operations must approve and configure a project byte quota.
INSERT INTO music_settings(key,value_json,updated_at) VALUES('storageQuotaBytes','0',0);
