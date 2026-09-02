import { expect, test } from '@playwright/test';

const desktopPages = [
  'home',
  'work',
  'bank',
  'shop',
  'inventory',
  'member_store',
  'cats',
  'hospital',
  'collection',
  'community',
  'arcade',
  'tasks',
  'version',
  'save',
  'settings'
];

async function pageWidthReport(page) {
  return page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    offenders: Array.from(document.querySelectorAll('body *'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return { selector: `${node.tagName.toLowerCase()}.${node.className || ''}`, left: rect.left, right: rect.right, width: rect.width };
      })
      .filter((item) => item.right > document.documentElement.clientWidth + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8)
  }));
}

test('keeps the storybook shell coherent across every desktop game page', async ({ page }) => {
  await page.goto('/games/cat-life/?lang=en');

  await expect(page.locator('.home-cat-stage')).toBeVisible();
  await expect(page.locator('.statusbar-stats [role="progressbar"]')).toHaveCount(3);
  await expect(page.locator('.desktop-navigation')).toBeVisible();
  await expect(page.locator('.mobile-navigation')).toBeHidden();
  expect(await page.locator('.cat-stage-art > img').getAttribute('src')).toContain('/assets/poses/');

  for (const selector of ['.statusbar-stats .stat-row', '.cat-stage-mini-stats .stat-row']) {
    const tops = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops), `${selector} should share one top edge`).toBeLessThan(1);
  }

  const audioBefore = await page.evaluate(() => ({
    bgmEnabled: window.CatGame.state.game.settings.bgmEnabled,
    bgmVolume: window.CatGame.state.game.settings.bgmVolume,
    sfxVolume: window.CatGame.state.game.settings.sfxVolume
  }));
  await page.locator('[data-top-sound-toggle]').click();
  const audioMuted = await page.evaluate(() => ({
    bgmEnabled: window.CatGame.state.game.settings.bgmEnabled,
    bgmVolume: window.CatGame.state.game.settings.bgmVolume,
    sfxVolume: window.CatGame.state.game.settings.sfxVolume
  }));
  expect(audioMuted).toEqual({ bgmEnabled: false, bgmVolume: audioBefore.bgmVolume, sfxVolume: audioBefore.sfxVolume });
  await page.locator('[data-top-sound-toggle]').click();
  await expect(page.locator('[data-top-sound-toggle]')).toHaveAttribute('aria-pressed', 'true');

  for (const pageName of desktopPages) {
    await page.locator(`.desktop-navigation [data-page-target="${pageName}"]`).click();
    await expect(page.locator('#app-main')).not.toBeEmpty();
    const width = await pageWidthReport(page);
    expect(width.scroll, `${pageName}: ${JSON.stringify(width.offenders)}`).toBe(1280);
  }

  await page.locator('.desktop-navigation [data-page-target="work"]').click();
  const workIcons = page.locator('.work-roster-icon img');
  await expect(workIcons).toHaveCount(5);
  const workIconReport = await workIcons.evaluateAll((images) => ({
    loaded: images.every((image) => image.complete && image.naturalWidth > 0),
    sources: new Set(images.map((image) => image.getAttribute('src'))).size
  }));
  expect(workIconReport).toEqual({ loaded: true, sources: 5 });

  await page.locator('.desktop-navigation [data-page-target="community"]').click();
  const neighborMarker = page.locator('[data-community-neighbor]').first();
  const markerBeforeHover = await neighborMarker.boundingBox();
  await neighborMarker.hover();
  await page.waitForTimeout(240);
  const markerAfterHover = await neighborMarker.boundingBox();
  expect(markerBeforeHover).not.toBeNull();
  expect(markerAfterHover).not.toBeNull();
  expect(Math.abs(markerAfterHover.x - markerBeforeHover.x)).toBeLessThan(6);
  expect(Math.abs(markerAfterHover.y - markerBeforeHover.y)).toBeLessThan(14);

  await page.locator('[data-community-home]').click();
  await expect(page.locator('.room-home-workspace')).toBeVisible();
  await expect(page.locator('.room-cat-actor')).toHaveCount(1);
  await expect(page.locator('.room-furniture-art')).toHaveCount(2);
  await expect(page.locator('.room-home-page')).toHaveAttribute('data-room-mode', 'life');
  const lifeAnimation = await page.locator('.room-cat-actor').evaluate((node) => getComputedStyle(node).animationName);
  expect(lifeAnimation).toContain('room-route-');
  await page.locator('[data-room-mode-target="edit"]').first().click();
  await expect(page.locator('.room-home-page')).toHaveAttribute('data-room-mode', 'edit');
  await expect(page.locator('.room-walk-zone')).toHaveCount(3);
  const editAnimationState = await page.locator('.room-cat-actor').evaluate((node) => getComputedStyle(node).animationPlayState);
  expect(editAnimationState).toBe('paused');
  await page.locator('[data-room-mode-target="life"]').last().click();
  await expect(page.locator('.room-home-page')).toHaveAttribute('data-room-mode', 'life');

  await page.locator('.desktop-navigation [data-page-target="shop"]').click();
  const shopTabs = page.locator('.shop-tabs [role="tab"]');
  await expect(shopTabs).toHaveCount(4);
  await expect(shopTabs.first()).toHaveAttribute('aria-controls', 'shop-panel');
  await shopTabs.first().focus();
  await shopTabs.first().press('ArrowRight');
  await expect(page.locator('[data-shop-category="player"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-shop-category="player"]')).toBeFocused();
  await expect(page.locator('#shop-panel')).toHaveAttribute('aria-labelledby', 'shop-tab-player');
  await expect(page.locator('.shop-grid .shop-card').first()).toBeVisible();

  await page.locator('[data-store-item="bread"]').click();
  await page.locator('.desktop-navigation [data-page-target="inventory"]').click();
  const breadCard = page.locator('.inventory-card', { hasText: 'Bread' });
  await expect(breadCard).toContainText('x1');
  await breadCard.locator('[data-use-player-item="bread"]').click();
  await expect(breadCard).toHaveCount(0);
});

