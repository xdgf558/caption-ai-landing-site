import { expect, test } from '@playwright/test';

const desktopPages = [
  'home',
  'work',
  'bank',
  'shop',
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

  for (const pageName of desktopPages) {
    await page.locator(`.desktop-navigation [data-page-target="${pageName}"]`).click();
    await expect(page.locator('#app-main')).not.toBeEmpty();
    const width = await pageWidthReport(page);
    expect(width.scroll, `${pageName}: ${JSON.stringify(width.offenders)}`).toBe(1280);
  }

  await page.locator('.desktop-navigation [data-page-target="shop"]').click();
  await expect(page.locator('.shop-tabs [role="tab"]')).toHaveCount(4);
  await page.locator('[data-shop-category="player"]').click();
  await expect(page.locator('[data-shop-category="player"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.shop-grid .shop-card').first()).toBeVisible();
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
  await page.locator('[data-page-target="shop"]:visible').click();
  await expect(page.locator('.shop-tabs')).toBeVisible();
  const shopWidth = await pageWidthReport(page);
  expect(shopWidth.scroll, JSON.stringify(shopWidth.offenders)).toBe(390);
});
