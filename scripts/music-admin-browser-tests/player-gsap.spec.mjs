import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { tracks as fixtures, demoWav } from '../fixtures/music-player/data.mjs';

async function setup(page, lyricsKind = 'lrc') {
  const tracks = fixtures.slice(0, 2).map(track => ({ ...track, durationSec: 120, lyricsKind }));
  const colors = await Promise.all(['#bb7744', '#325fb8'].map(background => sharp({ create: { width: 64, height: 64, channels: 3, background } }).png().toBuffer()));
  await page.route('**/api/music/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/catalog')) return route.fulfill({ json: { schemaVersion: 2, tracks, collections: [], featured: { version: 1, primaryTrackId: tracks[0].id, primarySource: 'primary', secondaryTrackIds: [tracks[1].id], collectionIds: [] } } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { canPlayVipFull: false, authenticated: false, musicVipDeliveryEnabled: false, membershipStatus: 'none', serverNow: new Date().toISOString(), validUntil: null } });
    if (path.endsWith('/cover')) return route.fulfill({ contentType: 'image/png', body: colors[path.includes(tracks[1].id) ? 1 : 0] });
    if (path.endsWith('/audio')) {
      const bytes = demoWav(tracks[0]);
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
      if (!range) return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body: bytes });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
    }
    if (path.endsWith('/lyrics')) return route.fulfill({ contentType: 'text/plain', body: lyricsKind === 'txt' ? '窗外的风慢慢走\n把今天留给温柔\n愿你今夜有好梦' : Array.from({ length: 20 }, (_, i) => `[00:${String(i * 3).padStart(2, '0')}]第 ${i + 1} 句，窗外的风慢慢走`).join('\n') });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh-hans/music/');
  await page.locator('[data-featured-play]').click();
  await expect.poll(() => page.locator('audio').evaluate(a => !a.paused)).toBe(true);
  await expect.poll(() => page.locator('[data-now-cover]').evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true);
}
const seek = (page, seconds) => page.locator('audio').evaluate((audio, seconds) => { audio.pause(); audio.currentTime = seconds; audio.dispatchEvent(new Event('timeupdate')); }, seconds);

for (const reduced of [false, true]) test(`GSAP artwork and timed lyrics: reduced=${reduced}`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await setup(page);
  const audio = await page.locator('audio').elementHandle();
  const started = await page.evaluate(() => {
    document.querySelector('[data-now-toggle]').click();
    return !!document.querySelector('[data-music-motion-art]');
  });
  expect(started).toBe(!reduced);
  await expect(page.locator('[data-music-motion-art]')).toHaveCount(0);
  const content = page.locator('[data-now-lyrics-content]');
  await expect(content.locator('p')).toHaveCount(20);
  await seek(page, 25);
  await expect(content.locator('[aria-current="true"]')).toHaveCount(1);
  await expect(content.locator('[aria-current="true"]')).toContainText('第 9 句');
  await expect(content.locator('[aria-current="true"]')).toHaveCSS('opacity', '1');
  await expect(content.locator('[data-lyric-distance="1"]').first()).toHaveCSS('opacity', '0.72');
  await expect.poll(() => content.evaluate(el => {
    const row = el.querySelector('[aria-current="true"]');
    return Math.abs(row.offsetTop + row.offsetHeight / 2 - el.scrollTop - el.clientHeight / 2);
  })).toBeLessThan(2);
  await content.evaluate(el => { el.dispatchEvent(new Event('touchmove')); el.scrollTop = 10; });
  await seek(page, 37);
  await expect(content.locator('[aria-current="true"]')).toContainText('第 13 句');
  expect(await content.evaluate(el => el.scrollTop)).toBe(10);
  await page.locator('[data-now-lyrics-follow]').click();
  await expect.poll(() => content.evaluate(el => {
    const line = el.querySelector('[aria-current="true"]');
    return Math.abs(line.offsetTop + line.offsetHeight / 2 - el.scrollTop - el.clientHeight / 2);
  })).toBeLessThan(2);
  await expect(page.locator('[data-now-lyrics-follow]')).toBeHidden();
  if (reduced) await expect(content.locator('p').first()).toHaveCSS('transition-duration', '0s');
  const dialog = page.locator('[data-now-dialog]');
  const tint = () => dialog.evaluate(el => getComputedStyle(el).getPropertyValue('--music-cover-tint').trim());
  await expect.poll(tint).toBe('rgb(66,52,43)');
  await page.screenshot({ path: test.info().outputPath('gsap-player-lyrics.png') });
  await page.locator('[data-next]').click();
  await expect.poll(tint).toBe('rgb(30,46,75)');
  expect(await page.locator('audio').evaluate((el, original) => el === original, audio)).toBe(true);
  // Back interrupts any transition without retaining a ghost or document lock.
  await page.goBack();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-music-motion-art]')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('position', 'static');
  expect(errors).toEqual([]);
});

test('plain lyrics remain readable and do not claim timed highlighting', async ({ page }) => {
  await setup(page, 'txt');
  await page.locator('[data-now-toggle]').click();
  const content = page.locator('[data-now-lyrics-content]');
  await expect(content).toContainText('愿你今夜有好梦');
  await expect(content.locator('[aria-current]')).toHaveCount(0);
  await expect(page.locator('[data-now-lyrics-follow]')).toBeHidden();
});


test('artwork transitions can be interrupted, reopened and destroyed without stale overlays', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => document.querySelector('[data-now-toggle]').click());
  await expect(page.locator('[data-now-dialog]')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('[data-now-close]').click();
    document.querySelector('[data-now-toggle]').click();
  });
  await expect(page.locator('[data-now-target]')).toHaveClass(/is-open/);
  await expect(page.locator('[data-music-motion-art]')).toHaveCount(0);
  await page.waitForTimeout(450);
  await expect(page.locator('[data-now-dialog]')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('[data-now-close]').click();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
  await expect(page.locator('[data-now-dialog]')).not.toBeVisible();
  await expect(page.locator('[data-music-motion-art]')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('position', 'static');
  await page.waitForTimeout(450);
  await expect(page.locator('[data-now-target]')).not.toHaveAttribute('style', /opacity|transform/);
});
