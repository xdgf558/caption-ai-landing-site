import { expect, test } from '@playwright/test';

async function open(page, width = 390, language = 'en') {
  await page.setViewportSize({ width, height: 844 });
  await page.clock.install({ time: new Date('2026-09-06T12:00:00Z') });
  await page.goto('/games/cat-life/?lang=' + language);
  await expect(page.locator('[data-care-journey]')).toBeVisible();
  await expect(page.locator('#app-toast')).toBeHidden();
}
async function nav(page, target) {
  await page.locator('nav [data-page-target="' + target + '"]:visible').click();
}
async function journal(page) {
  return page.evaluate(() => window.CatGame.state.game.cats[0].memoryJournal);
}
async function noOverflow(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}

test('390px: actual care creates memories; home opens the correct journal, reload and rename retain entries', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(page.locator('.home-latest-memory')).toHaveCount(0);
  await page.locator('[data-learning-meet]').click();
  await expect(page.locator('.home-latest-memory')).toContainText('Our story starts here');
  await page.locator('[data-learning-supplies]').click();
  await page.locator('[data-care-journey] [data-cat-action="feedBasic"]').click();
  await page.locator('[data-care-journey] [data-cat-action="play"]').click();
  await page.locator('[data-open-memories]').click();
  await expect(page.locator('#cat-memories-title')).toBeFocused();
  const top = await page.locator('#cat-memories-title').evaluate((node) => node.getBoundingClientRect().top);
  const barBottom = await page.locator('.station-site-bar').evaluate((node) => node.getBoundingClientRect().bottom);
  expect(top).toBeGreaterThanOrEqual(barBottom);
  await expect(page.locator('.cat-memory-entry')).toHaveCount(3);
  await page.clock.runFor(20000);
  await page.locator('.cat-action-grid [data-cat-action="play"]').click();
  await expect(page.locator('#app-toast')).toContainText('Memory saved: A little closer to you');
  await expect(page.locator('.cat-memory-entry')).toHaveCount(4);
  const memories = await journal(page);
  await page.locator('#cat-name-input').fill('Momo');
  await page.locator('[data-rename-cat]').click();
  await page.reload();
  await page.locator('[data-open-memories]').click();
  expect(await journal(page)).toEqual(memories);
  await expect(page.locator('#cat-profile-title')).toHaveText('Momo');
  await expect(page.locator('.memory-bond-stage')).toHaveText('Growing closer');
  await expect(page.locator('.cat-supply-list > .cat-supply-chip')).toHaveCount(6);
  await expect(page.locator('.cat-supply-chip .cat-supply-chip')).toHaveCount(0);
  await noOverflow(page, 390);
  await page.locator('.cat-memories').scrollIntoViewIfNeeded();
  await page.clock.fastForward(4000);
  await page.screenshot({ path: info.outputPath('memories-mobile.png') });
  expect(errors).toEqual([]);
});

test('journal expansion survives actions and focus refresh while nickname drafts are kept', async ({ page }, info) => {
  await open(page, 1280);
  await page.evaluate(() => {
    const game = window.CatGame, cat = game.state.game.cats[0];
    Object.assign(cat, { intimacy: 74, hunger: 50, mood: 50 });
    game.state.game.inventory.toys = 10;
    game.systems.catSystem.performAction(cat.id, 'feedBasic');
    game.systems.catSystem.performAction(cat.id, 'play');
    game.state.saveSystem.saveGame(game.state.game);
  });
  await nav(page, 'cats');
  await expect(page.locator('.cat-memory-entry')).toHaveCount(3);
  await page.locator('[data-memory-toggle]').click();
  await expect(page.locator('.cat-memory-entry')).toHaveCount(6);
  await expect(page.locator('[data-memory-toggle]')).toBeFocused();
  await page.locator('.cat-action-grid [data-cat-action="rest"]').click();
  await expect(page.locator('[data-memory-toggle]')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#cat-name-input').fill('Draft name');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#cat-name-input')).toHaveValue('Draft name');
  await expect(page.locator('[data-memory-toggle]')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.cat-memories').scrollIntoViewIfNeeded();
  await page.clock.fastForward(4000);
  await page.screenshot({ path: info.outputPath('memories-desktop.png') });
  await noOverflow(page, 1280);
});

test('most recent memory selects its own cat instead of the previously selected cat', async ({ page }) => {
  await open(page, 1040);
  await page.evaluate(() => {
    const game = window.CatGame;
    game.state.game.cats[1].unlocked = true;
    game.systems.memorySystem.recordMeet(game.state.game.cats[1]);
    game.state.selectedCatId = 'cat_001';
  });
  await nav(page, 'home');
  await expect(page.locator('[data-open-memories]')).toHaveAttribute('data-select-cat', 'cat_002');
  await page.locator('[data-open-memories]').click();
  await expect(page.locator('#cat-profile-title')).toHaveText('MooMoo');
  await expect(page.locator('#cat-memories-title')).toBeFocused();
  await expect(page.locator('.cat-memory-entry')).toHaveCount(1);
  await page.locator('[data-select-cat="cat_001"]').click();
  await expect(page.locator('.cat-memory-entry')).toHaveCount(0);
  await expect(page.locator('.memory-empty')).toBeVisible();
  await noOverflow(page, 1040);
});

for (const language of ['zh-CN', 'en', 'ja']) {
  test(language + ': legacy milestones have no invented dates; complete bond and future journal remain readable', async ({ page }, info) => {
    await open(page, 390, language);
    await page.evaluate(() => {
      const game = window.CatGame;
      game.state.game.cats[0].intimacy = 100;
      delete game.state.game.cats[0].memoryJournal;
      game.state.game = game.state.normalizeGameData(game.state.game);
      game.state.saveSystem.saveGame(game.state.game);
    });
    await nav(page, 'cats');
    await page.locator('[data-memory-toggle]').click();
    await expect(page.locator('.cat-memory-entry')).toHaveCount(4);
    await expect(page.locator('.cat-memories time')).toHaveCount(0);
    await expect(page.locator('.cat-memories')).not.toContainText(/memory_|undefined|NaN/);
    await expect(page.locator('.memory-bond-stage')).not.toHaveText('memory_stage_4');
    await noOverflow(page, 390);
    await page.locator('.cat-memories').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('legacy-' + language + '.png') });
    await page.evaluate(() => {
      window.CatGame.state.game.cats[0].memoryJournal = { version: 2, entries: [{ key: 'unknown', secret: 'keep' }] };
    });
    await nav(page, 'cats');
    await expect(page.locator('.memory-empty')).toBeVisible();
    await expect(page.locator('.cat-memory-entry')).toHaveCount(0);
    await expect(page.locator('.cat-memories')).not.toContainText(/memory_future|unknown/);
  });
}
