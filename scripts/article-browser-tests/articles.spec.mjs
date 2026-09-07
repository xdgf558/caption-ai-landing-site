import { test, expect } from '@playwright/test';

test('manual fallback, cover, draft, preview, publish, conflict and withdrawal', async ({ page, context }) => {
  await page.goto('/admin/articles/');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
  await page.getByLabel('X 文章链接', { exact: true }).fill('https://x.com/i/article/2001');
  await page.getByRole('button', { name: '识别链接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('请手动填写');
  await page.getByLabel('标题', { exact: true }).fill('Browser acceptance article');
  await page.getByLabel('摘要', { exact: true }).fill('A local-only publishing workflow.');
  await page.locator('#article-cover').setInputFiles('public/favicon-64.png');
  await expect(page.getByRole('status')).toContainText('封面已上传');
  await page.locator('#article-body-section summary').click();
  await page.getByLabel('正文', { exact: true }).fill('## Local body\n\n<script>alert(1)</script>');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('草稿已保存。');
  await page.reload();
  await page.getByRole('button', { name: /Browser acceptance article 草稿/ }).click();
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(/<script>/);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.frameLocator('#article-preview-frame').getByRole('heading', { name: 'Local body' })).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '发布文章', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('文章已发布。');
  const stale = await context.newPage();
  await stale.goto('/admin/articles/');
  await stale.getByRole('button', { name: /Browser acceptance article 已发布/ }).click();
  await page.getByLabel('标题', { exact: true }).fill('Updated acceptance article');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('文章已发布。');
  await stale.getByLabel('标题', { exact: true }).fill('Stale edit');
  await stale.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(stale.getByRole('status')).toContainText('重新载入');
  await stale.close({ runBeforeUnload: false });
  const reader = await context.newPage();
  await reader.goto('/signal/');
  await reader.getByRole('link', { name: 'Updated acceptance article', exact: true }).click();
  await expect(reader).toHaveURL(/\/zh-hans\/signal\/x-article-2001\//);
  await expect(reader.getByRole('heading', { name: 'Local body' })).toBeVisible();
  await page.getByRole('button', { name: '下架', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('文章已下架。');
  await reader.goto('/signal/');
  await expect(reader.getByRole('link', { name: 'Updated acceptance article', exact: true })).toHaveCount(0);
});

for (const width of [390, 1280]) {
  test(`article and editor layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/signal/', '/en/signal/', '/ja/signal/', '/zh-hans/signal/', '/zh-hans/signal/x-article-1001/', '/admin/articles/']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const images = page.locator('img:visible');
      for (const image of await images.all()) await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    }
  });
}
