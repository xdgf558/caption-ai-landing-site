const gameKey = 'cat-life';
const ledgerSource = 'cat-life-game';
const productIdPattern = /^cat-life\.(?:skin|furniture|bundle|map|story|feature)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const opaqueKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const productLifecycleStatuses = new Set(['planned', 'active', 'paused', 'retired']);
const productLifecycleTransitions = Object.freeze({
  planned: new Set(['planned', 'active']),
  active: new Set(['active', 'paused', 'retired']),
  paused: new Set(['paused', 'active', 'retired']),
  retired: new Set(['retired'])
});

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
export const createCatLifeGrantId = () => randomId('clg');
export const createCatLifeRevokeId = () => randomId('clr');

const parseJson = (value, fallback = {}) => {
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const supportedLocales = new Set(['en', 'ja', 'zh-Hans', 'zh-Hant']);

const normalizeLocale = (value) => {
  const locale = String(value || '').trim();
  return supportedLocales.has(locale) ? locale : 'zh-Hant';
};

const normalizeLifecycleStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (!productLifecycleStatuses.has(status)) {
    throw commerceError('INVALID_PRODUCT_UPDATE', 'A valid product lifecycle status is required.');
  }
  return status;
};

const normalizePointsPrice = (value) => {
  const pointsPrice = Number(value);
  if (!Number.isSafeInteger(pointsPrice) || pointsPrice < 1 || pointsPrice > 10000) {
    throw commerceError('INVALID_PRODUCT_UPDATE', 'The Station Points price must be an integer from 1 to 10000.');
  }
  return pointsPrice;
};

const normalizeProductNames = (value, fallback = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw commerceError('INVALID_PRODUCT_UPDATE', 'Localized product names are required.');
  }
  const names = {};
  for (const locale of supportedLocales) {
    const name = String(value[locale] || fallback[locale] || '').trim().slice(0, 120);
    if (!name) throw commerceError('INVALID_PRODUCT_UPDATE', `A ${locale} product name is required.`);
    names[locale] = name;
  }
  return names;
};

const normalizeActorEmail = (value) => String(value || '').trim().toLowerCase().slice(0, 254);

const localizedProductName = (names, locale, fallback) => {
  const normalizedNames = names && typeof names === 'object' ? names : {};
  return String(
    normalizedNames[locale]
    || normalizedNames.en
    || normalizedNames['zh-Hant']
    || fallback
  );
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

export const listCatLifeProducts = async (db, { accountId: accountIdValue = 0, locale: localeValue } = {}) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const accountId = Number(accountIdValue);
  const signedIn = Number.isSafeInteger(accountId) && accountId > 0;
  const locale = normalizeLocale(localeValue);
  const result = await db
    .prepare(
      `SELECT
        product.product_id,
        product.game_key,
        product.product_type,
        product.points_price,
        product.lifecycle_status,
        product.entitlement_key,
        product.catalog_revision,
        product.names_json,
        entitlement.id AS entitlement_id,
        entitlement.purchase_id,
        entitlement.granted_at,
        entitlement.expires_at
       FROM game_products product
       LEFT JOIN game_entitlements entitlement
         ON entitlement.account_id = ?
        AND entitlement.game_key = product.game_key
        AND entitlement.entitlement_key = product.entitlement_key
        AND entitlement.revoked_at IS NULL
        AND (entitlement.expires_at IS NULL OR entitlement.expires_at > CURRENT_TIMESTAMP)
       WHERE product.game_key = ?
         AND (
           product.lifecycle_status = 'active'
           OR (
             entitlement.id IS NOT NULL
             AND product.lifecycle_status IN ('paused', 'retired')
           )
         )
       ORDER BY product.points_price ASC, product.product_id ASC`
    )
    .bind(signedIn ? accountId : 0, gameKey)
    .all();

  return (result.results || []).map((row) => {
    const names = parseJson(row.names_json);
    const owned = Boolean(row.entitlement_id);
    return {
      productId: row.product_id,
      gameKey: row.game_key,
      productType: row.product_type,
      name: localizedProductName(names, locale, row.product_id),
      pointsPrice: Number(row.points_price),
      lifecycleStatus: row.lifecycle_status,
      entitlementKey: row.entitlement_key,
      catalogRevision: Number(row.catalog_revision),
      owned,
      redeemable: row.lifecycle_status === 'active' && !owned,
      entitlement: owned
        ? {
            id: row.entitlement_id,
            purchaseId: row.purchase_id,
            grantedAt: row.granted_at,
            expiresAt: row.expires_at
          }
        : null
    };
  });
};

