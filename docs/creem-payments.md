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
4. For Test Mode, configure `CREEM_TEST_READER_EMAILS` with the comma-separated reader emails allowed to reach checkout.
5. For a production gray rollout, optionally configure `CREEM_PRODUCTION_READER_EMAILS`. When this list is non-empty, only the listed signed-in readers can create production checkouts. Leave it empty for normal public sales.
6. Deploy the Worker.
7. In the matching Creem environment, register `https://wwwstationcat.org/api/novels/webhooks/creem` and subscribe to `checkout.completed`, `refund.created`, and `dispute.created`.
8. Complete a purchase, resend its webhook once, and verify that exactly 100 points are credited once.
9. Create a refund and verify that exactly 100 points are reversed once.

## Non-secret configuration

- `CREEM_MODE`: `test` during the guarded rollout; use `production` only after production credentials and product IDs are ready.
- `CREEM_CREDIT_PACK_PRODUCT_ID`: the Creem product ID for the 100-point pack.
- `CREEM_CREDIT_PACK_CREDITS`: must match the D1 pack credit quantity.
- `CREEM_CREDIT_PACK_PRICE_USD`: must match the D1 pack USD price.
- `CREEM_API_BASE`: optional API endpoint override for local testing only.
- `CREEM_SITE_URL`: optional public site origin override.
- `CREEM_PRODUCTION_READER_EMAILS`: optional comma-separated production gray-rollout allowlist. An empty value means all signed-in readers may buy.
- `PAYMENT_ALERT_EMAILS`: optional comma-separated recipients for rejected Creem webhooks or failed points fulfillment. It falls back to `ADMIN_ALLOWED_EMAILS`.

The checkout gate requires the live D1 pack to match the configured Creem product exactly. Before creating an order, the Worker also retrieves the Creem product and verifies its ID, environment, active status, one-time billing type, USD currency, and price in cents. A lookup failure or mismatch closes checkout before the customer can pay.

## Production go-live check

Before opening production checkout to all readers, use the real production product for one USD 10 purchase and then refund it. Verify all of the following:

- Creem charged USD 10 for `prod_3NnsiVBFubZ3DslDdBxPf6`.
- `checkout.completed` reached the production webhook and credited exactly 100 points once.
- Resending the same event did not add a second ledger entry.
- The refund event deducted exactly 100 points once and changed the order to `refunded`.
- The production dashboard, order detail, payment event status, and reader ledger agree.

This real purchase is the final check for credentials, webhook signing, product configuration, fulfillment, and reversal. Static configuration checks cannot replace it.

## Production rollback

To stop new Station Points purchases, remove or rotate `CREEM_API_KEY` and redeploy. Keep `CREEM_WEBHOOK_SECRET` configured so already-created checkouts can still deliver completion, refund, and dispute events. Do not change the product ID, price, or webhook secret until in-flight orders have settled.

Rejected webhook validation is stored as `rejected:<reason>` in `novel_payment_events.status`; fulfillment exceptions are stored as `fulfillment_failed:<code>`. The first delivery sends an administrator email, while duplicate deliveries continue through the idempotent recovery path without repeating the alert. Also review finished Creem credit-pack orders without a matching `creem-credit-pack` top-up ledger entry during the daily payment check.

## Webhook and reversal behavior

Creem signatures are verified against the unmodified request body using HMAC-SHA256. Supported events require a unique Creem event ID, matching mode, product, amount, currency, and customer. Permanent validation failures are acknowledged with HTTP 200 and a `rejected` reason so Creem does not repeatedly deliver an event that cannot become valid.

Credit grants and reversals are transactional and idempotent. Recording a provider event does not short-circuit fulfillment, so a Creem retry can resume safely if an earlier delivery stopped after recording the event but before updating the points ledger. A refund or dispute creates one `reversal` ledger entry for the original order. If the points have already been spent, the full reversal is still applied and the account balance becomes negative; this visible negative balance is the outstanding Station Points debt and prevents further redemptions until repaid. `lifetime_purchased_credits` remains the historical gross number of purchased points and is not reduced by reversals.

### Known refund limitation

The product is an indivisible 100-point pack. Any successful refund event, including a partial monetary refund, revokes the full 100-point pack; proportional point reversals are not implemented. A reversal arriving before the completion event creates a zero-delta marker so a later completion event cannot grant points for an already reversed payment.

Test and production event modes are canonicalized as follows:

- `test`, `sandbox`, and `local` map to `test`.
- `production`, `prod`, and `live` map to `production`.

Do not use a Test Mode webhook secret for the production endpoint.
