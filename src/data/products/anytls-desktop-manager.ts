export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: '0.2.9',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.9',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '117 MB',
      sha256: 'c75067335060e2d1681195056a54c8cd87962be7a04b6118a330a0d74773b0da',
      downloadPath: '/downloads/nodepilot/NodePilot-0.2.9-arm64.dmg',
      r2ObjectKey: 'anytls-desktop-manager/0.2.9/NodePilot-0.2.9-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.2.9',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '91 MB',
      sha256: '67a9b1720161e7caf8a3994d78c976967a6c272eb38d20525f52b67f1a4fe28f',
      downloadPath: '/downloads/nodepilot/NodePilot-Setup-0.2.9-x64.exe',
      r2ObjectKey: 'anytls-desktop-manager/0.2.9/NodePilot-Setup-0.2.9-x64.exe'
    }
  ],
  productPath: '/apps/nodepilot/',
  zhHantProductPath: '/zh-hant/apps/nodepilot/',
  zhHansProductPath: '/zh-hans/apps/nodepilot/',
  jaProductPath: '/ja/apps/nodepilot/',
  assets: {
    icon: '/images/apps/anytls-desktop-manager-icon.png',
    screenshot: '/images/anytls-desktop-manager-preview.svg'
  }
} as const;

export type AnyTlsDesktopManagerProduct = typeof anyTlsDesktopManagerProduct;
