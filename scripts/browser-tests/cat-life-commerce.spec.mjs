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

async function openGamePage(page, name) {
  const target = page.locator(`[data-page-target="${name}"]:visible`).first();
  if (!await target.count()) await page.locator('[data-page-target="more"]:visible').click();
  await target.click();
}

for (const width of [1440, 390]) {
  test(`room purchase, decoration, reload and revocation through UI at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockCloudMember(page);
    let owned = false;
    let balance = 100;
    let posts = 0;
    await page.route('**/api/games/cat-life/catalog?*', route => route.fulfill({ json: {
      ok: true, authenticated: true, account, balance,
      products: [{ ...roomProduct, owned, redeemable: !owned, entitlement: null }]
    } }));
    await page.route('**/api/games/cat-life/entitlements?*', route => route.fulfill({ json: {
      ok: true, authenticated: true, account, balance,
      entitlements: owned ? [entitlementFor(roomProduct)] : []
    } }));
    await page.route('**/api/games/cat-life/redemptions', route => {
      const body = route.request().postDataJSON();
      expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'productId']);
      expect(body.productId).toBe(roomProduct.productId);
      posts += 1;
      owned = true;
      balance = 75;
      return route.fulfill({ json: { ok: true, authenticated: true, account, balance,
        purchase: { id: 'clp_room_ui', status: 'completed' }, entitlement: entitlementFor(roomProduct) } });
    });
    await page.goto('/games/cat-life/?lang=en');
    await openGamePage(page, 'member_store');
    await expect(page.locator('.station-commerce-card')).toContainText('cannot be dragged independently');
    await page.locator('[data-cat-commerce-action="confirm"]').click();
    await expect(page.locator('[data-cat-commerce-copy]')).toContainText('25 Station Points');
    await expect(page.locator('[data-cat-commerce-scope]')).toContainText('No table');
    await expect(page.locator('[data-cat-commerce-policy]')).toContainText('not cash');
    await expect(page.locator('[data-cat-commerce-links] a').first()).toHaveAttribute('href', '/en/points/');
    await page.locator('[data-cat-commerce-confirm]').click();
    await expect(page.locator('.station-commerce-summary')).toContainText('75 Station Points');
    expect(posts).toBe(1);
    await openGamePage(page, 'community');
    await page.locator('[data-community-home]').click();
    await page.locator('[data-room-mode-target="edit"]').first().click();
    const options = { wall: 'station-green', floor: 'station-stripe', decor: 'station-signal', layout: 'station-waiting' };
    for (const [key, value] of Object.entries(options)) {
      await page.locator(`[data-room-option-key="${key}"][data-room-option-value="${value}"]`).click();
    }
    await expect(page.locator('.room-theme-fixture')).toHaveCount(3);
    await page.locator('[data-room-mode-target="life"]').last().click();
    await expect.poll(() => page.locator('.room-scene img').evaluateAll(images =>
      images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    expect(await page.locator('.room-theme-fixture').evaluateAll(images => images.every(image => {
      const box = image.getBoundingClientRect();
      const room = image.closest('.room-scene').getBoundingClientRect();
      return box.top >= room.top && box.left >= room.left && box.right <= room.right && box.bottom <= room.bottom;
    }))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.room-home-workspace').screenshot({ path: testInfo.outputPath('room-owned.png') });
    if (width === 1440 && process.env.CAT_LIFE_CAPTURE_ROOM_PREVIEW) {
      // Capture the actual entitled UI, never add an entitlement bypass to the renderer.
      await page.locator('.room-scene').screenshot({ path: process.env.CAT_LIFE_CAPTURE_ROOM_PREVIEW });
    }
    await page.reload();
    await expect.poll(() => page.evaluate(() => window.CatGameCommerce.hasEntitlement('cat-life.content.furniture.station-room.v1'))).toBe(true);
    await openGamePage(page, 'community');
    await page.locator('[data-community-home]').click();
    await expect(page.locator('.room-theme-fixture')).toHaveCount(3);
    expect(await page.evaluate(() => window.CatGame.state.game.home.roomScene)).toMatchObject(options);
    owned = false;
    balance = 100;
    await openGamePage(page, 'member_store');
    await page.locator('[data-cat-commerce-action="refresh"]').click();
    await expect(page.locator('.station-commerce-summary')).toContainText('100 Station Points');
    await openGamePage(page, 'community');
    await page.locator('[data-community-home]').click();
    await expect(page.locator('.room-theme-fixture')).toHaveCount(0);
    await expect(page.locator('.room-scene')).not.toHaveClass(/wall-station-green|floor-station-stripe/);
    await page.locator('[data-room-mode-target="edit"]').first().click();
    await expect(page.locator('[data-room-option-value="station-green"]')).toHaveCount(0);
    await page.locator('.room-home-workspace').screenshot({ path: testInfo.outputPath('room-revoked.png') });
    expect(posts).toBe(1);
  });
}

for (const [locale, prefix, skinScope, roomScope, policy] of [
  ['en', 'en', 'Only for the starter orange cat', 'cannot be dragged independently', 'not cash'],
  ['zh-CN', 'zh-hans', '仅适用初始橘猫', '不能独立拖动', '不等于现金退款'],
  ['zh-Hant', 'zh-hant', '僅適用初始橘貓', '不能獨立拖動', '不等於現金退款'],
  ['ja', 'ja', '最初の茶トラ猫', '個別にドラッグできません', '現金の返金ではありません']
]) {
  test(`localized offer scope and support links fit mobile: ${locale}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockCloudMember(page);
    await page.route('**/api/games/cat-life/catalog?*', route => route.fulfill({ json: {
      ok: true, authenticated: true, account, balance: 100,
      products: [skinProduct, { ...roomProduct, owned: false, redeemable: true, entitlement: null }]
    } }));
    await page.route('**/api/games/cat-life/entitlements?*', route => route.fulfill({ json: {
      ok: true, authenticated: true, account, balance: 100, entitlements: []
    } }));
    await page.goto(`/games/cat-life/?lang=${locale}`);
    await openGamePage(page, 'member_store');
    await expect(page.locator('.station-commerce-card').first()).toContainText(skinScope);
    await expect(page.locator('.station-commerce-card').last()).toContainText(roomScope);
    await expect.poll(() => page.locator('.station-commerce-art img').evaluateAll(images =>
      images.length === 2 && images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    const links = page.locator('.station-commerce-guidance a');
    await expect(page.locator('.station-commerce-guidance .station-commerce-links')).toHaveJSProperty('tagName', 'DIV');
    await expect(links.first()).toHaveAttribute('href', `/${prefix}/points/`);
    await expect(links.last()).toHaveAttribute('href', 'mailto:brodstem@protonmail.com');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.locator('[data-cat-commerce-section]').screenshot({ path: testInfo.outputPath('store.png') });
    for (const product of [skinProduct, roomProduct]) {
      await page.locator(`[data-cat-commerce-action="confirm"][data-product-id="${product.productId}"]`).click();
      await expect(page.locator('[data-cat-commerce-scope]')).toContainText(product === skinProduct ? skinScope : roomScope);
      await expect(page.locator('[data-cat-commerce-policy]')).toContainText(policy);
      await expect(page.locator('[data-cat-commerce-links]')).toHaveJSProperty('tagName', 'DIV');
      await expect(page.locator('[data-cat-commerce-links] a').first()).toHaveAttribute('href', `/${prefix}/points/`);
      expect(await page.locator('[data-cat-commerce-dialog]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.locator('[data-cat-commerce-dialog]').screenshot({ path: testInfo.outputPath(`${product === skinProduct ? 'skin' : 'room'}-confirm.png`) });
      await page.locator('[data-cat-commerce-cancel]').click();
    }
  });
}

test('uncertain redemption preserves the retry key and never promises no debit', async ({ page }) => {
  await mockCloudMember(page);
  await page.route('**/api/games/cat-life/catalog?*', route => route.fulfill({ json: {
    ok: true, authenticated: true, account, balance: 100, products: [skinProduct]
  } }));
  await page.route('**/api/games/cat-life/entitlements?*', route => route.fulfill({ json: {
    ok: true, authenticated: true, account, balance: 100, entitlements: []
  } }));
  const bodies = [];
  await page.route('**/api/games/cat-life/redemptions', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 503, json: { ok: false } });
  });
  await page.goto('/games/cat-life/?lang=en');
  await openGamePage(page, 'member_store');
  await page.locator('[data-cat-commerce-action="confirm"]').click();
  await page.locator('[data-cat-commerce-confirm]').click();
  await expect(page.locator('[data-cat-commerce-status]')).toContainText('could not confirm');
  await page.locator('[data-cat-commerce-confirm]').click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]).toEqual(bodies[1]);
});

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
  await page.locator('[data-page-target="member_store"]').first().click();
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

  await page.locator('[data-page-target="cats"]').first().click();
  await page.locator('.cat-action-section [data-cat-action="rest"]').click();
  await expect(page.locator('.cat-profile-scene .cat-profile-cat')).toHaveAttribute('src', /moonlit-tabby\.png/);
  await expect(page.locator('.cat-profile-scene .cat-reaction-cue')).toHaveText('Zz');
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
  await page.locator('[data-page-target="member_store"]').first().click();
  const signIn = page.locator('[data-cat-commerce-section] a', { hasText: 'Sign in to redeem' });
  await expect(signIn).toHaveAttribute('href', /\/en\/library\/\?returnTo=/);
  expect(posted).toBe(false);
});

