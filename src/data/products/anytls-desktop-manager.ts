export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: 'v0.2.26',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.26',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '121.8 MB',
      sha256: '36d5f94320755ab02b594051acf5a4c94564c9f4bc9c327a0950f507c0181e40',
      downloadPath: '/downloads/nodepilot/NodePilot-latest-arm64.dmg?release=0.2.26'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.2.26',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '93.8 MB',
      sha256: '53eec44cfa183eea11d6f8dc653dd10d0e0a0538623094ff1ca26ce7962db4b4',
      downloadPath: '/downloads/nodepilot/NodePilot-Setup-latest-x64.exe?release=0.2.26'
    }
  ],
  productPath: '/en/apps/nodepilot/',
  zhHantProductPath: '/zh-hant/apps/nodepilot/',
  zhHansProductPath: '/zh-hans/apps/nodepilot/',
  jaProductPath: '/ja/apps/nodepilot/',
  assets: {
    icon: '/images/apps/anytls-desktop-manager-icon.png',
    screenshot: '/images/anytls-desktop-manager-preview.svg'
  }
} as const;

export type AnyTlsDesktopManagerProduct = typeof anyTlsDesktopManagerProduct;
