-- MUSIC_DB only. Applying this migration does not enable cleanup or delete any object.
-- Retirements and proofs are permanent; neither upload receipts nor assets are deleted.
CREATE TABLE music_upload_cleanup (
  upload_id TEXT PRIMARY KEY NOT NULL REFERENCES music_upload_sessions(id),
  asset_id TEXT NOT NULL UNIQUE REFERENCES music_assets(id),
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  plan_hash TEXT NOT NULL CHECK (length(plan_hash)=64),
  claimed_at INTEGER NOT NULL CHECK (claimed_at>=0),
  proof_json TEXT CHECK (proof_json IS NULL OR
    (json_valid(proof_json) AND json_type(proof_json)='object' AND
      COALESCE(json_extract(proof_json,'$.kind') IN ('never_started','object_observed'),0))),
  proved_at INTEGER CHECK (proved_at>=claimed_at),
  released_at INTEGER CHECK (released_at>=proved_at),
  CHECK ((proof_json IS NULL)=(proved_at IS NULL)),
  CHECK (released_at IS NULL OR proved_at IS NOT NULL)
) STRICT;

-- All revisions, including old drafts and sealed/unpublished history, retain their bytes.
-- Upload/cleanup lifecycle receipts retain metadata, not a continuing right to read the file.
CREATE VIEW music_asset_references AS
SELECT a.id,
  EXISTS (SELECT 1 FROM music_track_revisions r WHERE a.id IN
    (r.audio_asset_id,r.preview_asset_id,r.cover_asset_id,r.lyrics_asset_id)) AS revision_ref,
  EXISTS (SELECT 1 FROM music_rights_evidence e WHERE e.asset_id=a.id) AS evidence_ref,
  EXISTS (SELECT 1 FROM music_rights_reviews r,json_tree(r.review_json) j WHERE j.atom=a.id) AS rights_ref,
  EXISTS (SELECT 1 FROM music_assets d WHERE d.derived_from_asset_id=a.id
    AND NOT EXISTS (SELECT 1 FROM music_upload_cleanup c WHERE c.asset_id=d.id)) AS derived_ref,
  EXISTS (SELECT 1 FROM music_admin_audit_logs l WHERE l.action NOT IN
    ('music.upload.reserve','music.upload.start','music.upload.reject','music.upload.complete',
     'music.cleanup.claim','music.cleanup.prove','music.cleanup.release')
    AND (l.target_id=a.id OR EXISTS (SELECT 1 FROM json_tree(l.summary_json) j WHERE j.atom=a.id))) AS audit_ref
FROM music_assets a;

CREATE TRIGGER music_cleanup_claim BEFORE INSERT ON music_upload_cleanup
WHEN NEW.proof_json IS NOT NULL OR NEW.released_at IS NOT NULL OR NOT EXISTS
  (SELECT 1 FROM music_upload_sessions u JOIN music_asset_references r ON r.id=u.asset_id
   WHERE u.id=NEW.upload_id AND u.asset_id=NEW.asset_id AND u.expires_at<=NEW.claimed_at-604800000
   AND r.revision_ref=0 AND r.evidence_ref=0 AND r.rights_ref=0 AND r.derived_ref=0 AND r.audit_ref=0)
  OR EXISTS (SELECT 1 FROM music_upload_cleanup WHERE upload_id=NEW.upload_id OR asset_id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_CLEANUP_CONFLICT'); END;
CREATE TRIGGER music_cleanup_update BEFORE UPDATE ON music_upload_cleanup
WHEN NEW.upload_id<>OLD.upload_id OR NEW.asset_id<>OLD.asset_id OR NEW.actor_id<>OLD.actor_id
  OR NEW.reason<>OLD.reason OR NEW.plan_hash<>OLD.plan_hash OR NEW.claimed_at<>OLD.claimed_at
  OR (OLD.proof_json IS NOT NULL AND (NEW.proof_json IS NOT OLD.proof_json OR NEW.proved_at IS NOT OLD.proved_at))
  OR (OLD.proof_json IS NULL AND NEW.released_at IS NOT NULL)
  OR OLD.released_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'MUSIC_CLEANUP_IMMUTABLE'); END;
CREATE TRIGGER music_cleanup_delete BEFORE DELETE ON music_upload_cleanup
BEGIN SELECT RAISE(ABORT,'MUSIC_CLEANUP_IMMUTABLE'); END;

-- Retirement and references serialize through the same D1 transaction. Checks before a
-- network call alone would leave a publication/cleanup race.
CREATE TRIGGER music_cleanup_revision_insert BEFORE INSERT ON music_track_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id IN
  (NEW.audio_asset_id,NEW.preview_asset_id,NEW.cover_asset_id,NEW.lyrics_asset_id))
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_revision_update BEFORE UPDATE ON music_track_revisions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id IN
  (NEW.audio_asset_id,NEW.preview_asset_id,NEW.cover_asset_id,NEW.lyrics_asset_id))
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_evidence BEFORE INSERT ON music_rights_evidence
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_rights_insert BEFORE INSERT ON music_rights_reviews
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup c,json_tree(NEW.review_json) j WHERE j.atom=c.asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_rights_update BEFORE UPDATE ON music_rights_reviews
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup c,json_tree(NEW.review_json) j WHERE j.atom=c.asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_source_insert BEFORE INSERT ON music_assets
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=NEW.derived_from_asset_id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_asset_update BEFORE UPDATE ON music_assets
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id IN (NEW.id,NEW.derived_from_asset_id))
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_asset_delete BEFORE DELETE ON music_assets
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE asset_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_upload_update BEFORE UPDATE ON music_upload_sessions
WHEN EXISTS (SELECT 1 FROM music_upload_cleanup WHERE upload_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;
CREATE TRIGGER music_cleanup_audit BEFORE INSERT ON music_admin_audit_logs
WHEN NEW.action NOT IN ('music.upload.reserve','music.upload.start','music.upload.reject','music.upload.complete',
  'music.cleanup.claim','music.cleanup.prove','music.cleanup.release') AND EXISTS
  (SELECT 1 FROM music_upload_cleanup c WHERE NEW.target_id=c.asset_id
    OR EXISTS (SELECT 1 FROM json_tree(NEW.summary_json) j WHERE j.atom=c.asset_id))
BEGIN SELECT RAISE(ABORT,'MUSIC_ASSET_RETIRED'); END;

CREATE VIEW music_storage_charges AS
SELECT u.asset_id,u.declared_bytes AS charged_bytes FROM music_upload_sessions u
WHERE NOT EXISTS (SELECT 1 FROM music_upload_cleanup c WHERE c.upload_id=u.id AND c.released_at IS NOT NULL)
UNION ALL
SELECT a.id,a.byte_size FROM music_assets a
WHERE NOT EXISTS (SELECT 1 FROM music_upload_sessions u WHERE u.asset_id=a.id);
