import { expect, test } from '@playwright/test';

const sessionResponse = {
  ok: true,
  authenticated: true,
  account: {
    id: 7,
    email: 'browser-player@example.com',
    username: 'browserplayer',
    displayName: 'Browser Player'
  }
};

const minimalSave = (gold, savedAt = '2026-08-30T12:00:00.000Z') => ({
  version: '1.17.0',
  schemaVersion: 2,
  meta: {
    createdAt: '2026-08-29T12:00:00.000Z',
    lastSavedAt: savedAt,
    lastSyncAt: savedAt
  },
  player: { name: 'Browser Player', gold },
  cats: [],
  inventory: {},
  settings: { language: 'en' }
});

const cloudEnvelope = (revision, gold, digest = `digest-${revision}`) => ({
  gameKey: 'cat-life',
  saveVersion: '1.17.0',
  schemaVersion: 2,
  revision,
  digest,
  clientUpdatedAt: '2026-08-30T12:00:00.000Z',
  updatedAt: '2026-08-30 12:00:00',
  data: minimalSave(gold)
});

async function mockSession(page) {
  await page.route('**/api/readers/session', (route) => route.fulfill({ json: sessionResponse }));
}

test('migrates a legacy guest save before first cloud upload and blocks oversized follow-up writes', async ({ page }) => {
  let putCount = 0;
  let uploadedSave = null;
  await page.addInitScript(() => {
    localStorage.setItem('catGameSaveV1', JSON.stringify({
      version: '1.0.0',
      meta: { createdAt: '2025-01-01T00:00:00.000Z' },
      player: { name: 'Legacy Player', coins: 42 },
      cats: [],
      inventory: {},
      settings: { language: 'en', musicVolume: 55 }
    }));
  });
  await mockSession(page);
  await page.route('**/api/readers/game-saves/cat-life', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { ok: true, authenticated: true, account: sessionResponse.account, save: null } });
      return;
    }
    putCount += 1;
    const payload = route.request().postDataJSON();
    uploadedSave = payload.saveData;
    await route.fulfill({
      json: {
        ok: true,
        authenticated: true,
        account: sessionResponse.account,
        save: { ...cloudEnvelope(1, payload.saveData.player.gold), data: payload.saveData }
      }
    });
  });

  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Cloud save synced');
  expect(putCount).toBe(1);
  expect(uploadedSave.schemaVersion).toBe(2);
  expect(uploadedSave.player.gold).toBe(42);
  expect(uploadedSave.player.coins).toBeUndefined();
  expect(uploadedSave.settings.bgmVolume).toBe(55);
  expect(uploadedSave.settings.sfxVolume).toBe(55);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('catGameSaveV1:member:7')));
  expect(stored.schemaVersion).toBe(2);
  expect(stored.player.gold).toBe(42);

  await page.evaluate(() => {
    window.CatGame.state.game.player.oversizedFixture = 'x'.repeat(760000);
    window.CatGame.state.saveSystem.saveGame(window.CatGame.state.game);
  });
  await expect(page.locator('[data-cat-cloud-status]')).toContainText('exceeds 750KB', { timeout: 8000 });
  expect(putCount).toBe(1);
});

test('lists recovery records and restores a selected cloud revision', async ({ page }) => {
  let currentSave = cloudEnvelope(3, 300);
  let recoveryGetCount = 0;
  let restorePayload = null;
  await page.addInitScript(() => {
    localStorage.setItem('catGameGuestSaveClaimV1', 'another-account');
  });
  await mockSession(page);
  await page.route('**/api/readers/game-saves/cat-life/recovery', async (route) => {
    if (route.request().method() === 'GET') {
      recoveryGetCount += 1;
      await route.fulfill({
        json: {
          ok: true,
          authenticated: true,
          currentRevision: currentSave.revision,
          backups: [{
            revision: 2,
            saveVersion: '1.17.0',
            schemaVersion: 2,
            digest: 'digest-2',
            saveBytes: 1200,
            clientUpdatedAt: '2026-08-29T10:00:00.000Z',
            createdAt: '2026-08-29 10:00:00'
          }],
          recoveryEvents: recoveryGetCount > 1 ? [{
            sourceRevision: 2,
            previousRevision: 3,
            restoredRevision: 4,
            createdAt: '2026-08-30T12:05:00.000Z'
          }] : []
        }
      });
      return;
    }
    restorePayload = route.request().postDataJSON();
    currentSave = cloudEnvelope(4, 120, 'digest-4-restored');
    await route.fulfill({
      json: {
        ok: true,
        authenticated: true,
        recoveredFromRevision: 2,
        save: currentSave
      }
    });
  });
  await page.route('**/api/readers/game-saves/cat-life', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account: sessionResponse.account, save: currentSave }
  }));
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Cloud save synced');
  await page.locator('[data-cat-recovery-action]').click();
  await expect(page.locator('[data-cat-recovery-dialog]')).toBeVisible();
  await expect(page.locator('.cat-recovery-item')).toContainText('Cloud revision 2');
  await page.locator('.cat-recovery-item button').click();
  await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Cloud save restored');
  expect(restorePayload).toEqual({ baseRevision: 3, sourceRevision: 2 });
  await expect(page.locator('[data-cat-recovery-log]')).toContainText('Restored version 2 as version 4');
  expect(await page.evaluate(() => window.CatGame.state.game.player.gold)).toBe(120);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('catGameSaveV1:member:7')).player.gold)).toBe(120);
});

test('shows the conflict chooser when another session wins the revision race', async ({ page }) => {
  const initialCloud = cloudEnvelope(1, 100);
  const winningCloud = cloudEnvelope(2, 250, 'digest-other-session');
  await page.addInitScript(() => {
    localStorage.setItem('catGameGuestSaveClaimV1', 'another-account');
  });
  await mockSession(page);
  await page.route('**/api/readers/game-saves/cat-life', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: { ok: true, authenticated: true, account: sessionResponse.account, save: initialCloud }
      });
      return;
    }
    await route.fulfill({
      status: 409,
      json: {
        ok: false,
        authenticated: true,
        code: 'GAME_SAVE_CONFLICT',
        message: 'The cloud save changed on another session.',
        account: sessionResponse.account,
        save: winningCloud
      }
    });
  });

  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Cloud save synced');
  await page.evaluate(() => {
    window.CatGame.state.game.player.gold = 125;
    window.CatGame.state.saveSystem.saveGame(window.CatGame.state.game);
  });
  await expect(page.locator('[data-cat-cloud-dialog]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-cat-cloud-status]')).toHaveText('Choose a save');
  await expect(page.locator('[data-cat-cloud-use-local]')).toHaveText('Use this device');
  await expect(page.locator('[data-cat-cloud-use-remote]')).toHaveText('Use cloud save');
});

test('keeps member recovery controls reachable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('catGameGuestSaveClaimV1', 'another-account');
  });
  await mockSession(page);
  await page.route('**/api/readers/game-saves/cat-life', (route) => route.fulfill({
    json: { ok: true, authenticated: true, account: sessionResponse.account, save: cloudEnvelope(1, 100) }
  }));

  await page.goto('/games/cat-life/?lang=en');
  await expect(page.locator('[data-cat-recovery-action]')).toBeVisible();
  await expect(page.locator('[data-station-language]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
