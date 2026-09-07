import { test, expect } from '@playwright/test';

test('Enter saves a draft and legacy editors cannot rewrite an article', async ({ page, request, baseURL }) => {
  await page.goto('/admin/articles/');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
  await page.getByLabel('X 文章链接', { exact: true }).fill('https://x.com/i/article/3001');
  await page.getByLabel('标题', { exact: true }).fill('Enter remains a draft');
  await page.getByLabel('摘要', { exact: true }).fill('Never publish by implicit form submission.');
  for (const field of ['标题', 'X 文章链接']) {
    const saved = page.waitForResponse(response => response.url().endsWith('/admin/api/articles') && response.request().method() === 'POST');
    await page.getByLabel(field, { exact: true }).press('Enter');
    expect((await (await saved).json()).entry.status).toBe('draft');
    await expect(page.getByRole('status')).toHaveText('草稿已保存。');
  }
  await page.getByRole('button', { name: '发布文章', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('文章已发布。');
  const entries = (await (await request.get('/admin/api/articles')).json()).entries;
  const article = entries.find(entry => entry.slug === 'x-article-3001');
  expect(article.status).toBe('published');
  for (const path of ['/admin/api/content/entries', '/admin/api/signal/import']) {
    const response = await request.post(path, { headers: { origin: baseURL }, data: { entryType: 'signal_brief', locale: article.locale, slug: article.slug, title: 'Legacy overwrite', markdown: 'Wrong body', status: 'published' } });
    expect(response.status()).toBe(409);
    expect((await response.json()).editUrl).toBe('/admin/articles/');
  }
  for (const query of ['', '?type=signal_brief&locale=zh-Hans']) {
    const legacy = (await (await request.get('/admin/api/content/entries' + query)).json()).entries;
    expect(legacy.some(entry => entry.sourceKind === 'x_article')).toBe(false);
  }
  const preserved = (await (await request.get(`/admin/api/articles?id=${article.id}`)).json()).entry;
  expect(preserved.metadata.article).toEqual(article.metadata.article);
  expect(preserved.sourceKind).toBe('x_article');
  await page.reload();
  await expect(page.getByRole('button', { name: /Enter remains a draft 已发布/ })).toBeVisible();
  await page.getByRole('button', { name: /Enter remains a draft 已发布/ }).click();
  await page.getByLabel('标题', { exact: true }).fill('Unsaved change');
  await page.getByLabel('筛选文章', { exact: true }).selectOption('draft');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('筛选文章', { exact: true })).toHaveValue('all');
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('Unsaved change');
});

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

test('paging asks before changing the list and preserves unsaved text', async ({ page, request, baseURL }) => {
  for (let index = 0; index < 21; index++) {
    const result = await request.post('/admin/api/articles', { headers: { origin: baseURL }, data: {
      sourceUrl: `https://x.com/i/article/${5000 + index}`, title: `Paging draft ${index}`, description: 'Local pagination fixture', status: 'draft'
    } });
    expect(result.ok()).toBe(true);
  }
  await page.goto('/admin/articles/');
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeEnabled();
  await page.getByLabel('标题', { exact: true }).fill('Keep this unsaved text');
  const listRequests = [];
  page.on('request', request => { if (request.url().includes('/admin/api/articles?page=')) listRequests.push(request.url()); });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(listRequests).toHaveLength(0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeEnabled();
  expect(listRequests.some(url => url.includes('page=2'))).toBe(true);
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('Keep this unsaved text');
});
