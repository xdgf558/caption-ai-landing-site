-- Independent MUSIC_DB schema. NEVER apply through the existing WAITLIST_DB migration path.
-- All persisted timestamps are UTC epoch milliseconds. No content, membership or grant seeds.
CREATE TABLE music_tracks (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 100),
  lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','published','unpublished','archived')),
  draft_revision_id TEXT,
  published_revision_id TEXT,
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version > 0),
  first_published_at INTEGER CHECK (first_published_at >= 0),
  published_at INTEGER CHECK (published_at >= first_published_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  UNIQUE (id, slug),
  FOREIGN KEY (id, draft_revision_id) REFERENCES music_track_revisions(track_id, id),
  FOREIGN KEY (id, published_revision_id) REFERENCES music_track_revisions(track_id, id),
  CHECK (lifecycle <> 'published' OR (published_revision_id IS NOT NULL AND first_published_at IS NOT NULL AND published_at IS NOT NULL)),
  CHECK (lifecycle NOT IN ('draft','archived') OR published_revision_id IS NULL)
) STRICT;

CREATE TABLE music_assets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_track_id TEXT NOT NULL REFERENCES music_tracks(id),
  kind TEXT NOT NULL CHECK (kind IN ('audio','preview','cover','lyrics','evidence')),
  object_key TEXT NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 512),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','uploading','uploaded','validated','rejected')),
  content_type TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('mp3','jpeg','png','webp','txt','lrc','pdf')),
  byte_size INTEGER CHECK (byte_size > 0),
  duration_ms INTEGER CHECK (duration_ms > 0),
  derived_from_asset_id TEXT,
  source_start_ms INTEGER,
  source_end_ms INTEGER,
  sha256 TEXT CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  etag TEXT,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (owner_track_id, id),
  FOREIGN KEY (owner_track_id, derived_from_asset_id) REFERENCES music_assets(owner_track_id, id),
  CHECK (derived_from_asset_id IS NULL OR derived_from_asset_id <> id),
  CHECK (kind = 'preview' OR (derived_from_asset_id IS NULL AND source_start_ms IS NULL AND source_end_ms IS NULL)),
  CHECK (state NOT IN ('uploaded','validated') OR (byte_size IS NOT NULL AND sha256 IS NOT NULL)),
  CHECK (kind NOT IN ('audio','preview') OR state <> 'validated' OR duration_ms IS NOT NULL),
  CHECK (kind <> 'preview' OR state <> 'validated' OR
    (derived_from_asset_id IS NOT NULL AND source_start_ms IS NOT NULL AND source_end_ms IS NOT NULL AND source_start_ms >= 0 AND source_end_ms > source_start_ms)),
  CHECK ((kind IN ('audio','preview') AND format = 'mp3' AND content_type = 'audio/mpeg') OR
    (kind = 'cover' AND ((format = 'jpeg' AND content_type = 'image/jpeg') OR (format = 'png' AND content_type = 'image/png') OR (format = 'webp' AND content_type = 'image/webp'))) OR
    (kind = 'lyrics' AND format IN ('txt','lrc') AND content_type = 'text/plain') OR
    (kind = 'evidence' AND ((format = 'pdf' AND content_type = 'application/pdf') OR (format = 'jpeg' AND content_type = 'image/jpeg') OR (format = 'png' AND content_type = 'image/png')))),
  CHECK (byte_size IS NULL OR byte_size <= CASE kind WHEN 'audio' THEN 33554432 WHEN 'preview' THEN 4194304 WHEN 'cover' THEN 5242880 WHEN 'lyrics' THEN 131072 WHEN 'evidence' THEN 10485760 END)
) STRICT;

