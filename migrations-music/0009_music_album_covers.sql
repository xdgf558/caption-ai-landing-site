-- MUSIC_DB only. Independent album covers; no track ownership or media changes.
CREATE TABLE music_collection_assets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_collection_id TEXT NOT NULL REFERENCES music_collections(id),
  kind TEXT NOT NULL CHECK (kind = 'cover'),
  object_key TEXT NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 512),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','uploading','uploaded','validated','rejected')),
  content_type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('jpeg','png','webp')),
  byte_size INTEGER CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256 TEXT CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  etag TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (state NOT IN ('uploaded','validated') OR (byte_size IS NOT NULL AND sha256 IS NOT NULL AND etag IS NOT NULL)),
  CHECK ((format = 'jpeg' AND content_type = 'image/jpeg') OR
    (format = 'png' AND content_type = 'image/png') OR
    (format = 'webp' AND content_type = 'image/webp'))
) STRICT;
CREATE TABLE music_collection_upload_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL UNIQUE REFERENCES music_collection_assets(id),
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','uploading','completed','rejected','expired')),
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes > 0 AND declared_bytes <= 5242880),
  actual_bytes INTEGER CHECK (actual_bytes >= 0 AND actual_bytes <= declared_bytes),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (status <> 'completed' OR actual_bytes = declared_bytes AND actual_bytes IS NOT NULL)
) STRICT;

-- MUSIC_DB only. No remote migration is authorized by merging this file.
ALTER TABLE music_collection_upload_sessions ADD COLUMN expected_sha256 TEXT
  CHECK (expected_sha256 IS NULL OR (length(expected_sha256)=64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE music_collection_upload_sessions ADD COLUMN write_token TEXT;

-- Reservations remain charged even after failure/expiry until a separately audited cleanup exists.
-- Never free quota while a late R2 write may still commit.
CREATE TRIGGER music_collection_upload_identity BEFORE UPDATE ON music_collection_upload_sessions
WHEN NEW.id<>OLD.id OR NEW.asset_id<>OLD.asset_id OR NEW.actor_id<>OLD.actor_id
  OR NEW.declared_bytes<>OLD.declared_bytes OR NEW.expected_sha256 IS NOT OLD.expected_sha256
  OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
  OR (OLD.write_token IS NOT NULL AND NEW.write_token IS NOT OLD.write_token)
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_IMMUTABLE'); END;
CREATE TRIGGER music_collection_upload_no_replace BEFORE INSERT ON music_collection_upload_sessions
WHEN EXISTS (SELECT 1 FROM music_collection_upload_sessions WHERE id=NEW.id OR asset_id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_IMMUTABLE'); END;
CREATE TRIGGER music_collection_upload_no_delete BEFORE DELETE ON music_collection_upload_sessions
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_IMMUTABLE'); END;
CREATE TRIGGER music_collection_upload_transition BEFORE UPDATE OF status ON music_collection_upload_sessions
WHEN NOT ((OLD.status='reserved' AND NEW.status IN ('uploading','expired','rejected'))
  OR (OLD.status='uploading' AND NEW.status IN ('completed','rejected','expired')))
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_STATE'); END;


CREATE TRIGGER music_collection_asset_identity BEFORE UPDATE OF id,owner_collection_id,kind,object_key,format,content_type ON music_collection_assets
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_IDENTITY'); END;
CREATE TRIGGER music_collection_asset_immutable BEFORE UPDATE ON music_collection_assets WHEN OLD.state='validated'
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_IMMUTABLE'); END;
CREATE TRIGGER music_collection_asset_replace BEFORE INSERT ON music_collection_assets WHEN EXISTS(SELECT 1 FROM music_collection_assets WHERE id=NEW.id OR object_key=NEW.object_key)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_IMMUTABLE'); END;
CREATE TRIGGER music_collection_asset_delete BEFORE DELETE ON music_collection_assets
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETAINED'); END;
CREATE TRIGGER music_collection_asset_owner BEFORE INSERT ON music_collection_assets
WHEN NOT EXISTS(SELECT 1 FROM music_collections WHERE id=NEW.owner_collection_id AND collection_type='album' AND status='draft')
BEGIN SELECT RAISE(ABORT,'MUSIC_DRAFT_REQUIRED'); END;
CREATE TRIGGER music_collection_upload_terminal BEFORE UPDATE ON music_collection_upload_sessions WHEN OLD.status IN ('completed','rejected','expired')
BEGIN SELECT RAISE(ABORT,'MUSIC_UPLOAD_TERMINAL'); END;
ALTER TABLE music_collections ADD COLUMN cover_asset_id TEXT REFERENCES music_collection_assets(id);
CREATE TRIGGER music_album_cover_insert BEFORE INSERT ON music_collections WHEN NEW.cover_asset_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'MUSIC_ALBUM_COVER_INVALID'); END;
CREATE TRIGGER music_album_cover_update BEFORE UPDATE ON music_collections
WHEN NEW.cover_asset_id IS NOT NULL AND (NEW.collection_type<>'album' OR NOT EXISTS
 (SELECT 1 FROM music_collection_assets WHERE id=NEW.cover_asset_id AND owner_collection_id=NEW.id AND state='validated' AND kind='cover'))
BEGIN SELECT RAISE(ABORT,'MUSIC_ALBUM_COVER_INVALID'); END;
-- Unknown and superseded album uploads remain charged. No album deletion is enabled.
DROP VIEW music_storage_charges;
CREATE VIEW music_storage_charges AS
SELECT u.asset_id,u.declared_bytes AS charged_bytes FROM music_upload_sessions u
WHERE NOT EXISTS(SELECT 1 FROM music_upload_cleanup c WHERE c.upload_id=u.id AND c.released_at IS NOT NULL)
UNION ALL SELECT a.id,a.byte_size FROM music_assets a WHERE NOT EXISTS(SELECT 1 FROM music_upload_sessions u WHERE u.asset_id=a.id)
UNION ALL SELECT u.asset_id,u.declared_bytes FROM music_collection_upload_sessions u
UNION ALL SELECT a.id,a.byte_size FROM music_collection_assets a WHERE NOT EXISTS(SELECT 1 FROM music_collection_upload_sessions u WHERE u.asset_id=a.id);
