-- T19: aggregate reports and explicitly sourced manual platform figures.
-- Apply once through the migration ledger; no activation or production backfill.
CREATE TABLE station_report_snapshots (
  id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL CHECK(window_end>window_start),
  query_key TEXT NOT NULL CHECK(length(query_key)<=768),
  stats_json TEXT NOT NULL CHECK(json_valid(stats_json) AND json_type(stats_json)='object'),
  generated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>window_end),
  UNIQUE(window_start,window_end,query_key)
) STRICT;
CREATE INDEX station_report_snapshot_expiry ON station_report_snapshots(expires_at);
-- Persist counts only, never visitor/session/event identifiers or arbitrary JSON.
CREATE TRIGGER station_report_snapshot_shape BEFORE INSERT ON station_report_snapshots
WHEN EXISTS(SELECT 1 FROM json_each(NEW.stats_json) WHERE key NOT IN
 ('track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete','game_launch_request','game_ready','save_success','visit_sessions','preview_sessions','click_sessions','unlinked_previews','unlinked_clicks','memory_events','time_anomalies')
 OR type<>'integer' OR value<0 OR value>9007199254740991)
 OR (SELECT COUNT(*) FROM json_each(NEW.stats_json))<>17
 OR (SELECT SUM(value) FROM json_each(NEW.stats_json) WHERE key IN ('track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete','game_launch_request','game_ready','save_success'))>20000
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_INVALID_AGGREGATE'); END;
CREATE TRIGGER station_report_snapshot_immutable BEFORE UPDATE ON station_report_snapshots
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_RETAINED'); END;

CREATE TABLE station_report_jobs (
  window_start INTEGER PRIMARY KEY,
  window_end INTEGER NOT NULL CHECK(window_end=window_start+86400000),
  keys_json TEXT NOT NULL CHECK(json_valid(keys_json) AND json_type(keys_json)='array' AND json_array_length(keys_json) BETWEEN 1 AND 512),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor>=0 AND cursor<=json_array_length(keys_json)),
  edit_version INTEGER NOT NULL DEFAULT 1 CHECK(edit_version>=1),
  status TEXT NOT NULL CHECK(status IN ('pending','complete')),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX station_report_job_expiry ON station_report_jobs(expires_at);
CREATE TABLE station_report_health (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  coverage_start INTEGER,
  next_day INTEGER,
  last_sweep_at INTEGER NOT NULL DEFAULT 0,
  last_aggregate_at INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO station_report_health(singleton) VALUES(1);
CREATE TABLE station_report_retention_guard (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), cutoff INTEGER NOT NULL
) STRICT;

CREATE TABLE station_external_metrics (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES music_tracks(id),
  clip_id TEXT,
  campaign_id TEXT REFERENCES station_campaigns(id),
  metric TEXT NOT NULL CHECK(metric IN ('impressions','platform_plays')),
  provider TEXT NOT NULL CHECK(provider IN ('netease','qishui','apple_music','spotify','youtube','douyin','xiaohongshu','bilibili','instagram')),
  value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 2147483647),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('platform_dashboard','platform_export')),
  source_label TEXT NOT NULL CHECK(length(source_label) BETWEEN 3 AND 160),
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL CHECK(window_end>window_start AND window_end-window_start<=2678400000),
  observed_at INTEGER NOT NULL CHECK(observed_at>=window_end),
  updated_at INTEGER NOT NULL CHECK(updated_at>=observed_at),
  status TEXT NOT NULL CHECK(status IN ('active','withdrawn')),
  edit_version INTEGER NOT NULL CHECK(edit_version>=1),
  expires_at INTEGER NOT NULL CHECK(expires_at>window_end),
  FOREIGN KEY(track_id,clip_id) REFERENCES station_clips(track_id,id),
  CHECK(metric<>'platform_plays' OR provider IN ('netease','qishui','apple_music','spotify','youtube'))
) STRICT;
CREATE INDEX station_external_window ON station_external_metrics(track_id,window_start,window_end);
CREATE INDEX station_external_expiry ON station_external_metrics(expires_at);
CREATE TRIGGER station_external_identity BEFORE UPDATE ON station_external_metrics
WHEN NEW.id<>OLD.id OR NEW.track_id<>OLD.track_id OR NEW.clip_id IS NOT OLD.clip_id
 OR NEW.campaign_id IS NOT OLD.campaign_id OR NEW.metric<>OLD.metric OR NEW.provider<>OLD.provider
 OR NEW.window_start<>OLD.window_start OR NEW.window_end<>OLD.window_end OR NEW.expires_at<>OLD.expires_at
 OR NEW.edit_version<>OLD.edit_version+1
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_EDIT_CONFLICT'); END;

CREATE TABLE station_report_operations (
  actor_id TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,route,idempotency_key)
) STRICT;
CREATE INDEX station_report_operation_expiry ON station_report_operations(expires_at);
CREATE TRIGGER station_report_operation_immutable BEFORE UPDATE ON station_report_operations
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_RETAINED'); END;
CREATE TRIGGER station_report_snapshot_delete BEFORE DELETE ON station_report_snapshots
WHEN NOT EXISTS(SELECT 1 FROM station_report_retention_guard WHERE singleton=1 AND OLD.expires_at<=cutoff)
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_RETAINED'); END;
CREATE TRIGGER station_report_job_delete BEFORE DELETE ON station_report_jobs
WHEN NOT EXISTS(SELECT 1 FROM station_report_retention_guard WHERE singleton=1 AND OLD.expires_at<=cutoff)
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_RETAINED'); END;
CREATE TRIGGER station_external_delete BEFORE DELETE ON station_external_metrics
WHEN NOT EXISTS(SELECT 1 FROM station_report_retention_guard WHERE singleton=1 AND OLD.expires_at<=cutoff)
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_RETAINED'); END;
CREATE TRIGGER station_report_operation_delete BEFORE DELETE ON station_report_operations
WHEN NOT EXISTS(SELECT 1 FROM station_report_retention_guard WHERE singleton=1 AND OLD.expires_at<=cutoff)
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_RETAINED'); END;
