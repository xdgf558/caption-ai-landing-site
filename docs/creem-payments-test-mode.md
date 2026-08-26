# Creem Station Points payments

This integration starts in Creem Test Mode and only handles the 100 Station Points / USD 10 one-time product. All other payment flows continue to use NOWPayments until the production rollout is explicitly enabled.

## Deployment order

1. Apply `migrations/0029_creem_credit_topup_idempotency.sql`.
2. Apply `migrations/0030_creem_reversals_and_event_ids.sql`.
3. Store `CREEM_API_KEY` and `CREEM_WEBHOOK_SECRET` with `wrangler secret put`; never add either value to `wrangler.toml` or source control.
4. Configure `CREEM_TEST_READER_EMAILS` with the comma-separated reader emails allowed to reach Creem Test Mode.
5. Deploy the Worker.
6. In the Creem Test Mode dashboard, register `https://wwwstationcat.org/api/novels/webhooks/creem` and subscribe to `checkout.completed`, `refund.created`, and `dispute.created`.
7. Complete a test purchase, resend its webhook once, and verify that exactly 100 points are credited once.
8. Create a test refund and verify that exactly 100 points are reversed once.

## Non-secret configuration

- `CREEM_MODE`: `test` during the guarded rollout; use `production` only after production credentials and product IDs are ready.
- `CREEM_CREDIT_PACK_PRODUCT_ID`: the Creem product ID for the 100-point pack.
- `CREEM_CREDIT_PACK_CREDITS`: must match the D1 pack credit quantity.
- `CREEM_CREDIT_PACK_PRICE_USD`: must match the D1 pack USD price.
- `CREEM_API_BASE`: optional API endpoint override for local testing only.
- `CREEM_SITE_URL`: optional public site origin override.

The checkout gate also requires the live D1 pack to match the configured Creem product exactly. Missing credentials, a mismatched pack, or a reader outside the Test Mode allowlist causes the request to stay on the existing NOWPayments path.

## Webhook and reversal behavior

Creem signatures are verified against the unmodified request body using HMAC-SHA256. Supported events require a unique Creem event ID, matching mode, product, amount, currency, and customer. Permanent validation failures are acknowledged with HTTP 200 and a `rejected` reason so Creem does not repeatedly deliver an event that cannot become valid.

Credit grants and reversals are transactional and idempotent. A refund or dispute creates one `reversal` ledger entry for the original order. If the points have already been spent, the full reversal is still applied and the account balance becomes negative; this visible negative balance is the outstanding Station Points debt and prevents further redemptions until repaid. A reversal arriving before the completion event creates a zero-delta marker so a later completion event cannot grant points for an already reversed payment.

Test and production event modes are canonicalized as follows:

- `test`, `sandbox`, and `local` map to `test`.
- `production`, `prod`, and `live` map to `production`.

Do not use a Test Mode webhook secret for the production endpoint.
