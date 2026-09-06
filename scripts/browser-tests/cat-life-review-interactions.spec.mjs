import { expect, test } from '@playwright/test';

async function sampleLiveButton(page, selector, mutation = null) {
  return page.evaluate(async ({ selector, mutation }) => {
    const positions = [];
    const started = performance.now();
    let previous = document.querySelector(selector);
    let replacements = 0;
    let forcedRender = false;
    let mutationApplied = false;
    const result = (error = null) => ({ positions, replacements, forcedRender, mutationApplied, error, elapsed: performance.now() - started });
    // A tick only refreshes DOM when state changes. Trigger the target redraw
    // after sampling begins, independent of timezone, shop offers or timer phase.
    do {
      await new Promise(requestAnimationFrame);
      if (!forcedRender && positions.length > 0) {
        window.CatGameApp.render();
        forcedRender = true;
      } else if (mutation && !mutationApplied && forcedRender && replacements > 0) {
        // First observe the replacement; mutate only the live successor on a
        // later frame. Inspection below must query again, never reuse that node.
        const target = document.querySelector(selector);
        if (!target) return result('missing');
        if (mutation === 'move') {
          target.style.setProperty('transition', 'none', 'important');
          target.style.setProperty('transform', 'translateY(-4px)', 'important');
        } else if (mutation === 'hidden') {
          target.style.setProperty('display', 'none', 'important');
        } else if (mutation === 'deleted') {
          target.remove();
        } else if (mutation === 'duplicate') {
          target.parentElement.appendChild(target.cloneNode(true));
        }
        mutationApplied = true;
      }
      const nodes = document.querySelectorAll(selector);
      if (nodes.length === 0) return result('missing');
      if (nodes.length !== 1) return result('duplicate');
      const node = nodes[0];
      const rect = node.getBoundingClientRect();
      if (!node.isConnected || rect.width <= 0 || rect.height <= 0 || getComputedStyle(node).visibility === 'hidden') {
        return result('hidden');
      }
      if (node !== previous) replacements++;
      previous = node;
      positions.push({ top: rect.top, left: rect.left, transform: getComputedStyle(node).transform });
    } while (performance.now() - started < 1200);
    return result();
  }, { selector, mutation });
}

function expectStationary(sample, before) {
  expect(sample.error, 'live control remains unique and visible').toBeNull();
  expect(sample.forcedRender).toBe(true);
  expect(sample.replacements, 'sampler observed the explicit redraw').toBeGreaterThan(0);
  expect(sample.positions.length).toBeGreaterThan(0);
  expect(sample.elapsed).toBeGreaterThanOrEqual(1200);
  expect(Math.max(...sample.positions.map((value) => Math.abs(value.top - before.y))), 'live vertical movement').toBeLessThan(0.1);
  expect(Math.max(...sample.positions.map((value) => Math.abs(value.left - before.x))), 'live horizontal movement').toBeLessThan(0.1);
  expect(sample.positions.every((value) => value.transform === 'none'), 'live button transform').toBe(true);
}

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
      const selector = kind === 'meal' ? '[data-care-journey] [data-care-meal]' : '[data-care-journey] [data-learning-supplies]';
      const button = page.locator(selector);
      await button.scrollIntoViewIfNeeded();
      const before = await button.boundingBox();
      await page.mouse.move(before.x + before.width / 2, before.y + before.height - 0.5);
      const sample = await sampleLiveButton(page, selector);
      expectStationary(sample, before);
      await expect(button).toHaveCSS('transform', 'none');
      await button.click({ timeout: 2000 });
      if (kind === 'meal') {
        expect(await page.evaluate(() => window.CatGame.state.game.player.hunger)).toBeLessThan(100);
      } else {
        expect(await page.evaluate(() => window.CatGame.state.game.player.careLearning.supplyClaims)).toEqual([1]);
      }
    }
  });

  for (const mutation of ['move', 'hidden', 'deleted', 'duplicate']) test(width + 'px: live sampler rejects ' + mutation + ' after observing a redraw', async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/games/cat-life/?lang=en');
    await expect(page.locator('[data-care-journey]')).toBeVisible();
    await page.locator('[data-learning-meet]').click();
    const selector = '[data-care-journey] [data-learning-supplies]';
    const button = page.locator(selector);
    await button.scrollIntoViewIfNeeded();
    const before = await button.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    const sample = await sampleLiveButton(page, selector, mutation);
    expect(sample.forcedRender).toBe(true);
    expect(sample.replacements, 'negative control sampled the live replacement').toBeGreaterThan(0);
    expect(sample.mutationApplied).toBe(true);
    if (mutation === 'move') {
      expect(sample.error).toBeNull();
      expect(() => expectStationary(sample, before)).toThrow(/live vertical movement/);
    } else {
      expect(sample.error).toBe(mutation === 'deleted' ? 'missing' : mutation);
      expect(() => expectStationary(sample, before)).toThrow(/live control remains unique and visible/);
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
