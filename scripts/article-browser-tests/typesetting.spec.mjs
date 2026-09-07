import { test, expect } from '@playwright/test';

async function editor(page, id) {
  await page.goto('/admin/articles/');
  await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
  await page.getByLabel('X 文章链接', { exact: true }).fill(`https://x.com/i/article/${id}`);
  await page.getByLabel('标题', { exact: true }).fill(`Typesetting ${id}`);
  await page.getByLabel('摘要', { exact: true }).fill('Structured content without rewriting the original text.');
  await page.locator('#article-body-section summary').click();
  return page.getByLabel('正文', { exact: true });
}

async function paste(body, html) {
  return body.evaluate((el, html) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', html);
    clipboardData.setData('text/plain', 'Plain clipboard text');
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  }, html);
}

test('rich paste preserves structure, drops external resources and survives save/preview/public rendering', async ({ page, context }) => {
  const body = await editor(page, 8101);
  const external = [];
  page.on('request', req => { if (req.url().includes('tracker.invalid')) external.push(req.url()); });
  await paste(body, `<h1>A pasted heading</h1><p>Hello <b>bold</b> and <i>italic</i>.</p>
    <p><span style="font-weight:700">Word emphasis</span> <del>Removed</del></p>
    <blockquote>A quotation</blockquote><ol><li>First</li><li>Second<ul><li>Nested</li></ul></li></ol>
    <table><thead><tr> <th>Name</th> <th>Value</th> </tr></thead><tbody><tr><td>A | B</td><td><code>x | y</code></td></tr></tbody></table>
    <pre><code>const x = "&lt;script&gt;";</code></pre><p><a href="https://example.com/">Read more</a></p>
    <script src="https://tracker.invalid/code.js">window.pastedScript=true</script><img src="https://tracker.invalid/image.png" alt="Remote caption" onerror="alert(1)">
    <iframe src="https://tracker.invalid/frame"></iframe><a href="javascript:alert(1)">Unsafe link</a><p hidden>Hidden text</p>`);
  await expect(body).toHaveValue(/\*\*bold\*\*/);
  await expect(body).not.toHaveValue(/tracker.invalid|javascript:|pastedScript|Hidden text/);
  await expect(page.locator('#editor-state')).toHaveText('未保存修改');
  expect(external).toEqual([]);
  expect(await page.evaluate(() => window.pastedScript)).toBeUndefined();
  const markdown = await body.inputValue();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const frame = page.frameLocator('#article-preview-frame');
  await expect(frame.getByRole('heading', { name: 'A pasted heading', level: 2 })).toBeVisible();
  await expect(frame.locator('.article-prose strong')).toHaveText(['bold', 'Word emphasis']);
  await expect(frame.locator('.article-prose td')).toHaveText(['A | B', 'x | y']);
  await expect(frame.locator('.article-prose pre code')).toContainText('const x = "<script>";');
  await expect(frame.locator('.article-prose ol ul li')).toHaveText('Nested');
  await expect(frame.locator('.article-prose img')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '撤销排版' })).toBeEnabled();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('草稿已保存。');
  await expect(page.getByRole('button', { name: '撤销排版' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: /Typesetting 8101 草稿/ }).click();
  await expect(body).toHaveValue(markdown);
  await page.getByRole('button', { name: '发布文章', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('文章已发布。');
  const reader = await context.newPage();
  await reader.goto('/zh-hans/signal/x-article-8101/');
  await expect(reader.locator('.article-prose td')).toHaveText(['A | B', 'x | y']);
  await expect(reader.locator('.article-prose strong')).toHaveText(['bold', 'Word emphasis']);
});

test('formatting is undoable, toolbar never submits and paste rejects unsafe conversions without losing text', async ({ page }) => {
  const body = await editor(page, 8102);
  let saves = 0;
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/admin/api/articles') saves++; });
  const original = '## Title\n\n\nParagraph\n\n\n```js\n  const x = 1;\n\n```\n\n\n';
  await body.fill(original);
  await page.getByRole('button', { name: '整理排版', exact: true }).click();
  await expect(body).toHaveValue('## Title\n\nParagraph\n\n```js\n  const x = 1;\n\n```');
  await page.getByRole('button', { name: '撤销排版', exact: true }).click();
  await expect(body).toHaveValue(original);
  await body.fill('Bold text');
  await body.evaluate(el => el.setSelectionRange(0, el.value.length));
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await expect(body).toHaveValue('**Bold text**');
  await page.getByRole('button', { name: '撤销排版', exact: true }).click();
  await expect(body).toHaveValue('Bold text');
  await paste(body, '<table><tr><td colspan="2">Merged</td></tr></table>');
  await expect(body).toHaveValue('Bold text');
  await expect(page.getByRole('status')).toContainText('合并单元格');
  await page.getByLabel('保留粘贴格式').uncheck();
  expect(await paste(body, '<p>Plain mode</p>')).toBe(false);
  await expect(body).toHaveValue('Bold text');
  await page.getByLabel('保留粘贴格式').check();
  await body.fill('x'.repeat(119999));
  await paste(body, '<p>Too much text</p>');
  await expect(page.getByRole('status')).toContainText('120000');
  expect((await body.inputValue()).length).toBe(119999);
  expect(saves).toBe(0);
});

test('headerless pasted tables retain first-row data and body image upload is undoable', async ({ page }) => {
  const body = await editor(page, 8103);
  await paste(body, '<table><tr> <td>First row</td> <td>42</td> </tr><tr><td>Second row</td><td>80</td></tr></table>');
  const before = await body.inputValue();
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.frameLocator('#article-preview-frame').locator('.article-prose td')).toHaveText(['First row', '42', 'Second row', '80']);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await body.evaluate(el => el.setSelectionRange(el.value.length, el.value.length));
  await page.locator('#article-body-image').setInputFiles('public/favicon-64.png');
  await expect(page.getByRole('status')).toContainText('图片已插入');
  await expect(body).toHaveValue(/!\[favicon-64.png\]\(\/api\/content\/media\?key=/);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  const image = page.frameLocator('#article-preview-frame').getByRole('img', { name: 'favicon-64.png' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '撤销排版', exact: true }).click();
  await expect(body).toHaveValue(before);
  await page.locator('#article-body-image').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.getByRole('status')).toContainText('5MB');
  await expect(body).toHaveValue(before);
});

for (const width of [390, 1280]) {
  test(`enhanced editor and article stay contained at ${width}px`, async ({ page, request, baseURL }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const id = 8200 + width;
    const body = await editor(page, id);
    const long = 'long-content-'.repeat(30);
    const markdown = `## A readable heading\n\nA **highlight**, a [link](https://example.com) and an observation.\n\n> A short quotation.\n\n| Column one | Column two | Column three |\n| --- | --- | --- |\n| ${long} | Content | More |\n\n\`\`\`js\nconst text = "${long}";\n\`\`\``;
    await body.fill(markdown);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.body-tools').screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) });
    const response = await request.post('/admin/api/articles', { headers: { origin: baseURL }, data: {
      sourceUrl: `https://x.com/i/article/${id}`, title: 'Enhanced article layout', description: 'Local typography fixture', locale: 'zh-Hans', markdown, status: 'published'
    } });
    expect(response.ok()).toBe(true);
    await page.goto(`/zh-hans/signal/x-article-${id}/`);
    await expect(page.locator('.article-prose table')).toBeVisible();
    const table = page.getByRole('region', { name: '表格', exact: true });
    if (width === 390) expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const code = page.locator('.article-prose pre');
    expect(await code.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`article-${width}.png`), fullPage: true });
  });
}
