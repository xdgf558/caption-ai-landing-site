import { test, expect } from '@playwright/test';

async function open(page, width, novice = false, action = 'feedBasic') {
  await page.setViewportSize({ width, height: 900 });
  await page.clock.install({ time: new Date('2026-09-07T03:00:00Z') });
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('.home-journal-page')).toBeVisible();
  await page.evaluate(({ novice, action }) => {
    const g = window.CatGame, state = g.state.game, cat = state.cats[0];
    Object.assign(state.player.careLearning, { eligible: novice, metCat: true, supplyClaims: [1, 2, 3] });
    Object.assign(cat, { hunger: action === 'clean' ? 100 : 50, clean: action === 'clean' ? 40 : 90, health: 80, mood: 80, energy: 80 });
    Object.assign(state.inventory, { food: 10, litter: 10, toys: 10 });
    g.state.selectedCatId = cat.id; g.state.currentPage = 'cats'; window.CatGameApp.render();
  }, { novice, action });
}

for (const width of [390, 1280]) {
  for (const novice of [false, true]) test(`${width}px ${novice ? 'novice' : 'veteran'}: guidance locates one care action; settlement is inline once`, async ({ page }) => {
    await open(page, width, novice);
    await expect(page.locator('.cat-journal-care [data-cat-action]')).toHaveCount(0);
    await expect(page.locator('[data-cat-action]')).toHaveCount(7);
    await page.locator('#cat-name-input').fill('Unsubmitted');
    const jump = page.locator('[data-focus-cat-action="feedBasic"]');
    await jump.focus(); await jump.press('Enter');
    const feed = page.locator('#cat-care-feedBasic');
    await expect(feed).toBeFocused();
    expect(await page.evaluate(() => window.CatGame.state.game.inventory.food)).toBe(10);
    const box = await feed.boundingBox();
    const top = await page.locator('.station-site-bar').evaluate(n => n.getBoundingClientRect().bottom);
    expect(box.y).toBeGreaterThanOrEqual(top);
    expect(box.y + box.height).toBeLessThanOrEqual(width === 390 ? await page.locator('#app-mobile-navigation').evaluate(n => n.getBoundingClientRect().top) : 900);
    await feed.press('Enter');
    await expect(page.locator('[data-interaction-feedback]')).toContainText('Done: Feed');
    await expect(page.locator('[data-interaction-feedback]')).toContainText('−1');
    await expect(page.locator('#app-toast')).toBeHidden();
    expect(await page.evaluate(() => window.CatGame.state.game.inventory.food)).toBe(9);
    await expect(page.locator('#cat-name-input')).toHaveValue('Unsubmitted');
    await page.evaluate(() => window.CatGameApp.render(true));
    await expect(feed).toBeFocused();
    await page.clock.runFor(2300);
    await expect(feed).toBeFocused();
    await expect(page.locator('#app-toast')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });

  test(`${width}px: find additional care opens details without consuming; orange focus survives redraw`, async ({ page }) => {
    await open(page, width, false, 'clean');
    await expect(page.locator('#cat-extra-care')).not.toHaveAttribute('open', '');
    const jump = page.locator('[data-focus-cat-action="clean"]');
    await jump.focus(); await jump.press('Enter');
    const clean = page.locator('#cat-care-clean');
    await expect(page.locator('#cat-extra-care')).toHaveAttribute('open', '');
    await expect(clean).toBeFocused();
    expect(await page.evaluate(() => window.CatGame.state.game.inventory.litter)).toBe(10);
    const outline = await clean.evaluate(n => getComputedStyle(n).outlineColor);
    const orange = await clean.evaluate(n => getComputedStyle(n).getPropertyValue('--story-orange').trim());
    expect(outline).toBe(await page.evaluate(color => {
      const n = document.createElement('span'); n.style.color = color; document.body.append(n);
      const value = getComputedStyle(n).color; n.remove(); return value;
    }, orange));
    await clean.press('Enter');
    await page.evaluate(() => window.CatGameApp.render(true));
    await expect(clean).toBeFocused();
    await expect(page.locator('#cat-extra-care')).toHaveAttribute('open', '');
    await expect(page.locator('#app-toast')).toBeHidden();
    expect(await page.evaluate(() => window.CatGame.state.game.inventory.litter)).toBe(9);
  });
}

test('home care keeps success toast; failed care on the cat page keeps errors', async ({ page }) => {
  await open(page, 1280);
  await page.locator('nav [data-page-target="home"]:visible').click();
  await page.locator('[data-care-journey] [data-cat-action="feedBasic"]').click();
  await expect(page.locator('#app-toast')).toBeVisible();
  await page.clock.runFor(20000);
  await page.locator('nav [data-page-target="cats"]:visible').click();
  // A stale enabled control after stock has changed still goes through core validation.
  await page.evaluate(() => { window.CatGame.state.game.inventory.food = 0; });
  await page.locator('#cat-care-feedBasic').click();
  await expect(page.locator('#app-toast')).toBeVisible();
  await expect(page.locator('[data-interaction-feedback]')).toContainText('A little time together');
  expect(await page.evaluate(() => window.CatGame.state.game.inventory.food)).toBe(0);
});
