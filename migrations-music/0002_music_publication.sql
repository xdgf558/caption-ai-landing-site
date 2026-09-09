-- MUSIC_DB only. Never apply to WAITLIST_DB. Approval fingerprints are private.
ALTER TABLE music_track_revisions ADD COLUMN technical_fingerprint TEXT
  CHECK (technical_fingerprint IS NULL OR (length(technical_fingerprint) = 64 AND technical_fingerprint NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE music_rights_reviews ADD COLUMN revision_fingerprint TEXT
  CHECK (revision_fingerprint IS NULL OR (length(revision_fingerprint) = 64 AND revision_fingerprint NOT GLOB '*[^0-9a-f]*'));

-- Short-lived within one batch only: NOT NULL converts failed conditions/zero writes into rollback.
CREATE TABLE music_publication_guards (
  operation_token TEXT PRIMARY KEY NOT NULL,
  passed INTEGER NOT NULL CHECK (passed = 1)
) STRICT;

CREATE TRIGGER music_mutation_update BEFORE UPDATE ON music_mutations
BEGIN SELECT RAISE(ABORT, 'MUSIC_IMMUTABLE_MUTATION'); END;
CREATE TRIGGER music_mutation_replace BEFORE INSERT ON music_mutations
WHEN EXISTS (SELECT 1 FROM music_mutations WHERE actor_id = NEW.actor_id
  AND route = NEW.route AND idempotency_key = NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT, 'MUSIC_IMMUTABLE_MUTATION'); END;
CREATE TRIGGER music_mutation_delete BEFORE DELETE ON music_mutations
BEGIN SELECT RAISE(ABORT, 'MUSIC_IMMUTABLE_MUTATION'); END;

INSERT INTO music_settings(key, value_json, updated_at) VALUES ('catalogVersion', '0', 0);
INSERT INTO music_settings(key, value_json, updated_at) VALUES ('previewLimitMs', '45000', 0);
