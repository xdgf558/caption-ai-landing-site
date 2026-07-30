import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

const productData = read('src/data/products/novelforge-ai.ts');
const landingPage = read('src/components/NovelForgeAiLanding.astro');
const downloadPage = read('src/components/NovelForgeAiDownload.astro');
const worker = read('src/worker.js');
const appsIndex = read('src/components/AppsIndex.astro');
const stationHome = read('src/components/StationHome.astro');
const footer = read('src/components/Footer.astro');
const sitemap = read('public/sitemap.xml');

assert.match(productData, /latestVersion: '0\.1\.110'/);
assert.match(productData, /minimumSystem: 'macOS 12 or later'/);
assert.match(productData, /fileSize: '430\.7 MB'/);
assert.match(productData, /26e0a41117b167244d633bc1dd2813fdd81a5c4bbd6e9a417c92f31baecd2109/);
assert.match(productData, /novelforge-ai\/0\.1\.110\/NovelForge-AI-0\.1\.110-mac-arm64\.pkg/);
assert.match(productData, /https:\/\/github\.com\/xdgf558\/novelforge-ai/);
assert.match(productData, /novelforge-ai-icon\.png/);

assert.match(worker, /\/downloads\/novelforge-ai\/NovelForge-AI-0\.1\.110-mac-arm64\.pkg/);
assert.match(worker, /limitKey: 'novelforge-ai-0\.1\.110-mac-arm64-pkg'/);

assert.match(landingPage, /作者審批邊界/);
assert.match(landingPage, /Local-first does not mean fully offline/);
assert.match(landingPage, /Developer ID signed, Apple notarized, and stapled/);
assert.match(downloadPage, /There is no auto-update feed yet/);
assert.match(downloadPage, /Gatekeeper: accepted \/ Notarized Developer ID/);
assert.match(downloadPage, /Application Support\/NovelForge AI/);
assert.match(downloadPage, /not offered under an open-source license/);

for (const route of [
  'src/pages/apps/novelforge-ai/index.astro',
  'src/pages/apps/novelforge-ai/download.astro',
  'src/pages/zh-hant/apps/novelforge-ai/index.astro',
  'src/pages/zh-hant/apps/novelforge-ai/download.astro',
  'src/pages/zh-hans/apps/novelforge-ai/index.astro',
  'src/pages/zh-hans/apps/novelforge-ai/download.astro',
  'src/pages/ja/apps/novelforge-ai/index.astro',
  'src/pages/ja/apps/novelforge-ai/download.astro'
]) {
  assert.ok(existsSync(join(root, route)), `${route} should exist`);
}

assert.match(appsIndex, /title="NovelForge AI"/);
assert.match(stationHome, /<h3>NovelForge AI<\/h3>/);
assert.match(footer, /label: 'NovelForge AI'/);
assert.match(sitemap, /\/zh-hant\/apps\/novelforge-ai\/download\//);

console.log('NovelForge AI product release tests passed.');
