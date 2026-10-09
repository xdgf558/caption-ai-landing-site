-- MUSIC_DB only. One-time, additive migration; no request-time replay or seeds.
ALTER TABLE station_asset_rights ADD COLUMN edit_version INTEGER NOT NULL DEFAULT 1 CHECK(edit_version>0);

CREATE TABLE station_publish_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  object_type TEXT NOT NULL CHECK(object_type IN ('tracks','promotions','clips','games','home')),
  object_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  edit_version INTEGER NOT NULL CHECK(edit_version>0),
  actor_id TEXT NOT NULL CHECK(length(actor_id) BETWEEN 1 AND 200),
  due_at INTEGER NOT NULL CHECK(due_at>=0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','cancelled')),
  error_code TEXT,
  created_at INTEGER NOT NULL CHECK(created_at>=0),
  finished_at INTEGER CHECK(finished_at>=created_at),
  CHECK((status='pending' AND finished_at IS NULL AND error_code IS NULL) OR
    (status<>'pending' AND finished_at IS NOT NULL)),
  CHECK(status<>'failed' OR error_code IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX station_one_pending_publish ON station_publish_jobs(object_type,object_id) WHERE status='pending';
CREATE INDEX station_publish_due ON station_publish_jobs(status,due_at,id);
CREATE TRIGGER station_publish_job_identity BEFORE UPDATE OF id,object_type,object_id,revision,edit_version,actor_id,due_at,created_at ON station_publish_jobs
BEGIN SELECT RAISE(ABORT,'STATION_JOB_IDENTITY'); END;
CREATE TRIGGER station_publish_job_terminal BEFORE UPDATE ON station_publish_jobs WHEN OLD.status<>'pending'
BEGIN SELECT RAISE(ABORT,'STATION_JOB_TERMINAL'); END;
CREATE TRIGGER station_publish_job_retained BEFORE DELETE ON station_publish_jobs
BEGIN SELECT RAISE(ABORT,'STATION_JOB_RETAINED'); END;
CREATE TRIGGER station_publish_job_replace BEFORE INSERT ON station_publish_jobs WHEN EXISTS(SELECT 1 FROM station_publish_jobs WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'STATION_JOB_RETAINED'); END;
