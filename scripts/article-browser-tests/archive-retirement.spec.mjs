import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`public archive is retired at ${width}px while articles and sharing remain available`, async ({ page, request, baseURL }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/signal/', '/zh-hans/signal/', '/en/signal/', '/ja/signal/']) {
      await page.goto(path + '?view=archive');
      await expect(page).toHaveURL(baseURL + path);
      await expect(page.locator('.articles-list-heading')).toBeVisible();
      await expect(page.locator('a[href*="view=archive"], .articles-nav')).toHaveCount(0);
      await expect(page.locator('.article-row')).not.toHaveCount(0);
      await expect(page.locator('.articles-list')).not.toContainText('历史简报');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    for (const suffix of ['local-archive/', 'local-archive/card.png', 'local-archive/card.svg']) {
      const response = await request.get('/signal/' + suffix, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe('/signal/');
    }
    await page.goto('/signal/local-archive/');
    await expect(page).toHaveURL(baseURL + '/signal/');
    await page.locator('[data-article-share]').first().click();
    await expect(page.locator('[data-share-image]')).toBeVisible();
    expect(await page.locator('[data-share-image]').evaluate(img => img.naturalWidth)).toBe(1080);
    await page.locator('[data-share-close]').click();
    await page.locator('.article-row h2 a[href^="/zh-hans/signal/"]').first().click();
    await expect(page.locator('.article-prose h2').first()).toBeVisible();
    await page.screenshot({ path: `test-results/archive-retirement-reader-${width}.png`, fullPage: true });
  });
}
