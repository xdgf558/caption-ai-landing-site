-- MUSIC_DB only. Existing collections remain playlists; no track policy changes.
ALTER TABLE music_collections ADD COLUMN collection_type TEXT NOT NULL DEFAULT 'playlist'
  CHECK (collection_type IN ('playlist','album'));
ALTER TABLE music_collections ADD COLUMN listening_mode TEXT NOT NULL DEFAULT 'mixed'
  CHECK (listening_mode IN ('mixed','free','vip') AND (collection_type='album' OR listening_mode='mixed'));
ALTER TABLE music_collections ADD COLUMN cover_track_id TEXT REFERENCES music_tracks(id)
  CHECK (collection_type='album' OR cover_track_id IS NULL);

CREATE TRIGGER music_collection_type_immutable BEFORE UPDATE OF collection_type ON music_collections
WHEN NEW.collection_type<>OLD.collection_type
BEGIN SELECT RAISE(ABORT,'MUSIC_COLLECTION_IDENTITY'); END;

-- INSERT OR REPLACE does not reliably fire DELETE triggers. It must not
-- relabel an existing identity or reuse its slug under a different type.
CREATE TRIGGER music_collection_type_replace BEFORE INSERT ON music_collections
WHEN EXISTS (SELECT 1 FROM music_collections
  WHERE (id=NEW.id OR slug=NEW.slug) AND collection_type<>NEW.collection_type)
BEGIN SELECT RAISE(ABORT,'MUSIC_COLLECTION_IDENTITY'); END;

CREATE INDEX music_collections_type_status ON music_collections(collection_type,status,slug);
