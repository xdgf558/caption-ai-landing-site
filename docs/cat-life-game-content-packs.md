# Cat Life Game content packs

## Public content manifest

`public/games/cat-life/content-manifest.js` is the single client-side source for owned-content rendering. It is loaded before the room system and commerce client, recursively frozen at runtime, and contains only stable content metadata:

- product and entitlement identifiers;
- catalog artwork and intrinsic image dimensions;
- cat targets and replacement sprites;
- room option values and translation keys;
- fixture assets, display conditions, and furniture layout coordinates.

The manifest must never contain Station Points prices, balances, lifecycle state, redeemability, or ownership. The Worker catalog remains authoritative for commercial state, while `/api/games/cat-life/entitlements` remains authoritative for account ownership.

## Version 1.19.0 packs

`cat-life.skin.moonlit-tabby` replaces the rendered sprite for `cat_001` only when `cat-life.cosmetic.skin.moonlit-tabby.v1` is active for the current account and the member has selected that appearance. It does not change stats, rewards, or save progression.

`cat-life.bundle.station-room` grants one coordinated room theme under `cat-life.content.furniture.station-room.v1`. The theme includes station-green walls, striped flooring, station signal decor, a waiting-room layout, and three actual fixtures:

- `station-bench.png` for the waiting-room layout;
- `station-signal-lamp.png` for station signal decor;
- `station-clock-board.png` for station-green walls.

The room renderer first sanitizes all room values through the currently available options. It then renders fixtures only when the official entitlement is present and each fixture's `when` rule matches the sanitized room scene. Editing a local save can therefore request a premium value but cannot make that value or its assets survive the entitlement gate.

## Adding content

Add new assets under `public/games/cat-life/src/assets/premium/`, declare their intrinsic dimensions and conditions in the manifest, and update the relevant renderer without duplicating entitlement keys or asset paths elsewhere. Add the product page media only after the final asset exists. Every content change must update the public game version and localized `releaseNotes` in `src/js/core/namespace.js`.

Run `node scripts/test-cat-life-content-manifest.mjs`, `npm test`, and the Cat Life commerce browser tests. Verify both an entitled account and a forged guest save at desktop and 390px widths. Shipping assets does not activate a product: the server catalog remains `planned` until an operator explicitly completes the release checklist and activates the exact product in Admin.
