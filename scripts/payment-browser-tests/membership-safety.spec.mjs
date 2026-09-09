import { test, expect } from '@playwright/test';
import { getReaderLibraryMessages } from '../../src/data/reader-library-client.js';

const messages = getReaderLibraryMessages('en');
async function fixture(page, { authenticated = true, loseFirst = false, onRedeem = async () => {} } = {}) {
  const state = { balance: 10, active: false, authenticated, keys: [], receipts: new Set(), sessionId: 1 };
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = request.headers()['idempotency-key'];
    if (path.endsWith('/membership/redeem')) {
      state.keys.push(key);
      expect(request.headers()['x-reader-account']).toBe('1');
      expect(key).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
      if (!state.receipts.has(key)) {
        state.receipts.add(key);
        state.balance -= 10;
        state.active = true;
      }
      if (loseFirst && state.keys.length === 1) return route.abort('failed');
      await onRedeem();
    } else if (request.method() === 'POST') state.authenticated = true;
    await route.fulfill({ json: {
      ok: true, authenticated: state.authenticated,
      account: { id: state.sessionId, email: 'fixture@example.test', username: 'Fixture', balanceCredits: state.balance },
      membership: { active: state.active, expiresAt: '2027-01-01T00:00:00Z' },
      membershipSettings: { enabled: true, membershipCreditCost: 10, membershipDurationMonths: 1, membershipCoversPaidContent: true },
      redemption: key ? { requestKey: key } : undefined,
      entitlements: [], bookmarks: [], ledger: [], packs: [], totp: { enabled: false },
      checkoutEnabled: false, publicCheckoutEnabled: false, readerCredits: { enabled: false, packs: [] }
    } });
  });
  return state;
}

test('unknown result survives reload; pending receipt can be checked even with zero balance', async ({ page }) => {
  const state = await fixture(page, { loseFirst: true });
  await page.goto('/en/library/');
  const button = page.locator('#reader-membership-redeem');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('#reader-membership-status')).toHaveText(messages.membershipRetrySafe);
  await page.reload();
  await expect(button).toHaveText(messages.membershipCheckRequest);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('#reader-membership-status')).toHaveText(messages.membershipRedeemed);
  expect(state.keys).toHaveLength(2);
  expect(state.keys[1]).toBe(state.keys[0]);
  expect(state.balance).toBe(0);
  await expect(button).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('stationcat.membership.pending.v1:1'))).toBeNull();
});

test('storage failure and changed session cannot send a redemption', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/en/library/');
  const button = page.locator('#reader-membership-redeem');
  await expect(button).toBeEnabled();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('storage denied'); }; });
  await button.click();
  await expect(page.locator('#reader-membership-status')).toHaveText(messages.membershipRetrySafe);
  expect(state.keys).toEqual([]);
  await page.reload();
  await expect(button).toBeEnabled();
  state.sessionId = 2;
  await button.click();
  await expect(page.locator('#reader-membership-status')).toHaveText(messages.signInRequired);
  expect(state.keys).toEqual([]);
});

test('a second tab cannot send while the first tab owns the redemption lock', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const first = await fixture(page, { onRedeem: () => held });
  const other = await page.context().newPage();
  const second = await fixture(other);
  try {
    await page.goto('/en/library/');
    await other.goto('/en/library/');
    await page.locator('#reader-membership-redeem').click();
    await expect.poll(() => first.keys.length).toBe(1);
    await other.locator('#reader-membership-redeem').click();
    await expect(other.locator('#reader-membership-status')).toHaveText(messages.membershipRetrySafe);
    expect(second.keys).toEqual([]);
    release();
    await expect(page.locator('#reader-membership-status')).toHaveText(messages.membershipRedeemed);
  } finally { release(); await other.close(); }
});

for (const returnTo of ['/\\outside.example', '/%255coutside.example', '/a/..//outside.example']) {
  test(`login cannot follow unsafe returnTo ${returnTo}`, async ({ page }) => {
    await fixture(page, { authenticated: false });
    await page.goto(`/en/library/?returnTo=${encodeURIComponent(returnTo)}`);
    const origin = new URL(page.url()).origin;
    await page.locator('#reader-identifier').fill('fixture@example.test');
    await page.locator('#reader-password').fill('fixture-password');
    await page.locator('#reader-login-submit').click();
    await expect(page.locator('#reader-membership-panel')).toBeVisible();
    expect(new URL(page.url()).origin).toBe(origin);
    expect(new URL(page.url()).pathname).toBe('/en/library/');
  });
}
