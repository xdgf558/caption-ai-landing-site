import { test, expect } from '@playwright/test';

async function openVersion(page, width) {
  await expect(page.locator('[data-care-journey]')).toBeVisible();
  if (width === 390) await page.locator('#app-mobile-navigation [data-page-target="more"]').click();
  await page.locator('[data-page-target="version"]:visible').click();
}

for (const width of [390, 1280]) test(width + 'px: release history stays folded until requested, preserving focus and expansion on refresh', async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/games/cat-life/?lang=en');
  await openVersion(page, width);
  await expect(page.locator('.release-latest .notice-item')).toHaveCount(2);
  await expect(page.locator('.release-history-item')).toHaveCount(4);
  await expect(page.locator('.release-history-item[open]')).toHaveCount(0);
  await expect(page.locator('[data-release-version="1.22.2"] summary')).toContainText('Changes: 1');
  const details = page.locator('[data-release-version="1.25.0"]');
  const summary = details.locator('summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('.notice-item')).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => window.CatGame.state.releaseHistoryOpen)).toContain('1.25.0');
  // Explicitly replace the DOM while history is open, not only after closing it.
  await page.evaluate(() => window.CatGameApp.render());
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('.notice-item').first()).toBeVisible();
  await expect(summary).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(details).toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  await summary.press('Space');
  await expect.poll(() => page.evaluate(() => window.CatGame.state.releaseHistoryOpen)).not.toContain('1.25.0');
  await page.evaluate(() => window.CatGameApp.render());
  await expect(page.locator('.release-history-item[open]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  expect(await page.evaluate(() => Object.hasOwn(window.CatGame.state.game, 'releaseHistoryOpen'))).toBe(false);
  // A real reload must discard view-only expansion, starting from an open entry.
  await summary.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => window.CatGame.state.releaseHistoryOpen)).toContain('1.25.0');
  await page.reload();
  await openVersion(page, width);
  await expect(page.locator('.release-history-item')).toHaveCount(4);
  await expect(page.locator('.release-history-item[open]')).toHaveCount(0);
  await expect(details.locator('.notice-item').first()).toBeHidden();
  expect(await page.evaluate(() => window.CatGame.state.releaseHistoryOpen)).toEqual([]);
});
