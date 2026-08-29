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
  site,
  headers,
  redirects,
  wrangler,
  worker,
  notFound,
  favicon,
  privacy,
  support,
  terms,
  structuredDataHelper
] = await Promise.all([
  read('src/layouts/BaseLayout.astro'),
  read('src/components/StationHome.astro'),
  read('src/data/site.ts'),
  read('public/_headers'),
  read('public/_redirects'),
  read('wrangler.toml'),
  read('src/worker.js'),
  read('src/components/NotFoundPage.astro'),
  read('public/favicon.svg'),
  read('src/pages/privacy.astro'),
  read('src/pages/support.astro'),
  read('src/pages/terms.astro'),
  read('src/data/structured-data.ts')
]);

assert.match(site, /ogImage:\s*'\/images\/social\/station-cat-og\.png'/);
assert.match(baseLayout, /property="og:image:type" content="image\/png"/);
assert.match(baseLayout, /property="og:image:width" content="1200"/);
assert.match(baseLayout, /property="og:image:height" content="630"/);
assert.match(baseLayout, /rel="icon" href="\/favicon\.ico"/);
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
assert.doesNotMatch(redirects, /^\/signal \/signal\/ 301$/m);
await assert.rejects(access(resolve(projectRoot, 'public/sitemap.xml')));

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
for (const route of ['/signal/*', '/en/signal/*', '/ja/signal/*', '/zh-hans/signal/*', '/zh-hant/signal/*']) {
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

for (const source of [favicon, privacy, support, terms]) {
  assert.doesNotMatch(source, /Everyday AI Apps/i);
}
assert.match(favicon, /aria-label="Station Cat"/);

assert.match(baseLayout, /type="application\/ld\+json"/);
assert.match(home, /'@type': 'Organization'/);
assert.match(home, /'@type': 'WebSite'/);
assert.match(structuredDataHelper, /'@type': 'Book'/);
assert.match(worker, /const dynamicBookStructuredData/);
assert.match(worker, /structuredData: dynamicBookStructuredData\(route, serial\)/);
assert.match(worker, /robots: 'noindex, follow'/);
assert.match(home, /station-cat-logo-67dc39a9-160\.webp/);
assert.match(home, /simplecut-icon-0268e767/);
assert.match(home, /offline-future-cover-96c3c463-360\.webp/);
assert.doesNotMatch(home, /station-cat-logo\.png/);
assert.doesNotMatch(home, /simpleCutProProduct\.assets\.icon/);
assert.doesNotMatch(home, /content\/media\/covers\/2026\/06/);
for (const asset of [
  'public/images/optimized/station-cat-logo-67dc39a9-160.webp',
  'public/images/optimized/simplecut-icon-0268e767-256.webp',
  'public/images/optimized/offline-future-cover-96c3c463-360.webp'
]) {
  const info = await stat(resolve(projectRoot, asset));
  assert.ok(info.size < 100_000, `${asset} should stay below 100 KB`);
}

for (const route of ['/devlog', '/devlog/', '/admin-v2', '/admin-v2/', '/library/', '/en/library/']) {
  assert.equal(shouldIncludeSitemapRoute(route), false, `sitemap must exclude ${route}`);
}
for (const route of ['/', '/signal/', '/novel/', '/zh-hant/apps/mindbudget/']) {
  assert.equal(shouldIncludeSitemapRoute(route), true, `sitemap must include ${route}`);
}
const sitemapFixture = await mkdtemp(join(tmpdir(), 'station-cat-sitemap-'));
try {
  for (const route of ['index.html', 'apps/tool/index.html', 'devlog/post/index.html', 'library/index.html']) {
    const path = resolve(sitemapFixture, route);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '<!doctype html>', 'utf8');
  }
  const generated = await generateSitemap({ distRoot: sitemapFixture, lastmod: '2026-08-29' });
  assert.ok(generated.routes.includes('/apps/tool/'));
  assert.ok(generated.routes.includes('/signal/'));
  assert.ok(generated.routes.includes('/novel/'));
  assert.ok(!generated.routes.includes('/devlog/post/'));
  assert.ok(!generated.routes.includes('/library/'));
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

const readPngDimensions = async (path) => {
  const buffer = await readFile(resolve(projectRoot, path));
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} is not a PNG`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
};

const ico = await readFile(resolve(projectRoot, 'public/favicon.ico'));
assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'favicon.ico has an invalid header');
assert.deepEqual(await readPngDimensions('public/apple-touch-icon.png'), [180, 180]);
assert.deepEqual(await readPngDimensions('public/images/social/station-cat-og.png'), [1200, 630]);

console.log('Site foundation tests passed.');