export const listCatLifeEntitlements = async (db, accountIdValue, { locale: localeValue } = {}) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const accountId = normalizeAccountId(accountIdValue);
  const locale = normalizeLocale(localeValue);
  const result = await db
    .prepare(
      `SELECT
        entitlement.id,
        entitlement.entitlement_key,
        entitlement.product_id,
        entitlement.purchase_id,
        entitlement.grant_source,
        entitlement.granted_at,
        entitlement.expires_at,
        product.product_type,
        product.lifecycle_status,
        product.catalog_revision,
        product.names_json
       FROM game_entitlements entitlement
       INNER JOIN game_products product ON product.product_id = entitlement.product_id
       WHERE entitlement.account_id = ?
         AND entitlement.game_key = ?
         AND entitlement.revoked_at IS NULL
         AND (entitlement.expires_at IS NULL OR entitlement.expires_at > CURRENT_TIMESTAMP)
       ORDER BY entitlement.granted_at DESC, entitlement.id DESC`
    )
    .bind(accountId, gameKey)
    .all();

  return (result.results || []).map((row) => ({
    id: row.id,
    entitlementKey: row.entitlement_key,
    productId: row.product_id,
    productType: row.product_type,
    productName: localizedProductName(parseJson(row.names_json), locale, row.product_id),
    purchaseId: row.purchase_id,
    grantSource: row.grant_source,
    lifecycleStatus: row.lifecycle_status,
    catalogRevision: Number(row.catalog_revision),
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
    active: true
  }));
};