test('keeps the normal shop and member store as separate pages', async ({ page }) => {
  await mockCloudGuest(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, products: [skinProduct] }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, entitlements: [] }
  }));

  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('.statusbar-stats [role="progressbar"]')).toHaveCount(3);
  await expect(page.locator('[data-player-stamina-bar]')).toHaveAttribute('aria-valuenow', '100');
  const batteryBox = await page.locator('.statusbar-stats .bar-track').first().evaluate((node) => node.getBoundingClientRect().toJSON());
  expect(batteryBox.height).toBeGreaterThanOrEqual(9);
  expect(batteryBox.height).toBeLessThanOrEqual(14);
  expect(batteryBox.width).toBeGreaterThan(100);
  await page.locator('[data-page-target="cats"]').first().click();
  expect(await page.locator('#app-main .cat-profile-section [role="progressbar"]').first().evaluate((node) => {
    return node.parentElement.getBoundingClientRect().height;
  })).toBeGreaterThanOrEqual(6);
  await page.locator('[data-page-target="shop"]').first().click();
  await expect(page.locator('#app-main')).toContainText('Daily Care Supplies');
  await expect(page.locator('#app-main [data-cat-commerce-section]')).toHaveCount(0);
  await expect(page.locator('#app-main .notice-list')).toHaveCount(0);
  expect(await page.locator('#app-main .shop-grid').first().evaluate((node) => {
    return getComputedStyle(node).gridTemplateColumns.split(' ').length;
  })).toBeGreaterThanOrEqual(2);
  expect(await page.locator('#app-main .shop-art').first().evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(170);
  const shopAlignment = await page.locator('#app-main .page-card', { hasText: 'Daily Care Supplies' }).locator('.shop-grid').evaluate((node) => {
    const cards = Array.from(node.children);
    const firstTop = cards[0].getBoundingClientRect().top;
    const firstRow = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 1);
    return {
      actionBottoms: firstRow.map((card) => card.querySelector('.shop-actions').getBoundingClientRect().bottom),
      buttonHeights: firstRow.flatMap((card) => Array.from(card.querySelectorAll('.shop-actions button')).map((button) => button.getBoundingClientRect().height))
    };
  });
  expect(Math.max(...shopAlignment.actionBottoms) - Math.min(...shopAlignment.actionBottoms)).toBeLessThanOrEqual(1);
  expect(Math.max(...shopAlignment.buttonHeights) - Math.min(...shopAlignment.buttonHeights)).toBeLessThanOrEqual(1);

  await page.locator('[data-page-target="member_store"]').first().click();
  await expect(page.locator('#app-main [data-cat-commerce-section]')).toContainText('Moonlit Tabby');
  await expect(page.locator('#app-main')).not.toContainText('Daily Care Supplies');
});

