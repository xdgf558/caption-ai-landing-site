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
    this.database.exec('BEGIN');
    try {
      const results = statements.map((statement) => ({
        success: true,
        results: this.database.prepare(statement.sql).all(...statement.params)
      }));
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [readerMigration, paymentMigration, creditMigration, creemMigration, workerSource, wranglerSource] = await Promise.all([
  read('../migrations/0003_reader_accounts.sql'),
  read('../migrations/0005_novel_payments.sql'),
  read('../migrations/0006_reader_credits.sql'),
  read('../migrations/0029_creem_credit_topup_idempotency.sql'),
  read('../src/worker.js'),
  read('../wrangler.toml')
]);

assert.match(workerSource, /const creemTestApiBase = 'https:\/\/test-api\.creem\.io\/v1'/);
assert.match(workerSource, /request\.headers\.get\('creem-signature'\)/);
assert.match(workerSource, /url\.pathname === creemWebhookPath/);
assert.match(wranglerSource, /CREEM_MODE = "test"/);
assert.match(wranglerSource, /CREEM_CREDIT_PACK_PRODUCT_ID = "prod_4DJS5zfnpMENgs7IaXBSwG"/);
assert.doesNotMatch(wranglerSource, /CREEM_API_KEY/);
assert.doesNotMatch(wranglerSource, /CREEM_WEBHOOK_SECRET/);

const secret = 'test-webhook-secret';
const productId = 'prod_4DJS5zfnpMENgs7IaXBSwG';
const orderToken = 'sc-creem-idempotency-test';
const payload = {
  id: 'evt_station_cat_test',
  eventType: 'checkout.completed',
  created_at: Date.now(),
  object: {
    id: 'ch_station_cat_test',
    object: 'checkout',
    request_id: orderToken,
    order: {
      id: 'ord_station_cat_test',
      product: productId,
      amount: 1000,
      currency: 'USD',
      status: 'paid',
      type: 'onetime',
      mode: 'test'
    },
    product: {
      id: productId,
      name: 'Station Points 100',
      price: 1000,
      currency: 'USD',
      billing_type: 'onetime',
      mode: 'test'
    },
    customer: {
      id: 'cust_station_cat_test',
      email: 'reader@example.com',
      mode: 'test'
    },
    status: 'completed',
    metadata: {
      accountId: '1',
      credits: '100',
      orderToken
    },
    mode: 'test'
  }
};
const rawBody = JSON.stringify(payload);
const signature = await hooks.hmacSha256Hex(rawBody, secret);
assert.equal(await hooks.verifyCreemSignature(rawBody, signature, secret), true);
const invalidComputedSignature = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
assert.equal(await hooks.verifyCreemSignature(rawBody, invalidComputedSignature, secret), false);

const testRequest = new Request('https://wwwstationcat.org/api/novels/payments/checkout');
const testConfig = hooks.getCreemConfig(
  {
    CREEM_MODE: 'test',
    CREEM_API_KEY: 'creem_test_example',
    CREEM_WEBHOOK_SECRET: secret,
    CREEM_CREDIT_PACK_PRODUCT_ID: productId,
    CREEM_TEST_READER_EMAILS: 'allowed@example.com'
  },
  testRequest
);
const configuredPack = { credits: 100, priceAmount: 10, priceCurrency: 'USD' };
assert.equal(hooks.isCreemCheckoutAllowed(testConfig, { email: 'allowed@example.com' }, configuredPack), true);
assert.equal(hooks.isCreemCheckoutAllowed(testConfig, { email: 'other@example.com' }, configuredPack), false);
assert.equal(
  hooks.isCreemCheckoutAllowed(testConfig, { email: 'allowed@example.com' }, { ...configuredPack, priceAmount: 9 }),
  false
);

const event = hooks.extractCreemEvent(payload);
assert.equal(event.eventType, 'checkout.completed');
assert.equal(event.requestId, orderToken);
assert.equal(event.productId, productId);
assert.equal(event.priceAmount, '10.00');
assert.equal(event.status, 'finished');

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readerMigration);
sqlite.exec(paymentMigration);
sqlite.exec(creditMigration);
sqlite.exec(creemMigration);
sqlite.prepare(
  `INSERT INTO reader_accounts (id, email, normalized_email, display_name)
   VALUES (1, 'reader@example.com', 'reader@example.com', 'Reader')`
).run();
sqlite.prepare(
  `INSERT INTO novel_orders (
    order_token, account_id, provider, provider_order_id, order_type,
    price_amount, price_currency, pay_currency, status, customer_email, metadata_json
  ) VALUES (?, 1, 'creem', ?, 'credit-pack', '10.00', 'USD', '', 'waiting', ?, ?)`
).run(
  orderToken,
  orderToken,
  'reader@example.com',
  JSON.stringify({
    creditPackCredits: 100,
    creditPackUnitLabel: 'Station Points',
    creemMode: 'test',
    creemProductId: productId
  })
);

