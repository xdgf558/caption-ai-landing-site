DROP INDEX IF EXISTS idx_game_entitlements_active_grant;
DROP INDEX IF EXISTS idx_game_entitlements_account;

CREATE TABLE game_entitlements_admin_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game_key TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  purchase_id TEXT,
  grant_source TEXT NOT NULL DEFAULT 'station-points',
  source_ref TEXT NOT NULL,
  grant_reason TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (purchase_id IS NOT NULL OR grant_source = 'admin'),
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES game_products(product_id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_id) REFERENCES game_purchases(id) ON DELETE RESTRICT
);

INSERT INTO game_entitlements_admin_v2 (
  id,
  account_id,
  game_key,
  entitlement_key,
  product_id,
  purchase_id,
  grant_source,
  source_ref,
  metadata_json,
  granted_at,
  expires_at,
  revoked_at,
  revoke_reason,
  created_at,
  updated_at
)
SELECT
  id,
  account_id,
  game_key,
  entitlement_key,
  product_id,
  purchase_id,
  grant_source,
  source_ref,
  metadata_json,
  granted_at,
  expires_at,
  revoked_at,
  revoke_reason,
  created_at,
  updated_at
FROM game_entitlements;

DROP TABLE game_entitlements;
ALTER TABLE game_entitlements_admin_v2 RENAME TO game_entitlements;

CREATE UNIQUE INDEX idx_game_entitlements_active_grant
  ON game_entitlements (account_id, game_key, entitlement_key)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_game_entitlements_account
  ON game_entitlements (account_id, game_key, granted_at DESC);

CREATE UNIQUE INDEX idx_game_entitlements_source
  ON game_entitlements (account_id, game_key, grant_source, source_ref);

CREATE TABLE IF NOT EXISTS game_entitlement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  entitlement_id INTEGER NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('entitlement.granted', 'entitlement.revoked')),
  event_key TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (entitlement_id) REFERENCES game_entitlements(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES game_products(product_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_game_entitlement_events_account
  ON game_entitlement_events (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_game_entitlement_events_entitlement
  ON game_entitlement_events (entitlement_id, created_at DESC);
