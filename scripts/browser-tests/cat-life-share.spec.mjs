import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import jsQR from 'jsqr';
const headers = await readFile(new URL('../../public/_headers', import.meta.url), 'utf8');
const gameCSP = headers.split('/games/cat-life/')[1].match(/Content-Security-Policy: ([^\n]+)/)[1];

async function guest(page) {
  await page.route('**/games/cat-life/?*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': gameCSP } });
  });
  await page.route('**/api/readers/session', route => route.fulfill({ json: { ok: true, authenticated: false, account: null } }));
  for (const endpoint of ['catalog', 'entitlements']) await page.route(`**/api/games/cat-life/${endpoint}?*`, route => route.fulfill({
    json: { ok: true, authenticated: false, account: null, balance: null, [endpoint === 'catalog' ? 'products' : 'entitlements']: [] }
  }));
}
async function open(page, width = 1280, language = 'en') {
  await page.setViewportSize({ width, height: 900 });
  await guest(page);
  await page.goto('/games/cat-life/?lang=' + language + '&accountId=PRIVATE_ACCOUNT#PRIVATE_FRAGMENT');
  await expect(page.locator('[data-care-journey]')).toBeVisible();
  if (!await page.locator('[data-page-target="version"]:visible').count()) await page.locator('[data-page-target="more"]:visible').click();
  await page.locator('[data-page-target="version"]:visible').click();
  await page.locator('[data-game-share-open]').click();
  await expect(page.locator('.game-share-dialog')).toBeVisible();
}
async function ready(page) {
  await expect(page.locator('[data-share-save]')).toBeEnabled();
  await expect.poll(() => page.locator('[data-share-image]').evaluate(img => img.complete && img.naturalWidth === 1080)).toBe(true);
}
async function decode(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}

