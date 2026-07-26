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
assert.match(productData, /latestVersion: '0\.1\.28'/);
assert.match(productData, /minimumSystem: 'macOS 14 or later'/);
assert.match(productData, /PrivatePinyin-0\.1\.28\.pkg/);
assert.match(productData, /778cd5b53565131126c2734acc4771badd48f52d5b275a3ad671b166c4595ea8/);
assert.match(productData, /PrivatePinyin-0\.1\.24-setup\.exe/);
assert.match(productData, /1252f8d00888be0cb2b0f25aaa5d4bdc357a441b94ffa183a76112851668be62/);
assert.match(worker, /privatepinyin\/0\.1\.28\/PrivatePinyin-0\.1\.28\.pkg/);
assert.match(worker, /privatepinyin\/0\.1\.24\/PrivatePinyin-0\.1\.24-setup\.exe/);
assert.match(productData, /iosTestflight/);
assert.match(productData, new RegExp(testflightUrl.replaceAll('/', '\\/')));

assert.equal(stableManifest.schema_version, 1);
assert.equal(stableManifest.channel, 'stable');
assert.equal(stableManifest.version, '0.1.28');
assert.equal(stableManifest.build, 28);
assert.equal(stableManifest.minimum_macos_version, '14.0');
assert.match(stableManifest.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.equal(stableManifest.package_url, 'https://wwwstationcat.org/downloads/privatepinyin/PrivatePinyin-0.1.28.pkg');
assert.equal(stableManifest.package_sha256, '778cd5b53565131126c2734acc4771badd48f52d5b275a3ad671b166c4595ea8');
assert.equal(stableManifest.package_size_bytes, 14384057);
assert.equal(new URL(stableManifest.release_page_url).hostname, 'wwwstationcat.org');
assert.equal(new URL(stableManifest.package_url).hostname, 'wwwstationcat.org');
assert.ok(stableManifest.release_notes.length >= 1 && stableManifest.release_notes.length <= 12);
assert.ok(stableManifest.release_notes.every((note) => typeof note === 'string' && Buffer.byteLength(note) <= 500));

const productPage = read('src/components/PrivatePinyinLanding.astro');
assert.match(productPage, /加入 iOS TestFlight/);
assert.match(productPage, /external TestFlight group/);
assert.match(productPage, /白霜拼音一鍵匯入/);
assert.match(productPage, /pinned official 1\.0\.4 release/);
assert.match(productPage, /嚴格隱私模式會停用並取消 Writer/);
assert.match(productPage, /全鍵盤拼音智能糾錯/);
assert.doesNotMatch(productPage, /偏好設定改為緊湊等比縮放/);
assert.match(productPage, /iosTestflight\.url/);
assert.match(productPage, /releaseToken = `\$\{macVersion\}-\$\{windowsVersion\}`/);
assert.match(productPage, /\?release=\$\{releaseToken\}/);

const downloadPage = read('src/components/PrivatePinyinDownload.astro');
assert.match(downloadPage, /privatepinyin-testflight-card/);
assert.match(downloadPage, /加入 iOS 外部測試/);
assert.match(downloadPage, /Apple TestFlight/);
assert.match(downloadPage, /rime_frost\.tsv/);
assert.match(downloadPage, /64 MiB/);
assert.match(downloadPage, /最多 75 萬條/);
assert.match(downloadPage, /Windows \$\{windowsVersion\} 新增全鍵盤拼音智能糾錯/);
assert.match(downloadPage, /AI Lite 候選重排序/);
assert.match(downloadPage, /Developer ID 簽名、Apple 公證與 stapling/);

const appsIndex = read('src/components/AppsIndex.astro');
const stationHome = read('src/components/StationHome.astro');
assert.match(appsIndex, /macOS \/ Windows \/ iOS input method/);
assert.match(stationHome, /iOS TestFlight/);
assert.match(stationHome, /macOS \$\{privatePinyinMacVersion\} · Windows \$\{privatePinyinWindowsVersion\}/);
assert.doesNotMatch(stationHome, /macOS \/ Windows \$\{privatePinyinVersion\}/);
assert.match(stationHome, /privatePinyinReleaseToken/);
assert.match(appsIndex, /privatePinyinReleaseToken/);

console.log('PrivatePinyin release entry tests passed.');
