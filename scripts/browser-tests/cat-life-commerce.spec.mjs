import { expect, test } from '@playwright/test';

const account = {
  id: 17,
  email: 'commerce-player@example.com',
  username: 'commerceplayer',
  displayName: 'Commerce Player'
};

const skinProduct = {
  productId: 'cat-life.skin.moonlit-tabby',
  gameKey: 'cat-life',
  productType: 'cosmetic-skin',
  name: 'Moonlit Tabby',
  pointsPrice: 10,
  lifecycleStatus: 'active',
  entitlementKey: 'cat-life.cosmetic.skin.moonlit-tabby.v1',
  catalogRevision: 1,
  owned: false,
  redeemable: true,
  entitlement: null
};

const roomProduct = {
  productId: 'cat-life.bundle.station-room',
  gameKey: 'cat-life',
  productType: 'furniture-theme',
  name: 'Station Room Set',
  pointsPrice: 25,
  lifecycleStatus: 'active',
  entitlementKey: 'cat-life.content.furniture.station-room.v1',
  catalogRevision: 1,
  owned: true,
  redeemable: false,
  entitlement: { id: 'ent_room', purchaseId: 'clp_room', grantedAt: '2026-08-30T12:00:00.000Z', expiresAt: null }
};

const entitlementFor = (product) => ({
  id: `ent_${product.productId}`,
  entitlementKey: product.entitlementKey,
  productId: product.productId,
  productType: product.productType,
  productName: product.name,
  purchaseId: `clp_${product.productId}`,
  grantSource: 'station-points',
  lifecycleStatus: product.lifecycleStatus,
  catalogRevision: 1,
  grantedAt: '2026-08-30T12:00:00.000Z',
  expiresAt: null,
  active: true
});

async function mockCloudGuest(page) {
  await page.route('**/api/readers/session', (route) => route.fulfill({
    json: { ok: true, authenticated: false, account: null }
  }));
}

async function mockCloudMember(page) {
  await page.addInitScript(() => localStorage.setItem('catGameGuestSaveClaimV1', 'another-account'));
  await page.route('**/api/readers/session', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account }
  }));
  await page.route('**/api/readers/game-saves/cat-life', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account, save: null }
  }));
}

test('redeems an active skin with server data only and applies the official entitlement', async ({ page }) => {
  let owned = false;
  let redemptionBody = null;
  await mockCloudMember(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: {
      ok: true,
      authenticated: true,
      account,
      balance: owned ? 90 : 100,
      products: [{ ...skinProduct, owned, redeemable: !owned }]
    }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: {
      ok: true,
      authenticated: true,
      account,
      balance: owned ? 90 : 100,
      entitlements: owned ? [entitlementFor(skinProduct)] : []
    }
  }));
  await page.route('**/api/games/cat-life/redemptions', async (route) => {
    redemptionBody = route.request().postDataJSON();
    owned = true;
    await route.fulfill({
      json: {
        ok: true,
        authenticated: true,
        account,
        balance: 90,
        replayed: false,
        purchase: { id: 'clp_skin', productId: skinProduct.productId, pointsSpent: 10, status: 'completed' },
        entitlement: entitlementFor(skinProduct)
      }
    });
  });

  await page.goto('/games/cat-life/?lang=en');
  await page.locator('[data-page-target="shop"]').first().click();
  await expect(page.locator('[data-cat-commerce-section]')).toContainText('Moonlit Tabby');
  await page.locator('[data-cat-commerce-action="confirm"]').click();
  await expect(page.locator('[data-cat-commerce-dialog]')).toBeVisible();
  await expect(page.locator('[data-cat-commerce-copy]')).toContainText('10 Station Points');
  await page.locator('[data-cat-commerce-confirm]').click();
  await expect(page.locator('[data-cat-commerce-section]')).toContainText('Owned');

  expect(Object.keys(redemptionBody).sort()).toEqual(['idempotencyKey', 'productId']);
  expect(redemptionBody.productId).toBe(skinProduct.productId);
  expect(redemptionBody.idempotencyKey).toMatch(/^clg_/);

  await page.locator('[data-cat-commerce-action="toggle-skin"]').click();
  expect(await page.evaluate(() => {
    const cat = window.CatGame.state.game.cats.find((entry) => entry.id === 'cat_001');
    return window.CatGameCommerce.getCatSprite(cat);
  })).toContain('/src/assets/premium/moonlit-tabby.png');
});

test('shows active products to guests but routes redemption through member sign-in', async ({ page }) => {
  let posted = false;
  await mockCloudGuest(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, products: [skinProduct] }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, entitlements: [] }
  }));
  await page.route('**/api/games/cat-life/redemptions', (route) => {
    posted = true;
    return route.abort();
  });

  await page.goto('/games/cat-life/?lang=en');
  await page.locator('[data-page-target="shop"]').first().click();
  const signIn = page.locator('[data-cat-commerce-section] a', { hasText: 'Sign in to redeem' });
  await expect(signIn).toHaveAttribute('href', /\/en\/library\/\?returnTo=/);
  expect(posted).toBe(false);
});

test('unlocks the complete station room option set from an account entitlement', async ({ page }) => {
  await mockCloudMember(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account, balance: 100, products: [roomProduct] }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account, balance: 100, entitlements: [entitlementFor(roomProduct)] }
  }));

  await page.goto('/games/cat-life/?lang=en');
  await expect.poll(() => page.evaluate(() => window.CatGameCommerce.hasEntitlement('cat-life.content.furniture.station-room.v1'))).toBe(true);
  expect(await page.evaluate(() => window.CatGame.systems.homeSystem.getRoomWallOptions().map((item) => item.value))).toContain('station-green');
  expect(await page.evaluate(() => window.CatGame.systems.homeSystem.getRenderableRoomScene({
    wall: 'station-green', floor: 'station-stripe', decor: 'station-signal', layout: 'station-waiting'
  }))).toEqual({ wall: 'station-green', floor: 'station-stripe', decor: 'station-signal', layout: 'station-waiting' });

});

test('keeps forged premium room values visually locked for a guest and fits mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('catGameSaveV1', JSON.stringify({
      version: '1.18.0',
      schemaVersion: 2,
      meta: { createdAt: new Date().toISOString() },
      player: { name: 'Guest', gold: 500 },
      home: { roomScene: { wall: 'station-green', floor: 'station-stripe', decor: 'station-signal', layout: 'station-waiting' } },
      settings: { language: 'en' }
    }));
  });
  await mockCloudGuest(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, products: [] }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, entitlements: [] }
  }));

  await page.goto('/games/cat-life/?lang=en');
  const scene = await page.evaluate(() => window.CatGame.systems.homeSystem.getRenderableRoomScene(
    window.CatGame.state.game.home.roomScene
  ));
  expect(scene).toEqual({ wall: 'sunny', floor: 'oak', decor: 'plants', layout: 'cozy' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
