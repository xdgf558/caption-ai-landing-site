import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8');
const policy = headers.split('\n').find(line => line.includes("default-src 'self'; script-src 'self';")).trim().slice('Content-Security-Policy: '.length);

async function open(page, width = 390) {
  await page.setViewportSize({ width, height: 844 });
  await page.route('**/games/cat-life/?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  await page.goto('/games/cat-life/?lang=zh-CN');
  await expect(page.locator('.home-journal-page')).toBeVisible();
  await page.evaluate(() => {
    const g = window.CatGame, cat = g.state.game.cats[0];
    g.state.game.player.careLearning.eligible = false;
    Object.assign(cat, { hunger: 50, mood: 50, health: 80, energy: 80, disease: null, careStatus: 'home', unlocked: true, isAlive: true });
    g.state.game.inventory.food = 10;
    g.state.currentPage = 'cats'; g.state.selectedCatId = cat.id;
    window.CatGameApp.render();
  });
}
const canvas = page => page.locator('.cat-profile-cat-wrap.has-cat-motion canvas');
function pixels(node) { return Array.from(node.getContext('2d').getImageData(0, 0, node.width, node.height).data).filter((_, i) => i % 4 === 3).filter(Boolean).length; }
for (const width of [390, 1040, 1280]) test(`${width}px: CSP-safe rig actually draws; feeding preserves settlement, focus and canvas through redraw`, async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await open(page, width);
  await expect(canvas(page)).toBeAttached();
  expect(await canvas(page).evaluate(pixels)).toBeGreaterThan(1000);
  await page.locator('#cat-care-feedBasic').click();
  await expect(page.locator('[data-motion-action="eat"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.CatGame.state.game.inventory.food)).toBe(9);
  await expect(page.locator('#cat-care-feedBasic')).toBeFocused();
  await page.evaluate(() => { window.__motionCanvas = document.querySelector('.cat-motion-canvas'); window.__receiptStart = CatGame.systems.catInteractionSystem.current(CatGame.state.game.cats[0]).startedAt; });
  await page.locator('#cat-name-input').fill('还没提交');
  await page.evaluate(() => CatGameApp.render(true));
  await expect(canvas(page)).toBeAttached();
  expect(await page.evaluate(() => document.querySelector('.cat-motion-canvas') === window.__motionCanvas)).toBe(true);
  await expect(page.locator('#cat-name-input')).toHaveValue('还没提交');
  await expect(page.locator('#cat-name-input')).toBeFocused();
  expect(await page.evaluate(() => CatGame.systems.catInteractionSystem.current(CatGame.state.game.cats[0]).startedAt === window.__receiptStart)).toBe(true);
  await page.waitForTimeout(1800);
  expect(await canvas(page).evaluate(pixels)).toBeGreaterThan(1000);
  await page.locator('.cat-profile-scene').screenshot({ path: 'test-results/cat-motion-' + width + '.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  expect(await page.evaluate(() => !!window.catPreview)).toBe(false);
  expect(errors).toEqual([]);
});

test('reduced motion, membership and non-orange/sheltered/dead cats retain their original art', async ({ page }) => {
  await open(page);
  await expect(canvas(page)).toBeAttached();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.cat-motion-canvas')).toHaveCount(0);
  await expect(page.locator('.cat-profile-cat')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(canvas(page)).toBeAttached();
  for (const kind of ['member', 'cow', 'sheltered', 'dead', 'locked', 'disease']) {
    await page.evaluate(kind => {
      const g = CatGame, cat = g.state.game.cats[0];
      Object.assign(cat, { unlocked: kind !== 'locked', isAlive: kind !== 'dead', careStatus: kind === 'sheltered' ? 'sheltered' : 'home', disease: kind === 'disease' ? { id: 'cold' } : null });
      cat.traits.artKey = kind === 'cow' ? 'cow_cat' : 'orange_tabby';
      window.CatGameCommerce.getCatSprite = () => kind === 'member' ? new URL('src/assets/premium/moonlit-tabby.png', document.baseURI).href : null;
      window.CatGameCommerce.getCatWalkSprite = () => null;
      CatGameApp.render(true);
    }, kind);
    await expect(page.locator('.cat-motion-canvas')).toHaveCount(0);
    await expect(page.locator('.cat-profile-cat')).toBeVisible();
  }
});
test('asset failure keeps a visible image and care still settles', async ({ page }) => {
  await page.route('**/vendor/cat-motion/head.webp', route => route.abort());
  await open(page);
  await page.locator('#cat-care-feedBasic').click();
  await expect(page.locator('[data-interaction-feedback]')).toContainText('普通猫粮 −1');
  await expect(page.locator('.cat-profile-cat')).toBeVisible();
  await expect(page.locator('.has-cat-motion')).toHaveCount(0);
});
test('home and room use animated cats; repeated routes and save replacement cannot retain stale canvases', async ({ page }) => {
  await open(page, 1280);
  await expect(canvas(page)).toBeAttached();
  for (const destination of ['home', 'community', 'cats', 'home', 'cats']) {
    await page.evaluate(destination => { CatGame.state.currentPage = destination; CatGame.state.communityView = 'player_home'; CatGameApp.render(); }, destination);
    await expect(page.locator('.has-cat-motion canvas')).toHaveCount(1);
    if (destination === 'community') {
      await page.locator('.room-scene').scrollIntoViewIfNeeded();
      await expect.poll(() => page.locator('[data-motion-action="walk"]').count(), { timeout: 20000 }).toBe(1);
    }
  }
  await page.locator('#cat-care-feedBasic').click();
  await expect(page.locator('[data-motion-action="eat"]')).toHaveCount(1);
  await page.evaluate(() => { CatGame.state.game = JSON.parse(JSON.stringify(CatGame.state.game)); CatGameApp.render(true); });
  await expect(page.locator('[data-motion-action="idle"]')).toHaveCount(1);
  await page.evaluate(() => { CatGame.state.currentPage = 'bank'; CatGameApp.render(); });
  await expect(page.locator('.cat-motion-canvas')).toHaveCount(0);
});

test('entering the room during a care reaction resumes the rig when the reaction expires', async ({ page }) => {
  await open(page, 1280);
  await expect(canvas(page)).toBeAttached();
  await page.evaluate(() => { CatGame.state.game.inventory.toys = 3; CatGameApp.render(); });
  await page.locator('#cat-care-play').click();
  await page.evaluate(() => { CatGame.state.currentPage = 'community'; CatGame.state.communityView = 'player_home'; CatGameApp.render(); });
  await expect(page.locator('.room-cat-visual canvas')).toHaveCount(0);
  await expect(page.locator('.room-cat-visual.has-cat-motion canvas')).toHaveCount(1, { timeout: 5000 });
  expect(await page.evaluate(() => CatGame.state.game.inventory.toys)).toBe(2);
});
