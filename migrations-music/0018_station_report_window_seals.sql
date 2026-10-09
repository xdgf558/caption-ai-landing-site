-- T19 repair: apply once through the ledger. No remote execution or activation.
-- Pre-seal aggregates are not trustworthy. Invalidate them rather than preserve
-- a possible undercount; recent raw receipts can rebuild them, expired ones
-- remain unavailable. External platform figures and their receipts are untouched.
INSERT INTO station_report_retention_guard(singleton,cutoff) VALUES(1,9223372036854775807);
DELETE FROM station_report_operations WHERE json_extract(result_json,'$.kind')='aggregate_snapshot';
DELETE FROM station_report_snapshots;
DELETE FROM station_report_jobs;
DELETE FROM station_report_retention_guard WHERE singleton=1;
UPDATE station_report_health SET coverage_start=NULL,next_day=NULL,last_aggregate_at=0 WHERE singleton=1;

CREATE TABLE station_report_window_seal (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  sealed_before INTEGER NOT NULL CHECK(sealed_before>=0 AND sealed_before%86400000=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=sealed_before)
) STRICT;
INSERT INTO station_report_window_seal VALUES(1,0,0);
CREATE TRIGGER station_report_seal_monotonic BEFORE UPDATE ON station_report_window_seal
WHEN NEW.singleton<>OLD.singleton OR NEW.sealed_before<OLD.sealed_before OR NEW.updated_at<OLD.updated_at
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_SEAL_RETAINED'); END;
CREATE TRIGGER station_report_seal_retained BEFORE DELETE ON station_report_window_seal
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_SEAL_RETAINED'); END;

-- Request-local random fencing tokens only: no account/session/event/payload.
-- Pruning expired tokens revokes commit. It never assumes a timed-out write ended.
CREATE TABLE station_event_inflight (
  token TEXT PRIMARY KEY CHECK(length(token)=36),
  received_at INTEGER NOT NULL CHECK(received_at>=0),
  expires_at INTEGER NOT NULL CHECK(expires_at=received_at+60000)
) STRICT;
CREATE INDEX station_event_inflight_window ON station_event_inflight(received_at);
CREATE INDEX station_event_inflight_expiry ON station_event_inflight(expires_at);
CREATE TRIGGER station_event_inflight_budget BEFORE INSERT ON station_event_inflight
WHEN NOT EXISTS(SELECT 1 FROM station_report_window_seal WHERE singleton=1 AND sealed_before<=NEW.received_at)
 OR EXISTS(SELECT 1 FROM station_event_inflight LIMIT 1 OFFSET 4095)
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_WRITE_FENCED'); END;
CREATE TRIGGER station_event_inflight_immutable BEFORE UPDATE ON station_event_inflight
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_WRITE_FENCED'); END;
-- Even a previously deployed collector cannot append into an already sealed
-- window. A rejected write gets no success receipt and must be retried.
CREATE TRIGGER station_event_sealed_window BEFORE INSERT ON station_analytics_events
WHEN NOT EXISTS(SELECT 1 FROM station_report_window_seal WHERE singleton=1 AND sealed_before<=NEW.received_at)
BEGIN SELECT RAISE(ABORT,'STATION_EVENT_WRITE_FENCED'); END;
CREATE TRIGGER station_report_snapshot_sealed BEFORE INSERT ON station_report_snapshots
WHEN NOT EXISTS(SELECT 1 FROM station_report_window_seal WHERE singleton=1 AND sealed_before>=NEW.window_end)
 OR NEW.generated_at<NEW.window_end
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_WINDOW_UNSEALED'); END;
CREATE TRIGGER station_report_job_sealed BEFORE INSERT ON station_report_jobs
WHEN NOT EXISTS(SELECT 1 FROM station_report_window_seal WHERE singleton=1 AND sealed_before>=NEW.window_end)
BEGIN SELECT RAISE(ABORT,'STATION_REPORT_WINDOW_UNSEALED'); END;
