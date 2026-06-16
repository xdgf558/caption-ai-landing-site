export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.19',
  releaseDate: '2026-06-16',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.19',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '197.1 MB',
      sha256: '178dd49ca869fdc6c67f35fd88ffec7aab9cfbf40970e2d924387b53546f4cb0',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.19',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: 'a19dca42e73cd5f89ea48309896f1e806472d37bb8cc2ddc4865353ef2d3fbb1',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.19-mac-arm64.zip',
      fileSize: '195.0 MB',
      sha256: '8aa0530730e0d58e4795cedb1a55e13bd61777be2029b358c2012ebdfa0daac7',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-mac-arm64.zip'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.19-mac-arm64.zip.blockmap',
      fileSize: '211 KB',
      sha256: '7b072fdca8cebee85983df754688a48dbaeb906b84c63912812cdd1bc1216e47',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '98f404ea988101ab686a48c8ec8d35b4e1444e9b7fffee9d57a9be2b7e14d9b8',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.19/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.19-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: 'a3a29655c0b5d63d7f565bf2eaab928f57af1d24cfd07a43f413d226b009c615',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.19-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.19/SimpleCut-Pro-0.1.19-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: 'bd60235498fa06a11ea84af9841c5af5d938d2e2f5cfde84e89f636c22ad995b',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.19/latest.yml'
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
