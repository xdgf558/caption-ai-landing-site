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
const [readerMigration, paymentMigration, creditMigration, creemMigration, creemReversalMigration, workerSource, wranglerSource] = await Promise.all([
  read('../migrations/0003_reader_accounts.sql'),
  read('../migrations/0005_novel_payments.sql'),
  read('../migrations/0006_reader_credits.sql'),
  read('../migrations/0029_creem_credit_topup_idempotency.sql'),
  read('../migrations/0030_creem_reversals_and_event_ids.sql'),
  read('../src/worker.js'),
  read('../wrangler.toml')
]);

assert.match(workerSource, /const creemTestApiBase = 'https:\/\/test-api\.creem\.io\/v1'/);
assert.match(workerSource, /request\.headers\.get\('creem-signature'\)/);
assert.match(workerSource, /url\.pathname === creemWebhookPath/);
assert.match(creemReversalMigration, /provider_event_id/);
assert.match(creemReversalMigration, /entry_type = 'reversal'/);
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
sqlite.exec(creemReversalMigration);
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
assert.equal(repeatedResult.duplicate, true);

const account = sqlite.prepare('SELECT * FROM reader_credit_accounts WHERE account_id = 1').get();
assert.equal(account.balance_credits, 100);
assert.equal(account.lifetime_purchased_credits, 100);
const ledger = sqlite.prepare('SELECT * FROM reader_credit_ledger WHERE account_id = 1').all();
assert.equal(ledger.length, 1);
assert.equal(ledger[0].source, 'creem-credit-pack');
assert.equal(ledger[0].source_ref, orderToken);
assert.equal(sqlite.prepare("SELECT status FROM novel_orders WHERE order_token = ?").get(orderToken).status, 'finished');
assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM novel_payment_events WHERE provider_event_id = ?").get(payload.id).count, 1);

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
assert.equal(mismatchResponse.status, 200);
const mismatchResult = await mismatchResponse.json();
assert.equal(mismatchResult.rejected, true);
assert.equal(mismatchResult.reason, 'product_mismatch');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_credit_ledger').get().count, 1);

const wrongAmountPayload = structuredClone(payload);
wrongAmountPayload.id = 'evt_wrong_amount';
wrongAmountPayload.object.order.amount = 900;
const wrongAmountRawBody = JSON.stringify(wrongAmountPayload);
const wrongAmountSignature = await hooks.hmacSha256Hex(wrongAmountRawBody, secret);
const wrongAmountResponse = await hooks.handleCreemWebhook(makeRequest(wrongAmountRawBody, wrongAmountSignature), env);
assert.equal(wrongAmountResponse.status, 200);
assert.equal((await wrongAmountResponse.json()).reason, 'amount_mismatch');

const wrongCurrencyPayload = structuredClone(payload);
wrongCurrencyPayload.id = 'evt_wrong_currency';
wrongCurrencyPayload.object.order.currency = 'EUR';
wrongCurrencyPayload.object.product.currency = 'EUR';
const wrongCurrencyRawBody = JSON.stringify(wrongCurrencyPayload);
const wrongCurrencySignature = await hooks.hmacSha256Hex(wrongCurrencyRawBody, secret);
const wrongCurrencyResponse = await hooks.handleCreemWebhook(makeRequest(wrongCurrencyRawBody, wrongCurrencySignature), env);
assert.equal(wrongCurrencyResponse.status, 200);
assert.equal((await wrongCurrencyResponse.json()).reason, 'currency_mismatch');

const wrongCustomerPayload = structuredClone(payload);
wrongCustomerPayload.id = 'evt_wrong_customer';
wrongCustomerPayload.object.customer.email = 'attacker@example.com';
const wrongCustomerRawBody = JSON.stringify(wrongCustomerPayload);
const wrongCustomerSignature = await hooks.hmacSha256Hex(wrongCustomerRawBody, secret);
const wrongCustomerResponse = await hooks.handleCreemWebhook(makeRequest(wrongCustomerRawBody, wrongCustomerSignature), env);
assert.equal(wrongCustomerResponse.status, 200);
assert.equal((await wrongCustomerResponse.json()).reason, 'customer_mismatch');

