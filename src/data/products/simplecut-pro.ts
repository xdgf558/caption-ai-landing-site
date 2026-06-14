export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.11',
  releaseDate: '2026-06-14',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.11',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '196.2 MB',
      sha256: 'd25f07863ce9c109143e1d82e19f2f2d5020f118615be80c0ecfc19831879cef',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.11',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: '5c5c8065202dad4f9667b2ba1534eb6e57350efcd86e41e2471965c197ebc4ec',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.11-mac-arm64.zip',
      fileSize: '194.4 MB',
      sha256: '29582ebb8cff6d52dc2cc7fbde56c21add1fe3dd16515fa603347735c23ee1e3',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.zip'
    },
    {
      id: 'mac-dmg-blockmap',
      label: 'macOS DMG blockmap',
      filename: 'SimpleCut-Pro-0.1.11-mac-arm64.dmg.blockmap',
      fileSize: '212 KB',
      sha256: '0bbaeb1244abe851a2caef83af966c9d98d8d5d9fa81f292658bfca6d3cb65e6',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.dmg.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.dmg.blockmap'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.11-mac-arm64.zip.blockmap',
      fileSize: '209 KB',
      sha256: 'dca51969f9e0fd4ed588b5cd53ed697fcc938ccaae3fdeb843cbb5c68ad7cba1',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '42f85a653a2d08d41eaba90b64736ddfd2e63a8a7f12154443db19c323836851',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.11/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.11-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: '0643f93dbf4a424429be863df07e50dfafc8187c947c9abfe7f0741aa47540bd',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.11-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.11/SimpleCut-Pro-0.1.11-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: '4b440b3e41c4b303982b38019eab41c388ee1952d65a3e97de0f4cd0797d28b9',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.11/latest.yml'
    }
  ],
  productPath: '/apps/simplecut-pro/',
  downloadPagePath: '/apps/simplecut-pro/download/',
  zhHantProductPath: '/zh-hant/apps/simplecut-pro/',
  zhHantDownloadPagePath: '/zh-hant/apps/simplecut-pro/download/',
  zhHansProductPath: '/zh-hans/apps/simplecut-pro/',
  zhHansDownloadPagePath: '/zh-hans/apps/simplecut-pro/download/',
  jaProductPath: '/ja/apps/simplecut-pro/',
  jaDownloadPagePath: '/ja/apps/simplecut-pro/download/',
  assets: {
    icon: '/images/apps/simplecut-pro-icon.png'
  }
} as const;

export type SimpleCutProProduct = typeof simpleCutProProduct;
