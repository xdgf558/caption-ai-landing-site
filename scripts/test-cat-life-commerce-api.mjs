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
const [readerMigration, passwordMigration, creditMigration, storageMigration, apiMigration] = await Promise.all([
  read('../migrations/0003_reader_accounts.sql'),
  read('../migrations/0011_reader_password_credentials.sql'),
  read('../migrations/0006_reader_credits.sql'),
  read('../migrations/0033_cat_life_game_commerce.sql'),
  read('../migrations/0034_cat_life_game_commerce_api.sql')
]);

const createDatabase = ({ commerce = true } = {}) => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readerMigration);
  sqlite.exec(passwordMigration);
  sqlite.exec(creditMigration);
  if (commerce) {
    sqlite.exec(storageMigration);
    sqlite.exec(apiMigration);
  }
  return { sqlite, db: new D1Database(sqlite) };
};

const { sqlite, db } = createDatabase();
const env = { WAITLIST_DB: db, CAT_LIFE_COMMERCE_ROLLOUT_MODE: 'public' };
const origin = 'https://wwwstationcat.org';
const sessionTokens = ['commerce-session-one', 'commerce-session-two', 'commerce-session-three'];
const sessionHashes = await Promise.all(sessionTokens.map((token) => hooks.sha256Hex(token)));

sqlite.prepare(
  `INSERT INTO reader_accounts (email, normalized_email, display_name)
   VALUES
     ('one@example.com', 'one@example.com', 'Player One'),
     ('two@example.com', 'two@example.com', 'Player Two'),
     ('three@example.com', 'three@example.com', 'Player Three')`
).run();
sqlite.prepare(
  `INSERT INTO reader_sessions (account_id, session_hash, expires_at)
   VALUES
     (1, ?, datetime('now', '+1 day')),
     (2, ?, datetime('now', '+1 day')),
     (3, ?, datetime('now', '+1 day'))`
).run(...sessionHashes);
sqlite.prepare(
  `INSERT INTO reader_credit_accounts (
    account_id, balance_credits, lifetime_purchased_credits, currency_label
  ) VALUES
    (1, 30, 30, 'Station Points'),
    (2, 5, 5, 'Station Points'),
    (3, 100, 100, 'Station Points')`
).run();

const makeRequest = (path, { method = 'GET', token = '', body, rawBody, originHeader = origin, contentType = 'application/json' } = {}) => {
  const headers = new Headers();
  if (token) headers.set('cookie', `station_cat_reader_session=${token}`);
  if (originHeader !== null) headers.set('origin', originHeader);
  if (contentType !== null) headers.set('content-type', contentType);
  const requestBody = rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body);
  return new Request(`${origin}${path}`, { method, headers, body: requestBody });
};

const call = async (request, targetEnv = env) => {
  const response = await worker.fetch(request, targetEnv, { waitUntil() {} });
  return { response, body: await response.json() };
};

let missing = createDatabase({ commerce: false });
let result = await call(makeRequest('/api/games/cat-life/catalog?locale=en'), { WAITLIST_DB: missing.db });
assert.equal(result.response.status, 503);
assert.equal(result.body.code, 'REDEMPTION_NOT_READY');

result = await call(makeRequest('/api/games/cat-life/catalog?locale=zh-Hans'));
assert.equal(result.response.status, 200);
assert.equal(result.body.authenticated, false);
assert.deepEqual(result.body.products, []);
assert.equal(result.response.headers.get('cache-control'), 'no-store');

result = await call(makeRequest('/api/games/cat-life/entitlements'));
assert.equal(result.response.status, 200);
assert.equal(result.body.authenticated, false);
assert.deepEqual(result.body.entitlements, []);

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    body: { productId: 'cat-life.skin.moonlit-tabby', idempotencyKey: 'guest-redemption-one' }
  })
);
assert.equal(result.response.status, 401);
assert.equal(result.body.code, 'SIGN_IN_REQUIRED');

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    originHeader: null,
    body: { productId: 'cat-life.skin.moonlit-tabby', idempotencyKey: 'missing-origin-one' }
  })
);
assert.equal(result.response.status, 403);
assert.equal(result.body.code, 'INVALID_ORIGIN');

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    contentType: 'text/plain',
    rawBody: '{}'
  })
);
assert.equal(result.response.status, 415);
assert.equal(result.body.code, 'INVALID_CONTENT_TYPE');

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    rawBody: '{'
  })
);
assert.equal(result.response.status, 400);
assert.equal(result.body.code, 'INVALID_REDEMPTION');
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM game_commerce_rate_limits WHERE account_id = 1').get().count,
  0,
  'invalid JSON must not consume the redemption rate limit'
);

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    rawBody: JSON.stringify({
      productId: 'cat-life.skin.moonlit-tabby',
      idempotencyKey: 'oversized-request-one',
      padding: 'x'.repeat(5000)
    })
  })
);
assert.equal(result.response.status, 413);
assert.equal(result.body.code, 'REDEMPTION_REQUEST_TOO_LARGE');
assert.equal(
  sqlite.prepare('SELECT COUNT(*) AS count FROM game_commerce_rate_limits WHERE account_id = 1').get().count,
  0,
  'oversized JSON must not consume the redemption rate limit'
);

