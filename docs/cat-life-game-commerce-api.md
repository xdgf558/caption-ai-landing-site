# Cat Life Game commerce API

Task 3 exposes the authenticated server boundary on top of the Task 2 storage transactions. Game version 1.18.0 consumes this API for the Task 5 storefront, but client code never activates a product or supplies a price.

## Routes

- `GET /api/games/cat-life/catalog?locale=zh-Hant` returns active products only when the server rollout permits that visitor. A signed-in owner continues to receive owned active, paused, or retired products when rollout is closed, always marked non-redeemable when no new purchase is allowed.
- `GET /api/games/cat-life/entitlements?locale=zh-Hant` returns the current account's active, unexpired server entitlements. Guests receive an empty list with `authenticated: false` so local play can continue without treating sign-out as an API failure.
- `POST /api/games/cat-life/redemptions` accepts only `productId` and `idempotencyKey` as transaction inputs. It requires an active Station Cat session, an exact same-origin `Origin`, JSON content type, and a bounded request body.

The redemption handler never forwards a client `purchaseId`, price, entitlement key, game currency, lottery result, or save data to the transaction module. The transaction creates its purchase ID with Web Crypto and selects price and entitlement data from D1.

Responses use stable error codes for client localization. Business conflicts return HTTP 409, authentication failures return 401, origin failures return 403, and missing migrations return `REDEMPTION_NOT_READY` with HTTP 503. Valid redemption attempts are limited to 10 per account in a 60-second fixed window; malformed and oversized requests are rejected before consuming the quota.

New purchases also require `CAT_LIFE_COMMERCE_ROLLOUT_MODE` to be `allowlist` for a listed member or `public`. Missing and invalid modes act as `off`. See `docs/cat-life-game-commerce-release.md` for the phased launch, monitoring, and kill-switch procedure.

## Deployment order

1. Apply `migrations/0033_cat_life_game_commerce.sql`.
2. Apply `migrations/0034_cat_life_game_commerce_api.sql`.
3. Apply `migrations/0035_cat_life_game_commerce_admin.sql` when deploying the Admin workspace.
4. Deploy the Worker.

Both launch products remain `planned` after the 1.18.0 client ships. The catalog therefore stays empty in production until an operator completes the activation checklist and explicitly activates a product through the protected Admin workspace. The client assets, purchase confirmation, entitlement-gated renderers, and localized version history may be deployed safely before that decision.
