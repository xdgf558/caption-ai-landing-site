# Cat Life Game commerce API

Task 3 exposes the authenticated server boundary on top of the Task 2 storage transactions. It does not activate a product or add a purchase button to the game.

## Routes

- `GET /api/games/cat-life/catalog?locale=zh-Hant` returns only active products for guests and non-owning members. A signed-in owner also receives owned paused or retired products, marked non-redeemable.
- `GET /api/games/cat-life/entitlements?locale=zh-Hant` returns the current account's active, unexpired server entitlements. Guests receive an empty list with `authenticated: false` so local play can continue without treating sign-out as an API failure.
- `POST /api/games/cat-life/redemptions` accepts only `productId` and `idempotencyKey` as transaction inputs. It requires an active Station Cat session, an exact same-origin `Origin`, JSON content type, and a bounded request body.

The redemption handler never forwards a client `purchaseId`, price, entitlement key, game currency, lottery result, or save data to the transaction module. The transaction creates its purchase ID with Web Crypto and selects price and entitlement data from D1.

Responses use stable error codes for client localization. Business conflicts return HTTP 409, authentication failures return 401, origin failures return 403, and missing migrations return `REDEMPTION_NOT_READY` with HTTP 503. Valid redemption attempts are limited to 10 per account in a 60-second fixed window; malformed and oversized requests are rejected before consuming the quota.

## Deployment order

1. Apply `migrations/0033_cat_life_game_commerce.sql`.
2. Apply `migrations/0034_cat_life_game_commerce_api.sql`.
3. Apply `migrations/0035_cat_life_game_commerce_admin.sql` when deploying the Admin workspace.
4. Deploy the Worker.

Both launch products remain `planned`. The catalog therefore stays empty in production until a later reviewed release ships the game assets, Admin activation controls, client purchase confirmation, and version-history entry.