export const getCatLifePointsBalance = async (db, accountIdValue) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const accountId = normalizeAccountId(accountIdValue);
  const row = await first(
    db,
    `SELECT balance_credits FROM reader_credit_accounts WHERE account_id = ?`,
    accountId
  );
  return Number(row?.balance_credits || 0);
};

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
  { accountId: accountIdValue, productId: productIdValue, idempotencyKey: keyValue },
  { purchaseIdFactory = createCatLifePurchaseId } = {}
) => {
  if (!db?.prepare || !db?.batch) {
    throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  }
  const accountId = normalizeAccountId(accountIdValue);
  const productId = normalizeProductId(productIdValue);
  const idempotencyKey = normalizeOpaqueKey(keyValue, 'idempotencyKey');
  const purchaseId = normalizeOpaqueKey(purchaseIdFactory(), 'purchaseId', 8, 100);

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

const adminProductToJson = (row) => ({
  productId: row.product_id,
  gameKey: row.game_key,
  productType: row.product_type,
  pointsPrice: Number(row.points_price),
  lifecycleStatus: row.lifecycle_status,
  entitlementKey: row.entitlement_key,
  catalogRevision: Number(row.catalog_revision),
  names: parseJson(row.names_json),
  metadata: parseJson(row.metadata_json),
  purchaseCount: Number(row.purchase_count || 0),
  activeEntitlementCount: Number(row.active_entitlement_count || 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const listCatLifeAdminProducts = async (db) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const result = await db
    .prepare(
      `SELECT
        product.*,
        (SELECT COUNT(*) FROM game_purchases purchase
         WHERE purchase.product_id = product.product_id) AS purchase_count,
        (SELECT COUNT(*) FROM game_entitlements entitlement
         WHERE entitlement.product_id = product.product_id
           AND entitlement.revoked_at IS NULL
           AND (entitlement.expires_at IS NULL OR entitlement.expires_at > CURRENT_TIMESTAMP)
        ) AS active_entitlement_count
       FROM game_products product
       WHERE product.game_key = ?
       ORDER BY product.product_type ASC, product.product_id ASC`
    )
    .bind(gameKey)
    .all();
  return (result.results || []).map(adminProductToJson);
};

export const updateCatLifeAdminProduct = async (
  db,
  {
    productId: productIdValue,
    pointsPrice: pointsPriceValue,
    lifecycleStatus: lifecycleStatusValue,
    names: namesValue,
    activationConfirmation: activationConfirmationValue
  }
) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const productId = normalizeProductId(productIdValue);
  const existing = await first(
    db,
    `SELECT * FROM game_products WHERE product_id = ? AND game_key = ? LIMIT 1`,
    productId,
    gameKey
  );
  if (!existing) throw commerceError('PRODUCT_NOT_FOUND', 'The game product was not found.');

  const lifecycleStatus = normalizeLifecycleStatus(lifecycleStatusValue);
  const allowedTransitions = productLifecycleTransitions[existing.lifecycle_status] || new Set();
  if (!allowedTransitions.has(lifecycleStatus)) {
    throw commerceError('INVALID_PRODUCT_TRANSITION', 'This product lifecycle transition is not allowed.');
  }
  if (
    lifecycleStatus === 'active'
    && existing.lifecycle_status !== 'active'
    && String(activationConfirmationValue || '').trim() !== productId
  ) {
    throw commerceError('ACTIVATION_CONFIRMATION_REQUIRED', 'Type the product ID to confirm activation.');
  }

  const pointsPrice = normalizePointsPrice(pointsPriceValue);
  const existingNames = parseJson(existing.names_json);
  const names = normalizeProductNames(namesValue, existingNames);
  const namesJson = JSON.stringify(names);
  const changed =
    pointsPrice !== Number(existing.points_price)
    || lifecycleStatus !== existing.lifecycle_status
    || namesJson !== JSON.stringify(existingNames);

  if (!changed) return adminProductToJson(existing);

  const updated = await db
    .prepare(
      `UPDATE game_products
       SET points_price = ?,
           lifecycle_status = ?,
           names_json = ?,
           catalog_revision = catalog_revision + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE product_id = ? AND game_key = ?
       RETURNING *`
    )
    .bind(pointsPrice, lifecycleStatus, namesJson, productId, gameKey)
    .first();
  return adminProductToJson(updated);
};

const adminPurchaseToJson = (row) => ({
  id: row.id,
  accountId: Number(row.account_id),
  accountEmail: row.account_email || '',
  gameKey: row.game_key,
  productId: row.product_id,
  productType: row.product_type,
  entitlementKey: row.entitlement_key,
  pointsSpent: Number(row.points_spent),
  balanceBefore: Number(row.balance_before),
  balanceAfter: row.balance_after === null ? null : Number(row.balance_after),
  catalogRevision: Number(row.catalog_revision),
  productSnapshot: parseJson(row.product_snapshot_json),
  idempotencyKey: row.idempotency_key,
  status: row.status,
  ledgerId: row.ledger_id,
  ledgerSource: row.ledger_source,
  ledgerSourceRef: row.ledger_source_ref,
  reversalId: row.reversal_id,
  reversalReason: row.reversal_reason,
  reversalLedgerId: row.reversal_ledger_id,
  entitlementId: row.entitlement_id || null,
  entitlementRevokedAt: row.entitlement_revoked_at || '',
  completedAt: row.completed_at,
  reversedAt: row.reversed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const adminPurchaseSelect = `SELECT
  purchase.*,
  account.email AS account_email,
  entitlement.id AS entitlement_id,
  entitlement.revoked_at AS entitlement_revoked_at
 FROM game_purchases purchase
 INNER JOIN reader_accounts account ON account.id = purchase.account_id
 LEFT JOIN game_entitlements entitlement ON entitlement.purchase_id = purchase.id`;

export const listCatLifeAdminPurchases = async (
  db,
  { status: statusValue = '', productId: productIdValue = '', email: emailValue = '', limit: limitValue = 80 } = {}
) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const status = String(statusValue || '').trim().toLowerCase();
  const productId = String(productIdValue || '').trim();
  const email = String(emailValue || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 80, 1), 100);
  const clauses = [];
  const params = [];
  if (status) {
    if (!new Set(['pending', 'completed', 'reversing', 'reversed']).has(status)) {
      throw commerceError('INVALID_ADMIN_FILTER', 'The purchase status filter is invalid.');
    }
    clauses.push('purchase.status = ?');
    params.push(status);
  }
  if (productId) {
    clauses.push('purchase.product_id = ?');
    params.push(normalizeProductId(productId));
  }
  if (email) {
    clauses.push('account.normalized_email = ?');
    params.push(email);
  }
  const result = await db
    .prepare(
      `${adminPurchaseSelect}
       ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY purchase.updated_at DESC, purchase.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();
  return (result.results || []).map(adminPurchaseToJson);
};

export const getCatLifeAdminPurchase = async (db, purchaseIdValue) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const purchaseId = normalizeOpaqueKey(purchaseIdValue, 'purchaseId', 8, 100);
  const row = await first(db, `${adminPurchaseSelect} WHERE purchase.id = ? LIMIT 1`, purchaseId);
  if (!row) throw commerceError('PURCHASE_NOT_FOUND', 'The purchase was not found.');
  const [ledgerResult, commerceEventsResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, entry_type, credits_delta, balance_after, source, source_ref, note, metadata_json, created_at
         FROM reader_credit_ledger
         WHERE account_id = ? AND source = ? AND source_ref = ?
         ORDER BY id ASC`
      )
      .bind(row.account_id, ledgerSource, purchaseId)
      .all(),
    db
      .prepare(
        `SELECT id, event_type, event_key, points_delta, metadata_json, created_at
         FROM game_commerce_events
         WHERE purchase_id = ?
         ORDER BY id ASC`
      )
      .bind(purchaseId)
      .all()
  ]);
  return {
    ...adminPurchaseToJson(row),
    ledger: (ledgerResult.results || []).map((entry) => ({
      id: entry.id,
      entryType: entry.entry_type,
      creditsDelta: Number(entry.credits_delta),
      balanceAfter: Number(entry.balance_after),
      source: entry.source,
      sourceRef: entry.source_ref,
      note: entry.note,
      metadata: parseJson(entry.metadata_json),
      createdAt: entry.created_at
    })),
    events: (commerceEventsResult.results || []).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      eventKey: event.event_key,
      pointsDelta: Number(event.points_delta),
      metadata: parseJson(event.metadata_json),
      createdAt: event.created_at
    }))
  };
};