const wrongModePayload = structuredClone(payload);
wrongModePayload.id = 'evt_wrong_mode';
wrongModePayload.object.mode = 'prod';
wrongModePayload.object.order.mode = 'prod';
wrongModePayload.object.product.mode = 'prod';
wrongModePayload.object.customer.mode = 'prod';
const wrongModeRawBody = JSON.stringify(wrongModePayload);
const wrongModeSignature = await hooks.hmacSha256Hex(wrongModeRawBody, secret);
const wrongModeResponse = await hooks.handleCreemWebhook(makeRequest(wrongModeRawBody, wrongModeSignature), env);
assert.equal(wrongModeResponse.status, 200);
const wrongModeResult = await wrongModeResponse.json();
assert.equal(wrongModeResult.rejected, true);
assert.equal(wrongModeResult.reason, 'mode_mismatch');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reader_credit_ledger').get().count, 1);

sqlite.prepare(
  `UPDATE reader_credit_accounts
   SET balance_credits = 20,
       lifetime_spent_credits = 80
   WHERE account_id = 1`
).run();
sqlite.prepare(
  `INSERT INTO reader_credit_ledger (
    account_id, entry_type, credits_delta, balance_after, source, source_ref, note
  ) VALUES (1, 'spend', -80, 20, 'test-spend', 'test-spend-1', 'Simulate consumed points before refund.')`
).run();

const refundPayload = {
  id: 'evt_station_cat_refund',
  eventType: 'refund.created',
  created_at: Date.now(),
  object: {
    id: 'ref_station_cat_test',
    object: 'refund',
    status: 'succeeded',
    refund_amount: 1000,
    refund_currency: 'USD',
    transaction: {
      id: 'tran_station_cat_test',
      amount: 1000,
      currency: 'USD',
      order: 'ord_station_cat_test',
      mode: 'sandbox'
    },
    checkout: {
      id: 'ch_station_cat_test',
      request_id: orderToken,
      mode: 'sandbox'
    },
    order: {
      id: 'ord_station_cat_test',
      product: productId,
      amount: 1000,
      currency: 'USD',
      status: 'paid',
      transaction: 'tran_station_cat_test',
      mode: 'sandbox'
    },
    product: { id: productId, price: 1000, currency: 'USD', mode: 'sandbox' },
    customer: { id: 'cust_station_cat_test', email: 'reader@example.com', mode: 'sandbox' },
    mode: 'sandbox'
  }
};
const refundRawBody = JSON.stringify(refundPayload);
const refundSignature = await hooks.hmacSha256Hex(refundRawBody, secret);
const refundResponse = await hooks.handleCreemWebhook(makeRequest(refundRawBody, refundSignature), env);
assert.equal(refundResponse.status, 200);
const refundResult = await refundResponse.json();
assert.equal(refundResult.creditGrant.reversed, true);
assert.equal(refundResult.creditGrant.reason, 'reversed');
assert.equal(refundResult.creditGrant.credits, 100);
assert.equal(refundResult.creditGrant.account.balanceCredits, -80);
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 1').get().balance_credits, -80);
assert.equal(sqlite.prepare('SELECT lifetime_purchased_credits FROM reader_credit_accounts WHERE account_id = 1').get().lifetime_purchased_credits, 0);
const reversalLedger = sqlite.prepare("SELECT * FROM reader_credit_ledger WHERE entry_type = 'reversal'").get();
assert.equal(reversalLedger.credits_delta, -100);
assert.equal(reversalLedger.balance_after, -80);

const repeatedRefundResponse = await hooks.handleCreemWebhook(makeRequest(refundRawBody, refundSignature), env);
assert.equal(repeatedRefundResponse.status, 200);
assert.equal((await repeatedRefundResponse.json()).duplicate, true);
assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM reader_credit_ledger WHERE entry_type = 'reversal'").get().count, 1);

const disputePayload = structuredClone(refundPayload);
disputePayload.id = 'evt_station_cat_dispute';
disputePayload.eventType = 'dispute.created';
disputePayload.object.id = 'disp_station_cat_test';
disputePayload.object.object = 'dispute';
delete disputePayload.object.checkout.request_id;
const disputeRawBody = JSON.stringify(disputePayload);
const disputeSignature = await hooks.hmacSha256Hex(disputeRawBody, secret);
const disputeResponse = await hooks.handleCreemWebhook(makeRequest(disputeRawBody, disputeSignature), env);
assert.equal(disputeResponse.status, 200);
const disputeResult = await disputeResponse.json();
assert.equal(disputeResult.creditGrant.reversed, false);
assert.equal(disputeResult.creditGrant.reason, 'already_reversed');
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 1').get().balance_credits, -80);

