import { expect, test } from '@playwright/test';

const start = new Date('2026-09-05T12:00:00Z');
async function open(page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.clock.install({ time: start });
  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-care-journey]')).toBeVisible();
  await expect(page.locator('#app-toast')).toBeHidden();
}
const journey = (page) => page.locator('[data-care-journey]');
const progress = (page) => page.evaluate(() => window.CatGame.state.game.player.careLearning);
async function noOverflow(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}

test('390px first visit: meet, claim once, feed, play and finish real work; progress survives reload', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await expect(journey(page).locator('button')).toHaveCount(1);
  await expect(journey(page)).toContainText('Sunny');
  await expect(journey(page).locator('[aria-current="step"]')).toHaveAttribute('data-learning-step', 'metCat');
  await expect(journey(page).locator('.care-journey-rules')).not.toHaveAttribute('open');
  expect(await journey(page).locator('.care-journey-rules summary').evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.home-route-entry.is-now h4')).toContainText('Say hello to Sunny');
  await noOverflow(page, 390);
  await page.clock.fastForward(4000);
  await page.screenshot({ path: testInfo.outputPath('onboarding-mobile-first.png'), fullPage: true });
  await page.locator('[data-learning-meet]').click();
  expect(await journey(page).locator('h3').evaluate((node) => document.activeElement === node)).toBe(true);
  expect(await progress(page)).toMatchObject({ metCat: true, careDates: [] });
  await page.evaluate(() => { window.CatGame.state.game.settings.autoSave = false; });
  await page.locator('[data-learning-supplies]').click();
  const food = await page.evaluate(() => window.CatGame.state.game.inventory.food);
  expect(await progress(page)).toMatchObject({ supplyClaims: [1], careDates: [] });
  await page.reload();
  await expect(page.locator('[data-learning-supplies]')).toHaveCount(0);
  expect(await page.evaluate(() => window.CatGame.state.game.inventory.food)).toBe(food);
  await journey(page).locator('[data-cat-action="feedBasic"]').click();
  await journey(page).locator('[data-cat-action="play"]').click();
  expect(await progress(page)).toMatchObject({ fed: true, played: true, worked: false, careDates: ['2026-09-05'] });
  await journey(page).locator('[data-page-target="work"]').click();
  await page.locator('[data-job-id="job_flyer"]').click();
  expect((await progress(page)).worked).toBe(false);
  const remaining = await page.evaluate(() => Date.parse(window.CatGame.state.game.player.activeWork.endsAt) - Date.now());
  await page.clock.fastForward(remaining + 1500);
  await expect.poll(async () => (await progress(page)).worked).toBe(true);
  await page.reload();
  expect(await progress(page)).toMatchObject({ worked: true, supplyClaims: [1], careDates: ['2026-09-05'] });
  await noOverflow(page, 390);
  expect(errors).toEqual([]);
});

test('a week away retains the second package and care date; welcome-home does not earn a learning day', async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(() => {
    const game = window.CatGame;
    const cat = game.state.game.cats[0];
    const then = new Date(Date.now() - 7 * 86400000).toISOString();
    Object.assign(game.state.game.player.careLearning, {
      metCat: true, fed: true, played: true, worked: true, careDates: ['2026-08-29'], supplyClaims: [1],
    });
    Object.assign(cat, { name: 'Momo', nameEn: 'Momo', hunger: 30, careLastSyncAt: then, ageUpdatedAt: then, diseaseCheckAt: then, diseaseProgressAt: then });
    for (const key of Object.keys(cat.decayTracker)) cat.decayTracker[key] = then;
    game.state.saveSystem.saveGame(game.state.game);
  });
  await page.reload();
  await expect(journey(page)).toContainText('Safe in temporary care');
  await expect(page.locator('#app-toast')).toBeHidden();
  await expect(journey(page)).toContainText('Momo');
  await expect(journey(page).locator('button')).toHaveCount(1);
  await noOverflow(page, 390);
  await page.clock.fastForward(4000);
  await page.screenshot({ path: testInfo.outputPath('onboarding-mobile-return.png'), fullPage: true });
  await journey(page).locator('[data-rescue-cat="cat_001"]').click();
  expect((await progress(page)).careDates).toEqual(['2026-08-29']);
  await page.locator('[data-learning-supplies]').click();
  expect((await progress(page)).supplyClaims).toEqual([1, 2]);
  await journey(page).locator('[data-cat-action="feedBasic"]').click();
  expect((await progress(page)).careDates).toEqual(['2026-08-29', '2026-09-05']);
  await page.reload();
  await expect(page.locator('[data-learning-supplies]')).toHaveCount(0);
});

