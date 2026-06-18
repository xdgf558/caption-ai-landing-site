# Stage 7F: Order, Account, Credit, and Entitlement Admin

Stage 7F makes Admin 2.0 the operating center for reader commerce support.

Stage 7G retires the old `/admin/` GitHub-token Markdown editor. New admin features should be added to `/admin-v2/` and backed by Worker admin APIs under `/admin/api/...`.

## Scope

7F adds:

- Order filtering by status, type, reader email, and series.
- Admin order detail with NOWPayments/IPN events and fulfillment status.
- Paid-order fulfillment retry for confirmed or finished orders.
- Reader account list and detail views.
- Credit balance, ledger, recent orders, and entitlement visibility in Admin 2.0.
- Manual reading-credit adjustment with required notes.
- Audit logs for manual entitlement grant, entitlement revoke, credit adjustment, and order fulfillment retry.

7F does not:

- Upload cover images. Stage 7H adds cover upload and preview in Admin 2.0.
- Mark unpaid orders as paid. Non-confirmed support cases should use manual entitlement grant or manual credit adjustment.

Stage 7G later added legacy Markdown migration and retired the old `/admin/` authoring page.

## Admin APIs

All routes must stay behind Cloudflare Access:

```text
GET  /admin/api/novels/payments/orders
GET  /admin/api/novels/payments/order
POST /admin/api/novels/payments/orders/fulfill

GET  /admin/api/novels/readers/accounts
GET  /admin/api/novels/readers/account
POST /admin/api/novels/readers/credits/adjust

GET  /admin/api/novels/entitlements
POST /admin/api/novels/entitlements/grant
POST /admin/api/novels/entitlements/revoke
```

## Fulfillment Retry

The order fulfillment retry only runs for `confirmed` or `finished` orders.

- `chapter`, `chapter-bundle`, and `supporter` orders rerun entitlement creation.
- `credit-pack` orders rerun credit top-up.
- `tip` orders are not fulfilled into access or credits.

If an entitlement from the same paid order was previously revoked, the Admin 2.0 retry restores it by clearing `revoked_at`. This makes the retry useful for support recovery while still keeping the action in `admin_audit_logs`.

## Manual Credit Adjustment

Manual credit adjustments require:

- reader account id or email,
- non-zero integer credit delta,
- required support note.

Adjustments write a `reader_credit_ledger` row with `entry_type = admin_adjustment` and `source = admin-v2-manual-credit`, then write an `admin_audit_logs` row.

Negative adjustments are blocked if they would make the balance negative.

## Review Checklist

1. Open `/admin-v2/` through Cloudflare Access.
2. Confirm the new `账户` tab is visible.
3. Filter orders by status/type/email/series.
4. Open one confirmed/finished paid order and verify fulfillment retry either completes or explains why it cannot.
5. Open a reader account and verify balance, ledger, orders, and entitlements.
6. Apply a small manual credit adjustment in a test account and confirm a ledger row plus audit row appears.
7. Grant and revoke a test entitlement and confirm both actions appear in audit logs.