for (const width of [390, 1040, 1280]) for (const language of ['zh-Hant', 'en', 'ja']) {
  test(`${width}px ${language}: real PNG, decodable QR, public latest notes and responsive dialog`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const assets = []; page.on('request', request => { if (/station-letter|letter-title|vendor\/qrcode/.test(request.url())) assets.push(request.url()); });
    await guest(page); await page.goto('/games/cat-life/?lang=' + language);
    await expect(page.locator('[data-care-journey]')).toBeVisible();
    expect(assets).toEqual([]);
    await open(page, width, language); await ready(page);
    const copy = await page.locator('#game-share-copy').inputValue();
    expect(copy).toContain('v1.27.0'); expect(copy).toContain('Station Cat');
    expect(copy).not.toMatch(/PRIVATE_|accountId|1\.26\.2|Moonlight|share_[a-z]|undefined|NaN/);
    const destination = 'https://wwwstationcat.org/games/cat-life/?lang=' + language;
    expect(copy).toContain(destination);
    expect(await page.locator('[data-share-image]').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    const intent = new URL(await page.locator('[data-share-x]').getAttribute('href'));
    expect(intent.searchParams.get('url')).toBe(destination);
    // Inspect the draft URL, never contact X or publish from the test.
    await page.screenshot({ path: testInfo.outputPath('dialog.png') });
    const layout = await page.locator('.game-share-dialog').evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }));
    expect(layout.scroll).toBe(layout.client); expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(width);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('[data-share-save]').click();
    const download = await downloadEvent;
    const output = testInfo.outputPath('postcard.png'); await download.saveAs(output);
    const png = await readFile(output);
    const metadata = await sharp(png).metadata();
    expect([metadata.format, metadata.width, metadata.height]).toEqual(['png', 1080, 1440]);
    expect(await decode(png)).toBe(destination);
    // Test a much smaller, compressed social-feed image, not only the original.
    expect(await decode(await sharp(png).resize(540).jpeg({ quality: 80 }).toBuffer())).toBe(destination);
    await page.locator('[data-share-close]').press('Escape');
    await expect(page.locator('.game-share-dialog')).toHaveCount(0);
    await expect(page.locator('[data-game-share-open]')).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test('explicit redraw and actual commerce completion keep the image, selection and focused controls', async ({ page }) => {
  await open(page); await ready(page);
  const dialog = await page.locator('.game-share-dialog').elementHandle();
  const imageURL = await page.locator('[data-share-image]').getAttribute('src');
  const copy = page.locator('#game-share-copy');
  await copy.focus(); await copy.evaluate(node => node.setSelectionRange(2, 9));
  await page.evaluate(async () => { window.CatGameApp.render(true); await window.CatGameCommerce.refresh({ silent: true }); });
  expect(await dialog.evaluate(node => node.isConnected && node.open)).toBe(true);
  expect(await page.locator('[data-share-image]').getAttribute('src')).toBe(imageURL);
  await expect(copy).toBeFocused();
  expect(await copy.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([2, 9]);
  await page.locator('[data-share-close]').click(); await expect(page.locator('[data-game-share-open]')).toBeFocused();
});

for (const asset of ['station-letter.webp', 'letter-title.ttf', 'qrcode.js']) test(`failed ${asset} can retry without offering a broken PNG`, async ({ page }) => {
  await page.route('**/' + asset, route => route.abort());
  await open(page);
  await expect(page.locator('[data-share-retry]')).toBeVisible();
  await expect(page.locator('[data-share-save]')).toBeDisabled();
  await expect(page.locator('[data-share-image]')).toBeHidden();
  await page.unroute('**/' + asset);
  await page.locator('[data-share-retry]').click(); await ready(page);
});

test('closing while generation is pending cannot resurrect a dialog or leak object URLs', async ({ page }) => {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.shareURLs = new Set();
    URL.createObjectURL = blob => { const url = create(blob); window.shareURLs.add(url); return url; };
    URL.revokeObjectURL = url => { window.shareURLs.delete(url); revoke(url); };
  });
  let blocked;
  await page.route('**/station-letter.webp', route => { blocked = route; });
  await open(page);
  await expect.poll(() => Boolean(blocked)).toBe(true);
  await page.locator('[data-share-close]').click();
  await blocked.continue(); await page.unroute('**/station-letter.webp');
  await expect(page.locator('.game-share-dialog')).toHaveCount(0);
  await page.locator('[data-game-share-open]').click(); await ready(page);
  expect(await page.evaluate(() => window.shareURLs.size)).toBe(1);
  await page.locator('[data-share-close]').click();
  // HTMLDialogElement.close queues its close event; wait for actual teardown.
  await expect(page.locator('.game-share-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.shareURLs.size)).toBe(0);
});

test('clipboard failure selects manual copy, success copies the clean public link', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await open(page); await ready(page);
  await page.locator('[data-share-copy-text]').click();
  await expect(page.locator('#game-share-copy')).toBeFocused();
  expect(await page.locator('#game-share-copy').evaluate(node => node.selectionEnd - node.selectionStart)).toBeGreaterThan(30);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => { window.copiedShare = value; return Promise.resolve(); } } }));
  await page.locator('[data-share-copy-link]').click();
  expect(await page.evaluate(() => window.copiedShare)).toBe('https://wwwstationcat.org/games/cat-life/?lang=en');
  await expect(page.locator('[data-share-status]')).toHaveText('Copied.');
});

for (const outcome of ['success', 'cancel', 'failure', 'unsupported']) test(`native share ${outcome} uses a prepared file and truthful feedback`, async ({ page }) => {
  await page.addInitScript(outcome => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: ({ files }) => outcome !== 'unsupported' && files[0].type === 'image/png' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: payload => {
      window.sharedFile = { name: payload.files[0].name, size: payload.files[0].size, fields: Object.keys(payload), active: navigator.userActivation.isActive };
      if (outcome === 'success') return Promise.resolve();
      return Promise.reject(new DOMException('fixture', outcome === 'cancel' ? 'AbortError' : 'NotAllowedError'));
    } });
  }, outcome);
  await open(page); await ready(page);
  if (outcome === 'unsupported') { await expect(page.locator('[data-share-native]')).toBeHidden(); return; }
  await page.locator('[data-share-native]').click();
  const file = await page.evaluate(() => window.sharedFile);
  expect(file.name).toBe('station-cat-v1.27.0-en.png'); expect(file.size).toBeGreaterThan(10000); expect(file.active).toBe(true);
  expect(file.fields).toEqual(['files', 'title']);
  await expect(page.locator('[data-share-status]')).toHaveText({ success: 'Image handed to system sharing.', cancel: 'Sharing cancelled. You can still save the image.', failure: 'System sharing failed. Please save the image instead.' }[outcome]);
  await expect(page.locator('[data-share-save]')).toBeEnabled();
});
