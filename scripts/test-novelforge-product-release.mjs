import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

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
assert.match(worker, /headers\.set\('accept-ranges', 'bytes'\)/);
assert.match(worker, /status: useRange \? 206 : 200/);
assert.deepEqual(hooks.parseDownloadByteRange('bytes=0-1023', 451597937), {
  kind: 'partial',
  start: 0,
  end: 1023,
  offset: 0,
  length: 1024
});
assert.deepEqual(hooks.parseDownloadByteRange('bytes=-1024', 451597937), {
  kind: 'partial',
  start: 451596913,
  end: 451597936,
  offset: 451596913,
  length: 1024
});
assert.deepEqual(hooks.parseDownloadByteRange('bytes=451597937-', 451597937), {
  kind: 'unsatisfiable'
});
assert.deepEqual(hooks.parseDownloadByteRange('bytes=0-1,4-5', 451597937), {
  kind: 'unsatisfiable'
});

const requestedRanges = [];
const objectMetadata = {
  size: 451597937,
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
const downloadFile = {
  key: 'novelforge-ai/0.1.110/NovelForge-AI-0.1.110-mac-arm64.pkg',
  filename: 'NovelForge-AI-0.1.110-mac-arm64.pkg',
  contentType: 'application/octet-stream'
};
const rangeResponse = await hooks.handleR2Download(
  new Request('https://wwwstationcat.org/downloads/novelforge-ai/NovelForge-AI-0.1.110-mac-arm64.pkg', {
    headers: { range: 'bytes=0-1023' }
  }),
  { DOWNLOADS_BUCKET: downloadsBucket },
  downloadFile
);
assert.equal(rangeResponse.status, 206);
assert.equal(rangeResponse.headers.get('accept-ranges'), 'bytes');
assert.equal(rangeResponse.headers.get('content-range'), 'bytes 0-1023/451597937');
assert.equal(rangeResponse.headers.get('content-length'), '1024');
assert.deepEqual(requestedRanges, [{ offset: 0, length: 1024 }]);
assert.equal((await rangeResponse.arrayBuffer()).byteLength, 1024);

const headResponse = await hooks.handleR2Download(
  new Request('https://wwwstationcat.org/downloads/novelforge-ai/NovelForge-AI-0.1.110-mac-arm64.pkg', {
    method: 'HEAD'
  }),
  { DOWNLOADS_BUCKET: downloadsBucket },
  downloadFile
);
assert.equal(headResponse.status, 200);
assert.equal(headResponse.headers.get('content-length'), '451597937');
assert.equal(headResponse.headers.get('accept-ranges'), 'bytes');

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
