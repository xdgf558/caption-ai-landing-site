import { test, expect } from '@playwright/test';

const endpoint = '**/admin/api/readers/membership-refund-reviews*';
async function fixture(page, { stale = false, blocked = false, lose = false } = {}) {
  const detail = {
    id: 11, account: { id: 1, email: 'review@example.test' },
    reversal: { source_ref: 'order-test-one', credits_delta: -100, created_at: '2026-09-09 13:00:00', note: '<img src=x onerror=alert(1)> Refund fixture' },
    topup: { credits_delta: 100 }, membership: { expires_at: '2026-11-09 13:00:00' }, version: 'a'.repeat(64),
    candidates: blocked ? [] : [{ ledgerId: 7, costCredits: 10, createdAt: '2026-09-08 13:00:00', remainingSeconds: 2678400,
      effectiveStart: '2026-10-09 13:00:00', effectiveEnd: '2026-11-09 13:00:00' }], review: null
  };
  const state = { posts: [], detail };
  await page.route(endpoint, async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); state.posts.push(body);
      if (stale) return route.fulfill({ status: 409, json: { ok: false, code: 'REVIEW_STALE' } });
      detail.review = { reversalId: 11, decision: body.decision, reason: body.reason, actor: 'admin@example.test',
        before: { expires_at: '2026-11-09 13:00:00' }, afterExpiresAt: body.decision === 'revoke' ? '2026-10-09 13:00:00' : '2026-11-09 13:00:00',
        removedSeconds: body.decision === 'revoke' ? 2678400 : 0, reviewedAt: '2026-09-09 14:00:00' };
      if (lose) return route.abort('failed');
      return route.fulfill({ json: { ok: true, review: detail.review } });
    }
    if (new URL(request.url()).searchParams.has('id')) return route.fulfill({ json: { ok: true, ...detail } });
    return route.fulfill({ json: { ok: true, reviews: [{ id: 11, email: 'review@example.test', credits_delta: -100, created_at: '2026-09-09 13:00:00' }], next: null } });
  });
  await page.goto('/admin/membership-refunds/');
  await page.locator('[data-review-id="11"]').click();
  await expect(page.locator('#refund-form')).toBeVisible();
  return state;
}
async function fill(page) {
  await page.locator('[name="reason"]').fill('已核对退款订单和会员兑换的关联证明，确认本次审核。');
  await page.locator('[name="confirmation"]').fill('11');
  await page.locator('[name="acknowledged"]').check();
}

for (const width of [1280, 390]) test(`manual VIP review is explicit and readable at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await fixture(page);
  await expect(page.locator('#refund-detail img')).toHaveCount(0);
  await expect(page.locator('[name="decision"][value="keep"]')).toBeChecked();
  await page.locator('[name="decision"][value="revoke"]').check();
  await expect(page.locator('#refund-submit')).toBeDisabled();
  await page.locator('[name="redemption"]').check();
  await expect(page.locator('#refund-preview')).toContainText('10 点');
  await fill(page);
  await page.locator('[name="confirmation"]').press('Enter');
  expect(state.posts).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath(`refund-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#refund-submit').click();
  await expect(page.locator('#refund-detail')).toContainText('已撤销对应期限');
  await expect(page.locator('#refund-form')).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
  expect(state.posts[0].redemptionIds).toEqual([7]);
  expect(state.posts[0].version).toBe('a'.repeat(64));
});

test('stale review locks the form until explicitly reloaded', async ({ page }) => {
  const state = await fixture(page, { stale: true });
  await fill(page);
  await page.locator('#refund-submit').click();
  await expect(page.locator('#refund-status')).toContainText('已变化');
  await expect(page.locator('#refund-submit')).toBeDisabled();
  expect(state.posts).toHaveLength(1);
  await page.locator('#refund-refresh').click();
  await expect(page.locator('[name="reason"]')).toBeEnabled();
  expect(state.posts).toHaveLength(1);
});

test('unknown response reloads the completed decision, never submits another deduction', async ({ page }) => {
  const state = await fixture(page, { lose: true });
  await fill(page);
  await page.locator('#refund-submit').click();
  await expect(page.locator('#refund-status')).toContainText('不会自动再次提交');
  await page.locator('#refund-refresh').click();
  await expect(page.locator('#refund-detail')).toContainText('已保留 VIP');
  await expect(page.locator('#refund-form')).toHaveCount(0);
  expect(state.posts).toHaveLength(1);
});

test('unknown historical allocation cannot be revoked; dirty filters require confirmation', async ({ page }) => {
  const state = await fixture(page, { blocked: true });
  await expect(page.locator('[name="decision"][value="revoke"]')).toBeDisabled();
  await page.locator('[name="reason"]').fill('尚在核对相关证据，不能随意撤销。');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#refund-filter').selectOption('reviewed');
  await expect(page.locator('#refund-filter')).toHaveValue('pending');
  await expect(page.locator('[name="reason"]')).toHaveValue('尚在核对相关证据，不能随意撤销。');
  expect(state.posts).toHaveLength(0);
});
