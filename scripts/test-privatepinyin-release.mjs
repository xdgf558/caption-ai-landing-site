import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const testflightUrl = 'https://testflight.apple.com/join/QnWqrAaH';

const productData = read('src/data/products/privatepinyin.ts');
const worker = read('src/worker.js');
assert.match(productData, /latestVersion: '0\.1\.21'/);
assert.match(productData, /minimumSystem: 'macOS 14 or later'/);
assert.match(productData, /PrivatePinyin-0\.1\.21\.pkg/);
assert.match(productData, /660d1cc7d8674c8be0e3f30683deb0d6351fa0f76a4842c6cad46bb55f0a5026/);
assert.match(productData, /PrivatePinyin-0\.1\.13-setup\.exe/);
assert.match(productData, /7bcc0125b1e57aa129a85f773aa5feca543c70a852704b80762440d4615c9b88/);
assert.match(worker, /privatepinyin\/0\.1\.21\/PrivatePinyin-0\.1\.21\.pkg/);
assert.match(worker, /privatepinyin\/0\.1\.13\/PrivatePinyin-0\.1\.13-setup\.exe/);
assert.match(productData, /iosTestflight/);
assert.match(productData, new RegExp(testflightUrl.replaceAll('/', '\\/')));

const productPage = read('src/components/PrivatePinyinLanding.astro');
assert.match(productPage, /加入 iOS TestFlight/);
assert.match(productPage, /external TestFlight group/);
assert.match(productPage, /iosTestflight\.url/);
assert.match(productPage, /\?release=\$\{macVersion\}/);

const downloadPage = read('src/components/PrivatePinyinDownload.astro');
assert.match(downloadPage, /privatepinyin-testflight-card/);
assert.match(downloadPage, /加入 iOS 外部測試/);
assert.match(downloadPage, /Apple TestFlight/);

const appsIndex = read('src/components/AppsIndex.astro');
const stationHome = read('src/components/StationHome.astro');
assert.match(appsIndex, /macOS \/ Windows \/ iOS input method/);
assert.match(stationHome, /iOS TestFlight/);

console.log('PrivatePinyin release entry tests passed.');
