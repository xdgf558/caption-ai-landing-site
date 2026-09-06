import { expect, test } from '@playwright/test';

// Hold both real initialization requests until the player is already editing.
// No sleeps, mocked renderer, or assumptions about the one-second timer.
async function holdInitialization(page, width, member = false) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pending = [];
  const account = member ? { id: 17, username: 'testmember', displayName: 'Test Member' } : null;
  await page.route('**/api/readers/session', route => route.fulfill({
    json: { ok: true, authenticated: member, account }
  }));
  await page.route('**/api/readers/game-saves/cat-life', route => route.fulfill({
    json: { ok: true, authenticated: member, account,
      save: route.request().method() === 'PUT' ? { revision: 1 } : null }
  }));
  await page.route('**/api/games/cat-life/catalog?*', route => { pending.push(route); });
  await page.route('**/api/games/cat-life/entitlements?*', route => { pending.push(route); });
  await page.goto('/games/cat-life/?lang=en');
  await expect.poll(() => pending.length).toBe(2);
  await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status)).toBe('loading');
  if (member) await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Cloud save synced');
  return async (failure = false) => {
    await expect.poll(() => pending.length).toBe(2);
    await Promise.all(pending.splice(0).map(route => route.fulfill(failure ? {
      status: 503, json: { ok: false }
    } : {
      json: { ok: true, authenticated: member, account, balance: member ? 100 : null, products: [],
        entitlements: member ? [{ productId: 'cat-life.skin.moonlit-tabby',
          entitlementKey: 'cat-life.cosmetic.skin.moonlit-tabby.v1', active: true }] : [] }
    })));
    await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status))
      .toBe(failure ? 'offline' : 'ready');
  };
}

async function openPage(page, target) {
  const button = page.locator(`[data-page-target="${target}"]:visible`).first();
  if (!await button.count()) await page.locator('[data-page-target="more"]:visible').click();
  await button.click();
}

async function rememberNode(locator) {
  return locator.evaluateHandle(node => node);
}

