import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';

class D1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.database, this.sql, params);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.params) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) }, success: true };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map((statement) => {
        const result = this.database.prepare(statement.sql).run(...statement.params);
        return { meta: { changes: Number(result.changes || 0) }, success: true };
      });
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [readerMigration, creditMigration, contentMigration, storageMigration, apiMigration, adminMigration, adminPage] =
  await Promise.all([
    read('../migrations/0003_reader_accounts.sql'),
    read('../migrations/0006_reader_credits.sql'),
    read('../migrations/0007_backend_content_platform.sql'),
    read('../migrations/0033_cat_life_game_commerce.sql'),
    read('../migrations/0034_cat_life_game_commerce_api.sql'),
    read('../migrations/0035_cat_life_game_commerce_admin.sql'),
    read('../src/pages/admin-v2/index.astro')
  ]);

const createDatabase = ({ withAdmin = true } = {}) => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readerMigration);
  sqlite.exec(creditMigration);
  sqlite.exec(contentMigration);
  sqlite.exec(storageMigration);
  sqlite.exec(apiMigration);
  if (withAdmin) sqlite.exec(adminMigration);
  return { sqlite, db: new D1Database(sqlite) };
};

const origin = 'http://localhost';
const makeRequest = (path, { method = 'GET', body, originHeader = origin, contentType = 'application/json' } = {}) => {
  const headers = new Headers();
  if (originHeader !== null) headers.set('origin', originHeader);
  if (contentType !== null) headers.set('content-type', contentType);
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
};

const call = async (request, db) => {
  const response = await worker.fetch(request, { WAITLIST_DB: db }, { waitUntil() {} });
  return { response, body: await response.json() };
};

const legacy = createDatabase({ withAdmin: false });
let result = await call(makeRequest('/admin/api/games/cat-life/products'), legacy.db);
assert.equal(result.response.status, 503);
assert.equal(result.body.code, 'GAME_COMMERCE_ADMIN_NOT_READY');

const { sqlite, db } = createDatabase();
sqlite
  .prepare(
    `INSERT INTO reader_accounts (email, normalized_email, display_name)
     VALUES ('buyer@example.com', 'buyer@example.com', 'Buyer'),
            ('support@example.com', 'support@example.com', 'Support')`
  )
  .run();
sqlite
  .prepare(
    `INSERT INTO reader_credit_accounts (
      account_id, balance_credits, lifetime_purchased_credits, currency_label
    ) VALUES (1, 50, 50, 'Station Points'), (2, 20, 20, 'Station Points')`
  )
  .run();

result = await call(makeRequest('/admin/api/games/cat-life/products'), db);
assert.equal(result.response.status, 200);
assert.equal(result.body.products.length, 2);
assert.equal(result.body.products.every((product) => product.lifecycleStatus === 'planned'), true);

result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    originHeader: null,
    body: {
      productId: 'cat-life.skin.moonlit-tabby',
      pointsPrice: 12,
      lifecycleStatus: 'planned',
      names: result.body.products[0].names
    }
  }),
  db
);
assert.equal(result.response.status, 403);
assert.equal(result.body.code, 'INVALID_ORIGIN');

const moonlit = (await call(makeRequest('/admin/api/games/cat-life/products'), db)).body.products
  .find((product) => product.productId === 'cat-life.skin.moonlit-tabby');
result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    body: {
      productId: moonlit.productId,
      pointsPrice: 12,
      lifecycleStatus: 'planned',
      names: { ...moonlit.names, en: 'Moonlit Tabby Deluxe' },
      entitlementKey: 'client.cannot.change.this'
    }
  }),
  db
);
assert.equal(result.response.status, 200);
assert.equal(result.body.product.pointsPrice, 12);
assert.equal(result.body.product.catalogRevision, 2);
assert.equal(result.body.product.entitlementKey, 'cat-life.cosmetic.skin.moonlit-tabby.v1');

result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    body: {
      productId: moonlit.productId,
      pointsPrice: 12,
      lifecycleStatus: 'active',
      names: result.body.product.names
    }
  }),
  db
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'ACTIVATION_CONFIRMATION_REQUIRED');

const moonlitNames = (await call(makeRequest('/admin/api/games/cat-life/products'), db)).body.products
  .find((product) => product.productId === moonlit.productId).names;
result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    body: {
      productId: moonlit.productId,
      pointsPrice: 12,
      lifecycleStatus: 'active',
      activationConfirmation: moonlit.productId,
      names: moonlitNames
    }
  }),
  db
);
assert.equal(result.response.status, 200);
assert.equal(result.body.product.lifecycleStatus, 'active');
assert.equal(result.body.product.catalogRevision, 3);

