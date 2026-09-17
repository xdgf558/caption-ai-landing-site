-- ISOLATED native WAITLIST_DB only. Not part of production migrations.
-- No raw grant, access token, R2 key or media URL is persisted.
CREATE TABLE mobile_playback_grants (
  hash TEXT PRIMARY KEY CHECK(length(hash)=64),
  auth_mode TEXT NOT NULL CHECK(auth_mode IN ('public','session_bearer')),
  account_id INTEGER REFERENCES reader_accounts(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES mobile_sessions(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  revision_no INTEGER NOT NULL CHECK(revision_no>0),
  variant TEXT NOT NULL CHECK(variant IN ('full','preview')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+600000),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
  CHECK((auth_mode='public' AND account_id IS NULL AND session_id IS NULL)
     OR (auth_mode='session_bearer' AND account_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE INDEX mobile_playback_grants_expiry ON mobile_playback_grants(expires_at);
CREATE INDEX mobile_playback_grants_session ON mobile_playback_grants(session_id);
