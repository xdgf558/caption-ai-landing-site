import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';
import { applyMembershipRedemption, readMembershipReceipt, membershipTimestamp } from '../src/readerMembership.js';
import { listMembershipRefundReviews, getMembershipRefundReview, decideMembershipRefundReview, refundCandidates } from '../src/membershipRefundReview.js';

const migrations = await Promise.all(['0003_reader_accounts.sql', '0005_novel_payments.sql', '0006_reader_credits.sql',
  '0007_backend_content_platform.sql', '0009_reader_memberships.sql', '0036_reader_membership_redemptions.sql',
  '0037_membership_refund_reviews.sql'].map(name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));
const databases = [];
async function fixture() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  migrations.forEach(sql => sqlite.exec(sql));
  const state = { fail: null, skip: null, lose: false, beforeBatch: null };
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    async first() { return sqlite.prepare(this.sql).get(...this.params) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.params) }; }
    async run() { return { success: true, meta: sqlite.prepare(this.sql).run(...this.params) }; }
  }
  const db = { prepare: sql => new Statement(sql), async batch(statements) {
    if (state.beforeBatch) { const hook = state.beforeBatch; state.beforeBatch = null; await hook(); }
    sqlite.exec('BEGIN');
    let result;
    try {
      result = statements.map(s => {
        if (state.fail?.test(s.sql)) throw new Error('injected database error');
        return { success: true, results: state.skip?.test(s.sql) ? [] : sqlite.prepare(s.sql).all(...s.params) };
      });
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    if (state.lose) { state.lose = false; throw new Error('lost response after commit'); }
    return result;
  } };
  for (const id of [1, 2]) {
    sqlite.prepare('INSERT INTO reader_accounts(id,email,normalized_email) VALUES(?,?,?)').run(id, `test${id}@example.test`, `test${id}@example.test`);
    sqlite.prepare('INSERT INTO reader_credit_accounts(account_id,balance_credits) VALUES(?,200)').run(id);
  }
  const ledger = (type, sourceRef, credits, accountId = 1) => Number(sqlite.prepare(`INSERT INTO reader_credit_ledger
    (account_id,entry_type,credits_delta,balance_after,source,source_ref,note) VALUES(?,?,?,100,'creem-credit-pack',?,'Fixture')`)
    .run(accountId, type, credits, sourceRef).lastInsertRowid);
  ledger('topup', 'order-one', 100); ledger('topup', 'order-two', 100);
  const settings = { membershipCreditCost: 10, membershipDurationMonths: 1, unitLabel: 'Points', membershipCoversPaidContent: true };
  const buy = (key, id = 1) => applyMembershipRedemption(db, id, key, settings);
  await buy('first-membership-0001');
  await buy('second-membership-0001');
  const reversalId = ledger('reversal', 'order-one', -100);
  const secondReversalId = ledger('reversal', 'order-two', -100);
  const count = table => sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const member = () => sqlite.prepare('SELECT * FROM reader_memberships WHERE account_id=1').get();
  const input = async (ids, id = reversalId, decision = 'revoke') => ({ id, decision, version: (await getMembershipRefundReview(db, id)).version,
    reason: '已人工核对原始订单与所选兑换的资金关联。', redemptionIds: ids, confirmation: String(id) });
  return { db, sqlite, state, ledger, buy, count, member, input, reversalId, secondReversalId };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
try {
  const f = await fixture();
  const list = await listMembershipRefundReviews(f.db);
  assert.equal(list.reviews.length, 2, 'historical reversals enter queue without webhook changes');
  const detail = await getMembershipRefundReview(f.db, f.reversalId);
  assert.equal(detail.candidates.length, 2);
  const first = detail.candidates.at(-1);
  const later = detail.candidates[0];
  const originalReceipt = await readMembershipReceipt(f.db, 1, 'first-membership-0001');
  const before = f.member();
  const balance = f.sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=1').get();
  const command = await f.input([first.ledgerId]);
  const result = await decideMembershipRefundReview(f.db, command, 'admin@example.test');
  assert.equal(result.replayed, false);
  assert.ok(membershipTimestamp(before.expires_at) > membershipTimestamp(f.member().expires_at));
  assert.ok(Math.abs((membershipTimestamp(f.member().expires_at) - Date.now()) / 1000 - later.remainingSeconds) < 3,
    'later paid duration is preserved after removing the first remaining grant');
  assert.deepEqual(f.sqlite.prepare('SELECT balance_credits FROM reader_credit_accounts WHERE account_id=1').get(), balance);
  assert.deepEqual(await readMembershipReceipt(f.db, 1, 'first-membership-0001'), originalReceipt, 'redemption receipts remain immutable');
  assert.equal(f.count('admin_audit_logs'), 1);
  assert.equal((await decideMembershipRefundReview(f.db, command, 'admin@example.test')).replayed, true);
  assert.equal(f.count('admin_audit_logs'), 1);
  await rejects(decideMembershipRefundReview(f.db, { ...command, reason: '另一条与原审核不同的理由，不允许覆盖已审结结果。' }, 'admin@example.test'), 'REVIEW_ALREADY_DECIDED');
  const remaining = await getMembershipRefundReview(f.db, f.secondReversalId);
  assert.deepEqual(remaining.candidates.map(c => c.ledgerId), [later.ledgerId]);
  await rejects(decideMembershipRefundReview(f.db, await f.input([first.ledgerId], f.secondReversalId), 'admin@example.test'), 'REDEMPTION_NOT_REVOKABLE');
  await decideMembershipRefundReview(f.db, await f.input([later.ledgerId], f.secondReversalId), 'admin@example.test');
  assert.ok(membershipTimestamp(f.member().expires_at) - Date.now() < 2000);
  assert.equal((await listMembershipRefundReviews(f.db)).reviews.length, 0);
  assert.equal((await listMembershipRefundReviews(f.db, { reviewed: true })).reviews.length, 2);

  const chain = await fixture();
  const originalCandidates = (await getMembershipRefundReview(chain.db, chain.reversalId)).candidates;
  await decideMembershipRefundReview(chain.db, await chain.input([originalCandidates.at(-1).ledgerId]), 'admin@example.test');
  await chain.buy('post-review-renewal-0001');
  const afterRenewal = await getMembershipRefundReview(chain.db, chain.secondReversalId);
  assert.deepEqual(afterRenewal.candidates.map(c => c.ledgerId), [originalCandidates[0].ledgerId],
    'later renewal remains supported; new purchase after reversal cannot be attributed to that refund');
  const chainBefore = chain.member();
  const chainResult = await decideMembershipRefundReview(chain.db, await chain.input([originalCandidates[0].ledgerId], chain.secondReversalId), 'admin@example.test');
  assert.equal(membershipTimestamp(chainBefore.expires_at) - membershipTimestamp(chain.member().expires_at), chainResult.review.removedSeconds * 1000);
  assert.ok(membershipTimestamp(chain.member().expires_at) - Date.now() > 27 * 86400000, 'new renewal survives the second refund review');

  const purchase = (id, start, end, previous = null) => ({ ledger_id: id, applied: 1, cost_credits: 10,
    operation_token: `token-${id}`, ledger_source: 'reader-membership-redeem', ledger_source_ref: `token-${id}`,
    credits_delta: -10, created_at: start, previous_expires_at: previous,
    membership_json: JSON.stringify({ account_id: 1, source_ref: `token-${id}`, expires_at: end }) });
  const finite = { member: { account_id: 1, membership_level: 'member', source: 'reader-membership-redeem',
    source_ref: 'token-3', started_at: '2026-09-01 00:00:00', expires_at: '2026-11-01 00:00:00' },
    receipts: [purchase(3, '2026-09-02 00:00:00', '2026-11-01 00:00:00', '2026-10-01 00:00:00'),
      purchase(2, '2026-09-01 00:00:00', '2026-10-01 00:00:00')], reviews: [], items: [],
    topup: { id: 1 }, reversal: { id: 4, credits_delta: -100 } };
  const clipped = refundCandidates(finite, Date.parse('2026-09-15T00:00:00Z'));
  assert.deepEqual(clipped.candidates.map(c => c.remainingSeconds), [31 * 86400, 16 * 86400], 'consumed fourteen days cannot be revoked');
  const brokenChain = structuredClone(finite);
  brokenChain.receipts[0].previous_expires_at = '2026-10-02 00:00:00';
  assert.equal(refundCandidates(brokenChain, Date.parse('2026-09-15T00:00:00Z')).blocked, 'MEMBERSHIP_HISTORY_UNVERIFIED');

  const paged = await fixture();
  for (let index = 0; index < 53; index++) paged.ledger('reversal', `historical-${index}`, 0);
  const pageOne = await listMembershipRefundReviews(paged.db);
  const pageTwo = await listMembershipRefundReviews(paged.db, { before: pageOne.next });
  assert.equal(pageOne.reviews.length, 50); assert.equal(pageTwo.reviews.length, 5);
  assert.equal(new Set([...pageOne.reviews, ...pageTwo.reviews].map(row => row.id)).size, 55);

  for (const stage of [/INSERT INTO membership_refund_reviews/, /UPDATE reader_memberships/, /INSERT INTO membership_refund_review_items/, /INSERT INTO admin_audit_logs/, /UPDATE membership_refund_reviews SET/]) {
    const x = await fixture();
    const c = (await getMembershipRefundReview(x.db, x.reversalId)).candidates[0];
    const body = await x.input([c.ledgerId]);
    const before = x.member();
    x.state.fail = stage;
    await rejects(decideMembershipRefundReview(x.db, body, 'admin@example.test'), 'REVIEW_UNAVAILABLE');
    assert.deepEqual(x.member(), before);
    assert.equal(x.count('admin_audit_logs'), 0);
    assert.equal(x.count('membership_refund_reviews'), 0);
    x.state.fail = null;
  }
  for (const stage of [/UPDATE reader_memberships/, /INSERT INTO membership_refund_review_items/, /INSERT INTO admin_audit_logs/]) {
    const x = await fixture(); const d = await getMembershipRefundReview(x.db, x.reversalId);
    const before = x.member(); x.state.skip = stage;
    await rejects(decideMembershipRefundReview(x.db, await x.input([d.candidates[0].ledgerId]), 'admin@example.test'), 'REVIEW_UNAVAILABLE');
    assert.deepEqual(x.member(), before); assert.equal(x.count('membership_refund_reviews'), 0);
  }
  const lost = await fixture(); const lostCandidate = (await getMembershipRefundReview(lost.db, lost.reversalId)).candidates[0];
  lost.state.lose = true;
  assert.equal((await decideMembershipRefundReview(lost.db, await lost.input([lostCandidate.ledgerId]), 'admin@example.test')).replayed, true);
  assert.equal(lost.count('admin_audit_logs'), 1);

  const stale = await fixture(); const staleCandidate = (await getMembershipRefundReview(stale.db, stale.reversalId)).candidates[0];
  const staleBody = await stale.input([staleCandidate.ledgerId]);
  await stale.buy('third-membership-0001');
  await rejects(decideMembershipRefundReview(stale.db, staleBody, 'admin@example.test'), 'REVIEW_STALE');
  const raceBody = await stale.input([staleCandidate.ledgerId]);
  stale.state.beforeBatch = () => stale.buy('fourth-membership-0001');
  await rejects(decideMembershipRefundReview(stale.db, raceBody, 'admin@example.test'), 'REVIEW_STALE');
  assert.equal(stale.count('membership_refund_reviews'), 0);

  const keep = await fixture(); const oldMember = keep.member();
  const keepCommand = await keep.input([], keep.reversalId, 'keep');
  const concurrent = await Promise.all([decideMembershipRefundReview(keep.db, keepCommand, 'admin@example.test'), decideMembershipRefundReview(keep.db, keepCommand, 'admin@example.test')]);
  assert.equal(concurrent.length, 2); assert.equal(keep.count('admin_audit_logs'), 1); assert.deepEqual(keep.member(), oldMember);
  await rejects(decideMembershipRefundReview(keep.db, { ...keepCommand, id: keep.secondReversalId, confirmation: 'wrong' }, 'admin@example.test'), 'INVALID_REVIEW');

  const budget = await fixture(); budget.sqlite.prepare('UPDATE reader_credit_ledger SET credits_delta=-5 WHERE id=?').run(budget.reversalId);
  const bid = (await getMembershipRefundReview(budget.db, budget.reversalId)).candidates[0].ledgerId;
  await rejects(decideMembershipRefundReview(budget.db, await budget.input([bid]), 'admin@example.test'), 'REFUND_CREDIT_BUDGET_EXCEEDED');
  await budget.buy('other-account-key-0001', 2);
  const foreignId = budget.sqlite.prepare('SELECT ledger_id FROM reader_membership_redemptions WHERE account_id=2').get().ledger_id;
  await rejects(decideMembershipRefundReview(budget.db, await budget.input([foreignId]), 'admin@example.test'), 'REDEMPTION_NOT_REVOKABLE');
  const future = await fixture(); future.sqlite.exec("UPDATE reader_memberships SET started_at='2099-01-01 00:00:00'");
  assert.equal((await getMembershipRefundReview(future.db, future.reversalId)).candidates.length, 0);
  const unknown = await fixture(); unknown.sqlite.exec("UPDATE reader_memberships SET expires_at=datetime(expires_at, '+2 day')");
  assert.equal((await getMembershipRefundReview(unknown.db, unknown.reversalId)).blocked, 'MEMBERSHIP_HISTORY_UNVERIFIED');

  const api = await fixture();
  const path = '/admin/api/readers/membership-refund-reviews';
  const request = (method, body, headers = {}) => new Request(`http://localhost${path}`, { method,
    headers: { Origin: 'http://localhost', 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await worker.fetch(request('GET'), { WAITLIST_DB: api.db }, {})).status, 200);
  assert.equal((await worker.fetch(request('POST', {}, { Origin: 'https://evil.invalid' }), { WAITLIST_DB: api.db }, {})).status, 403);
  assert.equal((await worker.fetch(request('POST', { reason: 'x'.repeat(13000) }), { WAITLIST_DB: api.db }, {})).status, 413);
  const protectedResponse = await worker.fetch(new Request(`https://wwwstationcat.org${path}`), {
    WAITLIST_DB: api.db, CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', CF_ACCESS_AUD: 'fixture', ADMIN_ALLOWED_EMAILS: 'admin@example.test'
  }, {});
  assert.equal(protectedResponse.status, 401);
  assert.equal((await worker.fetch(request('POST', null), { WAITLIST_DB: api.db }, {})).status, 400);
  const success = await worker.fetch(request('POST', await api.input([], api.reversalId, 'keep')), { WAITLIST_DB: api.db }, {});
  assert.equal(success.status, 200); assert.match(success.headers.get('cache-control'), /no-store/);
  assert.equal((await success.json()).review.actor, 'local-admin');
  api.sqlite.exec('DROP TABLE membership_refund_review_items; DROP TABLE membership_refund_reviews;');
  const missing = await worker.fetch(request('GET'), { WAITLIST_DB: api.db }, {});
  assert.equal(missing.status, 503); assert.equal((await missing.json()).code, 'REVIEW_UNAVAILABLE');
  console.log('Membership refund review tests passed: manual-only, audit atomicity, renewal preservation, replay, races and admin boundaries.');
} finally { databases.forEach(db => db.close()); }
