-- CANDIDATE ONLY: never discovered by production's migrations/ directory.
-- Empty schema, used independently in reader and catalog databases. Provisioning
-- and populating a real marker require reviewed resource inventory and release approval.
CREATE TABLE station_native_binding_identity (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 profile_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 resource_kind TEXT NOT NULL CHECK(resource_kind IN ('reader','catalog')),
 resource_id TEXT NOT NULL,
 binding_nonce TEXT NOT NULL
);