const stationRoom = result.body.products.find((product) => product.productId === 'cat-life.bundle.station-room');
result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    body: {
      productId: stationRoom.productId,
      pointsPrice: stationRoom.pointsPrice,
      lifecycleStatus: 'active',
      activationConfirmation: stationRoom.productId,
      names: stationRoom.names
    }
  }),
  db
);
assert.equal(result.response.status, 200);

const purchase = await hooks.redeemCatLifeProduct(
  db,
  {
    accountId: 1,
    productId: moonlit.productId,
    idempotencyKey: 'admin-test-purchase-buyer'
  },
  { purchaseIdFactory: () => 'clp_admin_test_buyer' }
);
assert.equal(purchase.purchase.pointsSpent, 12);
assert.equal(purchase.balance, 38);

result = await call(makeRequest('/admin/api/games/cat-life/purchases?email=buyer@example.com'), db);
assert.equal(result.response.status, 200);
assert.equal(result.body.purchases.length, 1);
assert.equal(result.body.purchases[0].ledgerId > 0, true);

result = await call(
  makeRequest(`/admin/api/games/cat-life/purchases?purchaseId=${purchase.purchase.id}`),
  db
);
assert.equal(result.body.purchase.ledger.length, 1);
assert.equal(result.body.purchase.events[0].eventType, 'purchase.completed');

const supportBalanceBefore = sqlite
  .prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 2')
  .get().balance_credits;
result = await call(
  makeRequest('/admin/api/games/cat-life/entitlements/grant', {
    method: 'POST',
    body: {
      email: 'support@example.com',
      productId: stationRoom.productId,
      reason: 'Manual support grant for a verified customer case.',
      pointsPrice: 0,
      gameGold: 999999
    }
  }),
  db
);
assert.equal(result.response.status, 200);
assert.equal(result.body.entitlement.grantSource, 'admin');
assert.equal(result.body.entitlement.purchaseId, '');
assert.equal(
  sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 2').get().balance_credits,
  supportBalanceBefore,
  'manual grants must not change Station Points'
);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_purchases WHERE account_id = 2').get().count, 0);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS count FROM game_entitlement_events WHERE event_type = 'entitlement.granted'").get().count,
  1
);
const manualEntitlementId = result.body.entitlement.id;

result = await call(
  makeRequest('/admin/api/games/cat-life/entitlements/revoke', {
    method: 'POST',
    body: {
      entitlementId: manualEntitlementId,
      reason: 'Support case was closed without retaining the manual grant.'
    }
  }),
  db
);
assert.equal(result.response.status, 200);
assert.equal(result.body.entitlement.active, false);
assert.equal(
  sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 2').get().balance_credits,
  supportBalanceBefore,
  'plain revocation must not restore points'
);

result = await call(
  makeRequest('/admin/api/games/cat-life/purchases/reverse', {
    method: 'POST',
    body: {
      purchaseId: purchase.purchase.id,
      reason: 'Corrective reversal for an accidental redemption.'
    }
  }),
  db
);
assert.equal(result.response.status, 200);
assert.equal(result.body.purchase.status, 'reversed');
assert.equal(result.body.result.balance, 50);
assert.equal(result.body.purchase.ledger.length, 2);

result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    body: {
      productId: stationRoom.productId,
      pointsPrice: stationRoom.pointsPrice,
      lifecycleStatus: 'retired',
      names: stationRoom.names
    }
  }),
  db
);
assert.equal(result.response.status, 200);
result = await call(
  makeRequest('/admin/api/games/cat-life/products', {
    method: 'POST',
    body: {
      productId: stationRoom.productId,
      pointsPrice: stationRoom.pointsPrice,
      lifecycleStatus: 'active',
      activationConfirmation: stationRoom.productId,
      names: stationRoom.names
    }
  }),
  db
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'INVALID_PRODUCT_TRANSITION');

assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action LIKE 'cat_life_%'").get().count >= 6,
  true
);
assert.match(adminPage, /data-admin-v2-tab="game-commerce"/);
assert.match(adminPage, /id="game-product-form"/);
assert.match(adminPage, /id="game-purchase-reverse-form"/);
assert.match(adminPage, /id="game-entitlement-grant-form"/);
assert.match(adminPage, /只撤销权益，不返还 Station 积分/);

console.log('Cat Life Game commerce Admin tests passed.');
