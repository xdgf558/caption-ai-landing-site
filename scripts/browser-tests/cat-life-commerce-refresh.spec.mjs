import { expect, test } from '@playwright/test';

function memberFixture(id, balance) {
  const productId = 'cat-life.skin.moonlit-tabby';
  const entitlementKey = 'cat-life.cosmetic.skin.moonlit-tabby.v1';
  return { account: { id, username: `member${id}`, displayName: `Member ${id}` }, balance,
    products: [{ productId, entitlementKey, name: `Member ${id} skin`, pointsPrice: 10,
      productType: 'cosmetic-skin', lifecycleStatus: 'active', owned: true, redeemable: false }],
    entitlements: [{ id: `entitlement-${id}`, productId, entitlementKey, active: true }] };
}

async function commerceRequests(page) {
  const requests = { catalog: [], entitlements: [] };
  for (const endpoint of Object.keys(requests)) {
    await page.route(`**/api/games/cat-life/${endpoint}?*`, route => { requests[endpoint].push(route); });
  }
  async function wait(index) {
    for (const endpoint of Object.keys(requests)) {
      await expect.poll(() => Boolean(requests[endpoint][index])).toBe(true);
    }
  }
  async function reply(index, endpoint, fixture = {}, failure = false) {
    const route = requests[endpoint][index];
    expect(route, `${endpoint} request ${index} is pending`).toBeTruthy();
    requests[endpoint][index] = null;
    // Each endpoint has its own contract; never return products and entitlements
    // in the same fixture or pair responses by whichever request arrived first.
    const json = { ok: true, authenticated: Boolean(fixture.account), account: fixture.account || null,
      balance: fixture.balance ?? null };
    if (endpoint === 'catalog') json.products = fixture.products || [];
    else json.entitlements = fixture.entitlements || [];
    await route.fulfill(failure ? { status: 503, json: { ok: false } } : { json });
  }
  async function complete(index, fixture, failure = false) {
    await wait(index);
    await Promise.all(Object.keys(requests).map(endpoint => reply(index, endpoint, fixture, failure)));
  }
  return { wait, reply, complete };
}

// Hold both real initialization requests until the player is already editing.
// No sleeps, mocked renderer, or assumptions about the one-second timer.
async function holdInitialization(page, width, member = false) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = member ? memberFixture(17, 100) : {};
  const account = fixture.account || null;
  await page.route('**/api/readers/session', route => route.fulfill({
    json: { ok: true, authenticated: member, account }
  }));
  await page.route('**/api/readers/game-saves/cat-life', route => route.fulfill({
    json: { ok: true, authenticated: member, account,
      save: route.request().method() === 'PUT' ? { revision: 1 } : null }
  }));
  const gate = await commerceRequests(page);
  await page.goto('/games/cat-life/?lang=en');
  await gate.wait(0);
  await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status)).toBe('loading');
  if (member) await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Cloud save synced');
  let next = 0;
  const release = async (failure = false) => {
    await gate.complete(next++, fixture, failure);
    await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status))
      .toBe(failure ? 'offline' : 'ready');
  };
  release.gate = gate;
  return release;
}

async function openPage(page, target) {
  const button = page.locator(`[data-page-target="${target}"]:visible`).first();
  if (!await button.count()) await page.locator('[data-page-target="more"]:visible').click();
  await button.click();
}

async function rememberNode(locator) {
  return locator.evaluateHandle(node => node);
}