const db = new D1Database(sqlite);
const env = {
  WAITLIST_DB: db,
  CREEM_WEBHOOK_SECRET: secret,
  CREEM_MODE: 'test',
  CREEM_CREDIT_PACK_PRODUCT_ID: productId,
  CREEM_CREDIT_PACK_CREDITS: '100',
  CREEM_CREDIT_PACK_PRICE_USD: '10'
};
const makeRequest = (body = rawBody, requestSignature = signature) =>
  new Request('https://wwwstationcat.org/api/novels/webhooks/creem', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'creem-signature': requestSignature
    },
    body
  });

const firstResponse = await hooks.handleCreemWebhook(makeRequest(), env);
assert.equal(firstResponse.status, 200);
const firstResult = await firstResponse.json();
assert.equal(firstResult.ok, true);
assert.equal(firstResult.creditGrant.credited, true);
assert.equal(firstResult.creditGrant.credits, 100);

const repeatedResponse = await hooks.handleCreemWebhook(makeRequest(), env);
assert.equal(repeatedResponse.status, 200);
const repeatedResult = await repeatedResponse.json();
assert.equal(repeatedResult.creditGrant.credited, false);
assert.equal(repeatedResult.creditGrant.reason, 'already_credited');

const account = sqlite.prepare('SELECT * FROM reader_credit_accounts WHERE account_id = 1').get();
assert.equal(account.balance_credits, 100);
assert.equal(account.lifetime_purchased_credits, 100);
const ledger = sqlite.prepare('SELECT * FROM reader_credit_ledger WHERE account_id = 1').all();
assert.equal(ledger.length, 1);
assert.equal(ledger[0].source, 'creem-credit-pack');
assert.equal(ledger[0].source_ref, orderToken);
assert.equal(sqlite.prepare("SELECT status FROM novel_orders WHERE order_token = ?").get(orderToken).status, 'finished');

const invalidResponse = await hooks.handleCreemWebhook(makeRequest(rawBody, 'invalid-signature'), env);
assert.equal(invalidResponse.status, 401);
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_credit_ledger').get().count, 1);

const mismatchedPayload = structuredClone(payload);
mismatchedPayload.id = 'evt_wrong_product';
mismatchedPayload.object.product.id = 'prod_wrong';
mismatchedPayload.object.order.product = 'prod_wrong';
const mismatchedRawBody = JSON.stringify(mismatchedPayload);
const mismatchedSignature = await hooks.hmacSha256Hex(mismatchedRawBody, secret);
const mismatchResponse = await hooks.handleCreemWebhook(makeRequest(mismatchedRawBody, mismatchedSignature), env);
assert.equal(mismatchResponse.status, 422);
assert.equal((await mismatchResponse.json()).reason, 'product_mismatch');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_credit_ledger').get().count, 1);

sqlite.close();
console.log('Creem test checkout webhook and idempotent Station Points crediting checks passed.');