const adminEntitlementToJson = (row) => ({
  id: Number(row.id),
  accountId: Number(row.account_id),
  accountEmail: row.account_email || '',
  gameKey: row.game_key,
  entitlementKey: row.entitlement_key,
  productId: row.product_id,
  productName: localizedProductName(parseJson(row.names_json), 'zh-Hant', row.product_id),
  purchaseId: row.purchase_id || '',
  grantSource: row.grant_source,
  sourceRef: row.source_ref,
  grantReason: row.grant_reason || '',
  grantedBy: row.granted_by || '',
  metadata: parseJson(row.metadata_json),
  grantedAt: row.granted_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  revokeReason: row.revoke_reason,
  active: !row.revoked_at
});

export const listCatLifeAdminEntitlements = async (
  db,
  { email: emailValue = '', productId: productIdValue = '', status: statusValue = '', limit: limitValue = 100 } = {}
) => {
  if (!db?.prepare) throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  const email = String(emailValue || '').trim().toLowerCase();
  const productId = String(productIdValue || '').trim();
  const status = String(statusValue || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 100, 1), 100);
  const clauses = ['entitlement.game_key = ?'];
  const params = [gameKey];
  if (email) {
    clauses.push('account.normalized_email = ?');
    params.push(email);
  }
  if (productId) {
    clauses.push('entitlement.product_id = ?');
    params.push(normalizeProductId(productId));
  }
  if (status === 'active') clauses.push('entitlement.revoked_at IS NULL');
  else if (status === 'revoked') clauses.push('entitlement.revoked_at IS NOT NULL');
  else if (status) throw commerceError('INVALID_ADMIN_FILTER', 'The entitlement status filter is invalid.');

  const result = await db
    .prepare(
      `SELECT entitlement.*, account.email AS account_email, product.names_json
       FROM game_entitlements entitlement
       INNER JOIN reader_accounts account ON account.id = entitlement.account_id
       INNER JOIN game_products product ON product.product_id = entitlement.product_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY entitlement.updated_at DESC, entitlement.id DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all();
  return (result.results || []).map(adminEntitlementToJson);
};

export const grantCatLifeAdminEntitlement = async (
  db,
  {
    accountId: accountIdValue,
    productId: productIdValue,
    reason: reasonValue,
    actorEmail: actorEmailValue
  },
  { grantIdFactory = createCatLifeGrantId } = {}
) => {
  if (!db?.prepare || !db?.batch) {
    throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  }
  const accountId = normalizeAccountId(accountIdValue);
  const productId = normalizeProductId(productIdValue);
  const reason = normalizeReason(reasonValue);
  const actorEmail = normalizeActorEmail(actorEmailValue) || 'admin';
  const grantId = normalizeOpaqueKey(grantIdFactory(), 'grantId', 8, 100);
  const product = await first(
    db,
    `SELECT * FROM game_products WHERE product_id = ? AND game_key = ? LIMIT 1`,
    productId,
    gameKey
  );
  if (!product) throw commerceError('PRODUCT_NOT_FOUND', 'The game product was not found.');
  if (!new Set(['active', 'paused']).has(product.lifecycle_status)) {
    throw commerceError('PRODUCT_NOT_GRANTABLE', 'Only active or paused products can be granted manually.');
  }

  const statements = [
    db
      .prepare(
        `INSERT INTO game_entitlements (
          account_id, game_key, entitlement_key, product_id, purchase_id,
          grant_source, source_ref, grant_reason, granted_by, metadata_json
        ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, ?, ?, json_object('catalogRevision', ?))`
      )
      .bind(
        accountId,
        gameKey,
        product.entitlement_key,
        product.product_id,
        grantId,
        reason,
        actorEmail,
        product.catalog_revision
      ),
    db
      .prepare(
        `INSERT INTO game_entitlement_events (
          account_id, entitlement_id, event_type, event_key, product_id,
          entitlement_key, actor_email, reason, metadata_json
        ) VALUES (
          ?,
          (SELECT id FROM game_entitlements
           WHERE account_id = ? AND game_key = ? AND grant_source = 'admin' AND source_ref = ?),
          'entitlement.granted', ?, ?, ?, ?, ?,
          json_object('grantSource', 'admin', 'catalogRevision', ?)
        )`
      )
      .bind(
        accountId,
        accountId,
        gameKey,
        grantId,
        `grant:${grantId}`,
        product.product_id,
        product.entitlement_key,
        actorEmail,
        reason,
        product.catalog_revision
      )
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    const existing = await first(
      db,
      `SELECT entitlement.*, account.email AS account_email, product.names_json
       FROM game_entitlements entitlement
       INNER JOIN reader_accounts account ON account.id = entitlement.account_id
       INNER JOIN game_products product ON product.product_id = entitlement.product_id
       WHERE entitlement.account_id = ? AND entitlement.game_key = ?
         AND entitlement.entitlement_key = ? AND entitlement.revoked_at IS NULL
       LIMIT 1`,
      accountId,
      gameKey,
      product.entitlement_key
    );
    if (existing) throw commerceError('ALREADY_OWNED', 'This account already owns the product.');
    throw commerceError('ADMIN_GRANT_CONFLICT', 'The manual entitlement grant was rolled back.', {
      cause: String(error?.message || error)
    });
  }

  const granted = await first(
    db,
    `SELECT entitlement.*, account.email AS account_email, product.names_json
     FROM game_entitlements entitlement
     INNER JOIN reader_accounts account ON account.id = entitlement.account_id
     INNER JOIN game_products product ON product.product_id = entitlement.product_id
     WHERE entitlement.account_id = ? AND entitlement.game_key = ?
       AND entitlement.grant_source = 'admin' AND entitlement.source_ref = ?
     LIMIT 1`,
    accountId,
    gameKey,
    grantId
  );
  if (!granted) throw commerceError('ADMIN_GRANT_CONFLICT', 'The manual entitlement grant did not complete.');
  return adminEntitlementToJson(granted);
};

export const revokeCatLifeAdminEntitlement = async (
  db,
  {
    entitlementId: entitlementIdValue,
    reason: reasonValue,
    actorEmail: actorEmailValue
  },
  { revokeIdFactory = createCatLifeRevokeId } = {}
) => {
  if (!db?.prepare || !db?.batch) {
    throw commerceError('REDEMPTION_NOT_READY', 'Game commerce storage is unavailable.');
  }
  const entitlementId = Number(entitlementIdValue);
  if (!Number.isSafeInteger(entitlementId) || entitlementId < 1) {
    throw commerceError('INVALID_ENTITLEMENT', 'A valid entitlement is required.');
  }
  const reason = normalizeReason(reasonValue);
  const actorEmail = normalizeActorEmail(actorEmailValue) || 'admin';
  const revokeId = normalizeOpaqueKey(revokeIdFactory(), 'revokeId', 8, 100);
  const existing = await first(
    db,
    `SELECT entitlement.*, account.email AS account_email, product.names_json
     FROM game_entitlements entitlement
     INNER JOIN reader_accounts account ON account.id = entitlement.account_id
     INNER JOIN game_products product ON product.product_id = entitlement.product_id
     WHERE entitlement.id = ? AND entitlement.game_key = ? LIMIT 1`,
    entitlementId,
    gameKey
  );
  if (!existing) throw commerceError('ENTITLEMENT_NOT_FOUND', 'The entitlement was not found.');
  if (existing.revoked_at) return { replayed: true, entitlement: adminEntitlementToJson(existing) };

  const statements = [
    db
      .prepare(
        `UPDATE game_entitlements
         SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND game_key = ? AND revoked_at IS NULL`
      )
      .bind(reason, entitlementId, gameKey),
    db
      .prepare(
        `INSERT INTO game_entitlement_events (
          account_id, entitlement_id, event_type, event_key, product_id,
          entitlement_key, actor_email, reason, metadata_json
        )
        SELECT account_id, id, 'entitlement.revoked', ?, product_id,
          entitlement_key, ?, ?, json_object('grantSource', grant_source, 'purchaseId', purchase_id)
        FROM game_entitlements
        WHERE id = ? AND game_key = ? AND revoked_at IS NOT NULL`
      )
      .bind(`revoke:${revokeId}`, actorEmail, reason, entitlementId, gameKey)
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    throw commerceError('ADMIN_REVOKE_CONFLICT', 'The entitlement revocation was rolled back.', {
      cause: String(error?.message || error)
    });
  }
  const revoked = await first(
    db,
    `SELECT entitlement.*, account.email AS account_email, product.names_json
     FROM game_entitlements entitlement
     INNER JOIN reader_accounts account ON account.id = entitlement.account_id
     INNER JOIN game_products product ON product.product_id = entitlement.product_id
     WHERE entitlement.id = ? LIMIT 1`,
    entitlementId
  );
  if (!revoked?.revoked_at) throw commerceError('ADMIN_REVOKE_CONFLICT', 'The entitlement revocation did not complete.');
  return { replayed: false, entitlement: adminEntitlementToJson(revoked) };
};

export const catLifeCommerceConstants = Object.freeze({
  gameKey,
  ledgerSource,
  productLifecycleStatuses: Object.freeze([...productLifecycleStatuses])
});
