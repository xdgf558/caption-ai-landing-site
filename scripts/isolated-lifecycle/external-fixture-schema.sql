-- Separate synthetic service storage; not an actual mail, payment or backup API.
CREATE TABLE r1_external_fixture_meta (id INTEGER PRIMARY KEY CHECK(id=1),dataset TEXT NOT NULL CHECK(dataset='synthetic-r1-external'),adapter_id TEXT NOT NULL,store_id TEXT NOT NULL);
CREATE TABLE r1_external_fixture_resources (resource_ref TEXT PRIMARY KEY,account_id INTEGER NOT NULL,category TEXT NOT NULL);
CREATE TABLE r1_external_fixture_records (id TEXT PRIMARY KEY,resource_ref TEXT NOT NULL REFERENCES r1_external_fixture_resources(resource_ref),payload TEXT NOT NULL);
CREATE TABLE r1_external_fixture_deletions (resource_ref TEXT PRIMARY KEY REFERENCES r1_external_fixture_resources(resource_ref),account_id INTEGER NOT NULL,category TEXT NOT NULL,operation_id TEXT NOT NULL UNIQUE,job_id TEXT NOT NULL,policy_digest TEXT NOT NULL,effect_digest TEXT NOT NULL);
CREATE TABLE r1_external_fixture_account_barriers (account_id INTEGER PRIMARY KEY,job_id TEXT NOT NULL,policy_digest TEXT NOT NULL);
CREATE TABLE r1_external_fixture_assert (value INTEGER NOT NULL CHECK(value=1));
CREATE TRIGGER r1_external_resource_insert BEFORE INSERT ON r1_external_fixture_resources WHEN EXISTS(SELECT 1 FROM r1_external_fixture_account_barriers WHERE account_id=NEW.account_id) BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
CREATE TRIGGER r1_external_records_insert BEFORE INSERT ON r1_external_fixture_records WHEN EXISTS(SELECT 1 FROM r1_external_fixture_deletions WHERE resource_ref=NEW.resource_ref) BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
CREATE TRIGGER r1_external_records_update BEFORE UPDATE ON r1_external_fixture_records WHEN EXISTS(SELECT 1 FROM r1_external_fixture_deletions WHERE resource_ref=OLD.resource_ref OR resource_ref=NEW.resource_ref) BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
CREATE TRIGGER r1_external_resource_update BEFORE UPDATE ON r1_external_fixture_resources BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER r1_external_resource_delete BEFORE DELETE ON r1_external_fixture_resources BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER r1_external_deletion_update BEFORE UPDATE ON r1_external_fixture_deletions BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
CREATE TRIGGER r1_external_deletion_delete BEFORE DELETE ON r1_external_fixture_deletions BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
CREATE TRIGGER r1_external_barrier_update BEFORE UPDATE ON r1_external_fixture_account_barriers BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
CREATE TRIGGER r1_external_barrier_delete BEFORE DELETE ON r1_external_fixture_account_barriers BEGIN SELECT RAISE(ABORT,'R1_EXTERNAL_ERASED'); END;
