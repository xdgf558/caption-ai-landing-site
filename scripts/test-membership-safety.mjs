import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';
import { safeReturnPath } from '../src/safeReturnPath.js';
import { isReaderMembershipActive } from '../src/readerMembership.js';
import { pendingMembershipKey } from '../src/data/membership-redemption-client.js';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('No network allowed in membership tests'); };
const sqlite = new DatabaseSync(':memory:');
let failureSql = null;
let skipSql = null;
let loseBatchResponse = false;
const writes = [];
class Statement {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.sql, params); }
  execute(method) {
    if (failureSql?.test(this.sql)) throw new Error('injected database failure');
    if (skipSql?.test(this.sql)) return method === 'all' ? [] : null;
    if (/^\s*(INSERT|UPDATE|DELETE)/.test(this.sql)) writes.push(this.sql);
    return sqlite.prepare(this.sql)[method](...this.params);
  }
  async first() { return this.execute('get') || null; }
  async all() { return { results: this.execute('all') }; }
  async run() { return { success: true, meta: { changes: Number(this.execute('run').changes) } }; }
}
const db = {
  prepare: sql => new Statement(sql),
  async batch(statements) {
    sqlite.exec('BEGIN');
    let results;
    try {
      results = statements.map(statement => ({ success: true, results: statement.execute('all') }));
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    if (loseBatchResponse) { loseBatchResponse = false; throw new Error('injected lost commit response'); }
    return results;
  }
};
const env = { WAITLIST_DB: db };
const origin = 'https://wwwstationcat.org';
const request = (key = 'same-attempt-000001', { id = 1, ...headers } = {}) => new Request(`${origin}/api/readers/membership/redeem`, {
  method: 'POST', headers: { origin, cookie: `station_cat_reader_session=fixture-session-${id}`,
    'Idempotency-Key': key, 'X-Reader-Account': String(id), ...headers }
});
const redeem = (key, options) => worker.fetch(request(key, options), env, {});
const balance = (id = 1) => sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=?').get(id).balance_credits;
const member = (id = 1) => sqlite.prepare('SELECT * FROM reader_memberships WHERE account_id=?').get(id);
const count = table => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
try {
  for (const file of ['0003_reader_accounts.sql', '0005_novel_payments.sql', '0006_reader_credits.sql',
    '0008_admin_content_settings.sql', '0009_reader_memberships.sql', '0011_reader_password_credentials.sql',
    '0036_reader_membership_redemptions.sql']) {
    sqlite.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  for (const id of [1, 2]) {
    sqlite.prepare('INSERT INTO reader_accounts (id,email,normalized_email) VALUES (?,?,?)')
      .run(id, `fixture${id}@example.test`, `fixture${id}@example.test`);
    sqlite.prepare(`INSERT INTO reader_sessions (account_id,session_hash,expires_at,last_seen_at)
      VALUES (?,?,datetime('now','+1 day'),'2000-01-01 00:00:00')`).run(id, await hooks.sha256Hex(`fixture-session-${id}`));
    sqlite.prepare('INSERT INTO reader_credit_accounts (account_id,balance_credits) VALUES (?,100)').run(id);
  }
  const first = await redeem();
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control'), /no-store/);
  const receipt = (await first.json()).redemption;
  const expiry = member().expires_at;
  assert.equal(balance(), 90);
  assert.equal(sqlite.prepare('SELECT last_seen_at FROM reader_sessions WHERE account_id=1').get().last_seen_at, '2000-01-01 00:00:00');
  const repeat = await redeem();
  assert.deepEqual((await repeat.json()).redemption, receipt);
  assert.equal(balance(), 90);
  assert.equal(member().expires_at, expiry);
  assert.equal(count('reader_credit_ledger'), 1);
  assert.equal(count('reader_membership_redemptions'), 1);

  const concurrent = await Promise.all([redeem('concurrent-key-0001'), redeem('concurrent-key-0001')]);
  assert.deepEqual(concurrent.map(r => r.status), [200, 200]);
  assert.equal(balance(), 80);
  assert.equal(count('reader_credit_ledger'), 2);
  assert.ok(member().expires_at > expiry);
  const before = { balance: balance(), membership: { ...member() }, ledger: count('reader_credit_ledger'), requests: count('reader_membership_redemptions') };
  for (const sql of [/INSERT INTO reader_memberships/, /INSERT INTO reader_credit_ledger/, /UPDATE reader_membership_redemptions SET/]) {
    failureSql = sql;
    const response = await redeem('failure-key-000001');
    assert.equal(response.status, 503);
    failureSql = null;
    assert.equal(balance(), before.balance);
    assert.deepEqual({ ...member() }, before.membership);
    assert.equal(count('reader_credit_ledger'), before.ledger);
    assert.equal(count('reader_membership_redemptions'), before.requests);
  }
  for (const sql of [/UPDATE reader_credit_accounts SET/, /INSERT INTO reader_memberships/, /INSERT INTO reader_credit_ledger/]) {
    skipSql = sql;
    assert.equal((await redeem('zero-change-000001')).status, 503);
    skipSql = null;
    assert.equal(balance(), before.balance);
    assert.deepEqual({ ...member() }, before.membership);
    assert.equal(count('reader_credit_ledger'), before.ledger);
    assert.equal(count('reader_membership_redemptions'), before.requests);
  }
  assert.equal((await redeem('failure-key-000001')).status, 200);
  assert.equal(balance(), 70);
  loseBatchResponse = true;
  assert.equal((await redeem('lost-response-0001')).status, 200);
  assert.equal(balance(), 60);
  assert.equal((await redeem('lost-response-0001')).status, 200);
  assert.equal(balance(), 60);
  assert.equal((await redeem('same-attempt-000001', { id: 2 })).status, 200);
  assert.equal(balance(2), 90);
  assert.equal((await redeem('account-switch-001', { 'X-Reader-Account': '2' })).status, 401);
  assert.equal((await redeem('', {})).status, 400);
  assert.equal((await redeem('origin-invalid-001', { origin: 'https://outside.example' })).status, 403);
  assert.equal((await redeem('session-missing-01', { cookie: '' })).status, 401);
  sqlite.exec("UPDATE reader_accounts SET status='disabled' WHERE id=2");
  assert.equal((await redeem('disabled-user-001', { id: 2 })).status, 401);
  sqlite.exec("UPDATE reader_accounts SET status='active' WHERE id=2");
  sqlite.exec('UPDATE reader_credit_accounts SET balance_credits=0 WHERE account_id=2');
  assert.equal((await redeem('insufficient-00001', { id: 2 })).status, 402);
  assert.equal((await redeem('same-attempt-000001', { id: 2 })).status, 200);
  assert.equal(balance(2), 0);
  sqlite.exec('ALTER TABLE reader_membership_redemptions RENAME TO missing_receipts');
  assert.equal((await redeem('missing-schema-001')).status, 503);
  assert.equal(balance(), 60);
  sqlite.exec('ALTER TABLE missing_receipts RENAME TO reader_membership_redemptions');

  const now = Date.parse('2026-09-09T12:00:00Z');
  const active = { membership_level: 'member', started_at: '2026-09-09 11:00:00', expires_at: '2026-10-09 12:00:00' };
  assert.equal(isReaderMembershipActive(active, now), true);
  for (const patch of [{ started_at: '2026-09-10 00:00:00' }, { expires_at: '2026-09-09 12:00:00' },
    { expires_at: '' }, { expires_at: null }, { expires_at: 'garbage' }, { started_at: '2026-02-30 00:00:00' },
    { membership_level: 'unknown' }, { expires_at: '2026-99-99 00:00:00' }]) {
    assert.equal(isReaderMembershipActive({ ...active, ...patch }, now), false);
  }
  sqlite.exec("UPDATE reader_memberships SET started_at=datetime('now','+1 day') WHERE account_id=1");
  const current = await (await hooks.handleReaderCredits(new Request(`${origin}/api/readers/credits`, {
    headers: { cookie: 'station_cat_reader_session=fixture-session-1' }
  }), env)).json();
  assert.equal(current.membership, null);

  for (const path of ['/music/?track=test#verse', '/ja/library/', '/games/cat-life/?lang=zh-Hant', '/novel/%E7%8C%AB/', '/music/?q=hello%20world']) {
    assert.equal(safeReturnPath(path), path);
  }
  for (const path of ['//outside.example', '/\\outside.example', '/%5coutside.example', '/%255coutside.example',
    '/%2foutside.example', '/%252foutside.example', '/\n/outside.example', '/%00evil', '/%09evil',
    'https://outside.example', 'javascript:alert(1)', ' /music/', '/%broken', '/a/..//outside.example']) {
    const result = safeReturnPath(path, '/en/library/');
    assert.equal(new URL(result, origin).origin, origin, path);
    assert.equal(result, '/en/library/', path);
  }
  assert.equal(safeReturnPath('//evil', '//evil'), '/zh-hant/library/');
  const memory = new Map();
  const storage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) };
  const pending = pendingMembershipKey(storage, 1, () => 'persisted-key-0001');
  assert.equal(pendingMembershipKey(storage, 1).key, pending.key);
  assert.equal(pendingMembershipKey(storage, 2, () => 'other-user-key-001').key, 'other-user-key-001');
  pending.clear();
  assert.equal(pendingMembershipKey(storage, 1, () => 'new-intent-key-001').key, 'new-intent-key-001');
  assert.throws(() => pendingMembershipKey({ ...storage, setItem() { throw new Error('quota'); } }, 3));
  console.log('Membership safety passed: atomicity, zero-change guard, replay/concurrency, lost response, auth, dates, safe returns and persistent keys.');
} finally {
  sqlite.close();
  globalThis.fetch = originalFetch;
}
