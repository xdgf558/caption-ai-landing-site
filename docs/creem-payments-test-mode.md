# Creem Station Points payments

This integration handles the 100 Station Points / USD 10 one-time product through Creem. Station Points purchases use Creem exclusively: the member center no longer exposes cryptocurrency network selection, and a missing or mismatched Creem configuration disables checkout instead of falling back to NOWPayments. Legacy NOWPayments code remains for historical orders and unrelated payment flows.

## Production resources

- Product: `Station Points 100` (`prod_3NnsiVBFubZ3DslDdBxPf6`)
- Webhook: `Station Cat Production Payments` (`wh_1BjIPvma3ajzWnUVdEGQpF`)
- Webhook endpoint: `https://wwwstationcat.org/api/novels/webhooks/creem`
- Events: `checkout.completed`, `refund.created`, and `dispute.created`

Production API and webhook secrets live in Cloudflare Worker secrets. The Test Mode product and webhook remain available for isolated regression testing.

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

The checkout gate also requires the live D1 pack to match the configured Creem product exactly. Missing credentials or a mismatched pack disables Station Points checkout. The reader allowlist is enforced only in Test Mode; production checkout is available to signed-in readers.

## Webhook and reversal behavior

Creem signatures are verified against the unmodified request body using HMAC-SHA256. Supported events require a unique Creem event ID, matching mode, product, amount, currency, and customer. Permanent validation failures are acknowledged with HTTP 200 and a `rejected` reason so Creem does not repeatedly deliver an event that cannot become valid.

Credit grants and reversals are transactional and idempotent. Recording a provider event does not short-circuit fulfillment, so a Creem retry can resume safely if an earlier delivery stopped after recording the event but before updating the points ledger. A refund or dispute creates one `reversal` ledger entry for the original order. If the points have already been spent, the full reversal is still applied and the account balance becomes negative; this visible negative balance is the outstanding Station Points debt and prevents further redemptions until repaid. `lifetime_purchased_credits` remains the historical gross number of purchased points and is not reduced by reversals.

The Test Mode product is an indivisible 100-point pack. Any successful refund event, including a partial monetary refund, revokes the full 100-point pack; proportional point reversals are not implemented. A reversal arriving before the completion event creates a zero-delta marker so a later completion event cannot grant points for an already reversed payment.

Test and production event modes are canonicalized as follows:

- `test`, `sandbox`, and `local` map to `test`.
- `production`, `prod`, and `live` map to `production`.

Do not use a Test Mode webhook secret for the production endpoint.
