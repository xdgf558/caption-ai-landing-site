import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const appStoreUrl = 'https://apps.apple.com/app/id6789098978';

const productData = read('src/data/products/privatepinyin.ts');
const worker = read('src/worker.js');
const stableManifest = JSON.parse(read('public/updates/private-pinyin/macos/stable.json'));
assert.match(productData, /latestVersion: '0\.1\.30'/);
assert.match(productData, /minimumSystem: 'macOS 14 or later'/);
assert.match(productData, /PrivatePinyin-0\.1\.30\.pkg/);
assert.match(productData, /d4ef4c8e0122d7a22acd7a0e252a33e48eb18424c92c74a6df73d095cd381142/);
assert.match(productData, /PrivatePinyin-0\.1\.25-setup\.exe/);
assert.match(productData, /f819de9a17ad319ce3abf5f8551b674278e3e90709167cb457e73932fff41600/);
assert.match(worker, /privatepinyin\/0\.1\.30\/PrivatePinyin-0\.1\.30\.pkg/);
assert.match(worker, /privatepinyin\/0\.1\.25\/PrivatePinyin-0\.1\.25-setup\.exe/);
assert.match(productData, /iosAppStore/);
assert.match(productData, /appId: '6789098978'/);
assert.match(productData, /version: '1\.0'/);
assert.match(productData, /minimumSystem: 'iOS 18 or later'/);
assert.match(productData, new RegExp(appStoreUrl.replaceAll('/', '\\/')));
assert.doesNotMatch(productData, /testflight\.apple\.com|iosTestflight/);
assert.match(productData, /privacyPaths/);
assert.match(productData, /supportPaths/);

assert.equal(stableManifest.schema_version, 1);
assert.equal(stableManifest.channel, 'stable');
assert.equal(stableManifest.version, '0.1.30');
assert.equal(stableManifest.build, 30);
assert.equal(stableManifest.minimum_macos_version, '14.0');
assert.match(stableManifest.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.equal(stableManifest.package_url, 'https://wwwstationcat.org/downloads/privatepinyin/PrivatePinyin-0.1.30.pkg');
assert.equal(stableManifest.package_sha256, 'd4ef4c8e0122d7a22acd7a0e252a33e48eb18424c92c74a6df73d095cd381142');
assert.equal(stableManifest.package_size_bytes, 14489209);
assert.equal(new URL(stableManifest.release_page_url).hostname, 'wwwstationcat.org');
assert.equal(new URL(stableManifest.package_url).hostname, 'wwwstationcat.org');
assert.ok(stableManifest.release_notes.length >= 1 && stableManifest.release_notes.length <= 12);
assert.ok(stableManifest.release_notes.every((note) => typeof note === 'string' && Buffer.byteLength(note) <= 500));

const productPage = read('src/components/PrivatePinyinLanding.astro');
assert.match(productPage, /在 App Store 下載/);
assert.match(productPage, /officially available on the App Store/);
assert.match(productPage, /原生候選面板偶爾點擊無反應/);
assert.match(productPage, /intermittent no-op clicks/);
assert.match(productPage, /嚴格隱私模式會停用並取消 Writer/);
assert.match(productPage, /過期候選回調/);
assert.doesNotMatch(productPage, /偏好設定改為緊湊等比縮放/);
assert.match(productPage, /iosAppStore\.url/);
assert.doesNotMatch(productPage, /TestFlight/);
assert.match(productPage, /releaseToken = `\$\{macVersion\}-\$\{windowsVersion\}`/);
assert.match(productPage, /\?release=\$\{releaseToken\}/);
assert.match(productPage, /legalLinks\.privacy/);
assert.match(productPage, /legalLinks\.support/);

for (const localePath of ['en/', 'zh-hans/', 'zh-hant/', 'ja/']) {
  const prefix = `src/pages/${localePath}apps/privatepinyin/`;
  const privacyPage = read(`${prefix}privacy.astro`);
  const supportPage = read(`${prefix}support.astro`);
  assert.match(privacyPage, /privatepinyin-icon\.png/);
  assert.match(supportPage, /privatepinyin-icon\.png/);
  assert.match(supportPage, /supportEmail/);
}

const downloadPage = read('src/components/PrivatePinyinDownload.astro');
assert.match(downloadPage, /privatepinyin-app-store-card/);
assert.match(downloadPage, /在 App Store 下載/);
assert.match(downloadPage, /App Store release/);
assert.doesNotMatch(downloadPage, /TestFlight/);
assert.match(downloadPage, /Windows \$\{windowsVersion\} 穩定預設候選/);
assert.match(downloadPage, /AI Lite 候選重排序/);
assert.match(downloadPage, /使用者目錄或設定路徑含空格/);
assert.match(downloadPage, /TLS 相容性/);
assert.match(downloadPage, /同一習慣經過約三次確認後才影響排序/);
assert.match(downloadPage, /prediction-only mode/);
assert.match(downloadPage, /重複文字候選/);
assert.match(downloadPage, /Duplicate-text candidates/);
assert.match(downloadPage, /Developer ID 簽名、Apple 公證與 stapling/);

const appsIndex = read('src/components/AppsIndex.astro');
const stationHome = read('src/components/StationHome.astro');
assert.match(appsIndex, /macOS \/ Windows \/ iOS input method/);
assert.match(appsIndex, /iOS \$\{privatePinyinIosVersion\} 正式版已上架 App Store/);
assert.doesNotMatch(appsIndex, /privatePinyinDescription: .*TestFlight/);
assert.match(stationHome, /iOS App Store \$\{privatePinyinIosVersion\}/);
assert.doesNotMatch(stationHome, /privatePinyin(?:Desc|Status|Download): .*TestFlight/);
assert.match(stationHome, /macOS \$\{privatePinyinMacVersion\} · Windows \$\{privatePinyinWindowsVersion\}/);
assert.doesNotMatch(stationHome, /macOS \/ Windows \$\{privatePinyinVersion\}/);
assert.match(stationHome, /privatePinyinReleaseToken/);
assert.match(appsIndex, /privatePinyinReleaseToken/);

console.log('PrivatePinyin release entry tests passed.');
