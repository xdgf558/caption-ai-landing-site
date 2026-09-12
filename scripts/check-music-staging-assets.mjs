import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMusicStagingRequest, musicStagingCanonicalPath } from '../src/music/stagingGate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.generated', 'music-staging-assets');
const expectedPages = new Map([
  ['/admin/music/', '/admin/music/index.html'],
  ['/admin/music/collections/', '/admin/music/collections/index.html'],
  ['/admin/music/collections/upload/', '/admin/music/collections/upload/index.html'],
  ['/admin/music/featured/', '/admin/music/featured/index.html'],
  ['/music/', '/music/index.html'],
  ['/en/music/', '/en/music/index.html'],
  ['/ja/music/', '/ja/music/index.html'],
  ['/zh-hans/music/', '/zh-hans/music/index.html']
]);
const assetExtension = /\.(?:css|ico|js|otf|png|txt|webp|woff2?)$/i;
const references = [
  /(?:src|href)="(\/[^"?#]*(?:[?#][^"]*)?)"/g,
  /["']((?:\.\/|\/)(?:[^"']+\.)?(?:css|ico|js|otf|png|txt|webp|woff2?))["']/gi,
  /url\(\s*["']?((?:\.\/|\/)[^"')]+)["']?\s*\)/gi
];

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    output.push(...(entry.isDirectory() ? await walk(absolute) : [`/${path.relative(root, absolute).replaceAll('\\', '/')}`]));
  }
  return output;
}

const files = new Set(await walk(root));
for (const [route, file] of expectedPages) {
  assert.ok(files.has(file), `missing staging page ${file}`);
  assert.equal(musicStagingCanonicalPath(route), route);
  assert.equal(musicStagingCanonicalPath(route.slice(0, -1)), route);
}

for (const file of files) {
  if (file.endsWith('/index.html')) continue;
  assert.equal(isMusicStagingRequest(new Request(`https://music-staging.wwwstationcat.org${file}`)), true,
    `deployed asset is blocked by the staging gate: ${file}`);
  const source = await readFile(path.join(root, file.slice(1)), 'utf8').catch(() => null);
  if (source === null || !/\.(?:css|html|js)$/i.test(file)) continue;
  for (const pattern of references) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const raw = match[1].split(/[?#]/, 1)[0];
      if (!assetExtension.test(raw)) continue;
      const dependency = raw.startsWith('/') ? path.posix.normalize(raw)
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), raw));
      assert.ok(files.has(dependency), `missing transitive staging asset ${dependency} from ${file}`);
    }
  }
}

assert.equal(isMusicStagingRequest(new Request('https://music-staging.wwwstationcat.org/_astro/articles.astro_hash.js')), false);
assert.equal(isMusicStagingRequest(new Request('https://music-staging.wwwstationcat.org/en/library/')), false);
console.log(`Verified ${expectedPages.size} staging pages and ${files.size - expectedPages.size} exact asset files.`);