sqlite
  .prepare("UPDATE game_products SET lifecycle_status = 'active' WHERE product_id = 'cat-life.skin.moonlit-tabby'")
  .run();

const closedEnv = { WAITLIST_DB: db };
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en'), closedEnv);
assert.equal(result.body.rollout.mode, 'off');
assert.equal(result.body.rollout.catalogVisible, false);
assert.deepEqual(result.body.products, [], 'missing rollout configuration must fail closed');
result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[1],
    body: { productId: 'cat-life.skin.moonlit-tabby', idempotencyKey: 'closed-rollout-two' }
  }),
  closedEnv
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'COMMERCE_ROLLOUT_CLOSED');

const allowlistEnv = {
  WAITLIST_DB: db,
  CAT_LIFE_COMMERCE_ROLLOUT_MODE: 'allowlist',
  CAT_LIFE_COMMERCE_ALLOWLIST: 'ONE@example.com'
};
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en'), allowlistEnv);
assert.deepEqual(result.body.products, [], 'allowlist mode must not expose products to guests');
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en', { token: sessionTokens[1] }), allowlistEnv);
assert.deepEqual(result.body.products, [], 'allowlist mode must not expose products to another account');
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en', { token: sessionTokens[0] }), allowlistEnv);
assert.equal(result.body.rollout.redemptionEnabled, true);
assert.equal(result.body.products.length, 1, 'allowlisted accounts must see active products');

result = await call(makeRequest('/api/games/cat-life/catalog?locale=zh-Hans'));
assert.equal(result.body.products.length, 1);
assert.equal(result.body.products[0].productId, 'cat-life.skin.moonlit-tabby');
assert.equal(result.body.products[0].name, '月夜虎斑皮肤');
assert.equal(result.body.products[0].pointsPrice, 10);
assert.equal(result.body.products[0].owned, false);
assert.equal(result.body.products[0].redeemable, true);

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    body: {
      productId: 'cat-life.bundle.station-room',
      idempotencyKey: 'planned-station-room-one'
    }
  })
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'PRODUCT_NOT_AVAILABLE');

const clientChosenPurchaseId = 'client-chosen-purchase-id';
result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    body: {
      productId: 'cat-life.skin.moonlit-tabby',
      idempotencyKey: 'api-moonlit-one',
      purchaseId: clientChosenPurchaseId,
      pointsPrice: 0,
      entitlementKey: 'client.fake.entitlement',
      gameGold: 999999,
      saveData: { lotteryResult: 'jackpot' }
    }
  })
);
assert.equal(result.response.status, 200);
assert.equal(result.body.ok, true);
assert.equal(result.body.purchase.id.startsWith('clp_'), true);
assert.notEqual(result.body.purchase.id, clientChosenPurchaseId);
assert.equal(result.body.purchase.pointsSpent, 10);
assert.equal(result.body.purchase.entitlementKey, 'cat-life.cosmetic.skin.moonlit-tabby.v1');
assert.equal(result.body.balance, 20);
assert.equal(result.body.entitlement.active, true);
const serverPurchaseId = result.body.purchase.id;

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    body: {
      productId: 'cat-life.skin.moonlit-tabby',
      idempotencyKey: 'api-moonlit-one'
    }
  }),
  closedEnv
);
assert.equal(result.response.status, 200, 'a closed rollout must still replay a completed purchase safely');
assert.equal(result.body.replayed, true);
assert.equal(result.body.purchase.id, serverPurchaseId);
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en', { token: sessionTokens[0] }), closedEnv);
assert.equal(result.body.products.length, 1, 'a closed rollout must retain owned active products');
assert.equal(result.body.products[0].owned, true);
assert.equal(result.body.products[0].redeemable, false);

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    body: {
      productId: 'cat-life.skin.moonlit-tabby',
      idempotencyKey: 'api-moonlit-one',
      purchaseId: 'another-client-id'
    }
  })
);
assert.equal(result.response.status, 200);
assert.equal(result.body.replayed, true);
assert.equal(result.body.purchase.id, serverPurchaseId);
assert.equal(result.body.balance, 20);

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    body: { productId: 'cat-life.bundle.station-room', idempotencyKey: 'api-moonlit-one' }
  })
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'IDEMPOTENCY_CONFLICT');