const missingEventIdPayload = structuredClone(payload);
delete missingEventIdPayload.id;
const missingEventIdRawBody = JSON.stringify(missingEventIdPayload);
const missingEventIdSignature = await hooks.hmacSha256Hex(missingEventIdRawBody, secret);
const missingEventIdResponse = await hooks.handleCreemWebhook(makeRequest(missingEventIdRawBody, missingEventIdSignature), env);
assert.equal(missingEventIdResponse.status, 200);
const missingEventIdResult = await missingEventIdResponse.json();
assert.equal(missingEventIdResult.rejected, true);
assert.equal(missingEventIdResult.reason, 'missing_event_id');

sqlite.prepare(
  `INSERT INTO reader_accounts (id, email, normalized_email, display_name)
   VALUES (2, 'early-refund@example.com', 'early-refund@example.com', 'Early Refund')`
).run();
const earlyRefundOrderToken = 'sc-creem-early-refund-test';
sqlite.prepare(
  `INSERT INTO novel_orders (
    order_token, account_id, provider, provider_order_id, order_type,
    price_amount, price_currency, pay_currency, status, customer_email, metadata_json
  ) VALUES (?, 2, 'creem', ?, 'credit-pack', '10.00', 'USD', '', 'waiting', ?, ?)`
).run(
  earlyRefundOrderToken,
  'ord_early_refund_test',
  'early-refund@example.com',
  JSON.stringify({
    creditPackCredits: 100,
    creditPackUnitLabel: 'Station Points',
    creemMode: 'test',
    creemProductId: productId
  })
);
const earlyRefundPayload = structuredClone(refundPayload);
earlyRefundPayload.id = 'evt_early_refund';
earlyRefundPayload.object.order.id = 'ord_early_refund_test';
earlyRefundPayload.object.customer.email = 'early-refund@example.com';
earlyRefundPayload.object.checkout.id = 'ch_early_refund_test';
earlyRefundPayload.object.checkout.request_id = earlyRefundOrderToken;
const earlyRefundRawBody = JSON.stringify(earlyRefundPayload);
const earlyRefundSignature = await hooks.hmacSha256Hex(earlyRefundRawBody, secret);
const earlyRefundResponse = await hooks.handleCreemWebhook(makeRequest(earlyRefundRawBody, earlyRefundSignature), env);
assert.equal(earlyRefundResponse.status, 200);
const earlyRefundResult = await earlyRefundResponse.json();
assert.equal(earlyRefundResult.creditGrant.reversed, false);
assert.equal(earlyRefundResult.creditGrant.reason, 'reversal_recorded_before_credit');
assert.equal(earlyRefundResult.creditGrant.ledger.creditsDelta, 0);

const lateCompletionPayload = structuredClone(payload);
lateCompletionPayload.id = 'evt_late_completion';
lateCompletionPayload.object.id = 'ch_early_refund_test';
lateCompletionPayload.object.request_id = earlyRefundOrderToken;
lateCompletionPayload.object.order.id = 'ord_early_refund_test';
lateCompletionPayload.object.customer.email = 'early-refund@example.com';
lateCompletionPayload.object.metadata.orderToken = earlyRefundOrderToken;
lateCompletionPayload.object.metadata.accountId = '2';
const lateCompletionRawBody = JSON.stringify(lateCompletionPayload);
const lateCompletionSignature = await hooks.hmacSha256Hex(lateCompletionRawBody, secret);
const lateCompletionResponse = await hooks.handleCreemWebhook(makeRequest(lateCompletionRawBody, lateCompletionSignature), env);
assert.equal(lateCompletionResponse.status, 200);
const lateCompletionResult = await lateCompletionResponse.json();
assert.equal(lateCompletionResult.creditGrant.credited, false);
assert.equal(lateCompletionResult.creditGrant.reason, 'payment_reversed');
assert.equal(sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id = 2').get().balance_credits, 0);

sqlite.close();
console.log('Creem checkout, event idempotency, mode isolation, and credit reversal checks passed.');
