export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.16',
  releaseDate: '2026-06-15',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.16',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '197.1 MB',
      sha256: '1f8ff1fd32fe665c106588563d7a5455a472eca41732f3c00c7aa8616cc852c7',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.16',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: 'c5c8bc2c2c5fe5518129550340d6cb9cfe44366ddd725fbb8e6b21691ff44c03',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.16-mac-arm64.zip',
      fileSize: '195.0 MB',
      sha256: '88aa5cfcaf04c24603c9ee5ec3c545dfa927da26bc6eb40bcfad328e095aa3f3',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-mac-arm64.zip'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.16-mac-arm64.zip.blockmap',
      fileSize: '211 KB',
      sha256: '2e54e3984ac4bff7990ead83c4dd3e2b4e99c499fdb30eed07eccf4f63919941',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '32552fee67fea01ae36f007bf616442e8fbc765b3f300353ae4b068298540ab4',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.16/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.16-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: '0395e1f99330e86466df30fd35a4df7e7addd454d6ee7088006f85f688e1f04d',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.16-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.16/SimpleCut-Pro-0.1.16-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: 'ac20430b4bd2c48ae87c00ed2dcdfcb6b4f80513a5c664aaa2c37e17147ab837',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.16/latest.yml'
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
