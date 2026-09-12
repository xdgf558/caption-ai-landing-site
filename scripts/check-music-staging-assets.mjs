import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMusicStagingRequest, musicStagingCanonicalPath } from '../src/music/stagingGate.js';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.generated', 'music-staging-assets');
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

async function walk(root, directory = root) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    output.push(...(entry.isDirectory() ? await walk(root, absolute) : [`/${path.relative(root, absolute).replaceAll('\\', '/')}`]));
  }
  return output;
}

export async function checkMusicStagingAssets(root = defaultRoot) {
  const files = new Set(await walk(root));
  const pageRoutes = new Map([...expectedPages].map(([route, file]) => [file, route]));
  for (const [route, file] of expectedPages) {
    assert.ok(files.has(file), `missing staging page ${file}`);
    assert.equal(musicStagingCanonicalPath(route), route);
    assert.equal(musicStagingCanonicalPath(route.slice(0, -1)), route);
  }

  for (const file of files) {
    if (/\.html$/i.test(file)) {
      assert.ok(pageRoutes.has(file), `unexpected staging page ${file}`);
    }
    const requestPath = pageRoutes.get(file) || file;
    assert.equal(isMusicStagingRequest(new Request(`https://music-staging.wwwstationcat.org${requestPath}`)), true,
      `deployed asset is blocked by the staging gate: ${file}`);
    if (!/\.(?:css|html|js)$/i.test(file)) continue;
    const source = await readFile(path.join(root, file.slice(1)), 'utf8');
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
  return { pages: expectedPages.size, assets: files.size - expectedPages.size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { pages, assets } = await checkMusicStagingAssets();
  console.log(`Verified ${pages} staging pages and ${assets} exact asset files.`);
}
