# Cat Life Game commerce and entitlement contract v1

## Status and scope

This document fixes the product and authorization rules for the first Station Points integration in Cat Life Game. It is a design contract for the database, APIs, Admin workspace, game client, and release tests that follow. It does not enable a public product, create a database table, deduct points, or expose a redemption button by itself.

The machine-readable companion is `server/catalog/cat-life-game-commerce.v1.json`. It is Worker seed input, not product-page or game-client data, and must never be bundled into a public response. Its launch products stay `planned` until the database migration, server redemption path, Admin controls, final assets, browser tests, and production rollout have all shipped. A planned product must never appear in a purchasable API response.

## Trust boundary

Game gold, energy, mood, cat statistics, inventory, work rewards, lottery tickets, lottery results, and other simulation state run in the browser and can be changed by the player. None of those values can create Station Points, a server entitlement, a refund, a transferable item, or any other real account right.

The Station Cat backend is authoritative for all of the following:

- the active product catalog and current Station Points price;
- the member account and available Station Points balance;
- point deductions and corrective point restorations;
- purchase idempotency and purchase history;
- entitlement grants, revocations, expiry, and account ownership;
- the official cross-device collection shown by the website and cloud save service.

The game may cache and render the last entitlement response for offline play. A player may also modify local files or JavaScript and make a cosmetic appear on that browser. Such a local modification never becomes an official entitlement, cannot enter the account collection, cannot be transferred to another account, and must not be accepted by a server API as proof of ownership.

## Product model

Every sellable item has two immutable identifiers:

- `productId` identifies the commercial offer and its purchase history.
- `entitlementKey` identifies the account capability granted by that offer.

Identifiers are lowercase, dot-separated, never reused, and never renamed after the first production sale. Display names, descriptions, art, and price may change through a new catalog revision, but a purchase stores the exact product ID, entitlement key, points price, and catalog revision that the member confirmed.

Version 1 grants only permanent, account-scoped, non-transferable entitlements. It does not support gifts, resale, account-to-account transfer, consumables, random rewards, subscriptions, expiry, or quantities greater than one. A permanent entitlement can be owned once; repurchasing it returns `ALREADY_OWNED` and deducts zero points.

### Product lifecycle

| Status | Guest or new-buyer catalog | Existing owner's account catalog | Redeemable | Meaning |
| --- | --- | --- | --- | --- |
| `planned` | No | No | No | Design or assets are incomplete. |
| `active` | Yes | Yes | Yes | Backend and game release both support the entitlement. |
| `paused` | No | Yes, marked owned and unavailable | No | Temporarily unavailable for new purchases. |
| `retired` | No | Yes, marked owned and retired | No | No new purchases; existing owners keep access. |

The unauthenticated catalog and a signed-in catalog for an account that does not own the product return only `active` products. A signed-in owner's response additionally joins that account's `paused` and `retired` entitlements to archival product presentation, with `owned: true`, the lifecycle status, and `redeemable: false`. Pausing or retiring a product never removes its entitlement key from the ownership response or content manifest.

Products are never deleted after a purchase. A retired product remains resolvable for history, recovery, and customer support. Changing a product from `planned` to `active` is a production release decision and requires the security checklist below.

## Initial catalog and price bands

The first release validates one single cosmetic and one bundle. Names are working product names that may be edited before activation; IDs and entitlement keys are the implementation contract.

| Product ID | Type | Entitlement key | Price | Initial status |
| --- | --- | --- | ---: | --- |
| `cat-life.skin.moonlit-tabby` | Cat skin | `cat-life.cosmetic.skin.moonlit-tabby.v1` | 10 points | `planned` |
| `cat-life.bundle.station-room` | Furniture theme bundle | `cat-life.content.furniture.station-room.v1` | 25 points | `planned` |

Future price guidance is 5-10 points for one skin or furniture item, 20-30 points for a furniture theme bundle, and 40-80 points for a substantial map or story expansion. These are product bands, not a client-side pricing source. Only the current server catalog price can be charged.

The Station Room Set is one commercial entitlement. Its content manifest may expand to multiple furniture asset keys, but the owned entitlement remains the immutable v1 pack key. Adding materially new paid content later should use a new pack and entitlement key instead of silently changing what a past purchase means.

## Redemption transaction

The future redemption endpoint accepts only `productId` and a caller-generated `idempotencyKey`. It must ignore prices, entitlement keys, item quantities, balance values, game gold, lottery state, and other client claims.

