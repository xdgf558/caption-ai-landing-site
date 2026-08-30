import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { __readerTotpTestHooks as hooks } from '../src/worker.js';

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
const [readerMigration, creditMigration, commerceMigration, catalogText] = await Promise.all([
  read('../migrations/0003_reader_accounts.sql'),
  read('../migrations/0006_reader_credits.sql'),
  read('../migrations/0033_cat_life_game_commerce.sql'),
  read('../server/catalog/cat-life-game-commerce.v1.json')
]);

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec(readerMigration);
sqlite.exec(creditMigration);
sqlite.exec(commerceMigration);
const db = new D1Database(sqlite);
const catalog = JSON.parse(catalogText);

const seededProducts = sqlite
  .prepare(
    `SELECT product_id, product_type, points_price, lifecycle_status,
            entitlement_key, catalog_revision, names_json
     FROM game_products ORDER BY product_id`
  )
  .all();
assert.equal(seededProducts.length, catalog.launchProducts.length);
for (const product of catalog.launchProducts) {
  const seeded = seededProducts.find((row) => row.product_id === product.productId);
  assert.ok(seeded, `migration must seed ${product.productId}`);
  assert.equal(seeded.product_type, product.productType);
  assert.equal(seeded.points_price, product.pointsPrice);
  assert.equal(seeded.lifecycle_status, 'planned');
  assert.equal(seeded.entitlement_key, product.entitlementKey);
  assert.equal(seeded.catalog_revision, catalog.catalogRevision);
  assert.deepEqual(JSON.parse(seeded.names_json), product.names);
}

sqlite
  .prepare(
    `UPDATE game_products
     SET points_price = 12, lifecycle_status = 'paused'
     WHERE product_id = 'cat-life.skin.moonlit-tabby'`
  )
  .run();
sqlite.exec(commerceMigration);
const reseededProduct = sqlite
  .prepare(
    `SELECT points_price, lifecycle_status FROM game_products
     WHERE product_id = 'cat-life.skin.moonlit-tabby'`
  )
  .get();
assert.equal(
  reseededProduct.points_price,
  12,
  'rerunning the seed migration must not overwrite a later catalog price'
);
assert.equal(
  reseededProduct.lifecycle_status,
  'paused',
  'rerunning the seed migration must not overwrite a later lifecycle decision'
);
sqlite
  .prepare(
    `UPDATE game_products
     SET points_price = 10, lifecycle_status = 'planned'
     WHERE product_id = 'cat-life.skin.moonlit-tabby'`
  )
  .run();

sqlite.prepare(
  `INSERT INTO reader_accounts (email, normalized_email, display_name)
   VALUES
     ('one@example.com', 'one@example.com', 'One'),
     ('two@example.com', 'two@example.com', 'Two'),
     ('three@example.com', 'three@example.com', 'Three'),
     ('four@example.com', 'four@example.com', 'Four'),
     ('five@example.com', 'five@example.com', 'Five')`
).run();
sqlite.prepare(
  `INSERT INTO reader_credit_accounts (
    account_id, balance_credits, lifetime_purchased_credits, currency_label
  ) VALUES
    (1, 30, 30, 'Station Points'),
    (2, 5, 5, 'Station Points'),
    (3, 30, 30, 'Station Points'),
    (4, 25, 25, 'Station Points'),
    (5, 20, 20, 'Station Points')`
).run();

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};

const moonlit = 'cat-life.skin.moonlit-tabby';
const stationRoom = 'cat-life.bundle.station-room';
const redeem = (payload, purchaseId) =>
  hooks.redeemCatLifeProduct(db, payload, { purchaseIdFactory: () => purchaseId });

await expectCode(
  redeem({
    accountId: 1,
    productId: moonlit,
    idempotencyKey: 'planned-product-one'
  }, 'purchase-planned-one'),
  'PRODUCT_NOT_AVAILABLE'
);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_purchases').get().count, 0);
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 1').get().balance_credits, 30);

sqlite.prepare("UPDATE game_products SET lifecycle_status = 'active', updated_at = CURRENT_TIMESTAMP").run();

let result = await redeem({
  accountId: 1,
  productId: moonlit,
  idempotencyKey: 'redeem-moonlit-one',
  pointsPrice: 0,
  entitlementKey: 'client-forged-entitlement',
  gameGold: 999999
}, 'purchase-moonlit-one');
assert.equal(result.replayed, false);
assert.equal(result.purchase.status, 'completed');
assert.equal(result.purchase.pointsSpent, 10, 'the server catalog must set the charged price');
assert.equal(result.purchase.entitlementKey, 'cat-life.cosmetic.skin.moonlit-tabby.v1');
assert.equal(result.balance, 20);
assert.equal(result.ledger.credits_delta, -10);
assert.equal(result.ledger.source_ref, result.purchase.id);
assert.equal(result.entitlement.active, true);
assert.equal(
  sqlite.prepare('SELECT lifetime_spent_credits FROM reader_credit_accounts WHERE account_id = 1').get()
    .lifetime_spent_credits,
  10
);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS count FROM game_commerce_events WHERE event_type = 'purchase.completed'").get()
    .count,
  1
);

result = await redeem({
  accountId: 1,
  productId: moonlit,
  idempotencyKey: 'redeem-moonlit-one'
}, 'ignored-on-replay');
assert.equal(result.replayed, true);
assert.equal(result.purchase.id, 'purchase-moonlit-one');
assert.equal(result.balance, 20);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_purchases').get().count, 1);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_credit_ledger').get().count, 1);

