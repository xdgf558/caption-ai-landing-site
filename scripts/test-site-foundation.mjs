import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as workerHooks } from '../src/worker.js';
import { generateSitemap, shouldIncludeSitemapRoute } from './generate-sitemap.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(projectRoot, path), 'utf8');

const [
  baseLayout,
  home,
  header,
  footer,
  site,
  headers,
  redirects,
  wrangler,
  worker,
  notFound,
  privacy,
  support,
  terms,
  structuredDataHelper,
  navigation,
  appsIndex,
  languageSwitcher
] = await Promise.all([
  read('src/layouts/BaseLayout.astro'),
  read('src/components/StationHome.astro'),
  read('src/components/Header.astro'),
  read('src/components/Footer.astro'),
  read('src/data/site.ts'),
  read('public/_headers'),
  read('public/_redirects'),
  read('wrangler.toml'),
  read('src/worker.js'),
  read('src/components/NotFoundPage.astro'),
  read('src/pages/en/privacy.astro'),
  read('src/pages/en/support.astro'),
  read('src/pages/en/terms.astro'),
  read('src/data/structured-data.ts'),
  read('src/data/navigation.ts'),
  read('src/components/AppsIndex.astro'),
  read('src/components/LanguageSwitcher.astro')
]);

assert.match(site, /ogImage:\s*'\/images\/social\/station-cat-og\.png'/);
assert.match(site, /xUrl:\s*'https:\/\/x\.com\/statiocat'/);
assert.match(baseLayout, /property="og:image:type" content="image\/png"/);
assert.match(baseLayout, /property="og:image:width" content="1200"/);
assert.match(baseLayout, /property="og:image:height" content="630"/);
assert.match(baseLayout, /rel="icon" href="\/favicon\.ico"/);
assert.match(baseLayout, /rel="icon" href="\/favicon-64\.png"/);
assert.match(baseLayout, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);

for (const title of [
  'Station Cat｜獨立 App、連載小說與信號簡報',
  'Station Cat｜独立 App、连载小说与信号简报',
  'Station Cat | Independent Apps, Serial Fiction, and Signals',
  'Station Cat｜個人開発アプリ・連載小説・シグナル速報'
]) {
  assert.ok(home.includes(title), `homepage title is missing: ${title}`);
}

await assert.rejects(access(resolve(projectRoot, 'src/pages/zh-hant/index.astro')));
assert.match(redirects, /^\/zh-hant \/ 301$/m);
assert.match(redirects, /^\/zh-hant\/ \/ 301$/m);
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
assert.doesNotMatch(redirects, /^\/signal \/signal\/ 301$/m);
await assert.rejects(access(resolve(projectRoot, 'public/sitemap.xml')));
for (const legacyPage of [
  'src/pages/apps/index.astro',
  'src/pages/points.astro',
  'src/pages/privacy.astro',
  'src/pages/support.astro',
  'src/pages/terms.astro',
  'src/pages/library/index.astro',
  'src/pages/works/index.astro',
  'src/pages/en/works/index.astro',
  'src/pages/ja/works/index.astro',
  'src/pages/zh-hans/works/index.astro',
  'src/pages/zh-hant/works/index.astro'
]) {
  await assert.rejects(access(resolve(projectRoot, legacyPage)), `${legacyPage} must not remain a duplicate page`);
}

