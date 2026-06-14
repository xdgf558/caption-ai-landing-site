export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.14',
  releaseDate: '2026-06-14',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.14',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '197.1 MB',
      sha256: '9c38c7729e81e967d8fe7d938602f1a2c6f15ebb5d9a8e9a290f428554a1c89b',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.14',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: 'e8a2731cc3529ad561e1a30a93dacf6d46e960a967f2e9fdbfe87408b39350c6',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.14-mac-arm64.zip',
      fileSize: '195.0 MB',
      sha256: '2dc72bb73fe1e512ca7fb832f4824081a1640b6f5960683c075270676c746158',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.zip'
    },
    {
      id: 'mac-dmg-blockmap',
      label: 'macOS DMG blockmap',
      filename: 'SimpleCut-Pro-0.1.14-mac-arm64.dmg.blockmap',
      fileSize: '211 KB',
      sha256: '1503503b7dd7e3e6ec5d45ede5d5f31a865be52acab7941b73cec93709ca7dfd',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.dmg.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.dmg.blockmap'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.14-mac-arm64.zip.blockmap',
      fileSize: '210 KB',
      sha256: 'da21e328bf1f0beed99ea043fe62675753a90ba50f01b8f7b023107243dcc017',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '3cdedad208b89de24dfe8a332285879781da40372d15dd37ae9890f3c982f4aa',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.14/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.14-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: 'aaa2e0742ffbb8522ac3c0c2faf53aa2fb61abde6b427242e28c743194d402fc',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.14-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.14/SimpleCut-Pro-0.1.14-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: 'bdd3cd6581e8ec957c11e44d18f241ee9894a8e4b23a43afd0a3a99c8d370fd0',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.14/latest.yml'
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
