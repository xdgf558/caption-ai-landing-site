# Cat Life Game commerce Admin

Task 4 adds the protected Admin 2.0 workspace and support APIs for the Cat Life Game catalog. It does not activate either launch product or add purchase controls to the game.

## Admin routes

All routes are below `/admin/api/games/cat-life/` and therefore pass through the existing Cloudflare Access gate. Every write also requires an exact same-origin `Origin`, JSON content type, and a request body no larger than 16 KB.

- `GET|POST products` lists and updates the server catalog. Product IDs and entitlement keys are never accepted as mutable fields. Moving a product into `active` requires the operator to submit the full product ID as a second confirmation. `retired` is terminal.
- `GET purchases` lists purchases or returns one purchase with its point ledger and commerce events.
- `POST purchases/reverse` performs the existing atomic corrective reversal. It revokes the purchased entitlement and restores exactly the points stored in the purchase snapshot.
- `GET entitlements` lists official game entitlements, including revoked records.
- `POST entitlements/grant` creates an audited manual entitlement for an existing active reader account. It creates no purchase and deducts no points.
- `POST entitlements/revoke` revokes only manual/admin entitlements with a reason and restores no points. Station Point purchase entitlements are rejected with `PURCHASE_REVERSAL_REQUIRED` and must use the atomic purchase correction route instead.

Product changes, grants, revocations, and purchase corrections also append the existing `admin_audit_logs` records. Manual entitlement grants and revocations have their own `game_entitlement_events` history so their support history does not depend only on the Admin UI.

## Migration and release order

Apply migrations in this order before deploying the Worker:

1. `0033_cat_life_game_commerce.sql`
2. `0034_cat_life_game_commerce_api.sql`
3. `0035_cat_life_game_commerce_admin.sql`
4. Worker and Admin 2.0 assets

Migration `0035` preserves existing purchased entitlements while allowing a manual Admin grant to have no purchase ID. It adds immutable grant reason and actor fields plus a separate entitlement event table.

Both launch products remain `planned` after this task. Activation is reserved for the later client-content release after assets, entitlement rendering, purchase confirmation, browser tests, public disclosures, and the in-game version-history entry are all approved.
