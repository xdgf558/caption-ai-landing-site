-- Store promotional access over a VIP baseline. Older Workers fail closed to VIP.
-- Existing sealed-revision triggers protect this new column as well.
ALTER TABLE music_track_revisions ADD COLUMN free_until INTEGER
  CHECK (free_until IS NULL OR (free_until>=0 AND access_mode='vip'));

DROP TRIGGER music_analytics_event_aggregate;
CREATE TRIGGER music_analytics_event_aggregate AFTER INSERT ON music_analytics_events
BEGIN
  INSERT INTO music_analytics_daily(day_start_ms,metric,track_id,variant,access_kind,value)
  SELECT NEW.received_at-NEW.received_at%86400000,NEW.event_type,NEW.track_id,NEW.variant,
    IIF(r.access_mode='free' OR (r.free_until IS NOT NULL AND NEW.received_at<r.free_until)
      OR (r.access_mode='early_access' AND r.early_access_until<=NEW.received_at
      AND r.post_early_access_mode='free'),'free','vip'),1
  FROM music_track_revisions r WHERE r.track_id=NEW.track_id AND r.revision_no=NEW.revision_no
  ON CONFLICT(day_start_ms,metric,track_id,variant,access_kind) DO UPDATE SET value=value+1;
  SELECT RAISE(ABORT,'MUSIC_ANALYTICS_AGGREGATE_INVALID') WHERE changes()<>1;
END;
