import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'dist');
const outputRoot = path.join(root, '.generated', 'music-staging-assets');
const htmlPaths = [
  '/admin/music/index.html',
  '/admin/music/collections/index.html',
  '/admin/music/collections/upload/index.html',
  '/admin/music/featured/index.html',
  '/music/index.html',
  '/en/music/index.html',
  '/ja/music/index.html',
  '/zh-hans/music/index.html'
];
const dynamicAssets = new Set([
  '/vendor/music-mp3/lamejs-1.2.7.js'
]);
const assetNamespaces = ['/favicon', '/apple-touch-icon', '/_astro/', '/images/', '/styles/', '/fonts/', '/vendor/music-mp3/'];
const assetExtension = /\.(?:css|ico|js|otf|png|txt|webp|woff2?)$/i;
const htmlReference = /(?:src|href)="(\/[^"?#]*(?:[?#][^"]*)?)"/g;
const quotedAsset = /["']((?:\.\/|\/)(?:[^"']+\.)?(?:css|ico|js|otf|png|txt|webp|woff2?))["']/gi;
const cssAsset = /url\(\s*["']?((?:\.\/|\/)[^"')]+)["']?\s*\)/gi;

function safeAsset(value, from = '/') {
  const pathname = value.split(/[?#]/, 1)[0];
  const resolved = pathname.startsWith('/') ? path.posix.normalize(pathname)
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), pathname));
  if (!resolved.startsWith('/') || resolved.includes('..') || !assetExtension.test(resolved) ||
    !assetNamespaces.some(prefix => resolved.startsWith(prefix))) {
    throw new Error(`Unexpected music staging asset reference: ${value}`);
  }
  return resolved;
}

const assets = new Set(dynamicAssets);
for (const htmlPath of htmlPaths) {
  const html = await readFile(path.join(sourceRoot, htmlPath), 'utf8');
  for (const match of html.matchAll(htmlReference)) {
    const pathname = match[1].split(/[?#]/, 1)[0];
    // Page links stay visible but the staging Worker decides which exact routes
    // exist. Only file-like references enter the deployed asset set.
    if (assetExtension.test(pathname)) assets.add(safeAsset(pathname, htmlPath));
  }
}

const pending = [...assets];
while (pending.length) {
  const asset = pending.pop();
  const source = await readFile(path.join(sourceRoot, asset), 'utf8');
  if (!/\.(?:css|js)$/i.test(asset)) continue;
  for (const pattern of [quotedAsset, cssAsset]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('data:')) continue;
      const dependency = safeAsset(match[1], asset);
      if (!assets.has(dependency)) { assets.add(dependency); pending.push(dependency); }
    }
  }
}

const files = [...htmlPaths, ...assets].sort();
await rm(outputRoot, { recursive: true, force: true });
for (const file of files) {
  const relative = file.slice(1);
  const destination = path.join(outputRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(sourceRoot, relative), destination);
}

console.log(`Prepared ${htmlPaths.length} pages and ${assets.size} exact dependencies for isolated music staging.`);
