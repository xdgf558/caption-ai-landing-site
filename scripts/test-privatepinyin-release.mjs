import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const testflightUrl = 'https://testflight.apple.com/join/QnWqrAaH';

const productData = read('src/data/products/privatepinyin.ts');
const worker = read('src/worker.js');
const stableManifest = JSON.parse(read('public/updates/private-pinyin/macos/stable.json'));
assert.match(productData, /latestVersion: '0\.1\.22'/);
assert.match(productData, /minimumSystem: 'macOS 14 or later'/);
assert.match(productData, /PrivatePinyin-0\.1\.22\.pkg/);
assert.match(productData, /f4c5445f7ce8d3d34555c5047f37731f1a8f16e0a7f3bf097ff11fa11baebfc1/);
assert.match(productData, /PrivatePinyin-0\.1\.20-setup\.exe/);
assert.match(productData, /28263c4aecaab8ac0a6d559f28efd6f9c13d1fe7cd81a11037c19150816c432d/);
assert.match(worker, /privatepinyin\/0\.1\.22\/PrivatePinyin-0\.1\.22\.pkg/);
assert.match(worker, /privatepinyin\/0\.1\.20\/PrivatePinyin-0\.1\.20-setup\.exe/);
assert.match(productData, /iosTestflight/);
assert.match(productData, new RegExp(testflightUrl.replaceAll('/', '\\/')));

assert.equal(stableManifest.schema_version, 1);
assert.equal(stableManifest.channel, 'stable');
assert.equal(stableManifest.version, '0.1.22');
assert.equal(stableManifest.build, 22);
assert.equal(stableManifest.minimum_macos_version, '14.0');
assert.match(stableManifest.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.equal(stableManifest.package_url, 'https://wwwstationcat.org/downloads/privatepinyin/PrivatePinyin-0.1.22.pkg');
assert.equal(stableManifest.package_sha256, 'f4c5445f7ce8d3d34555c5047f37731f1a8f16e0a7f3bf097ff11fa11baebfc1');
assert.equal(stableManifest.package_size_bytes, 3039890);
assert.equal(new URL(stableManifest.release_page_url).hostname, 'wwwstationcat.org');
assert.equal(new URL(stableManifest.package_url).hostname, 'wwwstationcat.org');
assert.ok(stableManifest.release_notes.length >= 1 && stableManifest.release_notes.length <= 12);
assert.ok(stableManifest.release_notes.every((note) => typeof note === 'string' && Buffer.byteLength(note) <= 500));

const productPage = read('src/components/PrivatePinyinLanding.astro');
assert.match(productPage, /加入 iOS TestFlight/);
assert.match(productPage, /external TestFlight group/);
assert.match(productPage, /AI Lite 候選重排序/);
assert.doesNotMatch(productPage, /偏好設定改為緊湊等比縮放/);
assert.match(productPage, /iosTestflight\.url/);
assert.match(productPage, /releaseToken = `\$\{macVersion\}-\$\{windowsVersion\}`/);
assert.match(productPage, /\?release=\$\{releaseToken\}/);

const downloadPage = read('src/components/PrivatePinyinDownload.astro');
assert.match(downloadPage, /privatepinyin-testflight-card/);
assert.match(downloadPage, /加入 iOS 外部測試/);
assert.match(downloadPage, /Apple TestFlight/);

const appsIndex = read('src/components/AppsIndex.astro');
const stationHome = read('src/components/StationHome.astro');
assert.match(appsIndex, /macOS \/ Windows \/ iOS input method/);
assert.match(stationHome, /iOS TestFlight/);
assert.match(stationHome, /macOS \$\{privatePinyinMacVersion\} · Windows \$\{privatePinyinWindowsVersion\}/);
assert.doesNotMatch(stationHome, /macOS \/ Windows \$\{privatePinyinVersion\}/);
assert.match(stationHome, /privatePinyinReleaseToken/);
assert.match(appsIndex, /privatePinyinReleaseToken/);

console.log('PrivatePinyin release entry tests passed.');
