-- Read-contract subset for synthetic staging identities only. Never apply to
-- WAITLIST_DB. No emails, passwords, payments, real accounts or login endpoint.
CREATE TABLE reader_accounts (
  id INTEGER PRIMARY KEY CHECK (id > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'restricted'))
);
CREATE TABLE reader_sessions (
  session_hash TEXT PRIMARY KEY CHECK (length(session_hash) = 64),
  account_id INTEGER NOT NULL REFERENCES reader_accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE reader_memberships (
  account_id INTEGER PRIMARY KEY REFERENCES reader_accounts(id),
  membership_level TEXT NOT NULL CHECK (membership_level = 'member'),
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
