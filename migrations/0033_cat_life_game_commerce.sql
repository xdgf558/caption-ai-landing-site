CREATE TABLE IF NOT EXISTS game_products (
  product_id TEXT PRIMARY KEY NOT NULL,
  game_key TEXT NOT NULL,
  product_type TEXT NOT NULL,
  points_price INTEGER NOT NULL CHECK (points_price > 0),
  lifecycle_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (lifecycle_status IN ('planned', 'active', 'paused', 'retired')),
  entitlement_key TEXT NOT NULL UNIQUE,
  catalog_revision INTEGER NOT NULL DEFAULT 1 CHECK (catalog_revision > 0),
  names_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(names_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_game_products_catalog
  ON game_products (game_key, lifecycle_status, product_type, product_id);

CREATE TABLE IF NOT EXISTS game_purchases (
  id TEXT PRIMARY KEY NOT NULL,
  account_id INTEGER NOT NULL,
  game_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  points_spent INTEGER NOT NULL CHECK (points_spent > 0),
  balance_before INTEGER NOT NULL,
  balance_after INTEGER,
  catalog_revision INTEGER NOT NULL CHECK (catalog_revision > 0),
  product_snapshot_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(product_snapshot_json)),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'reversing', 'reversed')),
  ledger_id INTEGER,
  ledger_source TEXT NOT NULL DEFAULT 'cat-life-game',
  ledger_source_ref TEXT NOT NULL,
  reversal_id TEXT NOT NULL DEFAULT '',
  reversal_reason TEXT NOT NULL DEFAULT '',
  reversal_ledger_id INTEGER,
  completed_at TEXT,
  reversed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES game_products(product_id) ON DELETE RESTRICT,
  FOREIGN KEY (ledger_id) REFERENCES reader_credit_ledger(id) ON DELETE RESTRICT,
  FOREIGN KEY (reversal_ledger_id) REFERENCES reader_credit_ledger(id) ON DELETE RESTRICT,
  UNIQUE (account_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_purchases_completed_product
  ON game_purchases (account_id, product_id)
  WHERE status IN ('completed', 'reversing');

CREATE INDEX IF NOT EXISTS idx_game_purchases_account_created
  ON game_purchases (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  game_key TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  purchase_id TEXT NOT NULL,
  grant_source TEXT NOT NULL DEFAULT 'station-points',
  source_ref TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  revoked_at TEXT,
  revoke_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (product_id) REFERENCES game_products(product_id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_id) REFERENCES game_purchases(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_entitlements_active_grant
  ON game_entitlements (account_id, game_key, entitlement_key)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_entitlements_account
  ON game_entitlements (account_id, game_key, granted_at DESC);

CREATE TABLE IF NOT EXISTS game_commerce_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  purchase_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT NOT NULL,
  product_id TEXT NOT NULL,
  entitlement_key TEXT NOT NULL,
  points_delta INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES reader_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (purchase_id) REFERENCES game_purchases(id) ON DELETE RESTRICT,
  UNIQUE (event_key),
  UNIQUE (purchase_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_game_commerce_events_account
  ON game_commerce_events (account_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reader_credit_ledger_cat_life_game_unique
  ON reader_credit_ledger (account_id, entry_type, source, source_ref)
  WHERE source = 'cat-life-game';

INSERT OR IGNORE INTO game_products (
  product_id,
  game_key,
  product_type,
  points_price,
  lifecycle_status,
  entitlement_key,
  catalog_revision,
  names_json,
  metadata_json
) VALUES
  (
    'cat-life.skin.moonlit-tabby',
    'cat-life',
    'cat_skin',
    10,
    'planned',
    'cat-life.cosmetic.skin.moonlit-tabby.v1',
    1,
    '{"en":"Moonlit Tabby","ja":"月夜のキジトラ","zh-Hans":"月夜虎斑皮肤","zh-Hant":"月夜虎斑皮膚"}',
    '{"ownershipScope":"account","entitlementMode":"perpetual","transferable":false}'
  ),
  (
    'cat-life.bundle.station-room',
    'cat-life',
    'furniture_bundle',
    25,
    'planned',
    'cat-life.content.furniture.station-room.v1',
    1,
    '{"en":"Station Room Set","ja":"ステーション・ルームセット","zh-Hans":"车站小屋家具套装","zh-Hant":"車站小屋家具組"}',
    '{"ownershipScope":"account","entitlementMode":"perpetual","transferable":false}'
  );
