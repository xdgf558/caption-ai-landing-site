const gameKey = 'cat-life';
const ledgerSource = 'cat-life-game';
const productIdPattern = /^cat-life\.(?:skin|furniture|bundle|map|story|feature)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const opaqueKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class CatLifeCommerceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CatLifeCommerceError';
    this.code = code;
    this.details = details;
  }
}

const commerceError = (code, message, details) => new CatLifeCommerceError(code, message, details);

const normalizeAccountId = (value) => {
  const accountId = Number(value);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) {
    throw commerceError('INVALID_ACCOUNT', 'A valid member account is required.');
  }
  return accountId;
};

const normalizeProductId = (value) => {
  const productId = String(value || '').trim();
  if (!productIdPattern.test(productId)) {
    throw commerceError('INVALID_PRODUCT', 'A valid game product is required.');
  }
  return productId;
};

const normalizeOpaqueKey = (value, field, minimumLength = 8, maximumLength = 120) => {
  const key = String(value || '').trim();
  if (
    key.length < minimumLength
    || key.length > maximumLength
    || !opaqueKeyPattern.test(key)
  ) {
    throw commerceError('INVALID_REQUEST', `${field} is invalid.`);
  }
  return key;
};

const normalizeReason = (value) => {
  const reason = String(value || '').trim().slice(0, 500);
  if (reason.length < 3) {
    throw commerceError('INVALID_CORRECTION', 'A correction reason is required.');
  }
  return reason;
};

