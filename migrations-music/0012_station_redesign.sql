-- MUSIC_DB only. Never apply through WAITLIST_DB or migrations-mobile.
-- Additive website/promotion extension; existing music tables, sealed revisions and rights are retained.
-- UTC epoch milliseconds, matching the existing music schema. No song/game/platform/rights seeds.
-- Apply this complete file atomically. Runtime request handlers must never run migrations.

CREATE TABLE IF NOT EXISTS station_track_publications (
  track_id TEXT PRIMARY KEY NOT NULL REFERENCES music_tracks(id),
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','legacy_backfill')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  draft_revision INTEGER CHECK (draft_revision > 0),
  published_revision INTEGER CHECK (published_revision > 0),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  scheduled_at INTEGER CHECK (scheduled_at >= 0),
  published_at INTEGER CHECK (published_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (track_id,draft_revision) REFERENCES station_track_revisions(track_id,revision),
  FOREIGN KEY (track_id,published_revision) REFERENCES station_track_revisions(track_id,revision),
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR (published_revision IS NOT NULL AND published_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_track_publications_pointers_insert AFTER INSERT ON station_track_publications
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_track_revisions WHERE track_id=NEW.track_id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_track_revisions WHERE track_id=NEW.track_id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TRIGGER IF NOT EXISTS station_track_publications_pointers_update AFTER UPDATE ON station_track_publications
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_track_revisions WHERE track_id=NEW.track_id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_track_revisions WHERE track_id=NEW.track_id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TABLE IF NOT EXISTS station_track_revisions (
  track_id TEXT NOT NULL REFERENCES station_track_publications(track_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sealed')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object'),
  legacy_revision_id TEXT,
  site_audio_mode TEXT NOT NULL DEFAULT 'none' CHECK (site_audio_mode IN ('none','preview','free_full','existing_entitlement')),
  duration_ms INTEGER CHECK (duration_ms > 0),
  cover_asset_id TEXT,
  lyrics_asset_id TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  FOREIGN KEY (track_id,legacy_revision_id) REFERENCES music_track_revisions(track_id,id),
  FOREIGN KEY (track_id,cover_asset_id) REFERENCES music_assets(owner_track_id,id),
  FOREIGN KEY (track_id,lyrics_asset_id) REFERENCES music_assets(owner_track_id,id),
  CHECK (site_audio_mode NOT IN ('free_full','existing_entitlement') OR legacy_revision_id IS NOT NULL),
  PRIMARY KEY (track_id,revision)
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_track_revisions_immutable BEFORE UPDATE ON station_track_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_track_revisions_retained BEFORE DELETE ON station_track_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_track_revisions_replace BEFORE INSERT ON station_track_revisions
WHEN EXISTS (SELECT 1 FROM station_track_revisions WHERE track_id=NEW.track_id AND revision=NEW.revision AND state='sealed')
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_track_revisions_identity BEFORE UPDATE OF track_id,revision ON station_track_revisions
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TABLE IF NOT EXISTS station_track_routes (
  slug TEXT PRIMARY KEY NOT NULL CHECK (length(slug) BETWEEN 1 AND 100),
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  role TEXT NOT NULL CHECK (role IN ('canonical','alias')),
  origin TEXT NOT NULL DEFAULT 'managed' CHECK (origin IN ('managed','legacy_backfill')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (origin='legacy_backfill' OR (slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT LIKE '-%' AND slug NOT LIKE '%-' AND instr(slug,'--')=0))
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS station_track_one_canonical ON station_track_routes(track_id) WHERE role='canonical';

CREATE TRIGGER IF NOT EXISTS station_track_routes_owner BEFORE INSERT ON station_track_routes
WHEN EXISTS (SELECT 1 FROM station_track_routes WHERE slug=NEW.slug AND track_id<>NEW.track_id)
  OR EXISTS (SELECT 1 FROM music_tracks WHERE slug=NEW.slug AND id<>NEW.track_id)
BEGIN SELECT RAISE(ABORT,'STATION_SLUG_OWNERSHIP'); END;

CREATE TRIGGER IF NOT EXISTS station_track_routes_identity BEFORE UPDATE OF slug,track_id,origin,created_at ON station_track_routes
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_track_routes_alias BEFORE UPDATE OF role ON station_track_routes WHEN OLD.role='alias' AND NEW.role<>OLD.role
BEGIN SELECT RAISE(ABORT,'STATION_SLUG_RETIRED'); END;

CREATE TRIGGER IF NOT EXISTS station_track_routes_replace BEFORE INSERT ON station_track_routes
WHEN EXISTS (SELECT 1 FROM station_track_routes WHERE slug=NEW.slug AND (track_id<>NEW.track_id OR role<>NEW.role OR origin<>NEW.origin OR created_at<>NEW.created_at))
BEGIN SELECT RAISE(ABORT,'STATION_SLUG_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_legacy_track_slug_reservation BEFORE INSERT ON music_tracks
WHEN EXISTS (SELECT 1 FROM station_track_routes WHERE slug=NEW.slug AND track_id<>NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_SLUG_OWNERSHIP'); END;

CREATE TRIGGER IF NOT EXISTS station_legacy_track_slug_update BEFORE UPDATE OF slug ON music_tracks
WHEN EXISTS (SELECT 1 FROM station_track_routes WHERE slug=NEW.slug AND track_id<>NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_SLUG_OWNERSHIP'); END;

CREATE TABLE IF NOT EXISTS station_platform_links (
  id TEXT PRIMARY KEY NOT NULL,
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  provider TEXT NOT NULL CHECK (provider IN ('netease','qishui','apple_music','youtube','spotify')),
  territories_json TEXT NOT NULL DEFAULT '["*"]' CHECK (json_valid(territories_json) AND json_type(territories_json)='array' AND json_array_length(territories_json)>0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','live','unavailable','removed')),
  url TEXT CHECK (url IS NULL OR (length(url) BETWEEN 10 AND 2048 AND url LIKE 'https://%')),
  verified_at INTEGER CHECK (verified_at >= 0),
  external_released_at INTEGER CHECK (external_released_at >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (track_id,provider,territories_json),
  UNIQUE (track_id,id),
  CHECK (status<>'live' OR (url IS NOT NULL AND verified_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_platform_territories_insert BEFORE INSERT ON station_platform_links
WHEN NEW.territories_json<>(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(NEW.territories_json) ORDER BY value))
  OR EXISTS (SELECT 1 FROM json_each(NEW.territories_json) WHERE type<>'text' OR (value<>'*' AND (length(value)<>2 OR value GLOB '*[^A-Z]*')))
  OR (json_array_length(NEW.territories_json)>1 AND EXISTS (SELECT 1 FROM json_each(NEW.territories_json) WHERE value='*'))
BEGIN SELECT RAISE(ABORT,'STATION_TERRITORIES'); END;

CREATE TRIGGER IF NOT EXISTS station_platform_territories_update BEFORE UPDATE ON station_platform_links
WHEN NEW.territories_json<>(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(NEW.territories_json) ORDER BY value))
  OR EXISTS (SELECT 1 FROM json_each(NEW.territories_json) WHERE type<>'text' OR (value<>'*' AND (length(value)<>2 OR value GLOB '*[^A-Z]*')))
  OR (json_array_length(NEW.territories_json)>1 AND EXISTS (SELECT 1 FROM json_each(NEW.territories_json) WHERE value='*'))
BEGIN SELECT RAISE(ABORT,'STATION_TERRITORIES'); END;

CREATE TABLE IF NOT EXISTS station_games (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 100 AND slug<>'cat-life' AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT LIKE '-%' AND slug NOT LIKE '%-' AND instr(slug,'--')=0),
  runtime_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  draft_revision INTEGER CHECK (draft_revision > 0),
  published_revision INTEGER CHECK (published_revision > 0),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  scheduled_at INTEGER CHECK (scheduled_at >= 0),
  published_at INTEGER CHECK (published_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (id,draft_revision) REFERENCES station_game_revisions(id,revision),
  FOREIGN KEY (id,published_revision) REFERENCES station_game_revisions(id,revision),
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR (published_revision IS NOT NULL AND published_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_games_pointers_insert AFTER INSERT ON station_games
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_game_revisions WHERE id=NEW.id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_game_revisions WHERE id=NEW.id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TRIGGER IF NOT EXISTS station_games_pointers_update AFTER UPDATE ON station_games
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_game_revisions WHERE id=NEW.id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_game_revisions WHERE id=NEW.id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TABLE IF NOT EXISTS station_game_revisions (
  id TEXT NOT NULL REFERENCES station_games(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sealed')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object'),
  launch_url TEXT CHECK (launch_url IS NULL OR (launch_url LIKE '/games/%/' AND launch_url NOT GLOB '*[^a-z0-9/_-]*' AND instr(launch_url,'//')=0)),
  supported_devices_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(supported_devices_json) AND json_type(supported_devices_json)='array'),
  screenshot_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(screenshot_ids_json) AND json_type(screenshot_ids_json)='array'),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (id,revision)
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_game_revisions_immutable BEFORE UPDATE ON station_game_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_game_revisions_retained BEFORE DELETE ON station_game_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_game_revisions_replace BEFORE INSERT ON station_game_revisions
WHEN EXISTS (SELECT 1 FROM station_game_revisions WHERE id=NEW.id AND revision=NEW.revision AND state='sealed')
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_game_revisions_identity BEFORE UPDATE OF id,revision ON station_game_revisions
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TABLE IF NOT EXISTS station_clips (
  id TEXT PRIMARY KEY NOT NULL,
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  type TEXT NOT NULL CHECK (type IN ('short_video','mv')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  draft_revision INTEGER CHECK (draft_revision > 0),
  published_revision INTEGER CHECK (published_revision > 0),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  scheduled_at INTEGER CHECK (scheduled_at >= 0),
  published_at INTEGER CHECK (published_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (track_id,id),
  FOREIGN KEY (id,draft_revision) REFERENCES station_clip_revisions(id,revision),
  FOREIGN KEY (id,published_revision) REFERENCES station_clip_revisions(id,revision),
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR (published_revision IS NOT NULL AND published_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_clips_pointers_insert AFTER INSERT ON station_clips
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_clip_revisions WHERE id=NEW.id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_clip_revisions WHERE id=NEW.id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TRIGGER IF NOT EXISTS station_clips_pointers_update AFTER UPDATE ON station_clips
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_clip_revisions WHERE id=NEW.id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_clip_revisions WHERE id=NEW.id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TABLE IF NOT EXISTS station_clip_revisions (
  id TEXT NOT NULL REFERENCES station_clips(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sealed')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND json_type(metadata_json)='object'),
  media_asset_id TEXT,
  poster_asset_id TEXT,
  duration_ms INTEGER CHECK (duration_ms > 0),
  subtitles_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(subtitles_json) AND json_type(subtitles_json)='object'),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  FOREIGN KEY (id,media_asset_id) REFERENCES station_media_assets(owner_clip_id,id),
  FOREIGN KEY (id,poster_asset_id) REFERENCES station_media_assets(owner_clip_id,id),
  PRIMARY KEY (id,revision)
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_clip_revisions_immutable BEFORE UPDATE ON station_clip_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_revisions_retained BEFORE DELETE ON station_clip_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_revisions_replace BEFORE INSERT ON station_clip_revisions
WHEN EXISTS (SELECT 1 FROM station_clip_revisions WHERE id=NEW.id AND revision=NEW.revision AND state='sealed')
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_revisions_identity BEFORE UPDATE OF id,revision ON station_clip_revisions
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TABLE IF NOT EXISTS station_media_assets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_clip_id TEXT REFERENCES station_clips(id),
  owner_game_id TEXT REFERENCES station_games(id),
  kind TEXT NOT NULL CHECK (kind IN ('short_video','mv','poster','game_screenshot')),
  object_key TEXT NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 512),
  content_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','uploading','uploaded','validated','rejected','revoked')),
  byte_size INTEGER CHECK (byte_size > 0),
  duration_ms INTEGER CHECK (duration_ms > 0),
  width INTEGER CHECK (width > 0),
  height INTEGER CHECK (height > 0),
  sha256 TEXT CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  etag TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (owner_clip_id,id),
  UNIQUE (owner_game_id,id),
  CHECK ((kind='game_screenshot' AND owner_game_id IS NOT NULL AND owner_clip_id IS NULL) OR
    (kind<>'game_screenshot' AND owner_clip_id IS NOT NULL AND owner_game_id IS NULL)),
  CHECK ((kind IN ('short_video','mv') AND content_type IN ('video/mp4','video/webm')) OR
    (kind IN ('poster','game_screenshot') AND content_type IN ('image/jpeg','image/png','image/webp'))),
  CHECK (state NOT IN ('uploaded','validated') OR (byte_size IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK (state<>'validated' OR (kind IN ('short_video','mv') AND duration_ms IS NOT NULL) OR
    (kind IN ('poster','game_screenshot') AND width IS NOT NULL AND height IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_media_asset_body BEFORE UPDATE OF object_key,kind,owner_clip_id,owner_game_id ON station_media_assets
BEGIN SELECT RAISE(ABORT,'STATION_ASSET_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_media_asset_validated BEFORE UPDATE OF content_type,byte_size,duration_ms,width,height,sha256,etag ON station_media_assets WHEN OLD.state IN ('validated','revoked')
BEGIN SELECT RAISE(ABORT,'STATION_VALIDATED_ASSET'); END;

CREATE TRIGGER IF NOT EXISTS station_media_asset_terminal BEFORE UPDATE OF state ON station_media_assets
WHEN (OLD.state='validated' AND NEW.state NOT IN ('validated','revoked')) OR (OLD.state='revoked' AND NEW.state<>'revoked')
BEGIN SELECT RAISE(ABORT,'STATION_VALIDATED_ASSET'); END;

CREATE TRIGGER IF NOT EXISTS station_media_asset_replace BEFORE INSERT ON station_media_assets
WHEN EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.id OR object_key=NEW.object_key)
BEGIN SELECT RAISE(ABORT,'STATION_ASSET_IDENTITY'); END;

CREATE TABLE IF NOT EXISTS station_asset_rights (
  id TEXT PRIMARY KEY NOT NULL,
  music_asset_id TEXT REFERENCES music_assets(id),
  media_asset_id TEXT REFERENCES station_media_assets(id),
  scope TEXT NOT NULL CHECK (scope IN ('cover','preview','lyrics','short_video','mv','poster','game_screenshot')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','blocked')),
  basis TEXT,
  reviewer_id TEXT,
  reviewed_at INTEGER CHECK (reviewed_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (music_asset_id,scope),
  UNIQUE (media_asset_id,scope),
  CHECK ((music_asset_id IS NOT NULL AND media_asset_id IS NULL) OR (music_asset_id IS NULL AND media_asset_id IS NOT NULL)),
  CHECK (status='pending' OR (basis IS NOT NULL AND length(trim(basis))>0 AND reviewer_id IS NOT NULL AND length(trim(reviewer_id))>0 AND reviewed_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_rights_scope_insert BEFORE INSERT ON station_asset_rights
WHEN (NEW.music_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.music_asset_id AND kind=NEW.scope AND kind IN ('cover','preview','lyrics')))
  OR (NEW.media_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.media_asset_id AND kind=NEW.scope))
BEGIN SELECT RAISE(ABORT,'STATION_RIGHTS_SCOPE'); END;

CREATE TRIGGER IF NOT EXISTS station_rights_scope_update BEFORE UPDATE ON station_asset_rights
WHEN (NEW.music_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.music_asset_id AND kind=NEW.scope AND kind IN ('cover','preview','lyrics')))
  OR (NEW.media_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.media_asset_id AND kind=NEW.scope))
BEGIN SELECT RAISE(ABORT,'STATION_RIGHTS_SCOPE'); END;

CREATE TABLE IF NOT EXISTS station_clip_publications (
  id TEXT PRIMARY KEY NOT NULL,
  clip_id TEXT NOT NULL REFERENCES station_clips(id),
  channel TEXT NOT NULL,
  post_id TEXT NOT NULL,
  post_url TEXT NOT NULL CHECK (post_url LIKE 'https://%' AND length(post_url)<=2048),
  external_published_at INTEGER NOT NULL CHECK (external_published_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (channel,post_id),
  UNIQUE (clip_id,channel,post_id)
) STRICT;

CREATE TABLE IF NOT EXISTS station_promotions (
  track_id TEXT PRIMARY KEY NOT NULL REFERENCES station_track_publications(track_id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  draft_revision INTEGER CHECK (draft_revision > 0),
  published_revision INTEGER CHECK (published_revision > 0),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  scheduled_at INTEGER CHECK (scheduled_at >= 0),
  published_at INTEGER CHECK (published_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (track_id,draft_revision) REFERENCES station_promotion_revisions(track_id,revision),
  FOREIGN KEY (track_id,published_revision) REFERENCES station_promotion_revisions(track_id,revision),
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR (published_revision IS NOT NULL AND published_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_promotions_pointers_insert AFTER INSERT ON station_promotions
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_promotion_revisions WHERE track_id=NEW.track_id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_promotion_revisions WHERE track_id=NEW.track_id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TRIGGER IF NOT EXISTS station_promotions_pointers_update AFTER UPDATE ON station_promotions
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_promotion_revisions WHERE track_id=NEW.track_id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_promotion_revisions WHERE track_id=NEW.track_id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TABLE IF NOT EXISTS station_promotion_revisions (
  track_id TEXT NOT NULL REFERENCES station_promotions(track_id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sealed')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  preview_enabled INTEGER NOT NULL DEFAULT 0 CHECK (preview_enabled IN (0,1)),
  preview_asset_id TEXT,
  selected_platform_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_platform_ids_json) AND json_type(selected_platform_ids_json)='array'),
  selected_clip_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_clip_ids_json) AND json_type(selected_clip_ids_json)='array'),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  FOREIGN KEY (track_id,preview_asset_id) REFERENCES music_assets(owner_track_id,id),
  CHECK (preview_enabled=0 OR preview_asset_id IS NOT NULL),
  PRIMARY KEY (track_id,revision)
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_immutable BEFORE UPDATE ON station_promotion_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_retained BEFORE DELETE ON station_promotion_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_replace BEFORE INSERT ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM station_promotion_revisions WHERE track_id=NEW.track_id AND revision=NEW.revision AND state='sealed')
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_identity BEFORE UPDATE OF track_id,revision ON station_promotion_revisions
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TABLE IF NOT EXISTS station_home_configs (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','published','archived')),
  draft_revision INTEGER CHECK (draft_revision > 0),
  published_revision INTEGER CHECK (published_revision > 0),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  scheduled_at INTEGER CHECK (scheduled_at >= 0),
  published_at INTEGER CHECK (published_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (id,draft_revision) REFERENCES station_home_revisions(id,revision),
  FOREIGN KEY (id,published_revision) REFERENCES station_home_revisions(id,revision),
  CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL),
  CHECK (status <> 'published' OR (published_revision IS NOT NULL AND published_at IS NOT NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_home_configs_pointers_insert AFTER INSERT ON station_home_configs
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_home_revisions WHERE id=NEW.id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_home_revisions WHERE id=NEW.id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TRIGGER IF NOT EXISTS station_home_configs_pointers_update AFTER UPDATE ON station_home_configs
WHEN (NEW.draft_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_home_revisions WHERE id=NEW.id AND revision=NEW.draft_revision AND state='draft'))
  OR (NEW.published_revision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_home_revisions WHERE id=NEW.id AND revision=NEW.published_revision AND state='sealed'))
BEGIN SELECT RAISE(ABORT,'STATION_REVISION_POINTER'); END;

CREATE TABLE IF NOT EXISTS station_home_revisions (
  id TEXT NOT NULL REFERENCES station_home_configs(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sealed')),
  featured_track_id TEXT REFERENCES station_promotions(track_id),
  featured_game_id TEXT REFERENCES station_games(id),
  selected_track_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_track_ids_json) AND json_type(selected_track_ids_json)='array' AND json_array_length(selected_track_ids_json)<=3),
  selected_clip_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_clip_ids_json) AND json_type(selected_clip_ids_json)='array' AND json_array_length(selected_clip_ids_json)<=4),
  selected_update_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(selected_update_ids_json) AND json_type(selected_update_ids_json)='array' AND json_array_length(selected_update_ids_json)<=3),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (id,revision)
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_immutable BEFORE UPDATE ON station_home_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_retained BEFORE DELETE ON station_home_revisions WHEN OLD.state='sealed'
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_replace BEFORE INSERT ON station_home_revisions
WHEN EXISTS (SELECT 1 FROM station_home_revisions WHERE id=NEW.id AND revision=NEW.revision AND state='sealed')
BEGIN SELECT RAISE(ABORT,'STATION_SEALED_REVISION'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_identity BEFORE UPDATE OF id,revision ON station_home_revisions
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TABLE IF NOT EXISTS station_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  medium TEXT NOT NULL,
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  clip_id TEXT,
  landing_path TEXT NOT NULL CHECK (landing_path LIKE '/%' AND landing_path NOT LIKE '//%' AND length(landing_path)<=1024),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (track_id,clip_id) REFERENCES station_clips(track_id,id)
) STRICT;

CREATE TABLE IF NOT EXISTS station_route_migrations (
  old_path TEXT PRIMARY KEY NOT NULL CHECK (old_path LIKE '/%' AND old_path NOT LIKE '//%'),
  action TEXT NOT NULL CHECK (action IN ('keep','redirect','retire','service')),
  new_path TEXT CHECK (new_path IS NULL OR (new_path LIKE '/%' AND new_path NOT LIKE '//%')),
  reason TEXT NOT NULL CHECK (length(trim(reason))>0),
  approved_at INTEGER CHECK (approved_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (action<>'redirect' OR (new_path IS NOT NULL AND new_path<>old_path)),
  CHECK (action IN ('redirect','keep') OR new_path IS NULL)
) STRICT;

CREATE TABLE IF NOT EXISTS station_analytics_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_name TEXT NOT NULL CHECK (event_name IN ('track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete','game_launch_request','game_ready','save_success')),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  track_id TEXT REFERENCES music_tracks(id),
  clip_id TEXT,
  game_id TEXT REFERENCES station_games(id),
  campaign_id TEXT REFERENCES station_campaigns(id),
  platform_link_id TEXT,
  session_id TEXT NOT NULL CHECK (length(session_id) BETWEEN 1 AND 128),
  playback_id TEXT CHECK (length(playback_id) BETWEEN 1 AND 128),
  interaction_id TEXT CHECK (length(interaction_id) BETWEEN 1 AND 128),
  launch_id TEXT CHECK (length(launch_id) BETWEEN 1 AND 128),
  save_operation_id TEXT CHECK (length(save_operation_id) BETWEEN 1 AND 128),
  FOREIGN KEY (track_id,clip_id) REFERENCES station_clips(track_id,id),
  FOREIGN KEY (track_id,platform_link_id) REFERENCES station_platform_links(track_id,id),
  CHECK (clip_id IS NULL OR track_id IS NOT NULL),
  CHECK (platform_link_id IS NULL OR track_id IS NOT NULL),
  CHECK (event_name NOT IN ('track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete') OR track_id IS NOT NULL),
  CHECK (event_name NOT IN ('preview_start','full_audio_start','preview_qualified','clip_start','clip_complete') OR playback_id IS NOT NULL),
  CHECK (event_name NOT IN ('clip_start','clip_complete') OR clip_id IS NOT NULL),
  CHECK (event_name<>'platform_click' OR (platform_link_id IS NOT NULL AND interaction_id IS NOT NULL)),
  CHECK (event_name NOT IN ('game_launch_request','game_ready','save_success') OR game_id IS NOT NULL),
  CHECK (event_name NOT IN ('game_launch_request','game_ready') OR launch_id IS NOT NULL),
  CHECK (event_name<>'save_success' OR save_operation_id IS NOT NULL)
) STRICT;

CREATE TRIGGER IF NOT EXISTS station_analytics_events_retained BEFORE DELETE ON station_analytics_events
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_analytics_events_append_only BEFORE UPDATE ON station_analytics_events
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_analytics_events_replace BEFORE INSERT ON station_analytics_events WHEN EXISTS (SELECT 1 FROM station_analytics_events WHERE event_id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_track_publications_identity BEFORE UPDATE OF track_id ON station_track_publications
WHEN NEW.track_id IS NOT OLD.track_id
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_track_publications_retained BEFORE DELETE ON station_track_publications
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_track_publications_replace BEFORE INSERT ON station_track_publications WHEN EXISTS (SELECT 1 FROM station_track_publications WHERE track_id=NEW.track_id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_platform_links_identity BEFORE UPDATE OF id,track_id,provider ON station_platform_links
WHEN NEW.id IS NOT OLD.id OR NEW.track_id IS NOT OLD.track_id OR NEW.provider IS NOT OLD.provider
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_platform_links_retained BEFORE DELETE ON station_platform_links
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_platform_links_replace BEFORE INSERT ON station_platform_links WHEN EXISTS (SELECT 1 FROM station_platform_links WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_games_identity BEFORE UPDATE OF id,slug ON station_games
WHEN NEW.id IS NOT OLD.id OR NEW.slug IS NOT OLD.slug
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

-- An unbound draft can acquire its verified runtime; an existing binding stays stable.
CREATE TRIGGER IF NOT EXISTS station_game_runtime_identity BEFORE UPDATE OF runtime_key ON station_games
WHEN NEW.runtime_key IS NOT OLD.runtime_key AND (OLD.runtime_key IS NOT NULL OR OLD.published_revision IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'STATION_GAME_RUNTIME_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_games_retained BEFORE DELETE ON station_games
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_games_replace BEFORE INSERT ON station_games WHEN EXISTS (SELECT 1 FROM station_games WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_clips_identity BEFORE UPDATE OF id,track_id,type ON station_clips
WHEN NEW.id IS NOT OLD.id OR NEW.track_id IS NOT OLD.track_id OR NEW.type IS NOT OLD.type
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_clips_retained BEFORE DELETE ON station_clips
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_clips_replace BEFORE INSERT ON station_clips WHEN EXISTS (SELECT 1 FROM station_clips WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_media_assets_identity BEFORE UPDATE OF id ON station_media_assets
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_media_assets_retained BEFORE DELETE ON station_media_assets
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_asset_rights_identity BEFORE UPDATE OF id,music_asset_id,media_asset_id,scope ON station_asset_rights
WHEN NEW.id IS NOT OLD.id OR NEW.music_asset_id IS NOT OLD.music_asset_id OR NEW.media_asset_id IS NOT OLD.media_asset_id OR NEW.scope IS NOT OLD.scope
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_asset_rights_retained BEFORE DELETE ON station_asset_rights
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_asset_rights_replace BEFORE INSERT ON station_asset_rights WHEN EXISTS (SELECT 1 FROM station_asset_rights WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_publications_identity BEFORE UPDATE OF id,clip_id,channel,post_id ON station_clip_publications
WHEN NEW.id IS NOT OLD.id OR NEW.clip_id IS NOT OLD.clip_id OR NEW.channel IS NOT OLD.channel OR NEW.post_id IS NOT OLD.post_id
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_publications_retained BEFORE DELETE ON station_clip_publications
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_publications_replace BEFORE INSERT ON station_clip_publications WHEN EXISTS (SELECT 1 FROM station_clip_publications WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_promotions_identity BEFORE UPDATE OF track_id ON station_promotions
WHEN NEW.track_id IS NOT OLD.track_id
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_promotions_retained BEFORE DELETE ON station_promotions
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_promotions_replace BEFORE INSERT ON station_promotions WHEN EXISTS (SELECT 1 FROM station_promotions WHERE track_id=NEW.track_id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_home_configs_identity BEFORE UPDATE OF id ON station_home_configs
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_home_configs_retained BEFORE DELETE ON station_home_configs
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_home_configs_replace BEFORE INSERT ON station_home_configs WHEN EXISTS (SELECT 1 FROM station_home_configs WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_campaigns_identity BEFORE UPDATE OF id,track_id,clip_id ON station_campaigns
WHEN NEW.id IS NOT OLD.id OR NEW.track_id IS NOT OLD.track_id OR NEW.clip_id IS NOT OLD.clip_id
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_campaigns_retained BEFORE DELETE ON station_campaigns
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_campaigns_replace BEFORE INSERT ON station_campaigns WHEN EXISTS (SELECT 1 FROM station_campaigns WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_IDENTITY'); END;

CREATE TRIGGER IF NOT EXISTS station_track_routes_retained BEFORE DELETE ON station_track_routes
BEGIN SELECT RAISE(ABORT,'STATION_OBJECT_RETAINED'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_selected_platform_ids_json_insert BEFORE INSERT ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_platform_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_platform_links WHERE id=item.value AND track_id=NEW.track_id))
  OR json_array_length(NEW.selected_platform_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_platform_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_selected_platform_ids_json_update BEFORE UPDATE ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_platform_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_platform_links WHERE id=item.value AND track_id=NEW.track_id))
  OR json_array_length(NEW.selected_platform_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_platform_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_selected_clip_ids_json_insert BEFORE INSERT ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_clip_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_clips WHERE id=item.value AND track_id=NEW.track_id))
  OR json_array_length(NEW.selected_clip_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_clip_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_selected_clip_ids_json_update BEFORE UPDATE ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_clip_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_clips WHERE id=item.value AND track_id=NEW.track_id))
  OR json_array_length(NEW.selected_clip_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_clip_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_selected_track_ids_json_insert BEFORE INSERT ON station_home_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_track_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM music_tracks WHERE id=item.value))
  OR json_array_length(NEW.selected_track_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_track_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_selected_track_ids_json_update BEFORE UPDATE ON station_home_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_track_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM music_tracks WHERE id=item.value))
  OR json_array_length(NEW.selected_track_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_track_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_selected_clip_ids_json_insert BEFORE INSERT ON station_home_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_clip_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_clips WHERE id=item.value))
  OR json_array_length(NEW.selected_clip_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_clip_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_home_revisions_selected_clip_ids_json_update BEFORE UPDATE ON station_home_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.selected_clip_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_clips WHERE id=item.value))
  OR json_array_length(NEW.selected_clip_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.selected_clip_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_game_revisions_screenshot_ids_json_insert BEFORE INSERT ON station_game_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.screenshot_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=item.value AND owner_game_id=NEW.id AND kind='game_screenshot'))
  OR json_array_length(NEW.screenshot_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.screenshot_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_game_revisions_screenshot_ids_json_update BEFORE UPDATE ON station_game_revisions
WHEN EXISTS (SELECT 1 FROM json_each(NEW.screenshot_ids_json) AS item WHERE item.type<>'text' OR NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=item.value AND owner_game_id=NEW.id AND kind='game_screenshot'))
  OR json_array_length(NEW.screenshot_ids_json)<>(SELECT COUNT(DISTINCT value) FROM json_each(NEW.screenshot_ids_json))
BEGIN SELECT RAISE(ABORT,'STATION_SELECTED_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_preview_kind_insert BEFORE INSERT ON station_promotion_revisions
WHEN NEW.preview_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.preview_asset_id AND owner_track_id=NEW.track_id AND kind='preview')
BEGIN SELECT RAISE(ABORT,'STATION_PREVIEW_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_preview_kind_update BEFORE UPDATE ON station_promotion_revisions
WHEN NEW.preview_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.preview_asset_id AND owner_track_id=NEW.track_id AND kind='preview')
BEGIN SELECT RAISE(ABORT,'STATION_PREVIEW_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_cover_kind_insert BEFORE INSERT ON station_track_revisions
WHEN NEW.cover_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.cover_asset_id AND owner_track_id=NEW.track_id AND kind='cover')
BEGIN SELECT RAISE(ABORT,'STATION_COVER_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_cover_kind_update BEFORE UPDATE ON station_track_revisions
WHEN NEW.cover_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.cover_asset_id AND owner_track_id=NEW.track_id AND kind='cover')
BEGIN SELECT RAISE(ABORT,'STATION_COVER_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_kind_insert BEFORE INSERT ON station_clip_revisions
WHEN (NEW.media_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_media_assets a JOIN station_clips c ON c.id=NEW.id WHERE a.id=NEW.media_asset_id AND a.owner_clip_id=c.id AND a.kind=c.type))
 OR (NEW.poster_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.poster_asset_id AND owner_clip_id=NEW.id AND kind='poster'))
BEGIN SELECT RAISE(ABORT,'STATION_CLIP_ASSET_REFERENCE'); END;

CREATE TRIGGER IF NOT EXISTS station_clip_kind_update BEFORE UPDATE ON station_clip_revisions
WHEN (NEW.media_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_media_assets a JOIN station_clips c ON c.id=NEW.id WHERE a.id=NEW.media_asset_id AND a.owner_clip_id=c.id AND a.kind=c.type))
 OR (NEW.poster_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM station_media_assets WHERE id=NEW.poster_asset_id AND owner_clip_id=NEW.id AND kind='poster'))
BEGIN SELECT RAISE(ABORT,'STATION_CLIP_ASSET_REFERENCE'); END;

DROP VIEW IF EXISTS music_asset_references;
CREATE VIEW music_asset_references AS
SELECT a.id,
  (EXISTS (SELECT 1 FROM music_track_revisions r WHERE a.id IN
    (r.audio_asset_id,r.preview_asset_id,r.cover_asset_id,r.lyrics_asset_id))
   OR EXISTS (SELECT 1 FROM station_track_revisions r WHERE a.id IN (r.cover_asset_id,r.lyrics_asset_id))
   OR EXISTS (SELECT 1 FROM station_promotion_revisions r WHERE r.preview_asset_id=a.id)) AS revision_ref,
  EXISTS (SELECT 1 FROM music_rights_evidence e WHERE e.asset_id=a.id) AS evidence_ref,
  (EXISTS (SELECT 1 FROM music_rights_reviews r,json_tree(r.review_json) j WHERE j.atom=a.id)
   OR EXISTS (SELECT 1 FROM station_asset_rights r WHERE r.music_asset_id=a.id)) AS rights_ref,
  EXISTS (SELECT 1 FROM music_assets d WHERE d.derived_from_asset_id=a.id
    AND NOT EXISTS (SELECT 1 FROM music_upload_cleanup c WHERE c.asset_id=d.id)) AS derived_ref,
  EXISTS (SELECT 1 FROM music_admin_audit_logs l WHERE l.action NOT IN
    ('music.upload.reserve','music.upload.start','music.upload.reject','music.upload.complete',
     'music.cleanup.claim','music.cleanup.prove','music.cleanup.release')
    AND (l.target_id=a.id OR EXISTS (SELECT 1 FROM json_tree(l.summary_json) j WHERE j.atom=a.id))) AS audit_ref
FROM music_assets a;

CREATE TRIGGER IF NOT EXISTS station_track_revisions_retired_asset_insert BEFORE INSERT ON station_track_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.cover_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE TRIGGER IF NOT EXISTS station_track_revisions_retired_asset_update BEFORE UPDATE ON station_track_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.cover_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_retired_asset_insert BEFORE INSERT ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.preview_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE TRIGGER IF NOT EXISTS station_promotion_revisions_retired_asset_update BEFORE UPDATE ON station_promotion_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.preview_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE TRIGGER IF NOT EXISTS station_asset_rights_retired_asset_insert BEFORE INSERT ON station_asset_rights
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.music_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE TRIGGER IF NOT EXISTS station_asset_rights_retired_asset_update BEFORE UPDATE ON station_asset_rights
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.music_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

-- Lyrics reuse the existing owned resource, including cleanup retirement guards.
CREATE TRIGGER IF NOT EXISTS station_lyrics_kind_insert BEFORE INSERT ON station_track_revisions
WHEN NEW.lyrics_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.lyrics_asset_id AND owner_track_id=NEW.track_id AND kind='lyrics')
BEGIN SELECT RAISE(ABORT,'STATION_LYRICS_REFERENCE'); END;
CREATE TRIGGER IF NOT EXISTS station_lyrics_kind_update BEFORE UPDATE ON station_track_revisions
WHEN NEW.lyrics_asset_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_assets WHERE id=NEW.lyrics_asset_id AND owner_track_id=NEW.track_id AND kind='lyrics')
BEGIN SELECT RAISE(ABORT,'STATION_LYRICS_REFERENCE'); END;
CREATE TRIGGER IF NOT EXISTS station_lyrics_retired_insert BEFORE INSERT ON station_track_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.lyrics_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER IF NOT EXISTS station_lyrics_retired_update BEFORE UPDATE ON station_track_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.lyrics_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE INDEX IF NOT EXISTS station_platform_status ON station_platform_links(track_id,status,sort_order,id);
CREATE INDEX IF NOT EXISTS station_clip_status ON station_clips(track_id,status,published_at,id);
CREATE INDEX IF NOT EXISTS station_track_public_status ON station_track_publications(status,published_at,track_id);
CREATE INDEX IF NOT EXISTS station_game_public_status ON station_games(status,published_at,id);
CREATE INDEX IF NOT EXISTS station_promotion_public_status ON station_promotions(status,published_at,track_id);
CREATE INDEX IF NOT EXISTS station_event_received ON station_analytics_events(received_at,event_id);

-- Backfill routing and draft website metadata only. No external release, promotion, preview or license inference.
INSERT INTO station_track_routes(slug,track_id,role,origin,created_at)
SELECT t.slug,t.id,'canonical','legacy_backfill',t.created_at FROM music_tracks t
WHERE NOT EXISTS (SELECT 1 FROM station_track_routes WHERE track_id=t.id);

INSERT INTO station_track_publications(track_id,origin,created_at,updated_at)
SELECT t.id,'legacy_backfill',t.created_at,t.updated_at FROM music_tracks t
WHERE NOT EXISTS (SELECT 1 FROM station_track_publications WHERE track_id=t.id);

INSERT INTO station_track_revisions(track_id,revision,metadata_json,legacy_revision_id,site_audio_mode,duration_ms,cover_asset_id,lyrics_asset_id,created_at)
SELECT t.id,1,COALESCE(r.metadata_json,'{}'),r.id,
  CASE WHEN r.state='sealed' AND r.audio_asset_id IS NOT NULL THEN CASE r.access_mode WHEN 'free' THEN 'free_full' ELSE 'existing_entitlement' END ELSE 'none' END,
  a.duration_ms,r.cover_asset_id,r.lyrics_asset_id,t.created_at
FROM music_tracks t JOIN station_track_publications h ON h.track_id=t.id
LEFT JOIN music_track_revisions r ON r.id=COALESCE(t.published_revision_id,t.draft_revision_id)
LEFT JOIN music_assets a ON a.id=r.audio_asset_id
WHERE h.origin='legacy_backfill' AND h.edit_version=1 AND h.draft_revision IS NULL AND h.published_revision IS NULL
  AND NOT EXISTS (SELECT 1 FROM station_track_revisions WHERE track_id=t.id AND revision=1);

UPDATE station_track_publications SET draft_revision=1
WHERE origin='legacy_backfill' AND edit_version=1 AND draft_revision IS NULL AND published_revision IS NULL
  AND EXISTS (SELECT 1 FROM station_track_revisions r WHERE r.track_id=station_track_publications.track_id AND r.revision=1 AND r.state='draft');

-- One empty home draft matches the file-config stable ID. Replays never overwrite newer drafts/publication.
INSERT INTO station_home_configs(id,created_at,updated_at)
SELECT 'ca710000-0000-4000-8000-000000000001',0,0
WHERE NOT EXISTS (SELECT 1 FROM station_home_configs WHERE id='ca710000-0000-4000-8000-000000000001');
INSERT INTO station_home_revisions(id,revision,created_at)
SELECT id,1,0 FROM station_home_configs h
WHERE h.id='ca710000-0000-4000-8000-000000000001' AND h.edit_version=1 AND h.draft_revision IS NULL AND h.published_revision IS NULL
  AND NOT EXISTS (SELECT 1 FROM station_home_revisions WHERE id=h.id AND revision=1);
UPDATE station_home_configs SET draft_revision=1
WHERE id='ca710000-0000-4000-8000-000000000001' AND edit_version=1 AND draft_revision IS NULL AND published_revision IS NULL
  AND EXISTS (SELECT 1 FROM station_home_revisions WHERE id=station_home_configs.id AND revision=1 AND state='draft');
