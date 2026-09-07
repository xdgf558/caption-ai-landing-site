import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

for (const width of [390, 1280]) {
  test(`article share PNG, copy, QR and focus at ${width}px`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/zh-hans/signal/x-article-1001/');
    const trigger = page.getByRole('button', { name: '分享卡片', exact: true });
    const expected = await trigger.evaluate(el => JSON.parse(el.dataset.articleShare));
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveText('分享卡片已准备好');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('link', { name: '保存图片' }).click();
    const download = await downloadEvent;
    await download.saveAs(test.info().outputPath('article-card.png'));
    const bytes = await readFile(await download.path());
    const metadata = await sharp(bytes).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', 1080, 1440]);
    const { data: pixels, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x,y) => pixels[(y * info.width + x) * info.channels];
    const n = expected.modules.length, cell = Math.floor(248 / (n + 8));
    const x = 1008 - (n + 8) * cell, y = 1148;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      expect(pixel(x + (c + 4) * cell + 1, y + (r + 4) * cell + 1) < 100).toBe(expected.modules[r][c] === '1');
    }
    expect(pixel(x + 1, y + 1)).toBe(255);
    await dialog.getByRole('button', { name: '复制链接' }).click();
    await expect(dialog.getByRole('status')).toHaveText('链接已复制');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://wwwstationcat.org/zh-hans/signal/x-article-1001/');
    await page.screenshot({ path: test.info().outputPath(`share-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByRole('status')).toHaveText('分享卡片已准备好');
  });
}

test('link-only cards, native sharing and unsupported clipboard fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: () => true });
    Object.defineProperty(navigator, 'share', { value: async payload => { window.sharedFile = { name: payload.files[0].name, size: payload.files[0].size, type: payload.files[0].type }; } });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw Error('Denied'); } } });
  });
  await page.goto('/en/signal/');
  await page.locator('.article-row').filter({ hasText: 'Local preview: a quieter place to write' }).getByRole('button', { name: 'Share card' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toHaveText('Share card ready');
  await dialog.getByRole('button', { name: 'Share image', exact: true }).click();
  expect(await page.evaluate(() => window.sharedFile)).toMatchObject({ name: 'station-cat-article.png', type: 'image/png' });
  await dialog.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Select and copy the link below.');
  await expect(dialog.getByRole('textbox')).toHaveValue('https://wwwstationcat.org/en/signal/x-article-1002/');
  await expect(dialog.getByRole('textbox')).toBeFocused();
});

test('image failure can retry; closing during generation does not reopen or leak old content', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    let first = true;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (first) { first = false; callback(null); } else original.call(this, callback, ...args);
    };
  });
  await page.goto('/zh-hans/signal/x-article-1001/');
  await page.getByRole('button', { name: '分享卡片' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toHaveText('卡片制作失败，请重试。');
  await expect(dialog.getByRole('link', { name: '保存图片' })).not.toBeVisible();
  await dialog.getByRole('button', { name: '重试' }).click();
  await expect(dialog.getByRole('status')).toHaveText('分享卡片已准备好');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.route('**/station-cat-logo-1668c2e5-160.webp', async route => { await new Promise(resolve => setTimeout(resolve, 300)); await route.abort(); });
  await page.getByRole('button', { name: '分享卡片' }).click();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-article-share-dialog] img')).not.toHaveAttribute('src');
});

test('long mixed-language titles and summaries stay bounded in the PNG', async ({ page }) => {
  await page.goto('/zh-hans/signal/x-article-1001/');
  const sizes = await page.evaluate(async () => {
    const { createArticleCard, wrapCardText } = await import('/scripts/article-share.js?v=1');
    const data = JSON.parse(document.querySelector('[data-article-share]').dataset.articleShare);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '64px sans-serif';
    const title = '很长的中文标题MixedEnglish日本語'.repeat(10);
    const lines = wrapCardText(ctx, title, 936, 5);
    const blob = await createArticleCard({ ...data, title, description: 'A'.repeat(1200) }, { scan: 'Scan to read' });
    return { count: lines.length, widths: lines.map(line => ctx.measureText(line).width), ellipsis: lines.at(-1).endsWith('…'), bytes: blob.size };
  });
  expect(sizes.count).toBeLessThanOrEqual(5);
  expect(sizes.widths.every(width => width <= 936)).toBe(true);
  expect(sizes.ellipsis).toBe(true);
  expect(sizes.bytes).toBeGreaterThan(20000);
});

for (const [path, open, ready] of [['/signal/', '分享卡片', '分享卡片已準備好'], ['/ja/signal/', 'シェアカード', 'シェアカードを作成しました']]) {
  test(`localized card controls on a short mobile viewport: ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await page.goto(path);
    await page.getByRole('button', { name: open, exact: true }).first().click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText(ready);
    expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().height <= innerHeight)).toBe(true);
    await page.getByRole('dialog').getByRole('textbox').scrollIntoViewIfNeeded();
    await expect(page.getByRole('dialog').getByRole('textbox')).toBeInViewport();
  });
}
