import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [wrangler, catalogSource, releaseDoc, apiTest, browserTest] = await Promise.all([
  read('../wrangler.toml'),
  read('../server/catalog/cat-life-game-commerce.v1.json'),
  read('../docs/cat-life-game-commerce-release.md'),
  read('./test-cat-life-commerce-api.mjs'),
  read('./browser-tests/cat-life-commerce.spec.mjs')
]);

const catalog = JSON.parse(catalogSource);
assert.match(wrangler, /CAT_LIFE_COMMERCE_ROLLOUT_MODE\s*=\s*"off"/);
assert.doesNotMatch(wrangler, /CAT_LIFE_COMMERCE_ALLOWLIST\s*=/, 'member email allowlist must not be committed');
assert.equal(catalog.catalogStatus, 'planned');
assert.equal(catalog.launchProducts.every((product) => product.saleStatus === 'planned'), true);

for (const migration of ['0033', '0034', '0035']) {
  assert.match(releaseDoc, new RegExp('`' + migration + '`'));
}
for (const mode of ['off', 'allowlist', 'public']) {
  assert.match(releaseDoc, new RegExp('CAT_LIFE_COMMERCE_ROLLOUT_MODE=' + mode));
}

assert.match(apiTest, /missing rollout configuration must fail closed/);
assert.match(apiTest, /allowlist mode must not expose products to guests/);
assert.match(apiTest, /closed rollout must still replay a completed purchase safely/);
assert.match(browserTest, /does not reuse another account offline entitlement cache/);
assert.match(browserTest, /keeps the current account cosmetic offline without enabling redemption/);
assert.match(browserTest, /removes equipped premium visuals after the server revokes their entitlements/);
assert.match(browserTest, /expect\(redemptionRequests\)\.toBe\(1\)/);

console.log('Cat Life Game commerce release configuration tests passed.');
