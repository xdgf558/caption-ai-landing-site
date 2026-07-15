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

for (const path of retiredRadarFiles) {
  assert.equal(existsSync(join(root, path)), false, `${path} should be removed`);
}

const stationHome = read('src/components/StationHome.astro');
const appsIndex = read('src/components/AppsIndex.astro');
const footer = read('src/components/Footer.astro');
const sitemap = read('public/sitemap.xml');
const worker = read('src/worker.js');

for (const [name, source] of Object.entries({ stationHome, appsIndex, footer, sitemap, worker })) {
  assert.doesNotMatch(source, /StationCat Radar|stationcat-radar|stationCatRadarProduct/, `${name} should not expose Radar`);
}

assert.match(stationHome, /anyTlsDesktopManagerProduct/);
assert.match(stationHome, /<h3>NodePilot<\/h3>/);
assert.match(stationHome, /nodePilotDownload/);
assert.match(appsIndex, /title="NodePilot"/);
assert.match(footer, /label: 'NodePilot'/);
assert.match(sitemap, /apps\/nodepilot\//);

console.log('Product catalog retirement and homepage tests passed.');
