export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: 'Latest GitHub release',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: 'Latest',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: 'Varies by release',
      sha256: 'Published with each GitHub Release asset',
      downloadPath: '/downloads/nodepilot/NodePilot-latest-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: 'Latest',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: 'Varies by release',
      sha256: 'Published with each GitHub Release asset',
      downloadPath: '/downloads/nodepilot/NodePilot-Setup-latest-x64.exe'
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
