import { test, expect } from '@playwright/test';
import { tracks as fixtures, demoWav } from '../fixtures/music-player/data.mjs';

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  test(`mobile player covers the viewport and restores the page at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const track = { ...fixtures[0], effectiveAccess: 'free', durationSec: 120, coverUrl: null, lyricsKind: 'lrc', lyricsAvailable: true };
    await page.route('**/api/music/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/catalog')) return route.fulfill({ json: { schemaVersion: 2, tracks: [track], collections: [], featured: { version: 1, primaryTrackId: track.id, primarySource: 'primary', secondaryTrackIds: [], collectionIds: [] } } });
      if (path.endsWith('/capabilities')) return route.fulfill({ json: { canPlayVipFull: false, musicVipDeliveryEnabled: false, authenticated: false, membershipStatus: 'none', serverNow: new Date().toISOString(), validUntil: null } });
      if (path.endsWith('/audio')) return route.fulfill({ contentType: 'audio/wav', body: demoWav(track) });
      if (path.endsWith('/lyrics')) return route.fulfill({ contentType: 'text/plain', body: '[00:00.00]测试歌词\n[00:05.00]下一行歌词' });
      return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
    });
    await page.goto('/zh-hans/music/');
    // A translated-offscreen skip link must not appear during Safari overscroll,
    // while remaining available to keyboard users before a modal is opened.
    await expect(page.locator('.skip-link')).toHaveCSS('clip-path', 'inset(50%)');
    await page.locator('.skip-link').focus();
    await expect(page.locator('.skip-link')).toHaveCSS('clip-path', 'none');
    await page.locator('[data-featured-play]').click();
    await expect.poll(() => page.locator('audio').evaluate(audio => !audio.paused)).toBe(true);
    const source = await page.locator('audio').getAttribute('src');
    await page.evaluate(() => { document.body.style.width = '100%'; window.scrollTo({ top: 450, behavior: 'instant' }); });
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThan(0);
    await page.locator('[data-now-toggle]').click();
    const dialog = page.locator('[data-now-dialog]');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-now-close]')).toBeFocused();
    await expect(page.locator('[data-now-close]')).toHaveCSS('outline-style', 'none');
    await page.keyboard.press('Tab');
    // WebKit's native Tab order follows the host OS keyboard-access setting.
    await page.locator('[data-now-share]').focus();
    await expect(page.locator('[data-now-share]')).toBeFocused();
    await expect(page.locator('[data-now-share]')).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Shift+Tab');
    await page.locator('[data-now-close]').focus();
    await expect(page.locator('[data-now-close]')).toHaveCSS('outline-style', 'solid');
    await page.locator('#music-now-heading').click();
    await expect(page.locator('[data-now-close]')).toHaveCSS('outline-style', 'none');
    await expect(page.locator('body')).toHaveCSS('position', 'fixed');
    expect(await page.locator('body').evaluate(body => body.style.top)).toBe(`${-scrollY}px`);
    const covered = async () => page.evaluate(() => {
      const modal = document.querySelector('[data-now-dialog]'), rect = modal.getBoundingClientRect();
      const paint = getComputedStyle(modal, '::backdrop');
      return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: innerWidth, height: innerHeight, backdrop: paint.backgroundColor,
        topHit: modal.contains(document.elementFromPoint(5, 5)) };
    });
    let bounds = await covered();
    expect(bounds.top).toBe(0); expect(bounds.left).toBe(0);
    expect(Math.abs(bounds.bottom - bounds.height)).toBeLessThan(1); expect(Math.abs(bounds.right - bounds.width)).toBeLessThan(1);
    await page.screenshot({ path: test.info().outputPath('player-fullscreen.png') });
    expect(bounds.backdrop).toBe('rgb(20, 26, 31)'); expect(bounds.topHit).toBe(true);
    // Browser chrome changes the visible height; the full-screen sheet follows it.
    await page.setViewportSize({ ...viewport, height: viewport.height - 90 });
    bounds = await covered(); expect(bounds.top).toBe(0); expect(Math.abs(bounds.bottom - bounds.height)).toBeLessThan(1);
    await page.locator('.station-music-now-queue-footer').click();
    await expect(page.locator('[data-queue-dialog]')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('position', 'fixed');
    await page.goBack();
    await expect(dialog).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('position', 'fixed');
    await page.locator('[data-now-close]').click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);
    expect(await page.locator('body').evaluate(body => ({ position: body.style.position, top: body.style.top, left: body.style.left, width: body.style.width, overflow: body.style.overflow })))
      .toEqual({ position: '', top: '', left: '', width: '100%', overflow: '' });
    expect(await page.locator('audio').getAttribute('src')).toBe(source);
    expect(await page.locator('audio').evaluate(audio => !audio.paused)).toBe(true);
    // Switching to the desktop layout also releases the document lock.
    await page.locator('[data-now-toggle]').click();
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('body')).toHaveCSS('position', 'static');
  });
}
