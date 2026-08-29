import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  sitemap,
  favicon,
  privacy,
  support,
  terms
] = await Promise.all([
  read('src/layouts/BaseLayout.astro'),
  read('src/components/StationHome.astro'),
  read('src/data/site.ts'),
  read('public/_headers'),
  read('public/_redirects'),
  read('wrangler.toml'),
  read('src/worker.js'),
  read('src/components/NotFoundPage.astro'),
  read('public/sitemap.xml'),
  read('public/favicon.svg'),
  read('src/pages/privacy.astro'),
  read('src/pages/support.astro'),
  read('src/pages/terms.astro')
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
assert.match(redirects, /^\/signal \/signal\/ 301$/m);
assert.doesNotMatch(sitemap, /<loc>https:\/\/wwwstationcat\.org\/zh-hant\/<\/loc>/);

for (const header of [
  'Content-Security-Policy: frame-ancestors \'none\'',
  'Referrer-Policy: strict-origin-when-cross-origin',
  'X-Content-Type-Options: nosniff',
  'X-Frame-Options: DENY'
]) {
  assert.ok(headers.includes(header), `static security header is missing: ${header}`);
}

assert.match(wrangler, /not_found_handling\s*=\s*"404-page"/);
assert.match(wrangler, /run_worker_first\s*=\s*\[/);
for (const route of ['/signal/*', '/en/signal/*', '/ja/signal/*', '/zh-hans/signal/*', '/zh-hant/signal/*']) {
  assert.ok(wrangler.includes(`"${route}"`), `dynamic route must run the Worker first: ${route}`);
}
assert.match(worker, /'content-security-policy': "frame-ancestors 'none'"/);
assert.match(worker, /const getPermanentTrailingSlashRedirect/);
assert.match(worker, /Response\.redirect\(redirectUrl\.toString\(\), 301\)/);

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
