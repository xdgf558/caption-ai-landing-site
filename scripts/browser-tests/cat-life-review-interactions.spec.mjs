import { expect, test } from '@playwright/test';

for (const width of [390, 1280]) {
  test(width + 'px: rescue successors stay stationary under an edge hover and accept ordinary clicks', async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/games/cat-life/?lang=en');
    await expect(page.locator('[data-care-journey]')).toBeVisible();
    for (const kind of ['meal', 'supplies']) {
      await page.mouse.move(0, 0);
      await page.evaluate((kind) => {
        const game = window.CatGame;
        game.state.game = game.state.createNewGame();
        const state = game.state.game;
        state.player.careLearning.metCat = true;
        state.cats[0].careStatus = 'sheltered';
        if (kind === 'meal') {
          state.player.gold = 0; state.player.hunger = 100; state.inventory.bread = 0;
        }
        window.CatGameApp.render();
      }, kind);
      await page.locator('[data-care-journey] [data-rescue-cat]').click();
      const button = page.locator(kind === 'meal' ? '[data-care-journey] [data-care-meal]' : '[data-care-journey] [data-learning-supplies]');
      await button.scrollIntoViewIfNeeded();
      const before = await button.boundingBox();
      await page.mouse.move(before.x + before.width / 2, before.y + before.height - 0.5);
      const samples = await button.evaluate(async (node) => {
        const positions = [];
        for (let index = 0; index < 24; index++) {
          await new Promise(requestAnimationFrame);
          const rect = node.getBoundingClientRect();
          positions.push({ top: rect.top, left: rect.left });
        }
        return positions;
      });
      expect(Math.max(...samples.map((value) => Math.abs(value.top - before.y)))).toBeLessThan(0.1);
      expect(Math.max(...samples.map((value) => Math.abs(value.left - before.x)))).toBeLessThan(0.1);
      await expect(button).toHaveCSS('transform', 'none');
      await button.click({ timeout: 2000 });
      if (kind === 'meal') {
        expect(await page.evaluate(() => window.CatGame.state.game.player.hunger)).toBeLessThan(100);
      } else {
        expect(await page.evaluate(() => window.CatGame.state.game.player.careLearning.supplyClaims)).toEqual([1]);
      }
    }
  });

  test(width + 'px: expanding ten memories retains visible keyboard focus without moving the control', async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/games/cat-life/?lang=en');
    await expect(page.locator('[data-care-journey]')).toBeVisible();
    await page.evaluate(() => {
      const game = window.CatGame;
      const keys = ['met', 'feed', 'play', 'treat', 'welcome', 'rescue', 'bond_25', 'bond_50', 'bond_75', 'bond_100'];
      game.state.game.cats[0].memoryJournal = { version: 1, entries: keys.map((key, index) => ({
        key, order: index + 1, at: new Date().toISOString(),
      })) };
    });
    await page.locator('nav [data-page-target="cats"]:visible').click();
    const toggle = page.locator('[data-memory-toggle]');
    await toggle.evaluate((node) => {
      node.scrollIntoView({ block: 'center' });
      node.focus({ preventScroll: true });
    });
    const before = await toggle.boundingBox();
    await toggle.press('Enter');
    await expect(page.locator('.cat-memory-entry')).toHaveCount(10);
    await expect(toggle).toBeFocused();
    const after = await toggle.boundingBox();
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
    async function visibleFocus() {
      const bounds = await toggle.boundingBox();
      const top = await page.locator('.station-site-bar').evaluate((node) => node.getBoundingClientRect().bottom);
      const bottom = await page.locator('#app-mobile-navigation').evaluate((node) => {
        return getComputedStyle(node).display === 'none' ? innerHeight : node.getBoundingClientRect().top;
      });
      expect(bounds.y).toBeGreaterThanOrEqual(top);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(bottom);
      await expect(toggle).toBeFocused();
    }
    await visibleFocus();
    await page.screenshot({ path: info.outputPath('expanded-focus-' + width + '.png') });
    await toggle.press('Space');
    await expect(page.locator('.cat-memory-entry')).toHaveCount(3);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await visibleFocus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
