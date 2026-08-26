import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const retiredRadarFiles = [
  'public/images/stationcat-radar-preview.svg',
  'src/components/StationCatRadarDownload.astro',
  'src/components/StationCatRadarLanding.astro',
  'src/data/products/stationcat-radar.ts',
  'src/pages/apps/stationcat-radar/index.astro',
  'src/pages/apps/stationcat-radar/download.astro',
  'src/pages/ja/apps/stationcat-radar/index.astro',
  'src/pages/ja/apps/stationcat-radar/download.astro',
  'src/pages/zh-hans/apps/stationcat-radar/index.astro',
  'src/pages/zh-hans/apps/stationcat-radar/download.astro',
  'src/pages/zh-hant/apps/stationcat-radar/index.astro',
  'src/pages/zh-hant/apps/stationcat-radar/download.astro'
];

const retiredXFollowCleanerFiles = [
  'public/images/x-follow-cleaner-preview.svg',
  'src/components/XFollowCleanerLanding.astro',
  'src/data/products/x-follow-cleaner.ts',
  'src/pages/apps/x-follow-cleaner/index.astro',
  'src/pages/ja/apps/x-follow-cleaner/index.astro',
  'src/pages/zh-hans/apps/x-follow-cleaner/index.astro',
  'src/pages/zh-hant/apps/x-follow-cleaner/index.astro'
];

for (const path of [...retiredRadarFiles, ...retiredXFollowCleanerFiles]) {
  assert.equal(existsSync(join(root, path)), false, `${path} should be removed`);
}

const stationHome = read('src/components/StationHome.astro');
const appsIndex = read('src/components/AppsIndex.astro');
const footer = read('src/components/Footer.astro');
const navigation = read('src/data/navigation.ts');
const about = read('src/pages/about.astro');
const sitemap = read('public/sitemap.xml');
const worker = read('src/worker.js');
const nodePilotProduct = read('src/data/products/anytls-desktop-manager.ts');
const nodePilotLanding = read('src/components/AnyTlsDesktopManagerLanding.astro');
const mindBudgetProduct = read('src/data/products/mindbudget.ts');
const mindBudgetLanding = read('src/components/MindBudgetLanding.astro');

for (const [name, source] of Object.entries({ stationHome, appsIndex, footer, sitemap, worker })) {
  assert.doesNotMatch(source, /StationCat Radar|stationcat-radar|stationCatRadarProduct/, `${name} should not expose Radar`);
  assert.doesNotMatch(source, /X Follow Cleaner|x-follow-cleaner|xFollowCleanerProduct/, `${name} should not expose X Follow Cleaner`);
}

for (const [name, source] of Object.entries({ stationHome, footer, navigation, about })) {
  assert.doesNotMatch(
    source,
    /(?:\/devlog\/|Build log|開發博客|开发博客|開発ログ|Dev Blog)/i,
    `${name} should not expose the development blog`
  );
}
assert.equal(existsSync(join(root, 'src/pages/devlog/index.astro')), true, 'Devlog routes should remain restorable');
assert.equal(existsSync(join(root, 'src/content/devlog')), true, 'Devlog content should remain intact');

assert.match(stationHome, /anyTlsDesktopManagerProduct/);
assert.match(stationHome, /<h3>NodePilot<\/h3>/);
assert.match(stationHome, /nodePilotDownload/);
assert.match(appsIndex, /title="NodePilot"/);
assert.match(footer, /label: 'NodePilot'/);
assert.match(sitemap, /apps\/nodepilot\//);
assert.match(nodePilotProduct, /latestVersion: 'v0\.2\.26'/);
assert.match(nodePilotProduct, /36d5f94320755ab02b594051acf5a4c94564c9f4bc9c327a0950f507c0181e40/);
assert.match(nodePilotProduct, /53eec44cfa183eea11d6f8dc653dd10d0e0a0538623094ff1ca26ce7962db4b4/);
assert.match(nodePilotLanding, /0\.2\.26 版本更新/);
assert.match(worker, /anytls-desktop-manager\/0\.2\.26\/NodePilot-0\.2\.26-arm64\.dmg/);
assert.match(worker, /anytls-desktop-manager\/0\.2\.26\/NodePilot-Setup-0\.2\.26-x64\.exe/);
assert.match(worker, /anytls-desktop-manager\/0\.2\.26\/latest-mac\.yml/);
assert.match(worker, /anytls-desktop-manager\/0\.2\.26\/latest\.yml/);
assert.match(stationHome, /mindBudgetProduct/);
assert.match(appsIndex, /title=\{lang === 'zh-Hans' \|\| lang === 'zh-Hant' \? '花有數' : 'MindBudget'\}/);
assert.match(footer, /apps\/mindbudget\//);
assert.match(sitemap, /apps\/mindbudget\/download\//);
assert.match(sitemap, /apps\/mindbudget\/privacy\//);
assert.match(sitemap, /apps\/mindbudget\/support\//);
assert.match(mindBudgetProduct, /latestVersion: '0\.9\.4'/);
assert.match(mindBudgetProduct, /https:\/\/testflight\.apple\.com\/join\/gnhUNEbz/);
assert.doesNotMatch(mindBudgetProduct, /gnhUNEbz[，,]/);
assert.match(mindBudgetProduct, /dashboard-zh-hans\.png/);
assert.match(mindBudgetLanding, /Ask MindBudget/);

console.log('Product catalog retirement, homepage, and MindBudget tests passed.');