test('fits the storybook shell, cat stage, shop tabs, and More menu at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/games/cat-life/?lang=en');

  await expect(page.locator('.desktop-navigation')).toBeHidden();
  await expect(page.locator('.mobile-navigation')).toBeVisible();
  await expect(page.locator('.home-cat-stage')).toBeVisible();
  const width = await pageWidthReport(page);
  expect(width.scroll, JSON.stringify(width.offenders)).toBe(390);

  await page.locator('[data-page-target="more"]:visible').click();
  await expect(page.locator('[data-page-target="settings"]:visible')).toBeVisible();
  await page.locator('[data-page-target="inventory"]:visible').click();
  await expect(page.locator('.inventory-grid').first()).toBeVisible();
  const inventoryWidth = await pageWidthReport(page);
  expect(inventoryWidth.scroll, JSON.stringify(inventoryWidth.offenders)).toBe(390);

  await page.locator('[data-page-target="more"]:visible').click();
  await page.locator('[data-page-target="shop"]:visible').click();
  await expect(page.locator('.shop-tabs')).toBeVisible();
  const shopWidth = await pageWidthReport(page);
  expect(shopWidth.scroll, JSON.stringify(shopWidth.offenders)).toBe(390);

  await page.locator('[data-page-target="work"]:visible').click();
  await expect(page.locator('.work-roster-icon')).toHaveCount(5);
  const workWidth = await pageWidthReport(page);
  expect(workWidth.scroll, JSON.stringify(workWidth.offenders)).toBe(390);

  await page.locator('[data-page-target="community"]:visible').click();
  await page.locator('[data-community-home]').click();
  await expect(page.locator('.room-home-workspace')).toBeVisible();
  const roomWidth = await pageWidthReport(page);
  expect(roomWidth.scroll, JSON.stringify(roomWidth.offenders)).toBe(390);
});

test('aligns the website account action with the language control', async ({ page }) => {
  await page.goto('/games/cat-life/?lang=zh-Hant');

  const accountAction = page.locator('.station-site-member__action:visible').first();
  const languageSelect = page.locator('[data-station-language]');
  const languageNote = page.locator('[data-station-language-note]');
  await expect(accountAction).toBeVisible();
  await expect(languageSelect).toBeVisible();
  await expect(languageNote).toBeVisible();

  const accountBox = await accountAction.boundingBox();
  const languageBox = await languageSelect.boundingBox();
  expect(accountBox).not.toBeNull();
  expect(languageBox).not.toBeNull();
  expect(Math.abs(accountBox.height - languageBox.height)).toBeLessThan(1);
  expect(Math.abs(accountBox.y - languageBox.y)).toBeLessThan(1);
});
