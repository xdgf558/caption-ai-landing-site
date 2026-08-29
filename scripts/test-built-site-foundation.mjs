import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (path) => readFile(resolve(projectRoot, 'dist', path), 'utf8');
const distPath = (path) => resolve(projectRoot, 'dist', path);
const pageTitle = (html) => html.match(/<title>([^<]+)<\/title>/)?.[1] || '';

const localizedNotFoundPages = [
  ['en', 'lang="en"', 'This stop is not on the map.'],
  ['ja', 'lang="ja"', 'この停車駅は地図にありません。'],
  ['zh-hans', 'lang="zh-Hans"', '这一站不在地图上。'],
  ['zh-hant', 'lang="zh-Hant"', '這一站不在地圖上。']
];

for (const [locale, langMarker, heading] of localizedNotFoundPages) {
  const fallback = await readDist(`${locale}/404.html`);
  assert.ok(fallback.includes(langMarker), `${locale}/404.html must preserve the locale language marker`);
  assert.ok(fallback.includes(heading), `${locale}/404.html must contain localized copy`);
}

const redirects = await readDist('_redirects');
assert.doesNotMatch(redirects, /^\/signal \/signal\/ 301$/m, 'Worker owns the slashless Signal redirect');
for (const [source, target] of [
  ['/apps', '/en/apps/'],
  ['/points', '/en/points/'],
  ['/privacy', '/en/privacy/'],
  ['/terms', '/en/terms/'],
  ['/support', '/en/support/'],
  ['/library', '/zh-hant/library/']
]) {
  assert.ok(redirects.includes(`${source} ${target} 301`), `${source} must redirect permanently to ${target}`);
}

for (const legacyPage of [
  'apps/index.html',
  'points/index.html',
  'privacy/index.html',
  'support/index.html',
  'terms/index.html',
  'library/index.html'
]) {
  await assert.rejects(access(distPath(legacyPage)), `${legacyPage} must not be emitted as a duplicate page`);
}

const sitemap = await readDist('sitemap.xml');
assert.match(sitemap, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
for (const route of [
  '/novel/',
  '/en/novel/',
  '/signal/',
  '/ja/signal/',
  '/en/apps/',
  '/en/points/',
  '/zh-hant/apps/mindbudget/'
]) {
  assert.ok(sitemap.includes(`<loc>https://wwwstationcat.org${route}</loc>`), `sitemap must include ${route}`);
}
assert.doesNotMatch(
  sitemap,
  /\/devlog\/|\/admin-v2\/|\/library\/|https:\/\/wwwstationcat\.org\/(?:apps|points|privacy|support|terms|works)\//
);

const localizedAppsPages = [
  ['en/apps/index.html', 'Station Cat Apps | Independent Creative Tools', 'https://wwwstationcat.org/en/apps/'],
  ['ja/apps/index.html', 'Station Cat Apps｜個人開発ツール', 'https://wwwstationcat.org/ja/apps/'],
  ['zh-hans/apps/index.html', 'Station Cat Apps｜独立创作工具', 'https://wwwstationcat.org/zh-hans/apps/'],
  ['zh-hant/apps/index.html', 'Station Cat Apps｜獨立創作工具', 'https://wwwstationcat.org/zh-hant/apps/']
];
const appsTitles = new Set();
for (const [path, expectedTitle, canonical] of localizedAppsPages) {
  const html = await readDist(path);
  const title = pageTitle(html);
  appsTitles.add(title);
  assert.equal(title, expectedTitle, `${path} must use its localized descriptive title`);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`), `${path} canonical is incorrect`);
  assert.ok(
    html.includes('<link rel="alternate" hreflang="en" href="https://wwwstationcat.org/en/apps/">'),
    `${path} must point its English alternate to /en/apps/`
  );
  assert.ok(
    html.includes('<link rel="alternate" hreflang="x-default" href="https://wwwstationcat.org/zh-hant/apps/">'),
    `${path} must use the Traditional Chinese apps page as x-default`
  );
}
assert.equal(appsTitles.size, 4, 'localized Apps pages must not share the same title');

for (const [path, expectedTitle, canonical] of [
  ['en/apps/nodepilot/index.html', 'NodePilot for macOS and Windows | Station Cat', 'https://wwwstationcat.org/en/apps/nodepilot/'],
  ['en/apps/novelforge-ai/index.html', 'NovelForge AI | Local-First Fiction Writing Workbench | Station Cat', 'https://wwwstationcat.org/en/apps/novelforge-ai/'],
  ['en/points/index.html', 'Station Points Pricing and Use | Station Cat', 'https://wwwstationcat.org/en/points/']
]) {
  const html = await readDist(path);
  assert.equal(pageTitle(html), expectedTitle, `${path} title is incorrect`);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}">`), `${path} canonical is incorrect`);
}

const homepage = await readDist('index.html');
assert.match(homepage, /station-cat-logo-67dc39a9-160\.webp/);
assert.match(homepage, /offline-future-cover-96c3c463-360\.webp/);
assert.match(homepage, /"@type":"Organization"/);
assert.match(homepage, /"@type":"WebSite"/);
assert.doesNotMatch(homepage, /station-cat-logo\.png/);

console.log('Built site foundation tests passed.');
