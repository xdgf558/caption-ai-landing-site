import { test, expect } from '@playwright/test';

for (const width of [390, 1280]) test(width + 'px: release history stays folded until requested, preserving focus and expansion on refresh', async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-care-journey]')).toBeVisible();
  if (width === 390) await page.locator('#app-mobile-navigation [data-page-target="more"]').click();
  await page.locator('[data-page-target="version"]:visible').click();
  await expect(page.locator('.release-latest .notice-item')).toHaveCount(2);
  await expect(page.locator('.release-history-item')).toHaveCount(4);
  await expect(page.locator('.release-history-item[open]')).toHaveCount(0);
  const details = page.locator('[data-release-version="1.25.0"]');
  const summary = details.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('.notice-item')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.CatGame.state.releaseHistoryOpen)).toContain('1.25.0');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(details).toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  await summary.press('Space');
  await expect.poll(() => page.evaluate(() => window.CatGame.state.releaseHistoryOpen)).not.toContain('1.25.0');
  await page.evaluate(() => window.CatGameApp.render());
  await expect(page.locator('.release-history-item[open]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  expect(await page.evaluate(() => Object.hasOwn(window.CatGame.state.game, 'releaseHistoryOpen'))).toBe(false);
});
