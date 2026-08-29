import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readDist = (path) => readFile(resolve(projectRoot, 'dist', path), 'utf8');

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

console.log('Built site foundation tests passed.');
