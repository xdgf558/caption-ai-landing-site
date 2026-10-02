-- Independent SYNTHETIC control database only. Never restore with reader snapshots.
CREATE TABLE r1_control_provenance (
 id INTEGER PRIMARY KEY CHECK(id=1), dataset TEXT NOT NULL CHECK(dataset='synthetic-control-r1'),
 schema_version INTEGER NOT NULL CHECK(schema_version=1), ledger_id TEXT NOT NULL UNIQUE, namespace TEXT NOT NULL
);
CREATE TABLE r1_control_head (
 id INTEGER PRIMARY KEY CHECK(id=1), watermark INTEGER NOT NULL CHECK(watermark>=0), digest TEXT NOT NULL
);
CREATE TABLE r1_control_tombstones (
 seq INTEGER PRIMARY KEY CHECK(seq>0), namespace TEXT NOT NULL, account_id INTEGER NOT NULL CHECK(account_id>0),
 scope_version TEXT NOT NULL, job_id TEXT NOT NULL, confirmed_at INTEGER NOT NULL CHECK(confirmed_at>0),
 previous_digest TEXT NOT NULL, digest TEXT NOT NULL,
 UNIQUE(namespace,account_id,scope_version), UNIQUE(namespace,job_id)
);
CREATE TABLE r1_control_restores (
 restore_id TEXT PRIMARY KEY, reader_ref TEXT NOT NULL, namespace TEXT NOT NULL, snapshot_digest TEXT NOT NULL,
 watermark INTEGER NOT NULL, digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('blocked','replaying','ready'))
);
CREATE TRIGGER r1_control_provenance_update BEFORE UPDATE ON r1_control_provenance BEGIN SELECT RAISE(ABORT,'CONTROL_IMMUTABLE'); END;
CREATE TRIGGER r1_control_provenance_delete BEFORE DELETE ON r1_control_provenance BEGIN SELECT RAISE(ABORT,'CONTROL_IMMUTABLE'); END;
CREATE TRIGGER r1_control_tombstones_update BEFORE UPDATE ON r1_control_tombstones BEGIN SELECT RAISE(ABORT,'CONTROL_IMMUTABLE'); END;
CREATE TRIGGER r1_control_tombstones_delete BEFORE DELETE ON r1_control_tombstones BEGIN SELECT RAISE(ABORT,'CONTROL_IMMUTABLE'); END;
CREATE TRIGGER r1_control_tombstones_insert BEFORE INSERT ON r1_control_tombstones
 WHEN NEW.seq!=(SELECT watermark+1 FROM r1_control_head WHERE id=1)
 OR NEW.previous_digest!=(SELECT digest FROM r1_control_head WHERE id=1)
 OR NEW.namespace!=(SELECT namespace FROM r1_control_provenance WHERE id=1)
 BEGIN SELECT RAISE(ABORT,'CONTROL_SEQUENCE_CONFLICT'); END;
CREATE TRIGGER r1_control_head_update BEFORE UPDATE ON r1_control_head
 WHEN NEW.id!=OLD.id OR NEW.watermark!=OLD.watermark+1 OR NOT EXISTS(
 SELECT 1 FROM r1_control_tombstones WHERE seq=NEW.watermark AND digest=NEW.digest AND previous_digest=OLD.digest)
 BEGIN SELECT RAISE(ABORT,'CONTROL_SEQUENCE_CONFLICT'); END;
CREATE TRIGGER r1_control_head_delete BEFORE DELETE ON r1_control_head BEGIN SELECT RAISE(ABORT,'CONTROL_IMMUTABLE'); END;
CREATE TRIGGER r1_control_invalidate_restores AFTER UPDATE ON r1_control_head
 BEGIN UPDATE r1_control_restores SET state='blocked' WHERE watermark<NEW.watermark; END;
