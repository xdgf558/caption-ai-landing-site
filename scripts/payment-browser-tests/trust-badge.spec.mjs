import { test, expect } from '@playwright/test';

const pack = { credits: 100, label: '100 Station Points', priceAmount: 10, priceCurrency: 'USD' };

async function mockPayments(page, { enabled = true, authenticated = true, fail = false } = {}) {
  const writes = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.url());
    if (fail) return route.fulfill({ status: 503, json: { ok: false } });
    await route.fulfill({ json: {
      ok: true, authenticated, account: { email: 'badge-test@example.test', balanceCredits: 0 },
      publicCheckoutEnabled: enabled, readerCredits: { enabled, packs: enabled ? [pack] : [] },
      checkoutEnabled: enabled, packs: enabled ? [pack] : [],
      entitlements: [], bookmarks: [], ledger: [], totp: { enabled: false }
    } });
  });
  return writes;
}

async function checkBadge(badge) {
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('href', 'https://www.creem.io/');
  await expect(badge).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(badge).toHaveAttribute('target', '_blank');
  await expect(badge).toHaveAttribute('aria-label', /Creem/);
  await expect(badge).toHaveText('Payments secured by Creem');
  await expect(badge.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(await badge.locator('img, script, iframe').count()).toBe(0);
  await badge.focus();
  await expect(badge).toBeFocused();
}

for (const width of [390, 1280]) for (const locale of ['zh-hant', 'zh-hans', 'en', 'ja']) {
  test(`${locale} ${width}px: badge near recharge and confirmation, no payment side effects`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const writes = await mockPayments(page);
    let creemRequests = 0;
    await context.route('https://www.creem.io/**', route => {
      creemRequests++;
      return route.fulfill({ contentType: 'text/html', body: '<h1>Creem link fixture</h1>' });
    });
    await page.goto(`/${locale}/points/`);
    const pointsBadge = page.locator('#station-points-trust a');
    await checkBadge(pointsBadge);
    expect(creemRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (locale === 'zh-hant') await page.screenshot({ path: `test-results/creem-points-${width}.png`, fullPage: true });
    const popupPromise = page.waitForEvent('popup');
    await pointsBadge.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://www.creem.io/');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();

    await page.goto(`/${locale}/library/`);
    await page.locator('[data-reader-view="points"]:visible').click();
    const controls = page.locator('#reader-credit-purchase-controls');
    await checkBadge(controls.locator('.creem-trust__link'));
    await expect(controls.locator('.reader-credit-pack-button')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    if (locale === 'zh-hant') await page.screenshot({ path: `test-results/creem-member-${width}.png`, fullPage: true });
    await controls.locator('.reader-credit-pack-button').click();
    const dialog = page.locator('#reader-checkout-dialog');
    await checkBadge(dialog.locator('.creem-trust__link'));
    await expect(dialog.locator('#reader-checkout-confirm')).toBeEnabled();
    await expect(dialog.locator('#reader-checkout-pack')).toContainText('100');
    await expect(dialog.locator('#reader-checkout-total')).toContainText('10');
    if (locale === 'zh-hant') await page.screenshot({ path: `test-results/creem-confirm-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('badge stays hidden on failed/disabled checkout and signed-out member pages', async ({ page }) => {
  for (const options of [{ enabled: false }, { fail: true }, { authenticated: false }]) {
    await page.unroute('**/api/**');
    await mockPayments(page, options);
    await page.goto('/zh-hant/library/');
    if (options.authenticated !== false && !options.fail) await page.locator('[data-reader-view="points"]:visible').click();
    await expect(page.locator('.creem-trust__link:visible')).toHaveCount(0);
    if (options.authenticated === false) continue;
    await page.goto('/zh-hant/points/');
    await expect(page.locator('#station-points-purchase')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('.creem-trust__link:visible')).toHaveCount(0);
  }
});

test('badge waits for payment availability', async ({ page }) => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    await ready;
    await route.fulfill({ json: { ok: true, publicCheckoutEnabled: true, readerCredits: { enabled: true, packs: [pack] } } });
  });
  await page.goto('/en/points/');
  await expect(page.locator('#station-points-trust')).toBeHidden();
  release();
  await checkBadge(page.locator('#station-points-trust a'));
});

test('touch badge keeps a 44px target and fits a narrow viewport', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, viewport: { width: 320, height: 740 } });
  const page = await context.newPage();
  await mockPayments(page);
  await page.goto('/ja/points/');
  const badge = page.locator('#station-points-trust a');
  await checkBadge(badge);
  const box = await badge.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  await context.close();
});