for (const scenario of ['older-success', 'older-failure', 'newer-guest', 'newer-failure']) {
  test(`out-of-order commerce responses cannot overwrite latest state: ${scenario}`, async ({ page }) => {
    const release = await holdInitialization(page, 1280);
    await release();
    await openPage(page, 'cats');
    const gate = release.gate;
    await page.evaluate(() => { window.oldRefresh = window.CatGameCommerce.refresh({ silent: true }); });
    await gate.wait(1);
    await page.evaluate(() => { window.newRefresh = window.CatGameCommerce.refresh({ silent: true }); });
    await gate.wait(2);
    const newest = scenario === 'newer-guest' ? {} : memberFixture(2, 222);
    // Interleave endpoints, then complete the newer pair before the older pair.
    await gate.reply(1, 'catalog', memberFixture(1, 111));
    await gate.reply(2, 'entitlements', newest, scenario === 'newer-failure');
    await gate.reply(2, 'catalog', newest, scenario === 'newer-failure');
    await page.evaluate(() => window.newRefresh);
    const snapshot = await page.evaluate(() => window.CatGameCommerce.getSnapshot());
    expect(snapshot.status).toBe(scenario === 'newer-failure' ? 'offline' : 'ready');
    expect(snapshot.account?.id ?? null).toBe(scenario.startsWith('newer-') ? null : 2);
    if (!scenario.startsWith('newer-')) expect(snapshot.balance).toBe(222);
    const cache = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
      .filter(([key]) => key.startsWith('catGameCommerce'))));
    const field = page.locator('#cat-name-input');
    await field.fill('Latest draft');
    const original = await rememberNode(field);
    await gate.reply(1, 'entitlements', memberFixture(1, 111), scenario === 'older-failure');
    await page.evaluate(() => window.oldRefresh);
    expect(await page.evaluate(() => window.CatGameCommerce.getSnapshot())).toEqual(snapshot);
    expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
      .filter(([key]) => key.startsWith('catGameCommerce'))))).toEqual(cache);
    expect(await original.evaluate(node => node.isConnected), 'stale response must not trigger a render').toBe(true);
    await expect(field).toHaveValue('Latest draft');
    await expect(field).toBeFocused();
  });
}

for (const mismatch of ['different-accounts', 'different-authentication']) {
  test(`a refresh rejects inconsistent endpoint identities: ${mismatch}`, async ({ page }) => {
    const release = await holdInitialization(page, 1280);
    await release.gate.reply(0, 'catalog', memberFixture(1, 111));
    await release.gate.reply(0, 'entitlements', mismatch === 'different-accounts' ? memberFixture(2, 222) : {});
    await expect.poll(() => page.evaluate(() => window.CatGameCommerce.getSnapshot().status)).toBe('offline');
    expect(await page.evaluate(() => window.CatGameCommerce.getSnapshot())).toMatchObject({
      authenticated: false, account: null, balance: null, products: [], entitlements: []
    });
    expect(await page.evaluate(() => localStorage.getItem('catGameCommerceLastAccountV1'))).toBeNull();
  });
}

for (const width of [390, 1280]) {
  for (const view of ['slot', 'lottery']) {
    for (const failure of [false, true]) {
      test(`arcade ${view} rules survive ${failure ? 'failed' : 'successful'} commerce and background render at ${width}px`, async ({ page }) => {
        const release = await holdInitialization(page, width);
        await openPage(page, 'arcade');
        await page.locator(`[role="tab"][data-arcade-view="${view}"]`).click();
        const details = page.locator('.arcade-details');
        const summary = details.locator('summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        await expect(details).toHaveAttribute('open', '');
        for (const refresh of [() => page.evaluate(() => window.CatGameApp.render(true)), () => release(failure)]) {
          const original = await rememberNode(summary);
          await refresh();
          expect(await original.evaluate(node => node.isConnected)).toBe(false);
          await expect(details).toHaveAttribute('open', '');
          await expect(summary).toBeFocused();
        }
        await page.keyboard.press('Enter');
        await page.evaluate(() => window.CatGameApp.render(true));
        await expect(details).not.toHaveAttribute('open');
        await expect(summary).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(details).toHaveAttribute('open', '');
      });
    }
  }

  test(`lottery digit retains value and focus across background and commerce render at ${width}px`, async ({ page }) => {
    const release = await holdInitialization(page, width);
    await openPage(page, 'arcade');
    await page.locator('[role="tab"][data-arcade-view="lottery"]').click();
    const digit = page.locator('[data-lottery-digit-index="2"]');
    await digit.selectOption('7');
    await digit.focus();
    for (const refresh of [() => page.evaluate(() => window.CatGameApp.render(true)), () => release()]) {
      const original = await rememberNode(digit);
      await refresh();
      expect(await original.evaluate(node => node.isConnected)).toBe(false);
      await expect(digit).toHaveValue('7');
      await expect(digit).toBeFocused();
    }
  });

  test(`care rules remain open and focused across background and commerce render at ${width}px`, async ({ page }) => {
    const release = await holdInitialization(page, width);
    const details = page.locator('.care-journey-rules');
    const summary = details.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    for (const refresh of [() => page.evaluate(() => window.CatGameApp.render(true)), () => release()]) {
      const original = await rememberNode(summary);
      await refresh();
      expect(await original.evaluate(node => node.isConnected)).toBe(false);
      await expect(details).toHaveAttribute('open', '');
      await expect(summary).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.CatGameApp.render(true));
    await expect(details).not.toHaveAttribute('open');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await page.reload();
    await expect(details).not.toHaveAttribute('open');
  });

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
