import { membershipTimestamp } from './readerMembership.js';

const error = (code, status = 409) => Object.assign(new Error(code), { code, status });
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(JSON.stringify(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
const rows = async statement => (await statement.all()).results || [];
const integer = value => Number.isSafeInteger(value) && value > 0;
const sqlDate = timestamp => new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
const memberFields = ['membership_level', 'source', 'source_ref', 'started_at', 'expires_at',
  'last_redeemed_at', 'metadata_json', 'created_at', 'updated_at'];

export async function listMembershipRefundReviews(db, { reviewed = false, before = Number.MAX_SAFE_INTEGER } = {}) {
  const list = await rows(db.prepare(`SELECT l.id, l.account_id, a.email, l.source_ref,
      l.credits_delta, l.created_at, r.decision, r.actor_email, r.reason, r.created_at AS reviewed_at
    FROM reader_credit_ledger l JOIN reader_accounts a ON a.id = l.account_id
    LEFT JOIN membership_refund_reviews r ON r.reversal_id = l.id AND r.applied = 1
    WHERE l.entry_type = 'reversal' AND l.source = 'creem-credit-pack' AND l.id < ?
      AND ${reviewed ? 'r.reversal_id IS NOT NULL' : 'r.reversal_id IS NULL'}
    ORDER BY l.id DESC LIMIT 51`).bind(before));
  return { reviews: list.slice(0, 50), next: list.length > 50 ? list[49].id : null };
}

async function snapshot(db, id) {
  const reversal = await db.prepare(`SELECT * FROM reader_credit_ledger
    WHERE id = ? AND entry_type = 'reversal' AND source = 'creem-credit-pack'`).bind(id).first();
  if (!reversal) throw error('REVIEW_NOT_FOUND', 404);
  const accountId = reversal.account_id;
  const member = await db.prepare('SELECT * FROM reader_memberships WHERE account_id = ?').bind(accountId).first();
  const receipts = await rows(db.prepare(`SELECT r.*, l.created_at AS ledger_created_at,
      l.credits_delta, l.source AS ledger_source, l.source_ref AS ledger_source_ref
    FROM reader_membership_redemptions r JOIN reader_credit_ledger l
      ON l.id = r.ledger_id AND l.account_id = r.account_id
    WHERE r.account_id = ? ORDER BY r.ledger_id DESC LIMIT 201`).bind(accountId));
  const reviews = await rows(db.prepare(`SELECT * FROM membership_refund_reviews
    WHERE account_id = ? ORDER BY reversal_id LIMIT 201`).bind(accountId));
  const items = await rows(db.prepare(`SELECT i.* FROM membership_refund_review_items i
    JOIN membership_refund_reviews r ON r.reversal_id = i.reversal_id WHERE r.account_id = ?
    ORDER BY i.redemption_ledger_id LIMIT 201`).bind(accountId));
  const topup = await db.prepare(`SELECT * FROM reader_credit_ledger WHERE account_id = ?
    AND entry_type = 'topup' AND source = 'creem-credit-pack' AND source_ref = ? LIMIT 1`)
    .bind(accountId, reversal.source_ref).first();
  const account = await db.prepare('SELECT id, email FROM reader_accounts WHERE id = ?').bind(accountId).first();
  const state = { reversal, member, receipts, reviews, items, topup };
  return { ...state, account, version: await digest(state) };
}

// Walk the known renewal chain backwards. Removing unused time compacts later grants,
// preserving their duration rather than restoring an old expiry and losing later purchases.
export function refundCandidates(state, now = Date.now()) {
  const { member, receipts, reviews, items, reversal, topup } = state;
  const blocked = reason => ({ candidates: [], blocked: reason });
  if (receipts.length > 200 || reviews.length > 200 || items.length > 200) return blocked('HISTORY_LIMIT');
  if (!member || member.membership_level !== 'member' || member.source !== 'reader-membership-redeem' ||
    !(membershipTimestamp(member.started_at) <= now) || !(membershipTimestamp(member.expires_at) > now)) {
    return blocked('NO_SUPPORTED_ACTIVE_MEMBERSHIP');
  }
  if (!receipts.length || member.source_ref !== receipts[0].operation_token) return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
  let latest;
  try { latest = JSON.parse(receipts[0].membership_json); } catch { return blocked('MEMBERSHIP_HISTORY_UNVERIFIED'); }
  // Reviews after the most recent purchase keep its source_ref; all earlier reviews
  // were already reflected in that purchase's immutable receipt.
  const removedBySource = new Map();
  for (const review of reviews) {
    let before;
    try { before = JSON.parse(review.before_json); } catch { return blocked('MEMBERSHIP_HISTORY_UNVERIFIED'); }
    if (review.applied !== 1) return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
    if (before) removedBySource.set(before.source_ref, (removedBySource.get(before.source_ref) || 0) + review.removed_seconds * 1000);
  }
  if (membershipTimestamp(member.expires_at) !== membershipTimestamp(latest?.expires_at) - (removedBySource.get(member.source_ref) || 0)) {
    return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
  }
  let cursor = membershipTimestamp(member.expires_at);
  const candidates = [];
  for (let index = 0; index < receipts.length; index++) {
    const receipt = receipts[index];
    let original;
    try { original = JSON.parse(receipt.membership_json); } catch { return blocked('MEMBERSHIP_HISTORY_UNVERIFIED'); }
    const created = membershipTimestamp(receipt.created_at);
    const previous = membershipTimestamp(receipt.previous_expires_at);
    if (receipt.previous_expires_at !== null && !Number.isFinite(previous)) return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
    const end = membershipTimestamp(original?.expires_at);
    const start = Math.max(created, Number.isFinite(previous) ? previous : created);
    if (receipt.applied !== 1 || original?.account_id !== member.account_id ||
      original.source_ref !== receipt.operation_token || receipt.ledger_source !== 'reader-membership-redeem' ||
      receipt.ledger_source_ref !== receipt.operation_token || receipt.credits_delta !== -receipt.cost_credits ||
      !integer(receipt.cost_credits) || !(end > start)) return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
    const prior = items.find(item => item.redemption_ledger_id === receipt.ledger_id);
    const duration = end - start - (prior?.removed_seconds || 0) * 1000;
    if (duration < 0) return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
    const remainingSeconds = Math.max(0, Math.floor((cursor - Math.max(now, cursor - duration)) / 1000));
    const inFundingWindow = topup && topup.id < receipt.ledger_id && receipt.ledger_id < reversal.id;
    if (!prior && inFundingWindow && remainingSeconds > 0 && reversal.credits_delta < 0) {
      candidates.push({ ledgerId: receipt.ledger_id, costCredits: receipt.cost_credits,
        createdAt: receipt.created_at, originalExpiresAt: original.expires_at,
        remainingSeconds, effectiveStart: sqlDate(cursor - duration), effectiveEnd: sqlDate(cursor) });
    }
    cursor -= duration;
    if (cursor <= now || !(previous > created)) break;
    const earlier = receipts[index + 1];
    if (earlier) {
      let earlierSnapshot;
      try { earlierSnapshot = JSON.parse(earlier.membership_json); } catch { return blocked('MEMBERSHIP_HISTORY_UNVERIFIED'); }
      if (previous !== membershipTimestamp(earlierSnapshot?.expires_at) - (removedBySource.get(earlier.operation_token) || 0)) {
        return blocked('MEMBERSHIP_HISTORY_UNVERIFIED');
      }
    }
  }
  return { candidates, blocked: candidates.length ? null : 'NO_TRACEABLE_UNUSED_REDEMPTION' };
}

const reviewJson = row => row ? { reversalId: row.reversal_id, decision: row.decision,
  actor: row.actor_email, reason: row.reason, before: JSON.parse(row.before_json),
  afterExpiresAt: row.after_expires_at, removedSeconds: row.removed_seconds, reviewedAt: row.created_at } : null;

export async function getMembershipRefundReview(db, id) {
  const state = await snapshot(db, id);
  const decision = state.reviews.find(r => r.reversal_id === id && r.applied === 1);
  return { id, account: state.account, reversal: state.reversal, topup: state.topup,
    membership: state.member, version: state.version, ...refundCandidates(state), review: reviewJson(decision) };
}

export async function decideMembershipRefundReview(db, input, actor) {
  const { id, decision, version } = input;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const selected = input.redemptionIds;
  if (!integer(id) || !['keep', 'revoke'].includes(decision) || typeof version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(version) || reason.length < 10 || reason.length > 1000 ||
    !Array.isArray(selected) || selected.length > 50 || !selected.every(integer) ||
    new Set(selected).size !== selected.length || (decision === 'keep' ? selected.length !== 0 : selected.length === 0) ||
    input.confirmation !== String(id) || !actor) throw error('INVALID_REVIEW', 400);
  const ids = [...selected].sort((a, b) => a - b);
  const intent = await digest({ id, decision, version, reason, ids, actor });
  const replay = async () => {
    const row = await db.prepare('SELECT * FROM membership_refund_reviews WHERE reversal_id = ?').bind(id).first();
    if (!row) return null;
    if (row.intent_hash !== intent || row.applied !== 1) throw error('REVIEW_ALREADY_DECIDED');
    return { review: reviewJson(row), replayed: true };
  };
  const existing = await replay();
  if (existing) return existing;
  const state = await snapshot(db, id);
  if (version !== state.version) throw error('REVIEW_STALE');
  const { candidates } = refundCandidates(state);
  const chosen = ids.map(id => candidates.find(c => c.ledgerId === id));
  if (chosen.some(item => !item)) throw error('REDEMPTION_NOT_REVOKABLE');
  if (chosen.reduce((sum, item) => sum + item.costCredits, 0) > Math.max(0, -state.reversal.credits_delta)) {
    throw error('REFUND_CREDIT_BUDGET_EXCEEDED');
  }
  const removed = chosen.reduce((sum, item) => sum + item.remainingSeconds, 0);
  const before = JSON.stringify(state.member);
  const after = removed ? sqlDate(membershipTimestamp(state.member.expires_at) - removed * 1000) : state.member?.expires_at || null;
  const token = `vip-review-${crypto.randomUUID()}`;
  const memberMatch = state.member
    ? `EXISTS (SELECT 1 FROM reader_memberships WHERE account_id = ? AND ${memberFields.map(f => `${f} IS ?`).join(' AND ')})`
    : 'NOT EXISTS (SELECT 1 FROM reader_memberships WHERE account_id = ?)';
  const memberParams = state.member ? [state.reversal.account_id, ...memberFields.map(f => state.member[f])] : [state.reversal.account_id];
  const audit = JSON.stringify({ reversalId: id, accountId: state.reversal.account_id,
    sourceRef: state.reversal.source_ref, decision, reason, redemptionIds: ids,
    before: state.member, afterExpiresAt: after, removedSeconds: removed, operationToken: token });
  const gate = 'EXISTS (SELECT 1 FROM membership_refund_reviews WHERE operation_token = ?)';
  const statements = [
    db.prepare(`INSERT INTO membership_refund_reviews
      (reversal_id, account_id, operation_token, intent_hash, decision, actor_email, reason, before_json, after_expires_at, removed_seconds)
      SELECT id, account_id, ?, ?, ?, ?, ?, ?, ?, ? FROM reader_credit_ledger
      WHERE id = ? AND account_id = ? AND entry_type = 'reversal' AND source = 'creem-credit-pack'
        AND source_ref = ? AND credits_delta = ? AND ${memberMatch}
        AND (SELECT COUNT(*) FROM membership_refund_reviews WHERE account_id = ?) = ?
      ON CONFLICT(reversal_id) DO NOTHING`).bind(token, intent, decision, actor, reason, before, after, removed,
        id, state.reversal.account_id, state.reversal.source_ref, state.reversal.credits_delta, ...memberParams,
        state.reversal.account_id, state.reviews.length)
  ];
  if (removed) statements.push(db.prepare(`UPDATE reader_memberships SET expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE account_id = ? AND ${gate}`).bind(after, state.reversal.account_id, token));
  for (const item of chosen) statements.push(db.prepare(`INSERT INTO membership_refund_review_items
    (redemption_ledger_id, reversal_id, removed_seconds) SELECT ?, ?, ? WHERE ${gate}`)
    .bind(item.ledgerId, id, item.remainingSeconds, token));
  statements.push(db.prepare(`INSERT INTO admin_audit_logs (actor_email, action, target_type, target_id, target_slug, metadata_json)
    SELECT ?, 'membership_refund.review', 'reader_credit_reversal', ?, ?, ? WHERE ${gate}`)
    .bind(actor, String(id), token, audit, token));
  statements.push(db.prepare(`UPDATE membership_refund_reviews SET applied = CASE WHEN
      (SELECT COUNT(*) FROM admin_audit_logs WHERE target_slug = ? AND action = 'membership_refund.review') = 1
      AND (SELECT COUNT(*) FROM membership_refund_review_items WHERE reversal_id = ?) = ?
      AND (? = 0 OR EXISTS (SELECT 1 FROM reader_memberships WHERE account_id = ? AND expires_at = ?))
      THEN 1 ELSE NULL END WHERE operation_token = ?`)
    .bind(token, id, chosen.length, removed, state.reversal.account_id, after, token));
  try { await db.batch(statements); }
  catch (cause) {
    const committed = await replay();
    if (committed) return committed;
    if (/UNIQUE constraint failed/.test(String(cause))) throw error('REVIEW_STALE');
    throw error('REVIEW_UNAVAILABLE', 503);
  }
  const result = await replay();
  if (!result) throw error('REVIEW_STALE');
  return { ...result, replayed: false };
}
