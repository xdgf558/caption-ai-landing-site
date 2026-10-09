-- One-time additive migration. Apply with the normal migration ledger, never in requests.
-- Existing Campaign rows remain unverified; this does not activate or backfill links.
ALTER TABLE station_campaigns ADD COLUMN content_value TEXT NOT NULL DEFAULT '';
ALTER TABLE station_campaigns ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 1 CHECK (edit_version >= 1);

CREATE TABLE station_campaign_legacy_sources (
  source_key TEXT PRIMARY KEY NOT NULL CHECK (length(source_key) BETWEEN 1 AND 64),
  campaign_id TEXT NOT NULL REFERENCES station_campaigns(id),
  created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;
CREATE INDEX station_campaign_legacy_owner ON station_campaign_legacy_sources(campaign_id);
CREATE INDEX station_campaign_track_created ON station_campaigns(track_id,created_at);
CREATE TRIGGER station_campaign_dimensions_immutable
BEFORE UPDATE OF id,source,medium,track_id,clip_id,landing_path,content_value ON station_campaigns
BEGIN SELECT RAISE(ABORT,'STATION_CAMPAIGN_IMMUTABLE'); END;
CREATE TRIGGER station_campaign_legacy_immutable BEFORE UPDATE ON station_campaign_legacy_sources
BEGIN SELECT RAISE(ABORT,'STATION_CAMPAIGN_IMMUTABLE'); END;
CREATE TRIGGER station_campaign_legacy_retained BEFORE DELETE ON station_campaign_legacy_sources
BEGIN SELECT RAISE(ABORT,'STATION_CAMPAIGN_RETAINED'); END;
CREATE TRIGGER station_campaign_legacy_replace BEFORE INSERT ON station_campaign_legacy_sources
WHEN EXISTS(SELECT 1 FROM station_campaign_legacy_sources WHERE source_key=NEW.source_key)
BEGIN SELECT RAISE(ABORT,'STATION_CAMPAIGN_IMMUTABLE'); END;
