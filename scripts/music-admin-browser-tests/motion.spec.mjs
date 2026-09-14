import { test, expect } from '@playwright/test';
import { tracks as fixtures, demoWav } from '../fixtures/music-player/data.mjs';

async function music(page) {
  const tracks = fixtures.map(track => ({ ...track, effectiveAccess: 'free', durationSec: 120, coverUrl: null }));
  const album = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'motion-album', type: 'album', title: '夜色歌单', description: '本地动效预览', listeningMode: 'free', version: 1, trackIds: tracks.map(t => t.id) };
  await page.route('**/api/music/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/catalog')) return route.fulfill({ json: { schemaVersion: 2, tracks, collections: [album], featured: { version: 1, primaryTrackId: tracks[0].id, primarySource: 'primary', secondaryTrackIds: [tracks[1].id], collectionIds: [album.id] } } });
    if (path.endsWith('/capabilities')) return route.fulfill({ json: { canPlayVipFull: false, authenticated: false, musicVipDeliveryEnabled: false, membershipStatus: 'none', serverNow: new Date().toISOString(), validUntil: null } });
    if (path.endsWith('/audio')) return route.fulfill({ contentType: 'audio/wav', body: demoWav(tracks[0]) });
    if (path.endsWith('/share.png')) return route.fulfill({ status: 503, json: { error: { code: 'LOCAL_PREVIEW' } } });
    return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND' } } });
  });
  await page.goto('/zh-hans/music/');
  await expect(page.locator('[data-featured-play]')).toBeVisible();
  return tracks;
}

for (const mobile of [true, false]) for (const reduced of [false, true]) {
  test(`music motion preserves playback, history and reduced motion: ${mobile ? 'phone' : 'desktop'}, reduced=${reduced}`, async ({ page }) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await music(page);
    const main = page.locator('[data-main-play]'), swap = main.locator('[data-play-swap]');
    await page.locator('[data-featured-play]').click();
    await expect.poll(() => page.locator('audio').evaluate(a => !a.paused)).toBe(true);
    await expect(swap).toHaveAttribute('data-state', 'b');
    const source = await page.locator('audio').getAttribute('src');
    const audio = await page.locator('audio').elementHandle();
    await main.click(); await expect(swap).toHaveAttribute('data-state', 'a');
    await expect(swap.locator('[data-icon="a"]')).toHaveCSS('opacity', '1');
    await main.click(); await expect(swap).toHaveAttribute('data-state', 'b');
    if (reduced) await expect(swap.locator('[data-icon="a"]')).toHaveCSS('transition-duration', '0s');

    const opener = page.locator(mobile ? '[data-now-toggle]' : '[data-featured-view]');
    const dialog = page.locator(mobile ? '[data-now-dialog]' : '[data-detail-dialog]');
    const target = dialog.locator('.t-modal');
    const closeSelector = mobile ? '[data-now-close]' : '[data-panel-close="detail"]';
    await opener.click(); await expect(target).toHaveCSS('opacity', '1');
    const favorite = page.locator(mobile ? '[data-now-favorite]' : '[data-detail-favorite]');
    await favorite.click(); await expect(favorite).toHaveAttribute('data-liked', 'true');
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    if (reduced) {
      await expect(target).toHaveCSS('transition-duration', '0s');
      await expect(favorite.locator('.t-like-icon')).toHaveCSS('animation-name', 'none');
    }
    // Reopening during the explicit close transition must cancel that close.
    if (!reduced) {
      await page.evaluate(({ closeSelector, mobile }) => {
        document.querySelector(closeSelector).click();
        document.querySelector(mobile ? '[data-now-toggle]' : '[data-featured-view]').click();
      }, { closeSelector, mobile });
      await expect(target).toHaveClass(/is-open/);
      await page.waitForTimeout(200);
      await expect(dialog).toBeVisible();
    }
    const closing = await page.evaluate(({ closeSelector, mobile }) => {
      document.querySelector(closeSelector).click();
      document.querySelector(closeSelector).click();
      const dialog = document.querySelector(mobile ? '[data-now-dialog]' : '[data-detail-dialog]');
      return { open: dialog.open, closing: dialog.querySelector('.t-modal').classList.contains('is-closing') };
    }, { closeSelector, mobile });
    expect(closing).toEqual({ open: !reduced, closing: !reduced });
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('body')).toHaveCSS('position', 'static');

    // Underline follows actual browse state, including Back and responsive widths.
    await page.locator('[data-browse-mode="picks"]').click();
    const aligned = () => page.evaluate(() => {
      const tab = document.querySelector('[data-browse-mode][aria-pressed="true"]').getBoundingClientRect();
      const pill = document.querySelector('[data-browse-indicator]').getBoundingClientRect();
      return Math.abs(tab.x - pill.x) < 1 && Math.abs(tab.width - pill.width) < 1;
    });
    await expect.poll(aligned).toBe(true);
    await page.goBack(); await expect.poll(aligned).toBe(true);
    await page.setViewportSize(mobile ? { width: 320, height: 680 } : { width: 1100, height: 800 });
    await expect.poll(aligned).toBe(true);
    if (reduced) await expect(page.locator('[data-browse-indicator]')).toHaveCSS('transition-duration', '0s');

    await page.locator('[data-featured-view]').click();
    await page.locator('[data-share-music="track"]').click();
    const share = page.locator('[data-share-card-dialog]');
    await expect(share.locator('.t-modal')).toHaveCSS('opacity', '1');
    await page.locator('[data-panel-close="share"]').click();
    await expect(share).not.toBeVisible();
    await expect(page.locator('[data-detail-dialog]')).toBeVisible();
    await page.locator('[data-panel-close="detail"]').click();
    await expect(page.locator('[data-detail-dialog]')).not.toBeVisible();
    expect(await page.locator('audio').getAttribute('src')).toBe(source);
    expect(await page.locator('audio').evaluate((a, original) => a === original && !a.paused, audio)).toBe(true);
    expect(await page.locator('audio').count()).toBe(1);
    await page.screenshot({ path: test.info().outputPath('music-motion.png'), fullPage: true });
  });
}
