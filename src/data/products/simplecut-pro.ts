export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.10',
  releaseDate: '2026-06-14',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.10',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '197.1 MB',
      sha256: '95c315eceb9fd24383e2956afcda09777e314f419d2fa9691ebe2d154775a5f5',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.10',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: 'bd460b68d99a801dba4ff7ae745f815c86404788a8097b7c790a89815d7a3d67',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.10-mac-arm64.zip',
      fileSize: '195.0 MB',
      sha256: 'fc2430de6197f07eb4e01f683d3e504f39c0ae5daa00cff958d74e37c46c16bf',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.zip'
    },
    {
      id: 'mac-dmg-blockmap',
      label: 'macOS DMG blockmap',
      filename: 'SimpleCut-Pro-0.1.10-mac-arm64.dmg.blockmap',
      fileSize: '213 KB',
      sha256: 'f727f1fe25debcd78a831df9a20cdf3384d2f9c33ac99e1743bc4da9309b566a',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.dmg.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.dmg.blockmap'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.10-mac-arm64.zip.blockmap',
      fileSize: '209 KB',
      sha256: '35741443f53588aa29c309222a4649b2b021580cc9df304f2c69552b34eb3559',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '1e290d08ca136e411df06cc8c9f75ea71f03fe96e90f7d102b1f970bd1f030e1',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.10/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.10-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: '9f4ae0d2c053af5e15f2ed87f7bba6b43d5e1a4373bfbe2123e18386d2cbcc67',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.10-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.10/SimpleCut-Pro-0.1.10-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: 'f8662831d0f18d9c81883d19a7057d0a18ea386b51ebf140af7e058f1818bc48',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.10/latest.yml'
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