for (const header of [
  'Content-Security-Policy: frame-ancestors \'none\'',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY'
]) {
  assert.ok(headers.includes(header), `static security header is missing: ${header}`);
}
assert.match(headers, /\/_astro\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
assert.match(headers, /\/images\/optimized\/\*\s+Cache-Control: public, max-age=31536000, immutable/);

assert.match(wrangler, /not_found_handling\s*=\s*"404-page"/);
assert.match(wrangler, /run_worker_first\s*=\s*\[/);
assert.ok(wrangler.includes('"/sitemap.xml"'), 'sitemap must run the Worker first');
for (const route of ['/admin', '/admin/*', '/admin-v2', '/admin-v2/*']) {
  assert.ok(wrangler.includes(`"${route}"`), `admin route must run the Worker first: ${route}`);
}
for (const route of ['/works', '/works/*']) {
  assert.ok(wrangler.includes(`"${route}"`), `unprefixed legacy works route must run the Worker first: ${route}`);
}
for (const route of ['/signal/*', '/en/*', '/ja/*', '/zh-hans/*', '/zh-hant/*']) {
  assert.ok(wrangler.includes(`"${route}"`), `dynamic route must run the Worker first: ${route}`);
}
assert.match(worker, /'content-security-policy': "frame-ancestors 'none'"/);
assert.match(worker, /const getPermanentTrailingSlashRedirect/);
assert.match(worker, /Response\.redirect\(redirectUrl\.toString\(\), 301\)/);
for (const path of ['/devlog', '/en/devlog', '/zh-hant/devlog/post', '/works/book', '/ja/works/book']) {
  assert.equal(workerHooks.getPermanentTrailingSlashRedirect(path), `${path}/`);
}
for (const path of ['/endevlog', '/zh-hantdevlog', '/jaworks', '/zh-hansworks']) {
  assert.equal(workerHooks.getPermanentTrailingSlashRedirect(path), '', `garbage route must not redirect: ${path}`);
}
for (const path of ['/about', '/en/apps/nodepilot', '/zh-hant/library']) {
  assert.equal(workerHooks.isStaticTrailingSlashCandidate(path), true, `static route must be checked: ${path}`);
}
for (const path of ['/', '/about/', '/images/logo.webp', '/unknown.json']) {
  assert.equal(workerHooks.isStaticTrailingSlashCandidate(path), false, `non-page route must not be checked: ${path}`);
}
assert.equal(workerHooks.getLegacyWorksRedirectPath('/works/book/chapter'), '/novel/book/chapter/chapter/');
assert.equal(workerHooks.getLegacyWorksRedirectPath('/en/works/book/chapter'), '/en/novel/book/chapter/chapter/');
assert.equal(workerHooks.getLegacyWorksRedirectPath('/ja/works/book'), '/novel/book/');
assert.doesNotMatch(worker, /<a href="\/apps\/">|<a href="\/library\/">/);

for (const source of [navigation, appsIndex]) {
  assert.match(source, /\/en\/apps\//, 'English app navigation must use the explicit locale prefix');
}
assert.match(languageSwitcher, /isApps \? `\/en\$\{appsPath\}`/);
assert.match(languageSwitcher, /isNovel \? `\/en\$\{novelPath\}`/);
assert.match(languageSwitcher, /isNovel \? novelPath/);
assert.match(navigation, /href: '\/en\/novel\/'/);
assert.match(appsIndex, /canonical: '\/en\/apps\/'/);

assert.match(notFound, /robots="noindex, follow"/);
assert.match(notFound, /aria-labelledby="not-found-heading"/);
for (const page of [
  'src/pages/404.astro',
  'src/pages/en/404.astro',
  'src/pages/ja/404.astro',
  'src/pages/zh-hans/404.astro',
  'src/pages/zh-hant/404.astro'
]) {
  await access(resolve(projectRoot, page));
}

for (const source of [privacy, support, terms]) {
  assert.doesNotMatch(source, /Everyday AI Apps/i);
}

assert.match(baseLayout, /type="application\/ld\+json"/);
assert.match(home, /'@type': 'Organization'/);
assert.match(home, /'@type': 'WebSite'/);
assert.match(structuredDataHelper, /'@type': 'Book'/);
assert.match(worker, /const dynamicBookStructuredData/);
assert.match(worker, /structuredData: dynamicBookStructuredData\(route, serial\)/);
assert.match(worker, /globalThis\.caches\?\.default/);
assert.match(worker, /LIMIT 50000/);
assert.match(worker, /robots: 'noindex, follow'/);
assert.match(worker, /const STATION_X_URL = 'https:\/\/x\.com\/statiocat'/);
assert.doesNotMatch([site, home, footer, navigation, worker].join('\n'), /bketck/);
assert.match(home, /station-cat-logo-1668c2e5-160\.webp/);
assert.match(header, /station-cat-logo-1668c2e5-160\.webp/);
assert.match(footer, /station-cat-logo-1668c2e5-160\.webp/);
assert.match(home, /simplecut-icon-0268e767/);
assert.match(home, /offline-future-cover-96c3c463-360\.webp/);
assert.doesNotMatch(home, /station-cat-logo\.png/);
assert.doesNotMatch(home, /simpleCutProProduct\.assets\.icon/);
assert.doesNotMatch(home, /content\/media\/covers\/2026\/06/);
await access(resolve(projectRoot, 'scripts/assets/station-cat-logo.png'));
await assert.rejects(access(resolve(projectRoot, 'public/images/home/station-cat-logo.png')));
for (const asset of [
  'public/images/optimized/station-cat-logo-1668c2e5-160.webp',
  'public/images/optimized/station-cat-logo-1668c2e5-320.webp',
  'public/images/optimized/simplecut-icon-0268e767-256.webp',
  'public/images/optimized/offline-future-cover-96c3c463-360.webp'
]) {
  const info = await stat(resolve(projectRoot, asset));
  assert.ok(info.size < 100_000, `${asset} should stay below 100 KB`);
}

for (const route of [
  '/devlog', '/devlog/', '/admin-v2', '/admin-v2/', '/library/', '/en/library/', '/apps/', '/points/',
  '/privacy/', '/support/', '/terms/', '/works/', '/en/works/'
]) {
  assert.equal(shouldIncludeSitemapRoute(route), false, `sitemap must exclude ${route}`);
}
for (const route of ['/', '/signal/', '/novel/', '/en/apps/', '/en/points/', '/zh-hant/apps/mindbudget/']) {
  assert.equal(shouldIncludeSitemapRoute(route), true, `sitemap must include ${route}`);
}
const sitemapFixture = await mkdtemp(join(tmpdir(), 'station-cat-sitemap-'));
try {
  for (const route of ['index.html', 'en/apps/tool/index.html', 'apps/legacy/index.html', 'devlog/post/index.html', 'library/index.html']) {
    const path = resolve(sitemapFixture, route);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '<!doctype html>', 'utf8');
  }
  const generated = await generateSitemap({ distRoot: sitemapFixture, lastmod: '2026-08-29' });
  assert.ok(generated.routes.includes('/en/apps/tool/'));
  assert.ok(generated.routes.includes('/signal/'));
  assert.ok(generated.routes.includes('/novel/'));
  assert.ok(!generated.routes.includes('/devlog/post/'));
  assert.ok(!generated.routes.includes('/library/'));
  assert.ok(!generated.routes.includes('/apps/legacy/'));
  assert.match(generated.xml, /<lastmod>2026-08-29<\/lastmod>/);
} finally {
  await rm(sitemapFixture, { recursive: true, force: true });
}

const mergedSitemap = workerHooks.mergeSitemapXmlWithRows(
  '<?xml version="1.0"?><urlset><url><loc>https://wwwstationcat.org/</loc><lastmod>2026-08-29</lastmod></url></urlset>',
  [
    { entry_type: 'signal_brief', locale: 'ja', slug: 'daily-brief', updated_at: '2026-08-28 10:00:00' },
    { entry_type: 'novel_series', locale: 'zh-Hant', slug: 'book-one', updated_at: '2026-08-27 10:00:00' },
    { entry_type: 'novel_chapter', locale: 'en', parent_slug: 'book-one', slug: 'chapter-one', updated_at: '2026-08-26 10:00:00' },
    { entry_type: 'novel_series', locale: 'ja', slug: 'unsupported-book', updated_at: '2026-08-25 10:00:00' },
    { entry_type: 'blog_post', locale: 'zh-Hant', slug: 'retired-post', updated_at: '2026-08-24 10:00:00' }
  ]
);
assert.match(mergedSitemap, /\/ja\/signal\/daily-brief\//);
assert.match(mergedSitemap, /\/novel\/book-one\//);
assert.match(mergedSitemap, /\/en\/novel\/book-one\/chapter\/chapter-one\//);
assert.doesNotMatch(mergedSitemap, /unsupported-book|retired-post/);
assert.equal(workerHooks.normalizeIsoTimestamp('2026-08-26 04:34:28'), '2026-08-26T04:34:28.000Z');
assert.equal(workerHooks.normalizeIsoTimestamp('2026-08-26'), '2026-08-26T00:00:00.000Z');
assert.equal(workerHooks.normalizeIsoTimestamp('2026-08-26T04:34:28+08:00'), '2026-08-25T20:34:28.000Z');
assert.equal(workerHooks.normalizeIsoTimestamp('not-a-date'), '');
const dynamicBookSchema = workerHooks.dynamicBookStructuredData(
  { basePath: '/novel/', locale: 'zh-Hant' },
  {
    slug: 'book-one',
    title: 'Book One',
    description: 'A test book.',
    published_at: '2026-08-26 04:34:28',
    updated_at: '2026-08-27 05:45:39'
  }
);
assert.equal(dynamicBookSchema.datePublished, '2026-08-26T04:34:28.000Z');
assert.equal(dynamicBookSchema.dateModified, '2026-08-27T05:45:39.000Z');

const originalCaches = globalThis.caches;
let cachedSitemapResponse = null;
let sitemapAssetFetches = 0;
globalThis.caches = {
  default: {
    match: async () => cachedSitemapResponse?.clone() || null,
    put: async (_key, response) => {
      cachedSitemapResponse = response.clone();
    }
  }
};
try {
  const pendingCacheWrites = [];
  const sitemapEnv = {
    ASSETS: {
      fetch: async () => {
        sitemapAssetFetches += 1;
        return new Response('<?xml version="1.0"?><urlset></urlset>', { status: 200 });
      }
    }
  };
  const request = new Request('https://wwwstationcat.org/sitemap.xml');
  const first = await workerHooks.handleSitemap(request, sitemapEnv, {
    waitUntil: (promise) => pendingCacheWrites.push(promise)
  });
  await Promise.all(pendingCacheWrites);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('cache-control') || '', /s-maxage=3600/);
  assert.ok(cachedSitemapResponse, 'sitemap response should be written to the Cache API');
  const second = await workerHooks.handleSitemap(request, sitemapEnv, { waitUntil: () => {} });
  assert.equal(second.status, 200);
  assert.equal(sitemapAssetFetches, 1, 'cached sitemap should avoid another asset or D1 load');
} finally {
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
}

const readPngDimensions = async (path) => {
  const buffer = await readFile(resolve(projectRoot, path));
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} is not a PNG`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
};

const ico = await readFile(resolve(projectRoot, 'public/favicon.ico'));
assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'favicon.ico has an invalid header');
assert.deepEqual(await readPngDimensions('public/favicon-64.png'), [64, 64]);
assert.deepEqual(await readPngDimensions('public/apple-touch-icon.png'), [180, 180]);
assert.deepEqual(await readPngDimensions('public/images/social/station-cat-og.png'), [1200, 630]);

console.log('Site foundation tests passed.');