test('first clinic aid works with no coins, synchronizes with hospital UI and cannot be reused', async ({ page }, testInfo) => {
  await open(page, 1040);
  await page.evaluate(() => {
    const game = window.CatGame;
    game.state.game.player.gold = 0;
    const cat = game.state.game.cats[0];
    Object.assign(cat, { diseaseId: 'cold', diseaseStartedAt: new Date().toISOString(), diseaseProgressAt: new Date().toISOString() });
    window.CatGameApp.render();
  });
  await expect(journey(page).locator('[data-treat-cat]')).toHaveText('Use first free treatment');
  await page.locator('.desktop-navigation [data-page-target="hospital"]').click();
  await expect(page.locator('.hospital-treatment-copy')).toContainText('this treatment is free');
  await expect(page.locator('.hospital-treat-button')).toBeEnabled();
  await expect(page.locator('.hospital-treat-button')).toContainText('0');
  await noOverflow(page, 1040);
  await page.screenshot({ path: testInfo.outputPath('onboarding-clinic-aid.png'), fullPage: true });
  await page.locator('.hospital-treat-button').click();
  expect((await progress(page)).treatmentUsed).toBe(true);
  expect(await page.evaluate(() => window.CatGame.state.game.player.gold)).toBe(0);
  await page.reload();
  await page.evaluate(() => {
    window.CatGame.state.game.cats[0].diseaseId = 'cold';
    window.CatGameApp.render();
  });
  await page.locator('.desktop-navigation [data-page-target="hospital"]').click();
  await expect(page.locator('.hospital-treat-button')).toBeDisabled();
  await expect(page.locator('.hospital-treatment-copy')).not.toContainText('this treatment is free');
});

test('third care day completes at UTC midnight without needing navigation, while free rescue remains', async ({ page }) => {
  await open(page);
  await page.clock.setSystemTime(new Date('2026-09-05T23:59:50Z'));
  await page.evaluate(() => {
    const game = window.CatGame;
    Object.assign(game.state.game.player.careLearning, {
      metCat: true, fed: true, played: true, worked: true,
      careDates: ['2026-09-01', '2026-09-03'], supplyClaims: [1, 2, 3],
    });
    Object.assign(game.state.game.cats[0], { hunger: 75, clean: 100, energy: 100, mood: 100 });
    window.CatGameApp.render();
  });
  await journey(page).locator('[data-cat-action="feedBasic"]').click();
  expect((await progress(page)).careDates).toHaveLength(3);
  await expect(page.locator('.care-journey-progress')).toBeVisible();
  await page.clock.fastForward(11000);
  await expect(page.locator('.care-journey-progress')).toHaveCount(0);
  await page.evaluate(() => {
    window.CatGame.state.game.cats[0].health = 10;
    window.CatGameApp.render();
  });
  await expect(journey(page).locator('[data-rescue-cat]')).toBeEnabled();
});

test('return recommendations stay useful for veterans, and three locales fit 390px and desktop', async ({ page }, testInfo) => {
  await open(page, 1280);
  await page.clock.fastForward(4000);
  await page.screenshot({ path: testInfo.outputPath('onboarding-desktop-first.png'), fullPage: true });
  for (const width of [1280, 1040, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const language of ['zh-CN', 'en', 'ja']) {
      await page.evaluate((language) => {
        window.CatGame.state.game.settings.language = language;
        window.CatGameApp.render();
      }, language);
      await noOverflow(page, width);
      await expect(journey(page)).not.toContainText(/learning_\w+|undefined|NaN/);
      await expect(journey(page).locator('button')).toHaveCount(1);
    }
  }
  await page.evaluate(() => {
    const game = window.CatGame;
    game.state.game.settings.language = 'en';
    game.state.game.player.careLearning.eligible = false;
    Object.assign(game.state.game.cats[0], { hunger: 100, clean: 100, energy: 100, mood: 100 });
    window.CatGameApp.render();
  });
  await expect(page.locator('.care-journey-progress')).toHaveCount(0);
  await expect(journey(page).locator('[data-page-target="cats"]')).toBeVisible();
});
