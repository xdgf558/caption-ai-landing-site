import { test, expect } from '@playwright/test';
import { vipMembershipCopy } from '../../src/data/vip-membership.js';
import { getReaderLibraryMessages } from '../../src/data/reader-library-client.js';

async function mockMembership(page, options = {}) {
  const state = {
    authenticated: true, enabled: true, balance: 100, active: false,
    cost: 10, months: 1, coversPaid: true, failRedeem: false, ...options
  };
  const writes = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') {
      writes.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postData() });
      if (!request.url().endsWith('/api/readers/membership/redeem')) {
        return route.fulfill({ status: 405, json: { ok: false } });
      }
      if (state.failRedeem) return route.fulfill({ status: 503, json: { ok: false } });
      state.active = true;
      state.balance -= state.cost;
    }
    await route.fulfill({ json: {
      ok: true, authenticated: state.authenticated,
      redemption: request.method() === 'POST' ? { requestKey: request.headers()['idempotency-key'] } : undefined,
      account: { id: 1, email: 'vip-preview@example.test', username: 'VIP Preview', balanceCredits: state.balance },
      membership: { active: state.active, expiresAt: '2027-01-10T00:00:00Z', level: 'member' },
      membershipSettings: { enabled: state.enabled, membershipCreditCost: state.cost, membershipDurationMonths: state.months, membershipCoversPaidContent: state.coversPaid },
      entitlements: [], bookmarks: [], ledger: [], packs: [], totp: { enabled: false },
      checkoutEnabled: false, publicCheckoutEnabled: false, readerCredits: { enabled: false, packs: [] }
    } });
  });
  return writes;
}

const locales = { 'zh-hant': 'zh-Hant', 'zh-hans': 'zh-Hans', en: 'en', ja: 'ja' };
async function expectVipBadge(root) {
  const mark = root.locator('.vip-mark');
  const image = mark.locator('img');
  await expect(image).toBeVisible();
  await expect(mark).toHaveAttribute('aria-hidden', 'true');
  await expect(image).toHaveAttribute('alt', '');
  await expect(image).toHaveAttribute('src', /\/_astro\/vip-badge\..*\.webp$/);
  await expect(image).toHaveAttribute('srcset', /192w/);
  await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  const box = await mark.boundingBox();
  expect(box.width).toBe(64);
  expect(box.height).toBe(64);
}

for (const width of [390, 768, 1280]) for (const [path, locale] of Object.entries(locales)) {
  test(`VIP ${locale} ${width}px: readable layout, planned services and existing redemption only`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const writes = await mockMembership(page);
    await page.goto(`/${path}/library/`);
    const panel = page.locator('#reader-membership-panel');
    const button = panel.locator('#reader-membership-redeem');
    const messages = getReaderLibraryMessages(locale);
    await expect(panel).toBeVisible();
    await expect(panel.locator('#reader-vip-title')).toHaveText(vipMembershipCopy[locale].name);
    await expect(panel.locator('#reader-membership-summary-title')).toHaveText(messages.membershipInactive);
    await expect(button).toContainText('VIP');
    await expect(button).toBeEnabled();
    await expect(panel.locator('button')).toHaveCount(1);
    await expect(panel.locator('[data-vip-planned]')).toHaveCount(2);
    await expect(panel.locator('[data-vip-planned] button, [data-vip-planned] a')).toHaveCount(0);
    await expectVipBadge(panel);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const status = await panel.locator('#reader-membership-summary-title').boundingBox();
    const action = await button.boundingBox();
    expect(action.y).toBeGreaterThan(status.y + status.height);
    expect(action.height).toBeGreaterThanOrEqual(44);
    expect(status.width).toBeGreaterThan(220);
    await panel.scrollIntoViewIfNeeded();
    if (locale === 'zh-Hant') await page.screenshot({ path: `test-results/vip-inactive-${width}.png` });
    await button.click();
    await expect(panel.locator('#reader-membership-summary-title')).toHaveText(messages.membershipActive);
    await expect(button).toHaveText(messages.renewMembership);
    await expect(panel.locator('#reader-membership-overview-credits')).toContainText('90');
    expect(writes).toEqual([{ path: '/api/readers/membership/redeem', method: 'POST', body: null }]);
    await page.reload();
    await expect(panel.locator('#reader-membership-summary-title')).toHaveText(messages.membershipActive);
    if (locale === 'zh-Hant') {
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/vip-active-${width}.png` });
    }
    expect(errors).toEqual([]);
    await page.goto(`/${path}/points/`);
    const vip = vipMembershipCopy[locale];
    const capabilities = page.locator('.station-points-capabilities');
    await expectVipBadge(capabilities);
    await expect(capabilities).toContainText(vip.name);
    await expect(capabilities.locator('.station-points-capabilities__heading > p').last()).toHaveText(vip.useIntro);
    await expect(capabilities.locator('.station-points-capability-group').first().locator('article').first().locator('p')).toHaveText(vip.readingDescription);
    await expect(capabilities.locator('.station-points-redemption-note > p')).toHaveText(vip.redemptionBody);
    await expect(capabilities.locator('.station-points-capability-group').last()).toContainText(vip.notice);
    await expect(capabilities.locator('.station-points-capability-group').last().locator('a, button')).toHaveCount(0);
    await expect(page.locator('#station-points-planned-title')).toHaveText(vip.plannedHeading);
  });
}

test('VIP states follow server settings, balance, coverage and session', async ({ page }) => {
  const messages = getReaderLibraryMessages('en');
  for (const options of [
    { active: true }, { balance: 0 }, { enabled: false }, { active: true, coversPaid: false },
    { authenticated: false }, { cost: 23, months: 3 }, { failRedeem: true }
  ]) {
    await page.unroute('**/api/**');
    const writes = await mockMembership(page, options);
    await page.goto('/en/library/');
    const panel = page.locator('#reader-membership-panel');
    const button = panel.locator('#reader-membership-redeem');
    if (options.authenticated === false) {
      await expect(panel).toBeHidden();
      expect(writes).toEqual([]);
      continue;
    }
    await expect(panel.locator('#reader-membership-rule')).toContainText(`${options.cost || 10} points`);
    await expect(panel.locator('#reader-membership-rule')).toContainText(`${options.months || 1} month(s)`);
    if (options.active) {
      await expect(button).toHaveText(messages.renewMembership);
      await expect(panel.locator('#reader-membership-summary-detail')).toContainText('2027');
    }
    if (options.balance === 0) await expect(button).toBeDisabled();
    if (options.enabled === false) await expect(button).toBeHidden();
    if (options.coversPaid === false) {
      await expect(panel.locator('#reader-vip-reading-coverage')).toHaveText(messages.membershipNoPaidCoverage);
      await expect(panel.locator('#reader-membership-rule')).toContainText(messages.membershipNoPaidCoverage);
    }
    if (options.failRedeem) {
      await button.click();
      await expect(panel.locator('#reader-membership-status')).toHaveText(messages.membershipRetrySafe);
      await expect(panel.locator('#reader-membership-summary-title')).toHaveText(messages.membershipInactive);
      await expect(button).toBeEnabled();
      expect(writes).toHaveLength(1);
    } else expect(writes).toEqual([]);
  }
});
