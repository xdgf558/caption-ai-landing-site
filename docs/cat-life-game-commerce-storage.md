# Cat Life Game commerce storage

Task 2 adds the private persistence and Station Points transaction layer for the Cat Life Game commerce contract. It does not expose catalog or redemption HTTP routes and does not activate either launch product.

## Migration

Apply `migrations/0033_cat_life_game_commerce.sql` only after the reader account and Station Points migrations. It creates `game_products`, `game_purchases`, `game_entitlements`, and `game_commerce_events`, then inserts the two version 1 catalog records with `planned` status. The seed uses `INSERT OR IGNORE`, so rerunning it cannot overwrite an administrator's later lifecycle or pricing decision.

The migration adds a game-specific uniqueness constraint to `reader_credit_ledger`. A purchase and its corrective reversal use the opaque server purchase ID as `source_ref`, with distinct entry types.

## Transaction behavior

`redeemCatLifeProduct` accepts only a trusted account ID, a product ID, and an idempotency key. A caller cannot provide the charged price or entitlement key. The database selects both values from an `active` `game_products` row.

The D1 batch inserts the pending purchase snapshot, performs a compare-and-swap balance deduction, appends the negative ledger entry, grants the entitlement, completes the purchase, and writes the commerce event. The final event insert has a non-null transaction guard: if any preceding condition did not complete, its constraint failure rolls the entire batch back. Database uniqueness protects the account idempotency key, completed permanent purchase, active entitlement, ledger reference, and audit event.

`reverseCatLifePurchase` is a private support primitive for later Admin APIs. It requires a reason, revokes the entitlement, restores the exact snapshot price, appends a positive ledger entry, and preserves the purchase and event history. Repeating either a successful purchase key or a completed correction returns the stored result without changing the balance again.

## Release boundary

Task 3 exposes these functions through the routes documented in `docs/cat-life-game-commerce-api.md`, and Task 4 adds the protected controls documented in `docs/cat-life-game-commerce-admin.md`. No public route imports client prices or local game state, and both products remain `planned`. Production deployment order is migration `0033`, migration `0034`, migration `0035`, then the Worker; the Worker must not be deployed until the migrations required by the selected release have completed successfully.
