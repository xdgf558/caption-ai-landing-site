-- MUSIC_DB only. This migration does not enable collection or retention jobs.
ALTER TABLE music_analytics_events ADD COLUMN consent_version TEXT;
CREATE UNIQUE INDEX music_events_play_once
  ON music_analytics_events(anonymous_session_id,play_session_id,event_type);

-- Preserve legacy totals without guessing their historical access policy.
ALTER TABLE music_analytics_daily RENAME TO music_analytics_daily_legacy;
CREATE TABLE music_analytics_daily (
  day_start_ms INTEGER NOT NULL CHECK(day_start_ms>=0 AND day_start_ms%86400000=0),
  metric TEXT NOT NULL CHECK(metric IN ('play_start','qualified_play','play_complete','preview_end','vip_cta_click','membership_center_open','vip_grant_confirmed','vip_grant_reversed')),
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  variant TEXT NOT NULL CHECK(variant IN ('full','preview')),
  access_kind TEXT NOT NULL CHECK(access_kind IN ('free','vip','unknown')),
  value INTEGER NOT NULL CHECK(value>=0),
  PRIMARY KEY(day_start_ms,metric,track_id,variant,access_kind)
) STRICT;
INSERT INTO music_analytics_daily SELECT day_start_ms,metric,track_id,variant,'unknown',value FROM music_analytics_daily_legacy;
DROP TABLE music_analytics_daily_legacy;

CREATE TABLE music_analytics_rates (
  scope TEXT NOT NULL CHECK(scope IN ('session','source','global')),
  window_start INTEGER NOT NULL CHECK(window_start>=0 AND window_start%60000=0),
  subject TEXT NOT NULL CHECK(length(subject)=64),
  hits INTEGER NOT NULL CHECK(hits>0),
  PRIMARY KEY(scope,window_start,subject)
) STRICT;
CREATE INDEX music_analytics_rates_expiry ON music_analytics_rates(window_start);
-- A transient transaction guard detects even RAISE(IGNORE)/zero-write faults.
CREATE TABLE music_analytics_admission_guard (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  passed INTEGER NOT NULL CHECK(passed=1)
) STRICT;
CREATE TABLE music_analytics_health (
  id INTEGER PRIMARY KEY CHECK(id=1),
  last_sweep_at INTEGER NOT NULL CHECK(last_sweep_at>=0)
) STRICT;

CREATE TRIGGER music_analytics_rate_insert BEFORE INSERT ON music_analytics_rates
WHEN (NEW.scope='session' AND NEW.hits>60) OR (NEW.scope='source' AND NEW.hits>600)
  OR (NEW.scope='global' AND NEW.hits>12000)
BEGIN SELECT RAISE(ABORT,'MUSIC_ANALYTICS_RATE_LIMITED'); END;
CREATE TRIGGER music_analytics_rate_update BEFORE UPDATE ON music_analytics_rates
WHEN (NEW.scope='session' AND NEW.hits>60) OR (NEW.scope='source' AND NEW.hits>600)
  OR (NEW.scope='global' AND NEW.hits>12000)
BEGIN SELECT RAISE(ABORT,'MUSIC_ANALYTICS_RATE_LIMITED'); END;

-- No identity/VIP lookup: these rows validate statistical metadata, never access.
CREATE VIEW music_analytics_public_variants AS
SELECT t.id AS track_id,r.revision_no,'full' AS variant,a.duration_ms,t.published_at
FROM music_tracks t JOIN music_track_revisions r ON r.id=t.published_revision_id AND r.track_id=t.id
JOIN music_assets a ON a.id=r.audio_asset_id AND a.owner_track_id=t.id
WHERE t.lifecycle='published' AND r.state='sealed' AND a.state='validated' AND a.kind='audio' AND a.duration_ms>0
UNION ALL
SELECT t.id,r.revision_no,'preview',a.duration_ms,t.published_at
FROM music_tracks t JOIN music_track_revisions r ON r.id=t.published_revision_id AND r.track_id=t.id
JOIN music_assets a ON a.id=r.preview_asset_id AND a.owner_track_id=t.id
WHERE t.lifecycle='published' AND r.state='sealed' AND a.state='validated' AND a.kind='preview' AND a.duration_ms>0;

CREATE TRIGGER music_analytics_event_validate BEFORE INSERT ON music_analytics_events
BEGIN
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_INVALID_EVENT') WHERE
    NEW.event_type NOT IN ('play_start','qualified_play','play_complete','preview_end','vip_cta_click')
    OR NEW.consent_version IS NOT 'music-analytics-v1' OR NEW.play_session_id IS NULL;
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_INVALID_TRACK') WHERE NOT EXISTS (
    SELECT 1 FROM music_analytics_public_variants p WHERE p.track_id=NEW.track_id
      AND p.revision_no=NEW.revision_no AND p.variant=NEW.variant AND p.published_at<=NEW.received_at
      AND NEW.listened_ms<=p.duration_ms+1000
      AND (NEW.event_type<>'qualified_play' OR NEW.listened_ms>=MIN(30000,p.duration_ms/2.0))
      AND (NEW.event_type<>'play_complete' OR NEW.listened_ms>=p.duration_ms*0.9));
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_INVALID_EVENT') WHERE
    (NEW.event_type='preview_end' AND NEW.variant<>'preview')
    OR (NEW.event_type IN ('play_start','vip_cta_click') AND NEW.listened_ms<>0);
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_SESSION_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM music_analytics_events e WHERE e.anonymous_session_id=NEW.anonymous_session_id
      AND e.play_session_id=NEW.play_session_id
      AND (e.track_id<>NEW.track_id OR e.revision_no<>NEW.revision_no OR e.variant<>NEW.variant));
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_START_REQUIRED') WHERE
    NEW.event_type IN ('qualified_play','play_complete','preview_end') AND NOT EXISTS (
      SELECT 1 FROM music_analytics_events e WHERE e.anonymous_session_id=NEW.anonymous_session_id
        AND e.play_session_id=NEW.play_session_id AND e.event_type='play_start');
  -- Validate first, then suppress. Never depend on SQLite trigger ordering.
  -- The rolling window uses server receive time, not a client minute bucket.
  SELECT RAISE(IGNORE) WHERE NEW.event_type='qualified_play' AND EXISTS (
    SELECT 1 FROM music_analytics_events e WHERE e.anonymous_session_id=NEW.anonymous_session_id
      AND e.track_id=NEW.track_id AND e.variant=NEW.variant AND e.event_type='qualified_play'
      AND e.received_at>NEW.received_at-1800000);
END;

-- Only newly inserted events increment totals. Lost receipts and duplicate milestones
-- cannot count twice; aggregate failure aborts the event and its entire batch.
CREATE TRIGGER music_analytics_event_aggregate AFTER INSERT ON music_analytics_events
BEGIN
  INSERT INTO music_analytics_daily(day_start_ms,metric,track_id,variant,access_kind,value)
  SELECT NEW.received_at-NEW.received_at%86400000,NEW.event_type,NEW.track_id,NEW.variant,
    IIF(r.access_mode='free' OR (r.access_mode='early_access' AND r.early_access_until<=NEW.received_at
      AND r.post_early_access_mode='free'),'free','vip'),1
  FROM music_track_revisions r WHERE r.track_id=NEW.track_id AND r.revision_no=NEW.revision_no
  ON CONFLICT(day_start_ms,metric,track_id,variant,access_kind) DO UPDATE SET value=value+1;
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_AGGREGATE_INVALID') WHERE changes()<>1;
END;
