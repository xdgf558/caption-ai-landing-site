// Optional local design evidence; screenshots stay outside the deployed public tree.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const baseline = process.argv[2] || 'origin/main';
const baseURL = process.argv[3] || 'http://127.0.0.1:4180';
const output = 'test-results/memories-design';
await mkdir(output, { recursive: true });
const oldCat = execFileSync('git', ['show', baseline + ':public/games/cat-life/src/js/ui/renderCatPanel.js'], { encoding: 'utf8' });
const browser = await chromium.launch();
try {
  for (const width of [390, 1040, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-09-06T12:00:00Z') });
    await page.goto(baseURL + '/games/cat-life/?lang=zh-CN');
    await page.locator('[data-care-journey]').waitFor();
    await page.evaluate(() => {
      const game = window.CatGame, cat = game.state.game.cats[0];
      game.state.game.player.careLearning.eligible = false;
      Object.assign(cat, { intimacy: 62, hunger: 50, mood: 50 });
      game.state.game.inventory.toys = 10;
      delete cat.memoryJournal;
      game.systems.catSystem.performAction(cat.id, 'feedBasic');
      game.systems.catSystem.performAction(cat.id, 'play');
      game.state.saveSystem.saveGame(game.state.game);
    });
    await page.reload();
    await page.locator('[data-care-journey]').waitFor();
    await page.addScriptTag({ content: oldCat });
    async function capture(name) {
      await page.clock.setSystemTime(new Date('2026-09-06T12:00:00Z'));
      await page.locator('nav [data-page-target="cats"]:visible').click();
      await page.locator('#app-main img').evaluateAll(async (images) => {
        images.forEach((image) => { image.loading = 'eager'; });
        await Promise.all(images.map((image) => image.decode().catch(() => {})));
        if (images.some((image) => !image.naturalWidth)) throw new Error('Unloaded cat-page image');
      });
      await page.clock.runFor(5000);
      await page.screenshot({ path: output + '/' + name + '-full-' + width + '.png', fullPage: true });
      await page.locator('.cat-bond-card').evaluate((node) => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 96));
      await page.clock.runFor(100);
      await page.screenshot({ path: output + '/' + name + '-' + width + '.png' });
    }
    await capture('before');
    await page.reload();
    await page.locator('[data-care-journey]').waitFor();
    await capture('after');
    await sharp({ create: { width: width * 2, height: 844, channels: 3, background: '#ffffff' } })
      .composite([{ input: output + '/before-' + width + '.png', left: 0, top: 0 }, { input: output + '/after-' + width + '.png', left: width, top: 0 }])
      .png().toFile(output + '/comparison-' + width + '.png');
    const beforeSize = await sharp(output + '/before-full-' + width + '.png').metadata();
    const afterSize = await sharp(output + '/after-full-' + width + '.png').metadata();
    await sharp({ create: { width: width * 2, height: Math.max(beforeSize.height, afterSize.height), channels: 3, background: '#ffffff' } })
      .composite([{ input: output + '/before-full-' + width + '.png', left: 0, top: 0 }, { input: output + '/after-full-' + width + '.png', left: width, top: 0 }])
      .png().toFile(output + '/comparison-full-' + width + '.png');
    console.log('Full page pixels:', width, beforeSize.height, afterSize.height);
    await page.locator('nav [data-page-target="home"]:visible').click();
    await page.locator('.home-latest-memory').evaluate((node) => window.scrollTo(0, window.scrollY + node.getBoundingClientRect().top - 96));
    await page.screenshot({ path: output + '/home-' + width + '.png' });
    await page.locator('[data-open-memories]').click();
    const titleTop = await page.locator('#cat-memories-title').evaluate((node) => node.getBoundingClientRect().top);
    const headerBottom = await page.locator('.station-site-bar').evaluate((node) => node.getBoundingClientRect().bottom);
    if (titleTop < headerBottom) throw new Error('Memory heading hidden under sticky header at ' + width);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Horizontal overflow at ' + width);
    await page.screenshot({ path: output + '/journal-' + width + '.png' });
    console.log('Compared baseline/current and checked home → journal at ' + width + 'px');
    await context.close();
  }
} finally { await browser.close(); }