CREATE TABLE music_track_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  revision_no INTEGER NOT NULL CHECK (revision_no > 0),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','sealed')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
  audio_asset_id TEXT,
  preview_asset_id TEXT,
  cover_asset_id TEXT,
  lyrics_asset_id TEXT,
  access_mode TEXT NOT NULL DEFAULT 'vip' CHECK (access_mode IN ('free','vip','early_access')),
  early_access_until INTEGER CHECK (early_access_until >= 0),
  post_early_access_mode TEXT CHECK (post_early_access_mode IN ('free','vip')),
  policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  technical_reviewed_at INTEGER CHECK (technical_reviewed_at >= 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  UNIQUE (track_id, id),
  UNIQUE (track_id, revision_no),
  FOREIGN KEY (track_id, audio_asset_id) REFERENCES music_assets(owner_track_id, id),
  FOREIGN KEY (track_id, preview_asset_id) REFERENCES music_assets(owner_track_id, id),
  FOREIGN KEY (track_id, cover_asset_id) REFERENCES music_assets(owner_track_id, id),
  FOREIGN KEY (track_id, lyrics_asset_id) REFERENCES music_assets(owner_track_id, id),
  CHECK ((access_mode = 'early_access' AND early_access_until IS NOT NULL AND post_early_access_mode IS NOT NULL) OR
    (access_mode IN ('free','vip') AND early_access_until IS NULL AND post_early_access_mode IS NULL)),
  CHECK (state <> 'sealed' OR (audio_asset_id IS NOT NULL AND technical_reviewed_at IS NOT NULL))
) STRICT;

CREATE TABLE music_rights_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  revision_id TEXT NOT NULL UNIQUE REFERENCES music_track_revisions(id),
  review_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(review_json) AND json_type(review_json) = 'object'),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','blocked')),
  reviewer_id TEXT,
  reviewed_at INTEGER CHECK (reviewed_at >= 0),
  CHECK (review_status = 'pending' OR (reviewer_id IS NOT NULL AND length(reviewer_id) > 0 AND reviewed_at IS NOT NULL))
) STRICT;

CREATE TABLE music_rights_evidence (
  review_id TEXT NOT NULL REFERENCES music_rights_reviews(id),
  asset_id TEXT NOT NULL REFERENCES music_assets(id),
  PRIMARY KEY (review_id, asset_id)
) STRICT;

CREATE TABLE music_collections (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  original_locale TEXT NOT NULL CHECK (original_locale IN ('zh-Hant','zh-Hans','en','ja')),
  title_json TEXT NOT NULL CHECK (json_valid(title_json) AND json_type(title_json) = 'object'),
  description_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(description_json) AND json_type(description_json) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE music_collection_tracks (
  collection_id TEXT NOT NULL REFERENCES music_collections(id),
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (collection_id, track_id),
  UNIQUE (collection_id, position)
) STRICT;

CREATE TABLE music_upload_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  asset_id TEXT NOT NULL UNIQUE REFERENCES music_assets(id),
  actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','uploading','completed','rejected','expired')),
  declared_bytes INTEGER NOT NULL CHECK (declared_bytes > 0 AND declared_bytes <= 33554432),
  actual_bytes INTEGER CHECK (actual_bytes >= 0 AND actual_bytes <= declared_bytes),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  CHECK (status <> 'completed' OR actual_bytes = declared_bytes AND actual_bytes IS NOT NULL)
) STRICT;

CREATE TABLE music_admin_audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  summary_json TEXT NOT NULL CHECK (json_valid(summary_json) AND json_type(summary_json) = 'object'),
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE music_mutations (
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  result_json TEXT NOT NULL CHECK (json_valid(result_json) AND json_type(result_json) = 'object'),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (actor_id, route, idempotency_key)
) STRICT;

CREATE TABLE music_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE music_analytics_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('play_start','qualified_play','play_complete','preview_end','vip_cta_click','membership_center_open','vip_grant_confirmed','vip_grant_reversed')),
  play_session_id TEXT,
  anonymous_session_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('full','preview')),
  occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  listened_ms INTEGER NOT NULL DEFAULT 0 CHECK (listened_ms >= 0),
  entry_source TEXT NOT NULL CHECK (entry_source IN ('catalog','collection','detail','player','membership')),
  FOREIGN KEY (track_id, revision_no) REFERENCES music_track_revisions(track_id, revision_no)
) STRICT;

