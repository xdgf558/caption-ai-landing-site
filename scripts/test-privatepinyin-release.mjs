import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const testflightUrl = 'https://testflight.apple.com/join/QnWqrAaH';

const productData = read('src/data/products/privatepinyin.ts');
const worker = read('src/worker.js');
assert.match(productData, /latestVersion: '0\.1\.15'/);
assert.match(productData, /minimumSystem: 'macOS 14 or later'/);
assert.match(productData, /PrivatePinyin-0\.1\.15\.pkg/);
assert.match(productData, /cb48d25bfd31345ba91f9a9d073a9cf49cabb407d376edaa304b04cffdf59211/);
assert.match(worker, /privatepinyin\/0\.1\.15\/PrivatePinyin-0\.1\.15\.pkg/);
assert.match(productData, /iosTestflight/);
assert.match(productData, new RegExp(testflightUrl.replaceAll('/', '\\/')));

const productPage = read('src/components/PrivatePinyinLanding.astro');
assert.match(productPage, /加入 iOS TestFlight/);
assert.match(productPage, /external TestFlight group/);
assert.match(productPage, /iosTestflight\.url/);

const downloadPage = read('src/components/PrivatePinyinDownload.astro');
assert.match(downloadPage, /privatepinyin-testflight-card/);
assert.match(downloadPage, /加入 iOS 外部測試/);
assert.match(downloadPage, /Apple TestFlight/);

const appsIndex = read('src/components/AppsIndex.astro');
const stationHome = read('src/components/StationHome.astro');
assert.match(appsIndex, /macOS \/ Windows \/ iOS input method/);
assert.match(stationHome, /iOS TestFlight/);

console.log('PrivatePinyin release entry tests passed.');
