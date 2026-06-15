export const simpleCutProProduct = {
  id: 'simplecut-pro',
  slug: 'simplecut-pro',
  name: 'SimpleCut Pro',
  latestVersion: 'v0.1.18',
  releaseDate: '2026-06-15',
  updateFeedUrl: 'https://wwwstationcat.org/downloads/simplecut-pro/',
  downloads: [
    {
      id: 'mac-arm64-dmg',
      label: 'macOS Apple Silicon',
      version: '0.1.18',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '214.9 MB',
      sha256: 'f110f3c1e998395520cfad85d920668027d6c0142faf4ccb9beccb8109bc6f12',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.dmg',
      r2ObjectKey: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.dmg'
    },
    {
      id: 'windows-x64-exe',
      label: 'Windows x64',
      version: '0.1.18',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '146.7 MB',
      sha256: '53e4598939c83b2bfc68894f0ce778ad796b6ea00a6ad28bd90bc3f5622da909',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-win-x64.exe',
      r2ObjectKey: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-win-x64.exe'
    }
  ],
  updateFiles: [
    {
      id: 'mac-zip',
      label: 'macOS auto-update ZIP',
      filename: 'SimpleCut-Pro-0.1.18-mac-arm64.zip',
      fileSize: '195.2 MB',
      sha256: 'd68a145cf415b92fa81b6e89ba09ae6f8939cf4d3123ce82fc683f3074499a90',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.zip',
      r2ObjectKey: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.zip'
    },
    {
      id: 'mac-dmg-blockmap',
      label: 'macOS DMG blockmap',
      filename: 'SimpleCut-Pro-0.1.18-mac-arm64.dmg.blockmap',
      fileSize: '231 KB',
      sha256: '27ddb082ae61460e919576afecc5bcb7a5ca4f8fa9b83e105845c8fbc17f8547',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.dmg.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.dmg.blockmap'
    },
    {
      id: 'mac-zip-blockmap',
      label: 'macOS ZIP blockmap',
      filename: 'SimpleCut-Pro-0.1.18-mac-arm64.zip.blockmap',
      fileSize: '210 KB',
      sha256: 'e19266753ba95e54fcb3920f95cdf16bce8891acd82a143121f6646e1389054d',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-mac-arm64.zip.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-mac-arm64.zip.blockmap'
    },
    {
      id: 'latest-mac',
      label: 'macOS update feed',
      filename: 'latest-mac.yml',
      fileSize: '531 B',
      sha256: '09259dfb157830109c38748ea1738b7d3bd84d1f55a8d8688eb153d729cd49af',
      downloadPath: '/downloads/simplecut-pro/latest-mac.yml',
      r2ObjectKey: 'simplecut-pro/0.1.18/latest-mac.yml'
    },
    {
      id: 'windows-exe-blockmap',
      label: 'Windows installer blockmap',
      filename: 'SimpleCut-Pro-0.1.18-win-x64.exe.blockmap',
      fileSize: '159 KB',
      sha256: '78e15e7547581542abc7a0e9ebe2fd9cad2f0175597818c5c8786af978953f13',
      downloadPath: '/downloads/simplecut-pro/SimpleCut-Pro-0.1.18-win-x64.exe.blockmap',
      r2ObjectKey: 'simplecut-pro/0.1.18/SimpleCut-Pro-0.1.18-win-x64.exe.blockmap'
    },
    {
      id: 'latest-windows',
      label: 'Windows update feed',
      filename: 'latest.yml',
      fileSize: '362 B',
      sha256: '2e8a81ff4857c9b9c215f703be6bde9b23114b617a090deb9084137e6dfdc6e4',
      downloadPath: '/downloads/simplecut-pro/latest.yml',
      r2ObjectKey: 'simplecut-pro/0.1.18/latest.yml'
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
