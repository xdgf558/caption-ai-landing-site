export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.24',
  releaseDate: '2026-06-16',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.24',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '197.1 MB',
      sha256: '6a6965580f63090d7d42069166578fcfa14b2e25400731490f29ab2acc3d85c4',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.24',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: '209b3ea35b70d866f552ffaedfbe2353e63f970bf5173dea6f6e15f96dd48015',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.24-mac-arm64.zip',
      fileSize: '195.0 MB',
      sha256: '3042f375f1f10e586243d7f30b43d5a8da863661dcd1f36d898ddaff6656cc40',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-mac-arm64.zip'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.24-mac-arm64.zip.blockmap',
      fileSize: '211 KB',
      sha256: '42a73ef0745db229be5ea282da298dc044eca70690636ed1ecec2cb4c84201c0',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '47954100ac02f2dff71d4c99a115ecdcb6a3fb061f26f3eac93d5d8f330b8b80',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.24/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.24-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: '1bde108f109f08089885dac76bb894c18d390262e995be2a3f1d0a70ae1d3258',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.24-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.24/SimpleCut-Pro-0.1.24-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: '907546086b729fc3de7ce68742653ba3e676a3a15e0acb009d1f6a7a70c9e716',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.24/latest.yml'
    }
  ],
  productPath: '/en/apps/simplecut-pro/',
  downloadPagePath: '/en/apps/simplecut-pro/download/',
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
