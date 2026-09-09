// M0 characterization, not the desired music contract or a CI regression suite.
// Exercises the current Worker with an in-memory database; all network is denied.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { runInNewContext } from 'node:vm';
import worker, { __readerTotpTestHooks as hooks } from '../../../src/worker.js';

const root = new URL('../../../', import.meta.url);
const sqlite = new DatabaseSync(':memory:');
const queries = [];
let failMembershipWrite = false;
class Statement {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.sql, params); }
  execute(method) {
    queries.push(this.sql);
    if (failMembershipWrite && /INSERT INTO reader_memberships/.test(this.sql)) {
      throw new Error('M0 injected membership write failure');
    }
    return sqlite.prepare(this.sql)[method](...this.params);
  }
  async first() { return this.execute('get') || null; }
  async all() { return { results: this.execute('all') }; }
  async run() { return { success: true, meta: { changes: Number(this.execute('run').changes) } }; }
}
const db = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push({ success: true, results: statement.execute('all') });
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden in M0 audit'); };
try {
  for (const file of [
    '0003_reader_accounts.sql', '0005_novel_payments.sql', '0006_reader_credits.sql',
    '0008_admin_content_settings.sql', '0009_reader_memberships.sql',
    '0011_reader_password_credentials.sql', '0029_creem_credit_topup_idempotency.sql',
    '0030_creem_reversals_and_event_ids.sql'
  ]) sqlite.exec(await readFile(new URL(`migrations/${file}`, root), 'utf8'));
  sqlite.exec(`INSERT INTO reader_accounts (id, email, normalized_email, display_name)
    VALUES (1, 'audit@example.com', 'audit@example.com', 'M0 fixture');`);
  const token = 'm0-local-session';
  sqlite.prepare(`INSERT INTO reader_sessions (account_id, session_hash, expires_at, last_seen_at)
    VALUES (1, ?, datetime('now', '+1 day'), '2000-01-01 00:00:00')`).run(await hooks.sha256Hex(token));
  const secret = 'm0-fixture-secret';
  const productId = 'prod_m0_fixture';
  const orderToken = 'm0-fixture-order';
  const env = {
    WAITLIST_DB: db, CREEM_MODE: 'test', CREEM_WEBHOOK_SECRET: secret,
    CREEM_CREDIT_PACK_PRODUCT_ID: productId,
    CREEM_CREDIT_PACK_CREDITS: '100', CREEM_CREDIT_PACK_PRICE_USD: '10'
  };
  sqlite.prepare(`INSERT INTO novel_orders (order_token, account_id, provider, provider_order_id,
    order_type, price_amount, price_currency, status, customer_email, metadata_json)
    VALUES (?, 1, 'creem', ?, 'credit-pack', '10.00', 'USD', 'waiting', 'audit@example.com', ?)`)
    .run(orderToken, orderToken, JSON.stringify({ creditPackCredits: 100, creemMode: 'test', creemProductId: productId }));
  const sendWebhook = async (payload) => {
    const body = JSON.stringify(payload);
    return hooks.handleCreemWebhook(new Request('https://wwwstationcat.org/api/novels/webhooks/creem', {
      method: 'POST', body, headers: { 'creem-signature': await hooks.hmacSha256Hex(body, secret) }
    }), env);
  };
  const paid = {
    id: 'evt_m0_paid', eventType: 'checkout.completed', created_at: Date.now(),
    object: {
      id: 'ch_m0', object: 'checkout', request_id: orderToken, status: 'completed', mode: 'test',
      order: { id: 'ord_m0', product: productId, amount: 1000, currency: 'USD', status: 'paid', type: 'onetime', mode: 'test' },
      product: { id: productId, price: 1000, currency: 'USD', billing_type: 'onetime', mode: 'test' },
      customer: { id: 'cust_m0', email: 'audit@example.com', mode: 'test' },
      metadata: { accountId: '1', credits: '100', orderToken }
    }
  };
  assert.equal((await sendWebhook(paid)).status, 200);
  const balance = () => sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=1').get().balance_credits;
  assert.equal(balance(), 100);
  const membership = () => sqlite.prepare('SELECT * FROM reader_memberships WHERE account_id=1').get();
  const request = (path, method = 'GET') => new Request(`https://wwwstationcat.org${path}`, {
    method, headers: { cookie: `station_cat_reader_session=${token}`, 'Idempotency-Key': 'm0-same-client-attempt' }
  });
  const redeem = () => worker.fetch(request('/api/readers/membership/redeem', 'POST'), env, {});
  assert.equal((await redeem()).status, 200);
  assert.equal(balance(), 90);
  const firstExpiry = membership().expires_at;
  assert.equal((await redeem()).status, 200);
  assert.equal(balance(), 80);
  assert.ok(membership().expires_at > firstExpiry);
  console.log('OBSERVED: repeated redemption with same request key spends twice (100 -> 80) and extends twice.');

  const beforeFailure = { ...membership() };
  failMembershipWrite = true;
  assert.equal((await redeem()).status, 400);
  failMembershipWrite = false;
  assert.equal(balance(), 70);
  assert.deepEqual({ ...membership() }, beforeFailure);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM reader_credit_ledger WHERE entry_type='membership_redeem'").get().n, 2);
  console.log('OBSERVED: injected membership-write failure leaves 10 points deducted without a membership/ledger update.');

  sqlite.exec("UPDATE reader_memberships SET started_at=datetime('now', '+1 day') WHERE account_id=1");
  const credits = await (await hooks.handleReaderCredits(request('/api/readers/credits'), env)).json();
  assert.equal(credits.membership.active, true);
  assert.ok(queries.some((sql) => /UPDATE reader_sessions SET last_seen_at/.test(sql)));
  assert.notEqual(sqlite.prepare('SELECT last_seen_at FROM reader_sessions WHERE account_id=1').get().last_seen_at, '2000-01-01 00:00:00');
  console.log('OBSERVED: future-start membership is returned active; authenticated lookup writes session last_seen_at.');

  const beforeRefund = { ...membership() };
  const refunded = await sendWebhook({
    id: 'evt_m0_refund', eventType: 'refund.created', created_at: Date.now(),
    object: {
      id: 'ref_m0', object: 'refund', status: 'succeeded', refund_amount: 1000, refund_currency: 'USD', mode: 'sandbox',
      transaction: { id: 'tran_m0', amount: 1000, currency: 'USD', order: 'ord_m0', mode: 'sandbox' },
      checkout: { id: 'ch_m0', request_id: orderToken, mode: 'sandbox' },
      order: { id: 'ord_m0', product: productId, amount: 1000, currency: 'USD', status: 'paid', transaction: 'tran_m0', mode: 'sandbox' },
      product: { id: productId, price: 1000, currency: 'USD', mode: 'sandbox' },
      customer: { id: 'cust_m0', email: 'audit@example.com', mode: 'sandbox' }
    }
  });
  assert.equal(refunded.status, 200);
  assert.equal(balance(), -30);
  assert.deepEqual({ ...membership() }, beforeRefund);
  assert.equal((await (await hooks.handleReaderCredits(request('/api/readers/credits'), env)).json()).membership.active, true);
  console.log('OBSERVED: signed refund reverses 100 points but leaves the membership row and active result unchanged.');

  // Exact existing helper, evaluated in isolation; no external redirect is followed.
  const source = await readFile(new URL('src/worker.js', root), 'utf8');
  const declaration = source.slice(source.indexOf('const cleanRedirectPath ='), source.indexOf('const isLocalHostnameRequest ='));
  assert.ok(declaration.startsWith('const cleanRedirectPath ='));
  const path = runInNewContext(`${declaration}\ncleanRedirectPath('/\\\\outside.example');`, {
    cleanText: (value, maxLength) => String(value || '').trim().slice(0, maxLength)
  });
  assert.equal(new URL(path, 'https://wwwstationcat.org').origin, 'https://outside.example');
  console.log('OBSERVED: existing redirect helper accepts slash-backslash which URL resolves off-origin.');
  console.log('M0 characterization complete. These are gaps to fix, not acceptable music behavior. No production requests made.');
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
}
