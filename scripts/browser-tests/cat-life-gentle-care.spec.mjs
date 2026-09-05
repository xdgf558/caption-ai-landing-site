import { expect, test } from '@playwright/test';

async function seedAbsence(page, hours, legacy = false) {
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('.home-journal-page')).toBeVisible();
  await page.evaluate(({ hours, legacy }) => {
    const game = window.CatGame;
    const save = game.state.createNewGame();
    save.settings.language = 'en';
    const then = new Date(Date.now() - hours * 3600000).toISOString();
    const cat = save.cats[0];
    cat.name = 'Momo';
    cat.nameEn = 'Momo';
    cat.intimacy = 61;
    cat.hunger = 8;
    cat.health = 12;
    cat.careLastSyncAt = then;
    cat.ageUpdatedAt = then;
    cat.diseaseProgressAt = then;
    cat.diseaseCheckAt = then;
    Object.keys(cat.decayTracker).forEach((key) => { cat.decayTracker[key] = then; });
    save.player.gold = 0;
    save.player.hunger = 100;
    save.player.hungerUpdatedAt = new Date().toISOString();
    save.inventory.food = 0;
    save.inventory.premiumFood = 0;
    if (legacy) {
      save.schemaVersion = 2;
      cat.isAlive = false;
      cat.diedAt = then;
      cat.deathReason = 'hunger_zero';
      delete cat.careStatus;
      delete cat.careLastSyncAt;
    }
    // pagehide saves live state; keep it aligned with the fixture before reloading.
    game.state.game = save;
    localStorage.setItem(game.state.saveSystem.getStorageKey(), JSON.stringify(save));
  }, { hours, legacy });
  await page.reload();
}

test('390px: welcome back after a week, rescue and emergency meal remain usable after reload', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await seedAbsence(page, 168);
  await expect(page.locator('.care-support-card').first()).toContainText('Safe in temporary care');
  await expect(page.locator('[data-rescue-cat="cat_001"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath('gentle-care-mobile-away.png'), fullPage: true });
  await page.locator('[data-rescue-cat="cat_001"]').click();
  await expect(page.locator('[data-rescue-cat]')).toHaveCount(0);
  await page.locator('[data-care-meal]').click();
  await expect(page.locator('[data-care-meal]')).toHaveCount(0);
  await page.reload();
  const state = await page.evaluate(() => ({
    cat: window.CatGame.state.game.cats[0],
    player: window.CatGame.state.game.player,
  }));
  expect(state.cat).toMatchObject({ id: 'cat_001', name: 'Momo', intimacy: 61, isAlive: true, careStatus: 'home' });
  expect(state.cat.hunger).toBeGreaterThanOrEqual(49);
  expect(state.player.gold).toBe(0);
  expect(state.player.hunger).toBeLessThan(80);
  expect(errors).toEqual([]);
});

test('temporary care connects cats, hospital, collection and backpack without consuming supplies', async ({ page }) => {
  await seedAbsence(page, 24);
  for (const target of ['cats', 'hospital', 'collection']) {
    await page.locator(`.desktop-navigation [data-page-target="${target}"]`).click();
    await expect(page.locator('[data-rescue-cat="cat_001"]')).toBeVisible();
    await expect(page.locator('#app-main')).toContainText('Safe in temporary care');
    await expect(page.locator('#app-main [data-cat-action]:enabled')).toHaveCount(0);
  }
  await page.locator('.desktop-navigation [data-page-target="inventory"]').click();
  await expect(page.locator('#app-main [data-cat-action]:enabled')).toHaveCount(0);
  await page.locator('#app-main [data-page-target="cats"]').first().click();
  await page.locator('[data-rescue-cat="cat_001"]').click();
  await expect(page.locator('.cat-action-grid')).toBeVisible();
});

test('old loss stays opt-in and recovery keeps a local backup and the same bond', async ({ page }) => {
  await seedAbsence(page, 72, true);
  expect(await page.evaluate(() => window.CatGame.state.game.cats[0].isAlive)).toBe(false);
  await expect(page.locator('.care-support-card').first()).toContainText('Your story can continue');
  await page.getByRole('button', { name: 'Back up & welcome back · Free', exact: true }).click();
  expect(await page.evaluate(() => {
    const game = window.CatGame;
    const before = JSON.parse(localStorage.getItem(game.state.saveSystem.getStorageKey() + ':before-care-recovery'));
    return { alive: game.state.game.cats[0].isAlive, bond: game.state.game.cats[0].intimacy, wasAlive: before.cats[0].isAlive };
  })).toEqual({ alive: true, bond: 61, wasAlive: false });
  await page.locator('.desktop-navigation [data-page-target="save"]').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup from before first recovery', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/^cat-care-before-recovery-.*\.json$/);
});

test('focus plus reload preserves two partial 20-minute care intervals', async ({ page }) => {
  const start = Date.parse('2026-09-05T00:00:00Z');
  await page.clock.setFixedTime(new Date(start));
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('.home-journal-page')).toBeVisible();
  await page.evaluate(() => {
    window.CatGame.utils.random.chance = () => false;
  });
  await page.clock.setFixedTime(new Date(start + 20 * 60000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.reload();
  expect(await page.evaluate(() => window.CatGame.state.game.cats[0].hunger)).toBe(80);
  await page.clock.setFixedTime(new Date(start + 40 * 60000));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.reload();
  expect(await page.evaluate(() => window.CatGame.state.game.cats[0].hunger)).toBe(79);
});

test('v2 import honors old cat trackers despite fresh meta and shows the new release notice', async ({ page }) => {
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('.home-journal-page')).toBeVisible();
  const saved = await page.evaluate(() => {
    const save = window.CatGame.state.createNewGame();
    save.schemaVersion = 2;
    save.version = '1.22.1';
    save.settings.language = 'en';
    save.meta.lastSeenVersion = '1.22.1';
    const old = new Date(Date.now() - 24 * 3600000).toISOString();
    save.cats.forEach((cat) => {
      delete cat.careLastSyncAt;
      delete cat.careStatus;
      Object.keys(cat.decayTracker).forEach((key) => { cat.decayTracker[key] = old; });
    });
    return JSON.stringify(save);
  });
  await page.locator('.desktop-navigation [data-page-target="save"]').click();
  await page.locator('#save-import-text').fill(saved);
  await page.locator('[data-import-save]').click();
  await page.locator('.desktop-navigation [data-page-target="home"]').click();
  await expect(page.locator('.care-support-card').first()).toContainText('Safe in temporary care');
  expect(await page.evaluate(() => window.CatGame.state.game.cats[0].hunger)).toBe(64);
  await page.locator('.desktop-navigation [data-page-target="version"]').click();
  await expect(page.locator('#app-main')).toContainText('1.24.0');
  await expect(page.locator('#app-main')).toContainText('Gentle care is on');
  await expect(page.locator('[data-dismiss-release-note]')).toBeVisible();
  await page.locator('[data-dismiss-release-note]').click();
  await page.reload();
  await page.locator('.desktop-navigation [data-page-target="version"]').click();
  await expect(page.locator('[data-dismiss-release-note]')).toHaveCount(0);
});
