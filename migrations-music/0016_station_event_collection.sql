-- One-time compatible migration. No remote application or collection activation.
-- Duplicate retries use INSERT ... SELECT guards, never REPLACE or UPDATE.
DROP TRIGGER station_analytics_events_append_only;
ALTER TABLE station_analytics_events ADD COLUMN context_id TEXT;
ALTER TABLE station_analytics_events ADD COLUMN session_scope TEXT CHECK(session_scope IN ('session_storage','memory'));
ALTER TABLE station_analytics_events ADD COLUMN attribution_kind TEXT CHECK(attribution_kind IN ('campaign','direct_or_unknown','unknown'));
ALTER TABLE station_analytics_events ADD COLUMN campaign_source TEXT;
ALTER TABLE station_analytics_events ADD COLUMN campaign_medium TEXT;
ALTER TABLE station_analytics_events ADD COLUMN first_campaign_id TEXT;
ALTER TABLE station_analytics_events ADD COLUMN device_class TEXT CHECK(device_class IN ('mobile','desktop','unknown'));
ALTER TABLE station_analytics_events ADD COLUMN listened_ms INTEGER NOT NULL DEFAULT 0 CHECK(listened_ms BETWEEN 0 AND 86400000);
ALTER TABLE station_analytics_events ADD COLUMN media_ended INTEGER NOT NULL DEFAULT 0 CHECK(media_ended IN (0,1));
ALTER TABLE station_analytics_events ADD COLUMN time_anomaly INTEGER NOT NULL DEFAULT 0 CHECK(time_anomaly IN (0,1));
ALTER TABLE station_analytics_events ADD COLUMN consent_version TEXT;
ALTER TABLE station_analytics_events ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0;
UPDATE station_analytics_events SET expires_at=received_at+7776000000;
CREATE TRIGGER station_analytics_events_append_only BEFORE UPDATE ON station_analytics_events
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RETAINED'); END;
CREATE INDEX station_events_expiry ON station_analytics_events(expires_at,event_id);
CREATE INDEX station_events_track_visit ON station_analytics_events(session_id,track_id,event_name,received_at);
CREATE UNIQUE INDEX station_events_play_once ON station_analytics_events(event_name,playback_id) WHERE playback_id IS NOT NULL;
CREATE UNIQUE INDEX station_events_click_once ON station_analytics_events(event_name,interaction_id) WHERE interaction_id IS NOT NULL;
CREATE UNIQUE INDEX station_events_launch_once ON station_analytics_events(event_name,launch_id) WHERE event_name IN ('game_launch_request','game_ready');
CREATE UNIQUE INDEX station_events_save_once ON station_analytics_events(event_name,save_operation_id) WHERE save_operation_id IS NOT NULL;

CREATE TABLE station_event_rates (
  scope TEXT NOT NULL CHECK(scope IN ('session','source','global')),
  window_start INTEGER NOT NULL CHECK(window_start>=0),
  subject TEXT NOT NULL CHECK(length(subject) BETWEEN 36 AND 64),
  hits INTEGER NOT NULL CHECK(hits>=1),
  PRIMARY KEY(scope,window_start,subject)
) STRICT;
CREATE TRIGGER station_event_rates_budget BEFORE INSERT ON station_event_rates
WHEN NEW.hits>CASE NEW.scope WHEN 'session' THEN 120 WHEN 'source' THEN 600 ELSE 12000 END
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RATE_LIMITED'); END;
CREATE TRIGGER station_event_rates_update_budget BEFORE UPDATE ON station_event_rates
WHEN NEW.hits>CASE NEW.scope WHEN 'session' THEN 120 WHEN 'source' THEN 600 ELSE 12000 END
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RATE_LIMITED'); END;
CREATE TABLE station_event_retention_health (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), last_sweep_at INTEGER NOT NULL CHECK(last_sweep_at>=0)
) STRICT;
CREATE TABLE station_event_retention_guard (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), cutoff INTEGER NOT NULL CHECK(cutoff>=0)
) STRICT;
DROP TRIGGER station_analytics_events_retained;
CREATE TRIGGER station_analytics_events_retained BEFORE DELETE ON station_analytics_events
WHEN NOT EXISTS(SELECT 1 FROM station_event_retention_guard WHERE singleton=1 AND OLD.expires_at<=cutoff)
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_RETAINED'); END;