result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[0],
    body: { productId: 'cat-life.skin.moonlit-tabby', idempotencyKey: 'api-moonlit-again-one' }
  })
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'ALREADY_OWNED');

sqlite
  .prepare("UPDATE game_products SET lifecycle_status = 'paused' WHERE product_id = 'cat-life.skin.moonlit-tabby'")
  .run();
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en'));
assert.deepEqual(result.body.products, [], 'guests must not see paused products');
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en', { token: sessionTokens[0] }));
assert.equal(result.body.products.length, 1);
assert.equal(result.body.products[0].lifecycleStatus, 'paused');
assert.equal(result.body.products[0].owned, true);
assert.equal(result.body.products[0].redeemable, false);

result = await call(makeRequest('/api/games/cat-life/entitlements?locale=ja', { token: sessionTokens[0] }));
assert.equal(result.body.authenticated, true);
assert.equal(result.body.balance, 20);
assert.equal(result.body.entitlements.length, 1);
assert.equal(result.body.entitlements[0].productName, '月夜のキジトラ');
assert.equal(result.body.entitlements[0].lifecycleStatus, 'paused');

sqlite
  .prepare("UPDATE game_products SET lifecycle_status = 'retired' WHERE product_id = 'cat-life.skin.moonlit-tabby'")
  .run();
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en', { token: sessionTokens[0] }));
assert.equal(result.body.products.length, 1);
assert.equal(result.body.products[0].lifecycleStatus, 'retired');
assert.equal(result.body.products[0].owned, true);
assert.equal(result.body.products[0].redeemable, false);

sqlite
  .prepare("UPDATE game_products SET lifecycle_status = 'planned' WHERE product_id = 'cat-life.skin.moonlit-tabby'")
  .run();
result = await call(makeRequest('/api/games/cat-life/catalog?locale=en', { token: sessionTokens[0] }));
assert.deepEqual(result.body.products, [], 'planned products must stay out of every catalog response');
result = await call(makeRequest('/api/games/cat-life/entitlements?locale=en', { token: sessionTokens[0] }));
assert.equal(result.body.entitlements.length, 1, 'catalog lifecycle changes must not erase an owned entitlement');
assert.equal(result.body.entitlements[0].lifecycleStatus, 'planned');

sqlite
  .prepare("UPDATE game_products SET lifecycle_status = 'active' WHERE product_id = 'cat-life.bundle.station-room'")
  .run();
result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[1],
    body: { productId: 'cat-life.bundle.station-room', idempotencyKey: 'insufficient-room-two' }
  })
);
assert.equal(result.response.status, 409);
assert.equal(result.body.code, 'INSUFFICIENT_POINTS');
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 2').get().balance_credits, 5);

for (let index = 0; index < 10; index += 1) {
  result = await call(
    makeRequest('/api/games/cat-life/redemptions', {
      method: 'POST',
      token: sessionTokens[2],
      body: {
        productId: 'cat-life.skin.not-found',
        idempotencyKey: `rate-limit-three-${index}`
      }
    })
  );
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'PRODUCT_NOT_AVAILABLE');
}
result = await call(
  makeRequest('/api/games/cat-life/redemptions', {
    method: 'POST',
    token: sessionTokens[2],
    body: { productId: 'cat-life.skin.not-found', idempotencyKey: 'rate-limit-three-final' }
  })
);
assert.equal(result.response.status, 429);
assert.equal(result.body.code, 'REDEMPTION_RATE_LIMITED');
assert.equal(Number(result.response.headers.get('retry-after')) > 0, true);

result = await call(makeRequest('/api/games/cat-life/catalog', { method: 'POST', body: {} }));
assert.equal(result.response.status, 405);
result = await call(makeRequest('/api/games/cat-life/redemptions'));
assert.equal(result.response.status, 405);

assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0);
console.log('Cat Life Game commerce API tests passed.');
