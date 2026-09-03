import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const localeLabels = [
  ['Apps', '遊戲', '積分價格', '連載小說', '信號簡報', '會員登入', 'About', 'Follow on X'],
  ['Apps', '游戏', '积分价格', '连载小说', '信号简报', '会员登录', 'About', 'Follow on X'],
  ['Apps', 'Game', 'Points', 'Serials', 'Signal', 'Member Login', 'About', 'Follow on X'],
  ['Apps', 'ゲーム', 'ポイント価格', '連載小説', 'Signal', '会員ログイン', 'About', 'Follow on X']
];

test('keeps the localized mobile homepage navigation in an equal two-by-two grid', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  for (const labels of localeLabels) {
    await page.setContent(`
      <body class="station-home station-home-v2">
        <header class="site-header">
          <nav class="nav-wrap">
            <a class="brand-mark" href="#">
              <span class="brand-icon"><img src="http://127.0.0.1:4178/images/optimized/station-cat-logo-1668c2e5-160.webp" alt="" width="34" height="34"></span>
              <span>Station Cat</span>
            </a>
            <div class="nav-links">
              ${labels.map((label, index) => `<a class="${index > 5 ? 'mobile-hide' : ''}" href="#">${label}</a>`).join('')}
            </div>
            <div class="language-switcher"><select class="language-select"><option>EN</option></select></div>
          </nav>
        </header>
      </body>
    `);
    await page.addStyleTag({ path: resolve('src/styles/global.css') });

    const logo = page.locator('.brand-icon img');
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate((image) => image.complete && image.naturalWidth)).toBe(160);

    const links = page.locator('.station-home-v2 .nav-links a:visible');
    await expect(links).toHaveCount(4);

    const boxes = await links.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { height: rect.height, top: Math.round(rect.top), width: rect.width };
      })
    );
    const rowCounts = boxes.reduce((counts, box) => {
      counts.set(box.top, (counts.get(box.top) || 0) + 1);
      return counts;
    }, new Map());

    expect(Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width))).toBeLessThan(1);
    expect(Math.max(...boxes.map((box) => box.height)) - Math.min(...boxes.map((box) => box.height))).toBeLessThan(1);
    expect([...rowCounts.values()].sort()).toEqual([2, 2]);
    expect(boxes.every((box) => box.height >= 44)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  }
});