For an authenticated account, the server first looks up `(account_id, idempotency_key)`. A completed request for the same product returns its original purchase, entitlement, ledger, and balance result before checking current ownership. Reusing the key for a different product returns `IDEMPOTENCY_CONFLICT`. This ordering ensures a successful retry never degrades into `ALREADY_OWNED`.

For a new key, the server generates the opaque purchase ID before starting the D1 transaction. One transaction must then:

1. claim the account-scoped idempotency key by inserting the purchase ID and an immutable snapshot selected from an `active` server product;
2. reject an existing permanent entitlement without charging;
3. verify the current Station Points balance;
4. append one negative `reader_credit_ledger` entry using the already-generated purchase ID as `source_ref`;
5. update the points balance;
6. mark the purchase completed;
7. grant the `game_entitlements` row;
8. append an audit event.

All steps succeed or none do. The idempotency insert has a database uniqueness constraint. If a concurrent request loses that race, it reads and returns the winning request's original result after the transaction completes. Concurrent requests with different keys for the same product may create only one completed purchase, one points deduction, and one active entitlement; the losing request resolves to `ALREADY_OWNED` without charging.

Recommended public errors are `SIGN_IN_REQUIRED`, `PRODUCT_NOT_AVAILABLE`, `ALREADY_OWNED`, `INSUFFICIENT_POINTS`, `IDEMPOTENCY_CONFLICT`, `REDEMPTION_CONFLICT`, and `REDEMPTION_NOT_READY`. The client must show the server balance and server price returned after the transaction rather than calculate either locally.

## Planned persistence contract

Task 2 should introduce three independent records rather than adding game columns to `novel_entitlements`:

- `game_products`: immutable IDs, game key, type, current points price, lifecycle status, entitlement key, localized presentation, catalog revision, and timestamps;
- `game_purchases`: account, product snapshot, points spent, idempotency key, status, ledger reference, and timestamps;
- `game_entitlements`: account, game key, entitlement key, source purchase, grant/revoke metadata, optional expiry for future versions, and timestamps.

Required uniqueness includes `(account_id, idempotency_key)` for requests, one completed permanent purchase per `(account_id, product_id)`, and one active grant per `(account_id, game_key, entitlement_key)`. Database constraints are the final concurrency guard; a check followed by an insert is not sufficient.

## Refunds, reversals, and support corrections

Redeeming Station Points for a digital game entitlement is final after grant except where applicable law requires otherwise or support is correcting an error. There is no client-side self-service refund in v1.

An approved correction must revoke the entitlement and restore exactly the points captured in the purchase snapshot in one idempotent server transaction. It keeps the purchase, ledger, and audit history. Administrators must provide a reason; rows are not deleted. Fraud or chargeback handling may revoke rights through the same audited path.

A later refund of a Station Points payment pack does not trust the game client and does not mint or refund game value. The existing payment reversal adjusts the Station Points account and may leave a negative balance after points were spent. A negative or insufficient balance blocks new redemptions. Any associated entitlement review or revocation is a separate server-side support decision with an audit record.

## Game and Admin behavior

Guests may preview products but must sign in through the existing locale-matched member-center return flow before redeeming. Signed-in players see the server balance, ownership state, price, and a confirmation step. The game can use cached ownership while offline, but redemption and restoration require the server.

Admin must be able to activate, pause, and retire products; inspect purchases and point ledger references; grant or revoke an entitlement with a reason; and perform an idempotent corrective reversal. Admin cannot edit an immutable product ID or entitlement key after activation.

Every release that adds game products or changes owned content must also update the in-game version history with the version number, release date, and localized change notes.

## Activation checklist

A product may become `active` only after all of these are true:

- the D1 migration and rollback-safe deployment order are documented;
- catalog, ownership, redemption, corrective reversal, and Admin APIs are deployed;
- point deduction plus entitlement grant is atomic and idempotent;
- asset manifests and the game renderer recognize the entitlement key;
- no game-local value can be submitted as proof of price or ownership;
- tests cover tampered prices, local save edits, insufficient points, duplicate requests, concurrent requests, account isolation, pause/retire behavior, and corrective reversal;
- desktop and mobile browser tests cover sign-in return, purchase confirmation, cross-device ownership, offline cache, and version history;
- public Station Points rules and the product page disclose the exact item, price, permanence, and refund boundary.

Until this checklist passes, both launch products remain `planned`, no redemption route is exposed, and no production balance can be charged.
