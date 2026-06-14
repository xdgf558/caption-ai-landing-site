export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.13',
  releaseDate: '2026-06-14',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.13',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '196.2 MB',
      sha256: '8f5afbb289430e81568188509dd04efc20751dd6791d058ab1fa81300748c9d1',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.13',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: '05611763579414edd0767a2565f047d25b66fd2340b739d87285869921a9f63a',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.13-mac-arm64.zip',
      fileSize: '194.4 MB',
      sha256: '8369eb008b3d4bfb8dd211f00d2861ea1c86559f9b184bd11b9c016cc14e39c6',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.zip'
    },
    {
      id: 'mac-dmg-blockmap',
      label: 'macOS DMG blockmap',
      filename: 'SimpleCut-Pro-0.1.13-mac-arm64.dmg.blockmap',
      fileSize: '211 KB',
      sha256: 'c3d9d2f7f06e9c780c9c66705617febb1cebfd9fd0bf859c3ec0fe7d3423bec3',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.dmg.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.dmg.blockmap'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.13-mac-arm64.zip.blockmap',
      fileSize: '209 KB',
      sha256: 'fbe9e1ca7d02e2c7c24fb600cfbabeeee59c21992a545822fc168c2fecf87e49',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '4c25cfa20cc3fa961350cd233b4f41979d3f50351c4f70a32cd18d14f125bb8a',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.13/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.13-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: '12b566f592a0053eafd6575e95973de83d1ce9f51ecf70d40f10b3c4d25e178e',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.13-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.13/SimpleCut-Pro-0.1.13-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: 'b14efc39efc61883da00bd5eaa16cbe371b99ea1cb47c311ca4983fbb9e7ba18',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.13/latest.yml'
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
