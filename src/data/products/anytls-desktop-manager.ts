export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: 'v0.2.17',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.17',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '124.9 MB',
      sha256: '25244851de842812d6fc26dffad66fc42e7f9059e2776c3e60aa382a2ad6a505',
      downloadPath: '/downloads/nodepilot/NodePilot-latest-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.2.17',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '96.4 MB',
      sha256: 'e1ba05b1bbdc13f64971412979a29963d5dfd50e19e97628633667655be5792b',
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