for (const width of [390, 1280]) {
  for (const rejection of ['disabled', 'duplicate', 'other-region']) {
    test(`background focus rejects ${rejection} replacement at ${width}px`, async ({ page }) => {
      const release = await holdInitialization(page, width);
      await openPage(page, 'cats');
      const button = page.locator('[data-rename-cat]');
      await button.focus();
      const original = await rememberNode(button);
      // Change only the next renderer output to exercise rejection branches;
      // the actual delayed commerce response still drives the background render.
      await page.evaluate(rejection => {
        const ui = window.CatGame.ui;
        const renderCats = ui.renderCatPanel;
        const renderHeader = ui.renderHeader;
        const identity = document.querySelector('[data-rename-cat]').outerHTML;
        ui.renderCatPanel = function (state) {
          const template = document.createElement('template');
          template.innerHTML = renderCats(state);
          const replacement = template.content.querySelector('[data-rename-cat]');
          if (rejection === 'disabled') replacement.disabled = true;
          if (rejection === 'duplicate') replacement.after(replacement.cloneNode(true));
          if (rejection === 'other-region') replacement.remove();
          return template.innerHTML;
        };
        if (rejection === 'other-region') {
          ui.renderHeader = state => renderHeader(state) + identity;
        }
      }, rejection);
      await release();
      expect(await original.evaluate(node => node.isConnected)).toBe(false);
      const mainCandidates = page.locator('#app-main [data-rename-cat]');
      await expect(mainCandidates).toHaveCount(rejection === 'duplicate' ? 2 : rejection === 'disabled' ? 1 : 0);
      if (rejection === 'disabled') await expect(mainCandidates).toBeDisabled();
      if (rejection === 'other-region') {
        await expect(page.locator('#app-header [data-rename-cat]')).toBeVisible();
      }
      expect(await page.locator('[data-rename-cat]').evaluateAll(nodes =>
        nodes.some(node => node === document.activeElement))).toBe(false);
      expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    });
  }

  test(`member entitlement initialization updates ownership without interrupting editing at ${width}px`, async ({ page }) => {
    const release = await holdInitialization(page, width, true);
    await openPage(page, 'cats');
    const field = page.locator('#cat-name-input');
    await field.fill('Member draft');
    const original = await rememberNode(field);
    await release();
    expect(await original.evaluate(node => node.isConnected)).toBe(false);
    await expect(field).toHaveValue('Member draft');
    await expect(field).toBeFocused();
    expect(await page.evaluate(() => window.CatGameCommerce.hasEntitlement('cat-life.cosmetic.skin.moonlit-tabby.v1'))).toBe(true);
    await openPage(page, 'member_store');
    await expect(page.locator('[data-cat-commerce-action="toggle-skin"]')).toBeVisible();
    // A later explicit refresh uses the same background-safe path, both while
    // showing "loading" and when ownership data arrives again.
    const refreshButton = page.locator('[data-cat-commerce-action="refresh"]');
    await refreshButton.focus();
    const beforeLoading = await rememberNode(refreshButton);
    await page.keyboard.press('Enter');
    expect(await beforeLoading.evaluate(node => node.isConnected)).toBe(false);
    await expect(refreshButton).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status)).toBe('loading');
    const beforeReady = await rememberNode(refreshButton);
    await release();
    expect(await beforeReady.evaluate(node => node.isConnected)).toBe(false);
    await expect(refreshButton).toBeFocused();
    await expect(page.locator('[data-cat-commerce-action="toggle-skin"]')).toBeVisible();
  });

  for (const failure of [false, true]) {
    const outcome = failure ? 'failure' : 'success';
    for (const [target, selector, draft] of [
      ['cats', '#cat-name-input', 'Momo draft'],
      ['save', '#save-import-text', 'draft-save-payload']
    ]) {
      test(`initial commerce ${outcome} preserves ${target} draft and selection at ${width}px`, async ({ page }) => {
        const release = await holdInitialization(page, width);
        await openPage(page, target);
        const originalName = await page.evaluate(() => window.CatGame.state.game.cats[0].name);
        const field = page.locator(selector);
        await field.fill(draft);
        await field.evaluate(node => node.setSelectionRange(2, 5, 'backward'));
        const original = await rememberNode(field);
        await release(failure);
        expect(await original.evaluate(node => node.isConnected), 'API completion really replaced the field').toBe(false);
        await expect(field).toHaveValue(draft);
        await expect(field).toBeFocused();
        expect(await field.evaluate(node => [node.selectionStart, node.selectionEnd, node.selectionDirection]))
          .toEqual([2, 5, 'backward']);
        expect(await page.evaluate(() => window.CatGame.state.game.cats[0].name)).toBe(originalName);
        // Continue typing into the restored selection, not a detached input.
        await page.keyboard.insertText('X');
        await expect(field).toHaveValue(draft.slice(0, 2) + 'X' + draft.slice(5));
      });
    }

    test(`initial commerce ${outcome} preserves rename button focus and unsubmitted draft at ${width}px`, async ({ page }) => {
      const release = await holdInitialization(page, width);
      await openPage(page, 'cats');
      await page.locator('#cat-name-input').fill('Momo draft');
      await page.keyboard.press('Tab');
      const button = page.locator('[data-rename-cat]');
      await expect(button).toBeFocused();
      const original = await rememberNode(button);
      await release(failure);
      expect(await original.evaluate(node => node.isConnected)).toBe(false);
      await expect(button).toBeFocused();
      await expect(page.locator('#cat-name-input')).toHaveValue('Momo draft');
      // Nothing is submitted until the player explicitly activates the button.
      expect(await page.evaluate(() => window.CatGame.state.game.cats[0].name)).not.toBe('Momo draft');
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.CatGame.state.game.cats[0].name)).toBe('Momo draft');
    });
  }

  test(`late commerce response preserves current navigation focus without reopening an old page at ${width}px`, async ({ page }) => {
    const release = await holdInitialization(page, width);
    await openPage(page, 'cats');
    await page.locator('#cat-name-input').fill('Abandoned');
    await openPage(page, 'work');
    const button = page.locator('[data-page-target="cats"]:visible').first();
    await button.focus();
    const original = await rememberNode(button);
    await release();
    expect(await original.evaluate(node => node.isConnected)).toBe(false);
    await expect(button).toBeFocused();
    expect(await page.evaluate(() => window.CatGame.state.currentPage)).toBe('work');
    await page.keyboard.press('Enter');
    await expect(page.locator('#cat-name-input')).not.toHaveValue('Abandoned');
  });
}
