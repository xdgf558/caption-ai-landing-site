import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { shouldIncludeSitemapRoute } from './generate-sitemap.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const gameRoot = 'public/games/cat-life';

for (const path of [
  `${gameRoot}/index.html`,
  `${gameRoot}/site-integration.js`,
  `${gameRoot}/site-integration.css`,
  `${gameRoot}/src/js/main.js`,
  `${gameRoot}/src/js/core/namespace.js`,
  `${gameRoot}/src/js/core/i18n.js`,
  `${gameRoot}/src/assets/cats/orange-tabby.png`,
  `${gameRoot}/src/assets/community/npc-cat-sprites.png`,
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
const gameMain = read(`${gameRoot}/src/js/main.js`);
const namespace = read(`${gameRoot}/src/js/core/namespace.js`);
const i18n = read(`${gameRoot}/src/js/core/i18n.js`);
const settingsPanel = read(`${gameRoot}/src/js/ui/renderSettingsPanel.js`);
const landing = read('src/components/CatLifeGameLanding.astro');
const product = read('src/data/products/cat-life-game.ts');
const apps = read('src/components/AppsIndex.astro');
const home = read('src/components/StationHome.astro');
const navigation = read('src/data/navigation.ts');
const footer = read('src/components/Footer.astro');
const headers = read('public/_headers');

assert.match(gameIndex, /<meta name="robots" content="noindex, nofollow"/);
assert.ok(gameIndex.indexOf('site-integration.js') < gameIndex.indexOf('core/namespace.js'));
assert.match(gameIndex, /data-station-link="gameInfo"/);
assert.match(gameIndex, /data-station-language/);
assert.match(integration, /sessionLanguage/);
assert.match(integration, /applySavedLanguage/);
assert.match(integration, /useSavedLanguage/);
assert.match(integration, /searchParams\.delete\("lang"\)/);
assert.match(integration, /"zh-Hant"/);
assert.match(integration, /"zh-CN"/);
assert.match(integration, /member: "Member center"/);
assert.doesNotMatch(
  gameMain,
  /settings\.language\s*=\s*window\.CatGameIntegration/,
  'a URL language must never replace the saved game language'
);
assert.match(gameMain, /CatGameIntegration\.useSavedLanguage/);
assert.match(settingsPanel, /activeLanguage = game\.utils\.i18n\.getLanguage\(\)/);
assert.match(namespace, /storageKey: "catGameSaveV1"/);
assert.match(product, /sourceCommit: '0cc839f'/);
assert.match(landing, /not yet synced to a Station Cat member account/);
assert.match(landing, /尚未與 Station Cat 會員帳號同步/);
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

console.log('Cat Life Game website integration tests passed.');
