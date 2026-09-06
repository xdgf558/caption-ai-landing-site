import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gameRoot = join(root, 'public/games/cat-life');
const source = readFileSync(join(gameRoot, 'content-manifest.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

const api = context.window.CatGameContentManifest;
const manifest = api.manifest;
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.releaseVersion, '1.25.0');
assert.equal(manifest.products.length, 2);
assert.equal(Object.isFrozen(manifest), true);
assert.equal(Object.isFrozen(manifest.products), true);
assert.equal(Object.isFrozen(api.productsById), true);

const productIds = manifest.products.map((product) => product.productId);
const entitlementKeys = manifest.products.map((product) => product.entitlementKey);
assert.equal(new Set(productIds).size, productIds.length);
assert.equal(new Set(entitlementKeys).size, entitlementKeys.length);

const forbiddenCommercialKeys = new Set([
  'price',
  'pointsPrice',
  'balance',
  'lifecycleStatus',
  'redeemable',
  'owned',
]);
function inspectKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenCommercialKeys.has(key), false, `${key} must stay server-authoritative`);
    inspectKeys(child);
  }
}
inspectKeys(manifest);

const skinProduct = api.getProduct('cat-life.skin.moonlit-tabby');
assert.equal(skinProduct.kind, 'skin');
assert.equal(api.getSkin(skinProduct.productId, 'cat_001').sprite, 'src/assets/premium/moonlit-tabby.png');
assert.equal(api.getSkin(skinProduct.productId, 'cat_001').walkSprite, 'src/assets/cats/moonlit-tabby-walk.png');
assert.equal(api.getSkin(skinProduct.productId, 'cat_002'), null);

const roomProduct = api.getProduct('cat-life.bundle.station-room');
assert.equal(roomProduct.kind, 'room');
assert.equal(roomProduct.image, 'src/assets/premium/station-room-preview.webp');
const preview = await sharp(join(gameRoot, roomProduct.image)).metadata();
assert.equal(preview.format, 'webp');
assert.equal(preview.width, roomProduct.imageSize.width);
assert.equal(preview.height, roomProduct.imageSize.height);
assert.ok(readFileSync(join(gameRoot, roomProduct.image)).length < 100000, 'Room preview must stay below 100 KB');
assert.deepEqual(
  Object.fromEntries(Object.entries(roomProduct.roomTheme.options).map(([key, option]) => [key, option.value])),
  {
    wall: 'station-green',
    floor: 'station-stripe',
    decor: 'station-signal',
    layout: 'station-waiting',
  }
);
assert.deepEqual(
  [...roomProduct.roomTheme.fixtures.map((fixture) => fixture.asset)].sort(),
  [
    'src/assets/premium/station-bench.png',
    'src/assets/premium/station-clock-board.png',
    'src/assets/premium/station-signal-lamp.png',
  ]
);
assert.equal(roomProduct.roomTheme.layoutPositions['station-waiting'].length, 4);

const assetPaths = new Set();
manifest.products.forEach((product) => {
  assetPaths.add(product.image);
  (product.skins || []).forEach((skin) => {
    assetPaths.add(skin.sprite);
    if (skin.walkSprite) assetPaths.add(skin.walkSprite);
  });
  (product.roomTheme?.fixtures || []).forEach((fixture) => assetPaths.add(fixture.asset));
});
for (const asset of assetPaths) {
  assert.equal(asset.startsWith('src/assets/'), true, `${asset} must remain inside the game asset tree`);
  assert.equal(existsSync(join(gameRoot, asset)), true, `${asset} must exist`);
}

assert.equal(api.getProduct('cat-life.unknown'), null);
assert.equal(api.getSkin('cat-life.unknown', 'cat_001'), null);

console.log('Cat Life Game content manifest tests passed.');
