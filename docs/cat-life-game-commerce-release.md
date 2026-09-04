# Cat Life Game commerce security and release

This runbook is the launch gate for the Moonlit Tabby skin and Station Room Set. Shipping the Worker, client, or content assets does not open sales. New redemptions require both an `active` D1 product and an eligible server rollout mode.

## Rollout controls

- The reviewed configuration currently commits `CAT_LIFE_COMMERCE_ROLLOUT_MODE=allowlist`. This is not approval for public sales; D1 product activation is a separate gate. See the [dated launch-readiness assessment](cat-life-paid-launch-readiness.md) for evidence and outstanding checks.
- `CAT_LIFE_COMMERCE_ROLLOUT_MODE=off` is the emergency closure mode. Missing, misspelled, or unknown values also fail closed as `off`.
- `CAT_LIFE_COMMERCE_ROLLOUT_MODE=allowlist` exposes active products only to signed-in readers whose normalized email is in `CAT_LIFE_COMMERCE_ALLOWLIST`.
- `CAT_LIFE_COMMERCE_ROLLOUT_MODE=public` exposes active products to guests for preview and lets any signed-in reader redeem them.
- Store `CAT_LIFE_COMMERCE_ALLOWLIST` as a Worker secret because it contains member email addresses. Never commit it to `wrangler.toml` or logs.

Closing the rollout hides new offers and rejects new purchases. It does not revoke an existing entitlement. A completed request may still replay its original idempotent result after closure so a lost HTTP response cannot turn a successful charge into an ambiguous failure.

## Security matrix

The release gate must remain green for these cases:

| Risk | Required behavior | Regression coverage |
| --- | --- | --- |
| Edited local save or preferences | Premium room values and skin preferences render only with a server entitlement | Cat Life commerce Playwright suite |
| Duplicate submit or retry | One purchase, one ledger debit, one entitlement; the same key returns the original result | API, storage, and Playwright suites |
| Concurrent purchase | D1 transaction and unique constraints allow at most one charge for the same product and never overspend the balance | Storage suite |
| Offline play | The last synchronized entitlement can render only for the same account; redemption stays disabled | Playwright suite |
| Refund or support correction | The exact purchase debit is reversed once, ownership is revoked, and premium visuals disappear after synchronization | Storage, Admin, and Playwright suites |
| Cross-account use | Purchases, entitlements, preferences, and offline cache are account-scoped | API, storage, and Playwright suites |
| Rollout mistake | Missing or invalid configuration acts as `off`; allowlist mode does not expose products to guests or other members | API and release-configuration suites |

## Phase 0: deploy closed

This is the initial-deployment procedure, not a claim about current production state. Do not reset an already deployed environment or rerun completed financial tests without checking the restricted audit records first.

1. Confirm both launch products are still `planned` in the Admin workspace.
2. Apply D1 migrations in order: `0033`, `0034`, then `0035`.
3. Deploy Worker and static assets with `CAT_LIFE_COMMERCE_ROLLOUT_MODE="off"`.
4. Verify the catalog response reports `rollout.mode: "off"`, returns no offer to a non-owner, and still returns an existing owner's entitlement.
5. Run the production smoke checks without activating a product. Local play and cloud saves must remain available.

## Phase 1: one-account verification

1. Configure `CAT_LIFE_COMMERCE_ALLOWLIST` with the exact normalized email of the test member.
2. Change the reviewed Worker configuration to `allowlist` and deploy it.
3. In the protected Admin workspace, activate one product with its full product-ID confirmation.
4. Redeem it once from the allowlisted account. Confirm the displayed price, point debit, purchase, ledger entry, entitlement, cross-device rendering, and offline rendering.
5. Use the Admin purchase correction flow. Confirm the exact points return once, the entitlement is revoked, and the equipped visual disappears after refresh.
6. Repeat for the second product, then leave both products paused until the results are reviewed.

## Phase 2: limited allowlist

Expand the secret allowlist without changing client code. Keep the phase for at least one normal observation window and inspect Worker errors plus the checks below. Do not continue while any purchase is incomplete, any completed purchase lacks an active entitlement, a reversal lacks its credit ledger, or any reader balance is negative.

```sql
SELECT product_id, lifecycle_status, points_price, catalog_revision
FROM game_products
WHERE game_key = 'cat-life'
ORDER BY product_id;

SELECT id, account_id, product_id, status, created_at
FROM game_purchases
WHERE status IN ('pending', 'reversing')
ORDER BY created_at DESC;

SELECT purchase.id, purchase.account_id, purchase.product_id
FROM game_purchases purchase
LEFT JOIN game_entitlements entitlement
  ON entitlement.purchase_id = purchase.id
 AND entitlement.revoked_at IS NULL
WHERE purchase.status = 'completed'
  AND entitlement.id IS NULL;

SELECT account_id, balance_credits
FROM reader_credit_accounts
WHERE balance_credits < 0;
```

## Phase 3: public release

After the limited phase is clean, change the reviewed configuration to `public`, deploy, verify a signed-out visitor can preview the active products, and complete one final signed-in redemption. Remove the allowlist secret when it is no longer needed.

## Kill switch and rollback

Set the rollout mode back to `off` first, then pause active products in Admin. Keep `CAT_LIFE_COMMERCE_ALLOWLIST`, the migrations, assets, purchase history, ledgers, and entitlements intact until reconciliation is complete. Never revoke a Station Points purchase with the manual entitlement button; use the purchase reversal flow so point restoration and entitlement revocation remain atomic and idempotent.
