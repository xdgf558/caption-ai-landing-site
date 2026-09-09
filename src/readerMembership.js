const failure = (code) => Object.assign(new Error(code), { code });

export const validMembershipRequestKey = (key) => typeof key === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(key);

export const membershipTimestamp = (value) => {
  if (typeof value !== 'string') return NaN;
  const normalized = value.replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z)?$/.test(normalized)) return NaN;
  const timestamp = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  // Date.parse can roll invalid calendar dates into the following month.
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === normalized.slice(0, 19)
    ? timestamp : NaN;
};

export const isReaderMembershipActive = (row, now = Date.now()) => Boolean(
  row && row.membership_level === 'member' &&
  membershipTimestamp(row.started_at) <= now && membershipTimestamp(row.expires_at) > now
);

export const readMembershipReceipt = async (db, accountId, key) => {
  const receipt = await db.prepare(`SELECT * FROM reader_membership_redemptions
    WHERE account_id = ? AND request_key = ?`).bind(accountId, key).first();
  if (!receipt) return null;
  if (receipt.applied !== 1 || !receipt.membership_json || !receipt.ledger_id) throw failure('MEMBERSHIP_REDEEM_UNAVAILABLE');
  const ledger = await db.prepare('SELECT * FROM reader_credit_ledger WHERE id = ? AND account_id = ?')
    .bind(receipt.ledger_id, accountId).first();
  if (!ledger) throw failure('MEMBERSHIP_REDEEM_UNAVAILABLE');
  return {
    membership: JSON.parse(receipt.membership_json), ledger,
    settings: {
      membershipCreditCost: receipt.cost_credits, membershipDurationMonths: receipt.duration_months,
      membershipCoversPaidContent: Boolean(receipt.covers_paid), unitLabel: receipt.unit_label
    }
  };
};

export const applyMembershipRedemption = async (db, accountId, key, settings) => {
  const cost = settings.membershipCreditCost;
  const months = settings.membershipDurationMonths;
  if (!Number.isSafeInteger(cost) || cost < 1 || !Number.isSafeInteger(months) || months < 1) {
    throw failure('MEMBERSHIP_REDEEM_UNAVAILABLE');
  }
  const token = `membership-${crypto.randomUUID()}`;
  const source = 'reader-membership-redeem';
  const metadata = JSON.stringify({ costCredits: cost, months, membershipCoversPaidContent: settings.membershipCoversPaidContent });
  // A unique per-attempt token gates every write. A replay cannot reuse the winner's gate.
  await db.batch([
    db.prepare(`INSERT INTO reader_membership_redemptions
      (account_id, request_key, operation_token, cost_credits, duration_months, unit_label,
       covers_paid, balance_before, previous_expires_at)
      SELECT a.account_id, ?, ?, ?, ?, ?, ?, a.balance_credits,
        (SELECT expires_at FROM reader_memberships WHERE account_id = a.account_id)
      FROM reader_credit_accounts a JOIN reader_accounts r ON r.id = a.account_id
      WHERE a.account_id = ? AND a.balance_credits >= ? AND r.status = 'active'
      ON CONFLICT(account_id, request_key) DO NOTHING`)
      .bind(key, token, cost, months, settings.unitLabel, settings.membershipCoversPaidContent ? 1 : 0, accountId, cost),
    db.prepare(`UPDATE reader_credit_accounts SET balance_credits = balance_credits - ?,
      lifetime_spent_credits = lifetime_spent_credits + ?, updated_at = CURRENT_TIMESTAMP
      WHERE account_id = ? AND balance_credits >= ?
      AND EXISTS (SELECT 1 FROM reader_membership_redemptions WHERE operation_token = ?)`)
      .bind(cost, cost, accountId, cost, token),
    db.prepare(`INSERT INTO reader_memberships
      (account_id, membership_level, source, source_ref, started_at, expires_at, last_redeemed_at, metadata_json)
      SELECT account_id, 'member', ?, ?, CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, ?), CURRENT_TIMESTAMP, ?
      FROM reader_membership_redemptions WHERE operation_token = ?
      ON CONFLICT(account_id) DO UPDATE SET
        membership_level = 'member', source = excluded.source, source_ref = excluded.source_ref,
        expires_at = datetime(CASE WHEN reader_memberships.expires_at > CURRENT_TIMESTAMP
          THEN reader_memberships.expires_at ELSE CURRENT_TIMESTAMP END, ?),
        last_redeemed_at = CURRENT_TIMESTAMP, metadata_json = excluded.metadata_json, updated_at = CURRENT_TIMESTAMP`)
      .bind(source, token, `+${months} month`, metadata, token, `+${months} month`),
    db.prepare(`INSERT INTO reader_credit_ledger
      (account_id, entry_type, credits_delta, balance_after, source, source_ref, series_slug, chapter_slug, note, metadata_json)
      SELECT r.account_id, 'membership_redeem', -r.cost_credits, a.balance_credits, ?, r.operation_token, '', '', ?,
        json_object('costCredits', r.cost_credits, 'months', r.duration_months, 'expiresAt', m.expires_at)
      FROM reader_membership_redemptions r JOIN reader_credit_accounts a ON a.account_id = r.account_id
      JOIN reader_memberships m ON m.account_id = r.account_id WHERE r.operation_token = ?`)
      .bind(source, `Redeemed ${months} month membership with ${cost} ${settings.unitLabel}.`, token),
    db.prepare(`UPDATE reader_membership_redemptions SET
      ledger_id = (SELECT id FROM reader_credit_ledger WHERE source = ? AND source_ref = ? AND account_id = ?),
      membership_json = (SELECT json_object('account_id', account_id, 'membership_level', membership_level,
        'source', source, 'source_ref', source_ref, 'started_at', started_at, 'expires_at', expires_at,
        'last_redeemed_at', last_redeemed_at, 'metadata_json', metadata_json,
        'created_at', created_at, 'updated_at', updated_at) FROM reader_memberships WHERE account_id = ?),
      applied = CASE WHEN
        (SELECT balance_credits FROM reader_credit_accounts WHERE account_id = ?) = balance_before - cost_credits
        AND (SELECT COUNT(*) FROM reader_credit_ledger WHERE source = ? AND source_ref = ? AND account_id = ?) = 1
        AND EXISTS (SELECT 1 FROM reader_memberships WHERE account_id = ? AND source_ref = ? AND expires_at IS NOT NULL)
        THEN 1 ELSE NULL END
      WHERE operation_token = ?`)
      .bind(source, token, accountId, accountId, accountId, source, token, accountId, accountId, token, token)
  ]);
  // The NOT NULL guard above turns a zero-write mismatch into a transaction rollback.
  const receipt = await readMembershipReceipt(db, accountId, key);
  if (!receipt) throw failure('INSUFFICIENT_CREDITS');
  return receipt;
};
