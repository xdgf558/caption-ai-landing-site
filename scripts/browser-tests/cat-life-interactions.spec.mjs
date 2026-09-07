import { test, expect } from '@playwright/test';

async function open(page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.clock.install({ time: new Date('2026-09-07T03:00:00Z') });
  await page.goto('/games/cat-life/?lang=zh-CN');
  await expect(page.locator('.home-journal-page')).toBeVisible();
  await page.evaluate(() => {
    const g = window.CatGame, cat = g.state.game.cats[0];
    g.state.game.player.careLearning.eligible = false;
    Object.assign(cat, { hunger: 50, mood: 50, health: 70, energy: 60, intimacy: 20 });
    Object.assign(g.state.game.inventory, { food: 10, toys: 10, litter: 10 });
    g.state.currentPage = 'cats'; g.state.selectedCatId = cat.id; window.CatGameApp.render();
  });
}
for (const width of [390, 1040, 1280]) test(`${width}px: scene, honest receipt, stable three-action layout and additional care`, async ({ page }) => {
  await open(page, width);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const feed = page.locator('#cat-care-feedBasic');
  await feed.click();
  await expect(page.locator('[data-interaction-feedback]')).toContainText('饱腹 +25');
  await expect(page.locator('[data-interaction-feedback]')).toContainText('心情 +4');
  await expect(page.locator('[data-interaction-feedback]')).toContainText('普通猫粮 −1');
  await expect(feed).toBeFocused();
  await expect(page.locator('.cat-profile-cat')).toHaveAttribute('src', /eating-bowl.webp/);
  await expect.poll(() => page.locator('.cat-profile-cat').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  const ys = await page.locator('.cat-interaction-tray button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().top));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.clock.runFor(2300);
  await page.locator('#cat-extra-care-summary').click();
  await page.locator('#cat-care-clean').click();
  await expect(page.locator('#cat-extra-care')).toHaveAttribute('open', '');
  await expect(page.locator('#cat-care-clean')).toBeFocused();
  await page.evaluate(() => window.CatGameApp.render(true));
  await expect(page.locator('#cat-care-clean')).toBeFocused();
  await expect(page.locator('#cat-extra-care')).toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});
test('double click across replacement settles once; background render resumes the animation clock', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    document.querySelector('#cat-care-feedBasic').click();
    window.CatGameApp.render(true);
    document.querySelector('#cat-care-feedBasic').click();
  });
  expect(await page.evaluate(() => window.CatGame.state.game.inventory.food)).toBe(9);
  const started = await page.evaluate(() => window.CatGame.state.catReaction.startedAt);
  await page.clock.runFor(800);
  await page.evaluate(() => window.CatGameApp.render(true));
  expect(await page.evaluate(() => window.CatGame.state.catReaction.startedAt)).toBe(started);
  expect(parseFloat(await page.locator('.cat-profile-cat').evaluate(n => getComputedStyle(n).animationDelay))).toBeLessThanOrEqual(-.8);
  await page.clock.runFor(1600);
  await expect(page.locator('.cat-profile-scene')).not.toHaveClass(/has-reaction/);
  await expect(page.locator('[data-interaction-feedback]')).toContainText('饱腹 +25');
});
test('rest and play have distinct animation, reduced motion disables it; reload clears only UI feedback', async ({ page }) => {
  await open(page);
  await page.locator('#cat-care-play').click();
  await expect(page.locator('.cat-profile-cat')).toHaveCSS('animation-name', 'cat-playing');
  await expect(page.locator('[data-interaction-feedback]')).toContainText('活力 -10');
  await page.locator('#cat-care-rest').click();
  await expect(page.locator('.cat-profile-cat')).toHaveCSS('animation-name', 'cat-resting');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.cat-profile-cat')).toHaveCSS('animation-name', 'none');
  await page.reload();
  await page.locator('nav [data-page-target="cats"]:visible').click();
  await expect(page.locator('[data-interaction-feedback]')).toContainText('陪它做一件小事');
  expect(await page.evaluate(() => window.CatGame.state.game.inventory.toys)).toBe(9);
});