test('keeps live player condition only in the masthead and exposes work progression', async ({ page }) => {
  await mockCloudGuest(page);
  await page.goto('/games/cat-life/?lang=en');
  await page.locator('[data-page-target="work"]').first().click();
  await expect(page.locator('#app-main .work-shift-board')).toBeVisible();
  await expect(page.locator('#app-main .work-growth-card')).toHaveCount(1);
  await expect(page.locator('#app-main .work-growth-card')).toContainText('Player Level');
  await expect(page.locator('#app-main .work-growth-card [data-work-exp-current]')).toContainText('0 / 100 EXP');
  await expect(page.locator('#app-main [data-player-stamina-live], #app-main [data-player-mood-live], #app-main [data-player-hunger-live]')).toHaveCount(0);
  await expect(page.locator('.statusbar-stats [role="progressbar"]')).toHaveCount(3);
});

test('keeps compact mouse controls while restoring 44px touch targets', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:4178',
    hasTouch: true,
    viewport: { width: 1024, height: 768 }
  });
  const page = await context.newPage();
  await mockCloudGuest(page);
  await page.goto('/games/cat-life/?lang=en');
  expect(await page.locator('.nav-button').first().evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.locator('.sleep-control').evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await context.close();
});

test('opens the separate member store from mobile More without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCloudGuest(page);
  await page.route('**/api/games/cat-life/catalog?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, products: [skinProduct] }
  }));
  await page.route('**/api/games/cat-life/entitlements?*', (route) => route.fulfill({
    json: { ok: true, authenticated: false, entitlements: [] }
  }));

  await page.goto('/games/cat-life/?lang=en');
  await page.locator('[data-page-target="more"]:visible').click();
  await page.locator('[data-page-target="shop"]:visible').click();
  expect(await page.locator('#app-main .shop-art').first().evaluate((node) => node.getBoundingClientRect().width)).toBeLessThanOrEqual(100);
  await page.locator('[data-page-target="more"]:visible').click();
  await page.locator('[data-page-target="member_store"]:visible').click();
  await expect(page.locator('#app-main [data-cat-commerce-section]')).toContainText('Moonlit Tabby');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
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
  await page.locator('[data-page-target="member_store"]').first().click();
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
  await page.locator('[data-page-target="member_store"]').first().click();
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
