import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const catalog = JSON.parse(read('src/data/products/cat-life-game-commerce.v1.json'));
const contract = read('docs/cat-life-game-commerce-v1.md');
const locales = ['en', 'ja', 'zh-Hans', 'zh-Hant'];
const productIdPattern = /^cat-life\.(?:skin|furniture|bundle|map|story|feature)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const entitlementKeyPattern = /^cat-life\.(?:cosmetic|content|feature)\.[a-z0-9]+(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+\.v\d+$/;

assert.equal(catalog.schemaVersion, 1);
assert.equal(catalog.catalogRevision, 1);
assert.equal(catalog.gameKey, 'cat-life');
assert.equal(catalog.catalogStatus, 'planned');
assert.equal(catalog.pointsUnit, 'Station Points');
assert.equal(catalog.ownershipScope, 'account');
assert.equal(catalog.entitlementMode, 'perpetual');
assert.equal(catalog.transferable, false);
assert.equal(catalog.launchProducts.length, 2);

const productIds = new Set();
const entitlementKeys = new Set();
for (const product of catalog.launchProducts) {
  assert.match(product.productId, productIdPattern);
  assert.match(product.entitlementKey, entitlementKeyPattern);
  assert.equal(product.saleStatus, 'planned', 'design-only products must not become purchasable');
  assert.equal(Number.isInteger(product.pointsPrice), true);
  assert.equal(product.pointsPrice > 0, true);
  assert.equal(productIds.has(product.productId), false, `duplicate product id: ${product.productId}`);
  assert.equal(entitlementKeys.has(product.entitlementKey), false, `duplicate entitlement key: ${product.entitlementKey}`);
  productIds.add(product.productId);
  entitlementKeys.add(product.entitlementKey);

  const band = catalog.pricingBands[product.productType];
  assert.ok(band, `missing price band for ${product.productType}`);
  assert.equal(product.pointsPrice >= band.minimumPoints, true);
  assert.equal(product.pointsPrice <= band.maximumPoints, true);
  assert.deepEqual(Object.keys(product.names).sort(), locales);
  for (const locale of locales) assert.equal(Boolean(product.names[locale]?.trim()), true);
}

assert.deepEqual(
  catalog.launchProducts.map(({ productId, pointsPrice }) => ({ productId, pointsPrice })),
  [
    { productId: 'cat-life.skin.moonlit-tabby', pointsPrice: 10 },
    { productId: 'cat-life.bundle.station-room', pointsPrice: 25 }
  ]
);

for (const forbidden of [
  'game_gold',
  'energy',
  'cat_stats',
  'lottery_tickets',
  'lottery_results',
  'chance_outcomes',
  'station_points_exchange'
]) {
  assert.equal(catalog.forbiddenRedemptions.includes(forbidden), true, `${forbidden} must stay outside commerce`);
}

assert.match(contract, /All steps succeed or none do\./);
assert.match(contract, /game_entitlements/);
assert.match(contract, /Repeating the same idempotency key returns the original completed result\./);
assert.match(contract, /negative or insufficient balance blocks new redemptions/);
assert.match(contract, /update the in-game version history/);
assert.match(contract, /both launch products remain `planned`/);
assert.match(contract, /None of those values can create Station Points, a server entitlement/);
assert.match(contract, /ignore prices, entitlement keys, item quantities, balance values, game gold, lottery state/);

console.log('Cat Life Game commerce contract tests passed.');
