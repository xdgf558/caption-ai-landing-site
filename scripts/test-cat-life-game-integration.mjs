import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { shouldIncludeSitemapRoute } from './generate-sitemap.mjs';
import './test-cat-life-content-manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const gameRoot = 'public/games/cat-life';

for (const path of [
  `${gameRoot}/index.html`,
  `${gameRoot}/cloud-sync-policy.js`,
  `${gameRoot}/cloud-sync.js`,
  `${gameRoot}/commerce.js`,
  `${gameRoot}/content-manifest.js`,
  `${gameRoot}/site-integration.js`,
  `${gameRoot}/site-integration.css`,
  `${gameRoot}/src/js/main.js`,
  `${gameRoot}/src/js/state/saveMigrations.js`,
  `${gameRoot}/src/js/core/namespace.js`,
  `${gameRoot}/src/js/core/i18n.js`,
  `${gameRoot}/src/js/ui/renderHeader.js`,
  `${gameRoot}/src/js/ui/renderMemberStorePanel.js`,
  `${gameRoot}/src/styles/broadsheet.css`,
  `${gameRoot}/src/assets/cats/orange-tabby.png`,
  `${gameRoot}/src/assets/community/npc-cat-sprites.png`,
  `${gameRoot}/src/assets/premium/moonlit-tabby.png`,
  `${gameRoot}/src/assets/premium/station-room-set.jpg`,
  `${gameRoot}/src/assets/premium/station-bench.png`,
  `${gameRoot}/src/assets/premium/station-clock-board.png`,
  `${gameRoot}/src/assets/premium/station-signal-lamp.png`,
  'src/components/CatLifeGameLanding.astro',
  'src/data/products/cat-life-game.ts',
  'src/pages/en/apps/cat-life-game/index.astro',
  'src/pages/ja/apps/cat-life-game/index.astro',
  'src/pages/zh-hans/apps/cat-life-game/index.astro',
  'src/pages/zh-hant/apps/cat-life-game/index.astro'
]) {
  assert.equal(existsSync(join(root, path)), true, `${path} must be included in the website build`);
}

const gameIndex = read(`${gameRoot}/index.html`);
const integration = read(`${gameRoot}/site-integration.js`);
const cloudSyncPolicy = read(`${gameRoot}/cloud-sync-policy.js`);
const cloudSync = read(`${gameRoot}/cloud-sync.js`);
const commerce = read(`${gameRoot}/commerce.js`);
const contentManifest = read(`${gameRoot}/content-manifest.js`);
const homeSystem = read(`${gameRoot}/src/js/systems/homeSystem.js`);
const gameMain = read(`${gameRoot}/src/js/main.js`);
const saveMigrations = read(`${gameRoot}/src/js/state/saveMigrations.js`);
const saveSystem = read(`${gameRoot}/src/js/state/saveSystem.js`);
const namespace = read(`${gameRoot}/src/js/core/namespace.js`);
const i18n = read(`${gameRoot}/src/js/core/i18n.js`);
const headerPanel = read(`${gameRoot}/src/js/ui/renderHeader.js`);
const savePanel = read(`${gameRoot}/src/js/ui/renderSavePanel.js`);
const settingsPanel = read(`${gameRoot}/src/js/ui/renderSettingsPanel.js`);
const shopPanel = read(`${gameRoot}/src/js/ui/renderShopPanel.js`);
const memberStorePanel = read(`${gameRoot}/src/js/ui/renderMemberStorePanel.js`);
const gameNavigation = read(`${gameRoot}/src/js/ui/renderNavigation.js`);
const broadsheetStyles = read(`${gameRoot}/src/styles/broadsheet.css`);
const landing = read('src/components/CatLifeGameLanding.astro');
const product = read('src/data/products/cat-life-game.ts');
const apps = read('src/components/AppsIndex.astro');
const home = read('src/components/StationHome.astro');
const navigation = read('src/data/navigation.ts');
const footer = read('src/components/Footer.astro');
const headers = read('public/_headers');