await expectCode(
  redeem({
    accountId: 1,
    productId: stationRoom,
    idempotencyKey: 'redeem-moonlit-one'
  }, 'purchase-conflicting-key'),
  'IDEMPOTENCY_CONFLICT'
);
await expectCode(
  redeem({
    accountId: 1,
    productId: moonlit,
    idempotencyKey: 'redeem-moonlit-again'
  }, 'purchase-moonlit-again'),
  'ALREADY_OWNED'
);
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 1').get().balance_credits, 20);

await expectCode(
  redeem({
    accountId: 2,
    productId: moonlit,
    idempotencyKey: 'insufficient-points-two'
  }, 'purchase-insufficient-two'),
  'INSUFFICIENT_POINTS'
);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_purchases WHERE account_id = 2').get().count, 0);
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 2').get().balance_credits, 5);

result = await redeem({
  accountId: 3,
  productId: stationRoom,
  idempotencyKey: 'redeem-station-room-three',
  pointsPrice: 1
}, 'purchase-station-room-three');
assert.equal(result.purchase.pointsSpent, 25);
assert.equal(result.balance, 5);
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM game_entitlements WHERE account_id = 1').get().count,
  1,
  'another account purchase must not alter the first account ownership'
);

const concurrent = await Promise.allSettled([
  redeem({
    accountId: 4,
    productId: moonlit,
    idempotencyKey: 'concurrent-moonlit-four'
  }, 'purchase-concurrent-moonlit-four'),
  redeem({
    accountId: 4,
    productId: stationRoom,
    idempotencyKey: 'concurrent-room-four'
  }, 'purchase-concurrent-room-four')
]);
assert.equal(concurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
assert.equal(concurrent.filter((entry) => entry.status === 'rejected').length, 1);
assert.equal(concurrent.find((entry) => entry.status === 'rejected').reason.code, 'INSUFFICIENT_POINTS');
const accountFour = sqlite
  .prepare('SELECT balance_credits, lifetime_spent_credits FROM reader_credit_accounts WHERE account_id = 4')
  .get();
assert.equal(accountFour.balance_credits >= 0, true);
assert.equal(accountFour.balance_credits + accountFour.lifetime_spent_credits, 25);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_purchases WHERE account_id = 4').get().count, 1);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_entitlements WHERE account_id = 4').get().count, 1);

const sameProductConcurrent = await Promise.allSettled([
  redeem({
    accountId: 5,
    productId: moonlit,
    idempotencyKey: 'same-product-first-five'
  }, 'purchase-same-product-first-five'),
  redeem({
    accountId: 5,
    productId: moonlit,
    idempotencyKey: 'same-product-second-five'
  }, 'purchase-same-product-second-five')
]);
assert.equal(sameProductConcurrent.filter((entry) => entry.status === 'fulfilled').length, 1);
assert.equal(sameProductConcurrent.filter((entry) => entry.status === 'rejected').length, 1);
assert.equal(sameProductConcurrent.find((entry) => entry.status === 'rejected').reason.code, 'ALREADY_OWNED');
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 5').get().balance_credits, 10);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_purchases WHERE account_id = 5').get().count, 1);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM game_entitlements WHERE account_id = 5').get().count, 1);

result = await hooks.reverseCatLifePurchase(db, {
  accountId: 3,
  purchaseId: 'purchase-station-room-three',
  correctionId: 'support-correction-three',
  reason: 'Support correction for a mistaken redemption.'
});
assert.equal(result.replayed, false);
assert.equal(result.purchase.status, 'reversed');
assert.equal(result.balance, 30);
assert.equal(result.lifetimeSpentCredits, 0);
assert.equal(result.entitlement.active, false);
assert.equal(result.reversalLedger.credits_delta, 25);
assert.equal(result.reversalLedger.balance_after, 30);
assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS count FROM game_commerce_events WHERE event_type = 'purchase.reversed'").get()
    .count,
  1
);

result = await hooks.reverseCatLifePurchase(db, {
  accountId: 3,
  purchaseId: 'purchase-station-room-three',
  correctionId: 'support-correction-three',
  reason: 'Support correction for a mistaken redemption.'
});
assert.equal(result.replayed, true);
assert.equal(result.balance, 30);
assert.equal(
  sqlite
    .prepare("SELECT COUNT(*) AS count FROM reader_credit_ledger WHERE entry_type = 'game_purchase_reversal'")
    .get().count,
  1
);

result = await redeem({
  accountId: 3,
  productId: stationRoom,
  idempotencyKey: 'redeem-station-room-three'
}, 'ignored-after-reversal');
assert.equal(result.replayed, true);
assert.equal(result.purchase.status, 'reversed');
assert.equal(result.balance, 30);

await expectCode(
  hooks.reverseCatLifePurchase(db, {
    accountId: 2,
    purchaseId: 'purchase-station-room-three',
    correctionId: 'wrong-account-correction',
    reason: 'This account does not own the purchase.'
  }),
  'PURCHASE_NOT_FOUND'
);

assert.equal(
  sqlite.prepare("SELECT COUNT(*) AS count FROM game_purchases WHERE status = 'pending' OR status = 'reversing'").get()
    .count,
  0,
  'failed transactions must not leave intermediate rows'
);
assert.equal(
  sqlite.prepare('PRAGMA foreign_key_check').all().length,
  0,
  'commerce rows must preserve foreign-key integrity'
);

console.log('Cat Life Game commerce storage tests passed.');
