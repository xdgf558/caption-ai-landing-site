import { expect, test } from '@playwright/test';

const account = {
  id: 17,
  email: 'commerce-player@example.com',
  username: 'commerceplayer',
  displayName: 'Commerce Player'
};

const secondAccount = {
  id: 18,
  email: 'second-commerce-player@example.com',
  username: 'secondplayer',
  displayName: 'Second Player'
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

async function mockCloudMember(page, member = account) {
  await page.addInitScript(() => localStorage.setItem('catGameGuestSaveClaimV1', 'another-account'));
  await page.route('**/api/readers/session', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account: member }
  }));
  await page.route('**/api/readers/game-saves/cat-life', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account: member, save: null }
  }));
}

test('redeems an active skin with server data only and applies the official entitlement', async ({ page }) => {
  let owned = false;
  let redemptionBody = null;
  let redemptionRequests = 0;
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
    redemptionRequests += 1;
    redemptionBody = route.request().postDataJSON();
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  await page.locator('[data-cat-commerce-confirm]').evaluate((button) => {
    button.click();
    button.click();
  });
  await expect(page.locator('[data-cat-commerce-section]')).toContainText('Owned');

  expect(redemptionRequests).toBe(1);
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
  await page.evaluate(() => {
    const preview = document.createElement('div');
    preview.id = 'station-room-test-preview';
    preview.innerHTML = window.CatGame.systems.homeSystem.renderRoomScene({
      wall: 'station-green', floor: 'station-stripe', decor: 'station-signal', layout: 'station-waiting'
    }, [], []);
    document.body.appendChild(preview);
  });
  await expect(page.locator('#station-room-test-preview .room-theme-fixture')).toHaveCount(3);
  await expect(page.locator('.room-theme-fixture--station-bench')).toHaveAttribute('src', /station-bench\.png$/);
  await expect(page.locator('.room-theme-fixture--station-signal-lamp')).toHaveAttribute('src', /station-signal-lamp\.png$/);
  await expect(page.locator('.room-theme-fixture--station-clock-board')).toHaveAttribute('src', /station-clock-board\.png$/);
});

test('keeps forged premium room values visually locked for a guest and fits mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('catGameSaveV1', JSON.stringify({
      version: '1.19.0',
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
  expect(await page.evaluate(() => {
    const preview = document.createElement('div');
    preview.innerHTML = window.CatGame.systems.homeSystem.renderRoomScene(
      window.CatGame.state.game.home.roomScene,
      [],
      []
    );
    return preview.querySelectorAll('.room-theme-fixture').length;
  })).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('does not reuse another account offline entitlement cache after an account switch', async ({ page }) => {
  await page.addInitScript(({ firstAccount, skinEntitlement }) => {
    localStorage.setItem('catGameCommerceLastAccountV1', String(firstAccount.id));
    localStorage.setItem(`catGameCommerceEntitlementsV1:${firstAccount.id}`, JSON.stringify({
      account: firstAccount,
      entitlements: [skinEntitlement],
      cachedAt: new Date().toISOString()
    }));
  }, { firstAccount: account, skinEntitlement: entitlementFor(skinProduct) });
  await mockCloudMember(page, secondAccount);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.abort('failed'));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.abort('failed'));

  await page.goto('/games/cat-life/?lang=en');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('catGameMemberAccountV1'))).toBe(String(secondAccount.id));
  await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status)).toBe('offline');
  expect(await page.evaluate(() => window.CatGameCommerce.hasEntitlement(
    'cat-life.cosmetic.skin.moonlit-tabby.v1'
  ))).toBe(false);
  expect(await page.evaluate(() => window.CatGameCommerce.getSnapshot().account)).toBeNull();
});

test('keeps the current account cosmetic offline without enabling redemption', async ({ page }) => {
  await page.addInitScript(({ member, skinEntitlement }) => {
    localStorage.setItem('catGameMemberAccountV1', String(member.id));
    localStorage.setItem('catGameCommerceLastAccountV1', String(member.id));
    localStorage.setItem(`catGameCommerceEntitlementsV1:${member.id}`, JSON.stringify({
      account: member,
      entitlements: [skinEntitlement],
      cachedAt: new Date().toISOString()
    }));
    localStorage.setItem(`catGameCommercePreferencesV1:${member.id}`, JSON.stringify({
      equippedSkin: 'cat-life.skin.moonlit-tabby'
    }));
  }, { member: account, skinEntitlement: entitlementFor(skinProduct) });
  await page.route('**/api/readers/session', (route) => route.abort('failed'));
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.abort('failed'));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.abort('failed'));

  await page.goto('/games/cat-life/?lang=en');
  await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().offlineCache)).toBe(true);
  expect(await page.evaluate(() => {
    const cat = window.CatGame.state.game.cats.find((entry) => entry.id === 'cat_001');
    return window.CatGameCommerce.getCatSprite(cat);
  })).toContain('/src/assets/premium/moonlit-tabby.png');
  expect(await page.evaluate(() => window.CatGameCommerce.getSnapshot().authenticated)).toBe(false);
  await page.locator('[data-page-target="shop"]').first().click();
  await expect(page.locator('[data-cat-commerce-section]')).not.toContainText('Redeem for');
});

test('removes equipped premium visuals after the server revokes their entitlements', async ({ page }) => {
  let owned = true;
  await mockCloudMember(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: {
      ok: true,
      authenticated: true,
      account,
      balance: 100,
      products: [
        { ...skinProduct, owned, redeemable: !owned },
        { ...roomProduct, owned, redeemable: !owned }
      ]
    }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: {
      ok: true,
      authenticated: true,
      account,
      balance: 100,
      entitlements: owned ? [entitlementFor(skinProduct), entitlementFor(roomProduct)] : []
    }
  }));

  await page.goto('/games/cat-life/?lang=en');
  await page.locator('[data-page-target="shop"]').first().click();
  await page.locator('[data-cat-commerce-action="toggle-skin"]').click();
  expect(await page.evaluate(() => {
    const cat = window.CatGame.state.game.cats.find((entry) => entry.id === 'cat_001');
    return window.CatGameCommerce.getCatSprite(cat);
  })).toContain('/src/assets/premium/moonlit-tabby.png');

  owned = false;
  await page.evaluate(() => window.CatGameCommerce.refresh({ silent: true }));
  expect(await page.evaluate(() => {
    const cat = window.CatGame.state.game.cats.find((entry) => entry.id === 'cat_001');
    return window.CatGameCommerce.getCatSprite(cat);
  })).toBe('');
  expect(await page.evaluate(() => window.CatGame.systems.homeSystem.getRenderableRoomScene({
    wall: 'station-green', floor: 'station-stripe', decor: 'station-signal', layout: 'station-waiting'
  }))).toEqual({ wall: 'sunny', floor: 'oak', decor: 'plants', layout: 'cozy' });
});