assert.match(gameIndex, /<meta name="robots" content="noindex, nofollow"/);
assert.ok(gameIndex.indexOf('site-integration.js') < gameIndex.indexOf('core/namespace.js'));
assert.ok(gameIndex.indexOf('core/namespace.js') < gameIndex.indexOf('content-manifest.js'));
assert.ok(gameIndex.indexOf('content-manifest.js') < gameIndex.indexOf('systems/homeSystem.js'));
assert.ok(gameIndex.indexOf('content-manifest.js') < gameIndex.indexOf('commerce.js'));
assert.ok(gameIndex.indexOf('saveMigrations.js') < gameIndex.indexOf('gameState.js'));
assert.ok(gameIndex.indexOf('cloud-sync-policy.js') < gameIndex.indexOf('cloud-sync.js'));
assert.ok(gameIndex.indexOf('cloud-sync.js') < gameIndex.indexOf('src/js/main.js'));
assert.ok(gameIndex.indexOf('cloud-sync.js') < gameIndex.indexOf('commerce.js'));
assert.ok(gameIndex.indexOf('commerce.js') < gameIndex.indexOf('src/js/main.js'));
assert.match(gameIndex, /data-station-link="gameInfo"/);
assert.match(gameIndex, /data-station-language/);
assert.match(integration, /sessionLanguage/);
assert.match(integration, /applySavedLanguage/);
assert.match(integration, /useSavedLanguage/);
assert.match(integration, /searchParams\.delete\("lang"\)/);
assert.match(integration, /"zh-Hant"/);
assert.match(integration, /"zh-CN"/);
assert.match(integration, /member: "Member center"/);
assert.match(cloudSync, /\/api\/readers\/game-saves\/cat-life/);
assert.match(cloudSync, /\/api\/readers\/session/);
assert.match(cloudSync, /\?returnTo=/);
assert.match(cloudSync, /baseRevision/);
assert.match(cloudSync, /error\.status === 409/);
assert.match(cloudSync, /customMusicData = ""/);
assert.match(cloudSync, /catGameLocalBackupV1:/);
assert.match(cloudSync, /catGameGuestSaveClaimV1/);
assert.match(cloudSync, /\/recovery/);
assert.match(cloudSync, /GAME_SAVE_TOO_LARGE|tooLarge/);
assert.match(cloudSync, /localDigest/);
assert.match(cloudSync, /cloudDigest/);
assert.match(saveSystem, /CatGameCloud\.onLocalSave\(nextData\)/);
assert.match(saveSystem, /setStorageKey/);
assert.match(savePanel, /saveSystem\.getStorageKey\(\)/);
assert.match(settingsPanel, /saveSystem\.getStorageKey\(\)/);
assert.doesNotMatch(i18n, /does not upload progress to a server|\u6e38\u620f\u4e0d\u4f1a\u4e0a\u4f20\u5230\u670d\u52a1\u5668|\u30b5\u30fc\u30d0\u30fc\u3078\u9001\u4fe1\u3055\u308cません/);
assert.match(gameMain, /applyCloudSave/);
assert.match(gameMain, /activateMemberStorage/);
assert.match(gameMain, /:member:/);
assert.match(gameMain, /CatGameCloud\.init\(game\.state\.game\)/);
assert.match(gameMain, /CatGameCommerce\.init\(\)/);
assert.match(commerce, /\/api\/games\/cat-life\/catalog/);
assert.match(commerce, /\/api\/games\/cat-life\/entitlements/);
assert.match(commerce, /\/api\/games\/cat-life\/redemptions/);
assert.match(commerce, /JSON\.stringify\(\{ productId: productId, idempotencyKey: idempotencyKey \}\)/);
assert.doesNotMatch(commerce, /src\/data\/products|server\/catalog/);
assert.match(commerce, /CatGameContentManifest/);
assert.doesNotMatch(commerce, /cat-life\.cosmetic\.skin\.moonlit-tabby\.v1/);
assert.doesNotMatch(commerce, /cat-life\.content\.furniture\.station-room\.v1/);
assert.match(contentManifest, /cat-life\.cosmetic\.skin\.moonlit-tabby\.v1/);
assert.match(contentManifest, /cat-life\.content\.furniture\.station-room\.v1/);
assert.match(homeSystem, /CatGameContentManifest/);
assert.doesNotMatch(homeSystem, /cat-life\.content\.furniture\.station-room\.v1/);
assert.doesNotMatch(homeSystem, /"station-waiting": \[/);
assert.doesNotMatch(commerce, /planned 商品|Planned products|planned products/);
assert.doesNotMatch(
  gameMain,
  /settings\.language\s*=\s*window\.CatGameIntegration/,
  'a URL language must never replace the saved game language'
);
assert.match(gameMain, /CatGameIntegration\.useSavedLanguage/);
assert.match(settingsPanel, /activeLanguage = game\.utils\.i18n\.getLanguage\(\)/);
assert.match(namespace, /storageKey: "catGameSaveV1"/);
assert.match(namespace, /version: "1\.19\.2"/);
assert.match(namespace, /Member Store is now a separate page/);
assert.match(product, /upstreamSourceCommit: '0cc839f'/);
assert.match(landing, /Signed-in members can sync a cloud save/);
assert.match(landing, /登入會員後可同步雲端存檔/);
assert.match(landing, /five latest cloud versions remain available for recovery/);
assert.match(landing, /最近 5 份雲端記錄恢復/);
assert.match(landing, /只有後台正式上架的商品才會顯示價格並允許兌換/);
assert.match(landing, /Prices and redemption appear only after a product is formally activated in Admin/);
assert.match(product, /latestVersion: '1\.19\.2'/);
assert.doesNotMatch(landing, /not yet synced to a Station Cat member account/);
assert.doesNotMatch(landing, /尚未與 Station Cat 會員帳號同步/);
assert.doesNotMatch(landing, /尚未与 Station Cat 会员账号同步/);
assert.match(landing, /SoftwareApplication/);
assert.match(landing, /inLanguage: \['zh-Hant', 'zh-Hans', 'en', 'ja'\]/);
const zhHantLanding = landing.slice(landing.indexOf("'zh-Hant':"), landing.indexOf("'zh-Hans':"));
assert.doesNotMatch(zhHantLanding, /猫咪/, 'Traditional Chinese product copy must use 貓咪');
assert.match(apps, /catLifeGameProduct/);
assert.match(home, /bench-card__icon--cat-life/);
assert.match(navigation, /href: '\/en\/apps\/cat-life-game\/'/);
assert.match(footer, /label: 'Cat Life Game'/);
assert.match(headers, /\/games\/cat-life\/\*/);
assert.match(headers, /Cache-Control: no-cache/);
assert.match(headers, /script-src 'self'/);
assert.match(headers, /X-Robots-Tag: noindex, nofollow/);
assert.match(gameIndex, /data-cat-recovery-action/);
assert.match(gameIndex, /data-cat-recovery-dialog/);
assert.match(gameIndex, /renderMemberStorePanel\.js/);
assert.doesNotMatch(shopPanel, /CatGameCommerce|notice-list/);
assert.match(memberStorePanel, /CatGameCommerce\.renderShopSection\(\)/);
assert.match(gameNavigation, /"member_store"/);
assert.match(gameMain, /member_store: game\.ui\.renderMemberStorePanel/);
assert.match(i18n, /nav_member_store: "Member Store"/);
assert.match(headerPanel, /role="progressbar"/);
assert.match(headerPanel, /aria-valuenow/);
assert.match(broadsheetStyles, /\.bar-track\.is-battery/);
assert.match(broadsheetStyles, /grid-template-columns: repeat\(auto-fit, minmax\(205px, 1fr\)\)/);
assert.match(broadsheetStyles, /grid-template-columns: 92px minmax\(0, 1fr\)/);
assert.equal(shouldIncludeSitemapRoute('/games/cat-life/'), false);
for (const route of [
  '/en/apps/cat-life-game/',
  '/ja/apps/cat-life-game/',
  '/zh-hans/apps/cat-life-game/',
  '/zh-hant/apps/cat-life-game/'
]) {
  assert.equal(shouldIncludeSitemapRoute(route), true, `${route} must stay indexable`);
}

const localAssets = [...gameIndex.matchAll(/(?:src|href)="\.\/(.*?)"/g)].map((match) => match[1]);
for (const asset of localAssets) {
  assert.equal(existsSync(join(root, gameRoot, asset)), true, `${asset} referenced by the game shell must exist`);
}

let replacedUrl = '';
const languageSelect = { value: '', addEventListener() {} };
const languageNote = { textContent: '', hidden: true };
const integrationContext = {
  URL,
  URLSearchParams,
  window: {
    location: {
      href: 'https://wwwstationcat.org/games/cat-life/?lang=zh-Hant',
      search: '?lang=zh-Hant'
    },
    history: {
      replaceState(_state, _title, url) {
        replacedUrl = url;
      }
    }
  },
  document: {
    documentElement: { lang: '' },
    querySelector(selector) {
      if (selector === '[data-station-language]') return languageSelect;
      if (selector === '[data-station-language-note]') return languageNote;
      return null;
    },
    querySelectorAll() {
      return [];
    }
  }
};
vm.runInNewContext(integration, integrationContext);
assert.equal(integrationContext.window.CatGameIntegration.sessionLanguage, 'zh-CN');
assert.equal(languageSelect.value, 'zh-Hant');
assert.equal(languageNote.textContent, '遊戲介面目前為簡中');

const savedLanguage = 'en';
const languageContext = {
  window: {
    CatGameIntegration: integrationContext.window.CatGameIntegration,
    CatGame: {
      state: { game: { settings: { language: savedLanguage } } },
      utils: {}
    }
  }
};
vm.runInNewContext(i18n, languageContext);
assert.equal(languageContext.window.CatGame.utils.i18n.getLanguage(), 'zh-CN');
assert.equal(
  languageContext.window.CatGame.state.game.settings.language,
  savedLanguage,
  'the session locale may change the rendered language but must not mutate the saved preference'
);
languageContext.window.CatGameIntegration.useSavedLanguage(savedLanguage);
assert.equal(languageContext.window.CatGameIntegration.sessionLanguage, '');
assert.equal(new URL(replacedUrl).searchParams.has('lang'), false);

const policyContext = { window: {} };
vm.runInNewContext(cloudSyncPolicy, policyContext);
const resolveInitialAction = policyContext.window.CatGameCloudPolicy.resolveInitialAction;
assert.equal(resolveInitialAction('local-a', null, null), 'upload');
assert.equal(resolveInitialAction('same', { digest: 'same' }, null), 'synced');
assert.equal(
  resolveInitialAction('normalized-local', { digest: 'compact-cloud' }, {
    localDigest: 'normalized-local',
    cloudDigest: 'compact-cloud'
  }),
  'synced',
  'different local and cloud representations must still be recognized as the same synced revision'
);
assert.equal(
  resolveInitialAction('local-after-play', { digest: 'compact-cloud' }, {
    localDigest: 'normalized-local',
    cloudDigest: 'compact-cloud'
  }),
  'upload',
  'playing after applying a cloud save must upload instead of reporting a false conflict'
);
assert.equal(
  resolveInitialAction('normalized-local', { digest: 'cloud-after-other-device' }, {
    localDigest: 'normalized-local',
    cloudDigest: 'compact-cloud'
  }),
  'remote'
);
assert.equal(
  resolveInitialAction('local-after-play', { digest: 'cloud-after-other-device' }, {
    localDigest: 'normalized-local',
    cloudDigest: 'compact-cloud'
  }),
  'conflict'
);
assert.equal(
  resolveInitialAction('legacy', { digest: 'legacy' }, { digest: 'legacy' }),
  'synced',
  'existing one-digest markers must remain readable during migration'
);

const storage = new Map();
const saveContext = {
  window: {
    CatGame: {
      config: { storageKey: 'catGameSaveV1', saveSchemaVersion: 2 },
      state: {
        game: null,
        normalizeGameData(value) { return value; }
      },
      utils: {
        format: { formatDateKey() { return '2026-08-30'; } },
        storage: {
          loadJSON(key) { return storage.get(key) || null; },
          saveJSON(key, value) { storage.set(key, value); }
        }
      }
    }
  }
};
vm.runInNewContext(saveSystem, saveContext);
const memberSaveSystem = saveContext.window.CatGame.state.saveSystem;
memberSaveSystem.setStorageKey('catGameSaveV1:member:1');
memberSaveSystem.saveGame({ meta: {}, player: { coins: 10 } });
memberSaveSystem.setStorageKey('catGameSaveV1:member:2');
memberSaveSystem.saveGame({ meta: {}, player: { coins: 20 } });
assert.equal(storage.get('catGameSaveV1:member:1').player.coins, 10);
assert.equal(storage.get('catGameSaveV1:member:2').player.coins, 20);
assert.equal(storage.has('catGameSaveV1'), false, 'member saves must not overwrite the shared guest slot');

const futureSave = { schemaVersion: 3, meta: {}, player: { gold: 99 } };
storage.set('catGameSaveV1:member:3', futureSave);
saveContext.window.CatGame.state.normalizeGameData = (value) => {
  if (value.schemaVersion > 2) {
    const error = new Error('unsupported');
    error.code = 'SAVE_SCHEMA_UNSUPPORTED';
    throw error;
  }
  return value;
};
saveContext.window.CatGame.state.createNewGame = () => ({ schemaVersion: 2, meta: {}, player: { gold: 200 } });
memberSaveSystem.setStorageKey('catGameSaveV1:member:3');
const compatibilitySave = memberSaveSystem.loadOrCreateGame();
assert.equal(compatibilitySave.schemaVersion, 2);
assert.equal(memberSaveSystem.getStorageKey(), 'catGameSaveV1:member:3:compat-v2');
assert.deepEqual(storage.get('catGameSaveV1:member:3'), futureSave, 'future saves must remain untouched');
assert.equal(storage.get('catGameSaveV1:member:3:compat-v2').schemaVersion, 2);

const migrationContext = { window: {} };
vm.runInNewContext(saveMigrations, migrationContext);
const legacySave = {
  version: '1.0.0',
  player: { coins: 42 },
  settings: { musicVolume: 55 }
};
const migratedSave = migrationContext.window.CatGameSaveMigrations.migrate(legacySave);
assert.equal(migratedSave.fromVersion, 0);
assert.equal(migratedSave.toVersion, 2);
assert.deepEqual([...migratedSave.applied], [1, 2]);
assert.equal(migratedSave.data.schemaVersion, 2);
assert.equal(migratedSave.data.player.gold, 42);
assert.equal(migratedSave.data.player.coins, undefined);
assert.equal(migratedSave.data.settings.bgmVolume, 55);
assert.equal(migratedSave.data.settings.sfxVolume, 55);
assert.equal(migratedSave.data.settings.musicVolume, undefined);
assert.equal(legacySave.player.coins, 42, 'migrations must not mutate the stored source object');
assert.throws(
  () => migrationContext.window.CatGameSaveMigrations.migrate({ schemaVersion: 3 }),
  (error) => error.code === 'SAVE_SCHEMA_UNSUPPORTED'
);

console.log('Cat Life Game website integration tests passed.');
