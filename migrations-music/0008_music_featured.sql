-- MUSIC_DB only. Curated placement never grants playback access.
CREATE TABLE music_featured_home (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE music_featured_items (
  slot_kind TEXT NOT NULL CHECK (slot_kind IN ('primary','secondary','collection')),
  position INTEGER NOT NULL CHECK (position >= 0 AND
    ((slot_kind = 'primary' AND position = 0) OR (slot_kind IN ('secondary','collection') AND position < 6))),
  track_id TEXT REFERENCES music_tracks(id),
  collection_id TEXT REFERENCES music_collections(id),
  PRIMARY KEY (slot_kind, position),
  UNIQUE (track_id),
  UNIQUE (collection_id),
  CHECK ((slot_kind IN ('primary','secondary') AND track_id IS NOT NULL AND collection_id IS NULL) OR
    (slot_kind = 'collection' AND collection_id IS NOT NULL AND track_id IS NULL))
) STRICT;

INSERT INTO music_featured_home(id,version,updated_at) VALUES(1,1,0);

-- A target must be public when it is selected. Later downlisting is allowed:
-- public projection will omit the stale placement without a cleanup write.
CREATE TRIGGER music_featured_track_insert BEFORE INSERT ON music_featured_items
WHEN NEW.track_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM music_tracks WHERE id=NEW.track_id AND lifecycle='published'
)
BEGIN SELECT RAISE(ABORT,'MUSIC_FEATURED_TRACK_UNAVAILABLE'); END;

CREATE TRIGGER music_featured_collection_insert BEFORE INSERT ON music_featured_items
WHEN NEW.collection_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM music_collections WHERE id=NEW.collection_id AND status='published'
)
BEGIN SELECT RAISE(ABORT,'MUSIC_FEATURED_COLLECTION_UNAVAILABLE'); END;
