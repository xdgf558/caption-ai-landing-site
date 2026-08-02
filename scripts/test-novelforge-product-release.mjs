import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import siteWorker, { __readerTotpTestHooks as hooks } from '../src/worker.js';

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
const novelForgeDownloadPath = '/downloads/novelforge-ai/NovelForge-AI-0.1.115-mac-arm64.pkg';
const novelForgeExternalDownloadUrl = 'https://downloads.wwwstationcat.org:8443/novelforge-ai/0.1.115/NovelForge-AI-0.1.115-mac-arm64.pkg';

assert.match(productData, /latestVersion: '0\.1\.115'/);
assert.match(productData, /minimumSystem: 'macOS 12 or later'/);
assert.match(productData, /fileSize: '395\.0 MB'/);
assert.match(productData, /070284ed4156bbe2cfa158e2102b13027ee270e9d4c1e2523d72e163366b5197/);
assert.match(productData, /downloadPath: '\/downloads\/novelforge-ai\/NovelForge-AI-0\.1\.115-mac-arm64\.pkg'/);
assert.doesNotMatch(productData, /r2ObjectKey/);
assert.match(productData, /https:\/\/github\.com\/xdgf558\/novelforge-ai/);
assert.match(productData, /novelforge-ai-icon\.png/);

assert.match(worker, /const externalDownloadRedirects = \{/);
assert.match(worker, /https:\/\/downloads\.wwwstationcat\.org:8443\/novelforge-ai\/0\.1\.115\/NovelForge-AI-0\.1\.115-mac-arm64\.pkg/);
assert.doesNotMatch(worker, /key: 'novelforge-ai\/0\.1\.115\/NovelForge-AI-0\.1\.115-mac-arm64\.pkg'/);
assert.match(worker, /headers\.set\('accept-ranges', 'bytes'\)/);
assert.match(worker, /status: useRange \? 206 : 200/);
const externalDownloadResponse = await siteWorker.fetch(
  new Request(`https://wwwstationcat.org${novelForgeDownloadPath}`),
  {},
  { waitUntil() {} }
);
assert.equal(externalDownloadResponse.status, 302);
assert.equal(externalDownloadResponse.headers.get('location'), novelForgeExternalDownloadUrl);
assert.deepEqual(hooks.parseDownloadByteRange('bytes=0-1023', 414189499), {
  kind: 'partial',
  start: 0,
  end: 1023,
  offset: 0,
  length: 1024
});
assert.deepEqual(hooks.parseDownloadByteRange('bytes=-1024', 414189499), {
  kind: 'partial',
  start: 414188475,
  end: 414189498,
  offset: 414188475,
  length: 1024
});
assert.deepEqual(hooks.parseDownloadByteRange('bytes=414189499-', 414189499), {
  kind: 'unsatisfiable'
});
assert.deepEqual(hooks.parseDownloadByteRange('bytes=0-1,4-5', 414189499), {
  kind: 'unsatisfiable'
});

const requestedRanges = [];
const objectMetadata = {
  size: 414189499,
  httpEtag: '"multipart-etag-14"',
  writeHttpMetadata(headers) {
    headers.set('content-type', 'application/octet-stream');
  }
};
const downloadsBucket = {
  async head() {
    return objectMetadata;
  },
  async get(_key, options) {
    requestedRanges.push(options?.range || null);
    const length = options?.range?.length || objectMetadata.size;
    return {
      ...objectMetadata,
      body: new Uint8Array(length)
    };
  }
};
const r2TestFile = {
  key: 'test-fixtures/novelforge-ai.pkg',
  filename: 'NovelForge-AI-test.pkg',
  contentType: 'application/octet-stream'
};
const rangeResponse = await hooks.handleR2Download(
  new Request('https://wwwstationcat.org/downloads/test-fixtures/novelforge-ai.pkg', {
    headers: { range: 'bytes=0-1023' }
  }),
  { DOWNLOADS_BUCKET: downloadsBucket },
  r2TestFile
);
assert.equal(rangeResponse.status, 206);
assert.equal(rangeResponse.headers.get('accept-ranges'), 'bytes');
assert.equal(rangeResponse.headers.get('content-range'), 'bytes 0-1023/414189499');
assert.equal(rangeResponse.headers.get('content-length'), '1024');
assert.deepEqual(requestedRanges, [{ offset: 0, length: 1024 }]);
assert.equal((await rangeResponse.arrayBuffer()).byteLength, 1024);

const headResponse = await hooks.handleR2Download(
  new Request('https://wwwstationcat.org/downloads/test-fixtures/novelforge-ai.pkg', {
    method: 'HEAD'
  }),
  { DOWNLOADS_BUCKET: downloadsBucket },
  r2TestFile
);
assert.equal(headResponse.status, 200);
assert.equal(headResponse.headers.get('content-length'), '414189499');
assert.equal(headResponse.headers.get('accept-ranges'), 'bytes');

assert.match(landingPage, /作者審批邊界/);
assert.match(landingPage, /Local-first does not mean fully offline/);
assert.match(landingPage, /Developer ID signed, Apple notarized, and stapled/);
assert.match(downloadPage, /There is no auto-update feed yet/);
assert.match(downloadPage, /unfinished AI tasks are ended immediately/);
assert.match(downloadPage, /中斷任務會顯示清楚的重新生成提示/);
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
assert.match(stationHome, /bench-card__icon--novelforge/);
assert.match(footer, /label: 'NovelForge AI'/);
assert.match(sitemap, /\/zh-hant\/apps\/novelforge-ai\/download\//);

console.log('NovelForge AI product release tests passed.');