CREATE TABLE music_analytics_daily (
  day_start_ms INTEGER NOT NULL CHECK (day_start_ms >= 0 AND day_start_ms % 86400000 = 0),
  metric TEXT NOT NULL CHECK (metric IN ('play_start','qualified_play','play_complete','preview_end','vip_cta_click','membership_center_open','vip_grant_confirmed','vip_grant_reversed')),
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  variant TEXT NOT NULL CHECK (variant IN ('full','preview')),
  value INTEGER NOT NULL CHECK (value >= 0),
  PRIMARY KEY (day_start_ms, metric, track_id, variant)
) STRICT;

-- Analytics reference only: deliberately no account_id, VIP status or expiry columns.
CREATE TABLE music_membership_attributions (
  verified_grant_ref TEXT PRIMARY KEY NOT NULL,
  anonymous_session_id TEXT NOT NULL,
  entry_track_id TEXT NOT NULL REFERENCES music_tracks(id),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
  qualification TEXT NOT NULL CHECK (qualification IN ('verified_new','unavailable')),
  reversed_at INTEGER CHECK (reversed_at >= observed_at)
) STRICT;

CREATE INDEX music_tracks_public ON music_tracks(lifecycle, published_at DESC, id);
CREATE INDEX music_assets_owner ON music_assets(owner_track_id, state, kind);
CREATE INDEX music_assets_derived ON music_assets(derived_from_asset_id);
CREATE INDEX music_upload_expiry ON music_upload_sessions(status, expires_at);
CREATE INDEX music_audit_time ON music_admin_audit_logs(created_at, id);
CREATE INDEX music_collection_track ON music_collection_tracks(track_id);
CREATE INDEX music_events_retention ON music_analytics_events(received_at);
CREATE INDEX music_events_session ON music_analytics_events(anonymous_session_id, track_id, variant, event_type, occurred_at);
CREATE INDEX music_mutations_expiry ON music_mutations(expires_at);
CREATE INDEX music_attribution_retention ON music_membership_attributions(observed_at);

CREATE TRIGGER music_revision_immutable BEFORE UPDATE ON music_track_revisions
WHEN OLD.state = 'sealed' BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVISION'); END;
-- INSERT OR REPLACE can bypass delete triggers unless recursive_triggers is enabled.
CREATE TRIGGER music_revision_replace BEFORE INSERT ON music_track_revisions
WHEN EXISTS (SELECT 1 FROM music_track_revisions WHERE state = 'sealed'
  AND (id = NEW.id OR (track_id = NEW.track_id AND revision_no = NEW.revision_no)))
BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVISION'); END;
CREATE TRIGGER music_revision_retained BEFORE DELETE ON music_track_revisions
WHEN OLD.state = 'sealed' BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVISION'); END;
CREATE TRIGGER music_revision_identity BEFORE UPDATE OF id, track_id, revision_no ON music_track_revisions
BEGIN SELECT RAISE(ABORT, 'MUSIC_REVISION_IDENTITY'); END;
CREATE TRIGGER music_asset_identity BEFORE UPDATE OF id, owner_track_id, kind, object_key ON music_assets
BEGIN SELECT RAISE(ABORT, 'MUSIC_ASSET_IDENTITY'); END;
CREATE TRIGGER music_asset_immutable BEFORE UPDATE ON music_assets
WHEN OLD.state = 'validated' BEGIN SELECT RAISE(ABORT, 'MUSIC_VALIDATED_ASSET'); END;
CREATE TRIGGER music_asset_replace BEFORE INSERT ON music_assets
WHEN EXISTS (SELECT 1 FROM music_assets WHERE id = NEW.id OR object_key = NEW.object_key)
BEGIN SELECT RAISE(ABORT, 'MUSIC_ASSET_IDENTITY'); END;
CREATE TRIGGER music_asset_source_insert BEFORE INSERT ON music_assets
WHEN NEW.derived_from_asset_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM music_assets WHERE id = NEW.derived_from_asset_id AND kind = 'audio' AND owner_track_id = NEW.owner_track_id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_PREVIEW_SOURCE'); END;
CREATE TRIGGER music_asset_source_update BEFORE UPDATE OF derived_from_asset_id ON music_assets
WHEN NEW.derived_from_asset_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM music_assets WHERE id = NEW.derived_from_asset_id AND kind = 'audio' AND owner_track_id = NEW.owner_track_id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_PREVIEW_SOURCE'); END;
CREATE TRIGGER music_track_identity BEFORE UPDATE OF id ON music_tracks
BEGIN SELECT RAISE(ABORT, 'MUSIC_TRACK_IDENTITY'); END;
CREATE TRIGGER music_track_replace BEFORE INSERT ON music_tracks
WHEN EXISTS (SELECT 1 FROM music_tracks WHERE id = NEW.id OR slug = NEW.slug)
BEGIN SELECT RAISE(ABORT, 'MUSIC_TRACK_IDENTITY'); END;
CREATE TRIGGER music_track_slug BEFORE UPDATE OF slug, first_published_at ON music_tracks
WHEN OLD.first_published_at IS NOT NULL AND (NEW.slug <> OLD.slug OR NEW.first_published_at IS NOT OLD.first_published_at)
BEGIN SELECT RAISE(ABORT, 'MUSIC_PUBLISHED_IDENTITY'); END;
CREATE TRIGGER music_track_archive BEFORE UPDATE OF lifecycle ON music_tracks
WHEN OLD.lifecycle = 'published' AND NEW.lifecycle = 'archived'
BEGIN SELECT RAISE(ABORT, 'MUSIC_UNPUBLISH_FIRST'); END;

CREATE VIEW music_invalid_revision_assets AS
SELECT r.id FROM music_track_revisions r WHERE EXISTS (
  SELECT 1 FROM music_assets a WHERE
    (a.id = r.audio_asset_id AND a.kind <> 'audio') OR
    (a.id = r.cover_asset_id AND a.kind <> 'cover') OR
    (a.id = r.lyrics_asset_id AND a.kind <> 'lyrics') OR
    (a.id = r.preview_asset_id AND (a.kind <> 'preview' OR a.derived_from_asset_id IS NOT r.audio_asset_id)) OR
    (r.state = 'sealed' AND a.id IN (r.audio_asset_id, r.preview_asset_id, r.cover_asset_id, r.lyrics_asset_id) AND a.state <> 'validated')
);
CREATE TRIGGER music_revision_assets_insert AFTER INSERT ON music_track_revisions
WHEN EXISTS (SELECT 1 FROM music_invalid_revision_assets WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_ASSET_REFERENCE'); END;
CREATE TRIGGER music_revision_assets_update AFTER UPDATE ON music_track_revisions
WHEN EXISTS (SELECT 1 FROM music_invalid_revision_assets WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_ASSET_REFERENCE'); END;
CREATE TRIGGER music_track_pointers_insert AFTER INSERT ON music_tracks
WHEN (NEW.published_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_track_revisions WHERE id = NEW.published_revision_id AND state = 'sealed'))
  OR (NEW.draft_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_track_revisions WHERE id = NEW.draft_revision_id AND state = 'draft'))
BEGIN SELECT RAISE(ABORT, 'MUSIC_REVISION_POINTER'); END;
CREATE TRIGGER music_track_pointers_update AFTER UPDATE ON music_tracks
WHEN (NEW.published_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_track_revisions WHERE id = NEW.published_revision_id AND state = 'sealed'))
  OR (NEW.draft_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM music_track_revisions WHERE id = NEW.draft_revision_id AND state = 'draft'))