const randomId = (prefix) => {
  const uuid = crypto.randomUUID?.();
  if (uuid) return `${prefix}_${uuid.replace(/-/g, '')}`;
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export const createCatLifePurchaseId = () => randomId('clp');
export const createCatLifeCorrectionId = () => randomId('clc');

const parseJson = (value, fallback = {}) => {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const first = (db, sql, ...params) => db.prepare(sql).bind(...params).first();

const getPurchaseRowByIdempotency = (db, accountId, idempotencyKey) =>
  first(
    db,
    `SELECT * FROM game_purchases
     WHERE account_id = ? AND idempotency_key = ?
     LIMIT 1`,
    accountId,
    idempotencyKey
  );

const getPurchaseRowById = (db, accountId, purchaseId) =>
  first(
    db,
    `SELECT * FROM game_purchases
     WHERE account_id = ? AND id = ?
     LIMIT 1`,
    accountId,
    purchaseId
  );

const purchaseResult = async (db, purchase, { replayed = false } = {}) => {
  if (!purchase) return null;
  const [account, entitlement, purchaseLedger, reversalLedger] = await Promise.all([
    first(
      db,
      `SELECT balance_credits, lifetime_spent_credits
       FROM reader_credit_accounts WHERE account_id = ?`,
      purchase.account_id
    ),
    first(
      db,
      `SELECT id, entitlement_key, product_id, purchase_id, granted_at, expires_at,
              revoked_at, revoke_reason
       FROM game_entitlements
       WHERE account_id = ? AND purchase_id = ?
       ORDER BY id DESC LIMIT 1`,
      purchase.account_id,
      purchase.id
    ),
    first(
      db,
      `SELECT id, entry_type, credits_delta, balance_after, source, source_ref, created_at
       FROM reader_credit_ledger
       WHERE account_id = ? AND entry_type = 'game_purchase'
         AND source = ? AND source_ref = ?
       LIMIT 1`,
      purchase.account_id,
      ledgerSource,
      purchase.id
    ),
    first(
      db,
      `SELECT id, entry_type, credits_delta, balance_after, source, source_ref, created_at
       FROM reader_credit_ledger
       WHERE account_id = ? AND entry_type = 'game_purchase_reversal'
         AND source = ? AND source_ref = ?
       LIMIT 1`,
      purchase.account_id,
      ledgerSource,
      purchase.id
    )
  ]);

  return {
    replayed,
    purchase: {
      id: purchase.id,
      accountId: purchase.account_id,
      gameKey: purchase.game_key,
      productId: purchase.product_id,
      productType: purchase.product_type,
      entitlementKey: purchase.entitlement_key,
      pointsSpent: Number(purchase.points_spent),
      balanceBefore: Number(purchase.balance_before),
      balanceAfter: purchase.balance_after === null ? null : Number(purchase.balance_after),
      catalogRevision: Number(purchase.catalog_revision),
      productSnapshot: parseJson(purchase.product_snapshot_json),
      idempotencyKey: purchase.idempotency_key,
      status: purchase.status,
      reversalId: purchase.reversal_id,
      reversalReason: purchase.reversal_reason,
      completedAt: purchase.completed_at,
      reversedAt: purchase.reversed_at,
      createdAt: purchase.created_at
    },
    entitlement: entitlement
      ? {
          id: entitlement.id,
          entitlementKey: entitlement.entitlement_key,
          productId: entitlement.product_id,
          purchaseId: entitlement.purchase_id,
          grantedAt: entitlement.granted_at,
          expiresAt: entitlement.expires_at,
          revokedAt: entitlement.revoked_at,
          revokeReason: entitlement.revoke_reason,
          active: !entitlement.revoked_at
        }
      : null,
    ledger: purchaseLedger,
    reversalLedger,
    balance: Number(account?.balance_credits || 0),
    lifetimeSpentCredits: Number(account?.lifetime_spent_credits || 0)
  };
};

const diagnoseRedemptionFailure = async (db, { accountId, productId, idempotencyKey }) => {
  const existing = await getPurchaseRowByIdempotency(db, accountId, idempotencyKey);
  if (existing) {
    if (existing.product_id !== productId) {
      throw commerceError('IDEMPOTENCY_CONFLICT', 'This request key was used for another product.');
    }
    if (existing.status === 'completed' || existing.status === 'reversed') {
      return purchaseResult(db, existing, { replayed: true });
    }
    throw commerceError('REDEMPTION_CONFLICT', 'The original redemption is incomplete.');
  }

  const product = await first(
    db,
    `SELECT product_id, lifecycle_status, points_price
     FROM game_products WHERE product_id = ? AND game_key = ?`,
    productId,
    gameKey
  );
  if (!product || product.lifecycle_status !== 'active') {
    throw commerceError('PRODUCT_NOT_AVAILABLE', 'This product is not available for redemption.');
  }

  const owned = await first(
    db,
    `SELECT id FROM game_entitlements
     WHERE account_id = ? AND game_key = ? AND entitlement_key = (
       SELECT entitlement_key FROM game_products WHERE product_id = ?
     ) AND revoked_at IS NULL
     LIMIT 1`,
    accountId,
    gameKey,
    productId
  );
  if (owned) throw commerceError('ALREADY_OWNED', 'This account already owns the product.');

  const account = await first(
    db,
    `SELECT balance_credits FROM reader_credit_accounts WHERE account_id = ?`,
    accountId
  );
  if (Number(account?.balance_credits || 0) < Number(product.points_price)) {
    throw commerceError('INSUFFICIENT_POINTS', 'There are not enough Station Points.');
  }

  throw commerceError('REDEMPTION_CONFLICT', 'The redemption could not be completed safely.');
};

export const redeemCatLifeProduct = async (
  db,
  { accountId: accountIdValue, productId: productIdValue, idempotencyKey: keyValue, purchaseId: trustedId }
) => {
  if (!db?.prepare || !db?.batch) {
    throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  }
  const accountId = normalizeAccountId(accountIdValue);
  const productId = normalizeProductId(productIdValue);
  const idempotencyKey = normalizeOpaqueKey(keyValue, 'idempotencyKey');
  const purchaseId = trustedId
    ? normalizeOpaqueKey(trustedId, 'purchaseId', 8, 100)
    : createCatLifePurchaseId();

  const existing = await getPurchaseRowByIdempotency(db, accountId, idempotencyKey);
  if (existing) {
    if (existing.product_id !== productId) {
      throw commerceError('IDEMPOTENCY_CONFLICT', 'This request key was used for another product.');
    }
    if (existing.status === 'completed' || existing.status === 'reversed') {
      return purchaseResult(db, existing, { replayed: true });
    }
    throw commerceError('REDEMPTION_CONFLICT', 'The original redemption is incomplete.');
  }

  const statements = [
    db.prepare(
      `INSERT OR IGNORE INTO reader_credit_accounts (account_id, currency_label)
       VALUES (?, 'Station Points')`
    ).bind(accountId),
    db.prepare(
      `INSERT INTO game_purchases (
        id, account_id, game_key, product_id, product_type, entitlement_key,
        points_spent, balance_before, catalog_revision, product_snapshot_json,
        idempotency_key, status, ledger_source, ledger_source_ref
      )
      SELECT ?, ?, p.game_key, p.product_id, p.product_type, p.entitlement_key,
        p.points_price, credits.balance_credits, p.catalog_revision,
        json_object(
          'productId', p.product_id,
          'gameKey', p.game_key,
          'productType', p.product_type,
          'entitlementKey', p.entitlement_key,
          'pointsPrice', p.points_price,
          'catalogRevision', p.catalog_revision,
          'names', json(p.names_json)
        ),
        ?, 'pending', ?, ?
      FROM game_products p
      JOIN reader_credit_accounts credits ON credits.account_id = ?
      WHERE p.product_id = ?
        AND p.game_key = ?
        AND p.lifecycle_status = 'active'
        AND credits.balance_credits >= p.points_price
        AND NOT EXISTS (
          SELECT 1 FROM game_entitlements owned
          WHERE owned.account_id = ?
            AND owned.game_key = p.game_key
            AND owned.entitlement_key = p.entitlement_key
            AND owned.revoked_at IS NULL
        )`
    ).bind(
      purchaseId,
      accountId,
      idempotencyKey,
      ledgerSource,
      purchaseId,
      accountId,
      productId,
      gameKey,
      accountId
    ),
    db.prepare(
      `UPDATE reader_credit_accounts
       SET balance_credits = balance_credits - (
             SELECT points_spent FROM game_purchases WHERE id = ? AND status = 'pending'
           ),
           lifetime_spent_credits = lifetime_spent_credits + (
             SELECT points_spent FROM game_purchases WHERE id = ? AND status = 'pending'
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?
         AND balance_credits = (
           SELECT balance_before FROM game_purchases WHERE id = ? AND status = 'pending'
         )`
    ).bind(purchaseId, purchaseId, accountId, purchaseId),
    db.prepare(
      `INSERT INTO reader_credit_ledger (
        account_id, entry_type, credits_delta, balance_after, source, source_ref,
        note, metadata_json
      )
      SELECT p.account_id, 'game_purchase', -p.points_spent, credits.balance_credits,
        ?, p.id, 'Cat Life Game entitlement redemption',
        json_object(
          'gameKey', p.game_key,
          'productId', p.product_id,
          'entitlementKey', p.entitlement_key,
          'catalogRevision', p.catalog_revision
        )
      FROM game_purchases p
      JOIN reader_credit_accounts credits ON credits.account_id = p.account_id
      WHERE p.id = ?
        AND p.status = 'pending'
        AND credits.balance_credits = p.balance_before - p.points_spent`
    ).bind(ledgerSource, purchaseId),
    db.prepare(
      `INSERT INTO game_entitlements (
        account_id, game_key, entitlement_key, product_id, purchase_id,
        grant_source, source_ref, metadata_json
      )
      SELECT p.account_id, p.game_key, p.entitlement_key, p.product_id, p.id,
        'station-points', p.id,
        json_object('catalogRevision', p.catalog_revision, 'pointsSpent', p.points_spent)
      FROM game_purchases p
      WHERE p.id = ?
        AND p.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM reader_credit_ledger ledger
          WHERE ledger.account_id = p.account_id
            AND ledger.entry_type = 'game_purchase'
            AND ledger.source = ?
            AND ledger.source_ref = p.id
        )`
    ).bind(purchaseId, ledgerSource),
    db.prepare(
      `UPDATE game_purchases
       SET status = 'completed',
           balance_after = (
             SELECT balance_credits FROM reader_credit_accounts
             WHERE account_id = game_purchases.account_id
           ),
           ledger_id = (
             SELECT id FROM reader_credit_ledger
             WHERE account_id = game_purchases.account_id
               AND entry_type = 'game_purchase'
               AND source = ?
               AND source_ref = game_purchases.id
           ),
           completed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'pending'
         AND EXISTS (
           SELECT 1 FROM game_entitlements entitlement
           WHERE entitlement.purchase_id = game_purchases.id
             AND entitlement.revoked_at IS NULL
         )`
    ).bind(ledgerSource, purchaseId),
    // A NULL purchase_id violates the event table constraint and rolls the whole batch back.
    db.prepare(
      `INSERT INTO game_commerce_events (
        account_id, purchase_id, event_type, event_key, product_id,
        entitlement_key, points_delta, metadata_json
      ) VALUES (
        ?,
        CASE WHEN EXISTS (
          SELECT 1 FROM game_purchases WHERE id = ? AND status = 'completed'
        ) THEN ? ELSE NULL END,
        'purchase.completed', ?, ?,
        COALESCE((SELECT entitlement_key FROM game_purchases WHERE id = ?), ''),
        -COALESCE((SELECT points_spent FROM game_purchases WHERE id = ?), 0),
        json_object('idempotencyKey', ?, 'source', 'station-points')
      )`
    ).bind(
      accountId,
      purchaseId,
      purchaseId,
      `purchase:${purchaseId}`,
      productId,
      purchaseId,
      purchaseId,
      idempotencyKey
    )
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    try {
      const resolved = await diagnoseRedemptionFailure(db, { accountId, productId, idempotencyKey });
      if (resolved) return resolved;
    } catch (diagnosed) {
      if (diagnosed instanceof CatLifeCommerceError) throw diagnosed;
    }
    throw commerceError('REDEMPTION_CONFLICT', 'The redemption transaction was rolled back.', {
      cause: String(error?.message || error)
    });
  }

  const completed = await getPurchaseRowById(db, accountId, purchaseId);
  if (!completed || completed.status !== 'completed') {
    return diagnoseRedemptionFailure(db, { accountId, productId, idempotencyKey });
  }
  return purchaseResult(db, completed);
};

export const reverseCatLifePurchase = async (
  db,
  {
    accountId: accountIdValue,
    purchaseId: purchaseIdValue,
    correctionId: correctionIdValue,
    reason: reasonValue
  }
) => {
  if (!db?.prepare || !db?.batch) {
    throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  }
  const accountId = normalizeAccountId(accountIdValue);
  const purchaseId = normalizeOpaqueKey(purchaseIdValue, 'purchaseId', 8, 100);
  const correctionId = correctionIdValue
    ? normalizeOpaqueKey(correctionIdValue, 'correctionId', 8, 120)
    : createCatLifeCorrectionId();
  const reason = normalizeReason(reasonValue);
  const purchase = await getPurchaseRowById(db, accountId, purchaseId);
  if (!purchase) throw commerceError('PURCHASE_NOT_FOUND', 'The purchase was not found.');
  if (purchase.status === 'reversed') {
    return purchaseResult(db, purchase, { replayed: true });
  }
  if (purchase.status !== 'completed') {
    throw commerceError('CORRECTION_CONFLICT', 'Only a completed purchase can be corrected.');
  }

  const statements = [
    db.prepare(
      `UPDATE game_purchases
       SET status = 'reversing', reversal_id = ?, reversal_reason = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND account_id = ? AND status = 'completed'`
    ).bind(correctionId, reason, purchaseId, accountId),
    db.prepare(
      `UPDATE reader_credit_accounts
       SET balance_credits = balance_credits + (
             SELECT points_spent FROM game_purchases
             WHERE id = ? AND status = 'reversing'
           ),
           lifetime_spent_credits = MAX(
             0,
             lifetime_spent_credits - (
               SELECT points_spent FROM game_purchases
               WHERE id = ? AND status = 'reversing'
             )
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ?
         AND EXISTS (
           SELECT 1 FROM game_purchases
           WHERE id = ? AND account_id = ? AND status = 'reversing'
         )`
    ).bind(purchaseId, purchaseId, accountId, purchaseId, accountId),
    db.prepare(
      `INSERT INTO reader_credit_ledger (
        account_id, entry_type, credits_delta, balance_after, source, source_ref,
        note, metadata_json
      )
      SELECT p.account_id, 'game_purchase_reversal', p.points_spent,
        credits.balance_credits, ?, p.id, ?,
        json_object('correctionId', p.reversal_id, 'productId', p.product_id)
      FROM game_purchases p
      JOIN reader_credit_accounts credits ON credits.account_id = p.account_id
      WHERE p.id = ? AND p.account_id = ? AND p.status = 'reversing'`
    ).bind(ledgerSource, reason, purchaseId, accountId),
    db.prepare(
      `UPDATE game_entitlements
       SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = ?, updated_at = CURRENT_TIMESTAMP
       WHERE account_id = ? AND purchase_id = ? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM reader_credit_ledger ledger
           WHERE ledger.account_id = ?
             AND ledger.entry_type = 'game_purchase_reversal'
             AND ledger.source = ?
             AND ledger.source_ref = ?
         )`
    ).bind(reason, accountId, purchaseId, accountId, ledgerSource, purchaseId),
    db.prepare(
      `UPDATE game_purchases
       SET status = 'reversed',
           reversal_ledger_id = (
             SELECT id FROM reader_credit_ledger
             WHERE account_id = game_purchases.account_id
               AND entry_type = 'game_purchase_reversal'
               AND source = ?
               AND source_ref = game_purchases.id
           ),
           reversed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND account_id = ? AND status = 'reversing'
         AND EXISTS (
           SELECT 1 FROM game_entitlements entitlement
           WHERE entitlement.purchase_id = game_purchases.id
             AND entitlement.revoked_at IS NOT NULL
         )`
    ).bind(ledgerSource, purchaseId, accountId),
    db.prepare(
      `INSERT INTO game_commerce_events (
        account_id, purchase_id, event_type, event_key, product_id,
        entitlement_key, points_delta, metadata_json
      ) VALUES (
        ?,
        CASE WHEN EXISTS (
          SELECT 1 FROM game_purchases WHERE id = ? AND status = 'reversed'
        ) THEN ? ELSE NULL END,
        'purchase.reversed', ?,
        COALESCE((SELECT product_id FROM game_purchases WHERE id = ?), ''),
        COALESCE((SELECT entitlement_key FROM game_purchases WHERE id = ?), ''),
        COALESCE((SELECT points_spent FROM game_purchases WHERE id = ?), 0),
        json_object('correctionId', ?, 'reason', ?)
      )`
    ).bind(
      accountId,
      purchaseId,
      purchaseId,
      `correction:${correctionId}`,
      purchaseId,
      purchaseId,
      purchaseId,
      correctionId,
      reason
    )
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const current = await getPurchaseRowById(db, accountId, purchaseId);
    if (current?.status === 'reversed') {
      return purchaseResult(db, current, { replayed: true });
    }
    throw commerceError('CORRECTION_CONFLICT', 'The correction transaction was rolled back.', {
      cause: String(error?.message || error)
    });
  }

  const reversed = await getPurchaseRowById(db, accountId, purchaseId);
  if (!reversed || reversed.status !== 'reversed') {
    throw commerceError('CORRECTION_CONFLICT', 'The correction did not complete.');
  }
  return purchaseResult(db, reversed);
};

export const catLifeCommerceConstants = Object.freeze({ gameKey, ledgerSource });