BEGIN SELECT RAISE(ABORT, 'MUSIC_REVISION_POINTER'); END;

CREATE TRIGGER music_evidence_insert BEFORE INSERT ON music_rights_evidence
WHEN NOT EXISTS (SELECT 1 FROM music_rights_reviews rr JOIN music_track_revisions r ON r.id = rr.revision_id
  JOIN music_assets a ON a.id = NEW.asset_id WHERE rr.id = NEW.review_id AND r.state = 'draft'
  AND a.owner_track_id = r.track_id AND a.kind = 'evidence' AND a.state = 'validated')
BEGIN SELECT RAISE(ABORT, 'MUSIC_EVIDENCE_REFERENCE'); END;
CREATE TRIGGER music_evidence_update BEFORE UPDATE ON music_rights_evidence
BEGIN SELECT RAISE(ABORT, 'MUSIC_EVIDENCE_REPLACE'); END;
CREATE TRIGGER music_evidence_delete BEFORE DELETE ON music_rights_evidence
WHEN EXISTS (SELECT 1 FROM music_rights_reviews rr JOIN music_track_revisions r ON r.id = rr.revision_id
  WHERE rr.id = OLD.review_id AND r.state = 'sealed')
BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVIEW'); END;
CREATE TRIGGER music_rights_insert BEFORE INSERT ON music_rights_reviews
WHEN EXISTS (SELECT 1 FROM music_track_revisions WHERE id = NEW.revision_id AND state = 'sealed') OR
  EXISTS (SELECT 1 FROM music_rights_reviews rr JOIN music_track_revisions r ON r.id = rr.revision_id
    WHERE rr.id = NEW.id AND r.state = 'sealed')
BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVIEW'); END;
CREATE TRIGGER music_rights_update BEFORE UPDATE ON music_rights_reviews
WHEN NEW.revision_id <> OLD.revision_id OR EXISTS (SELECT 1 FROM music_track_revisions WHERE id = OLD.revision_id AND state = 'sealed')
BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVIEW'); END;
CREATE TRIGGER music_rights_delete BEFORE DELETE ON music_rights_reviews
WHEN EXISTS (SELECT 1 FROM music_track_revisions WHERE id = OLD.revision_id AND state = 'sealed')
BEGIN SELECT RAISE(ABORT, 'MUSIC_SEALED_REVIEW'); END;
CREATE TRIGGER music_upload_terminal BEFORE UPDATE ON music_upload_sessions
WHEN OLD.status IN ('completed','rejected','expired')
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_TERMINAL'); END;
CREATE TRIGGER music_upload_replace BEFORE INSERT ON music_upload_sessions
WHEN EXISTS (SELECT 1 FROM music_upload_sessions WHERE status IN ('completed','rejected','expired')
  AND (id = NEW.id OR asset_id = NEW.asset_id))
BEGIN SELECT RAISE(ABORT, 'MUSIC_UPLOAD_TERMINAL'); END;
CREATE TRIGGER music_audit_update BEFORE UPDATE ON music_admin_audit_logs
BEGIN SELECT RAISE(ABORT, 'MUSIC_APPEND_ONLY_AUDIT'); END;
CREATE TRIGGER music_audit_delete BEFORE DELETE ON music_admin_audit_logs
BEGIN SELECT RAISE(ABORT, 'MUSIC_APPEND_ONLY_AUDIT'); END;
CREATE TRIGGER music_audit_replace BEFORE INSERT ON music_admin_audit_logs
WHEN EXISTS (SELECT 1 FROM music_admin_audit_logs WHERE id = NEW.id OR request_id = NEW.request_id)
BEGIN SELECT RAISE(ABORT, 'MUSIC_APPEND_ONLY_AUDIT'); END;
