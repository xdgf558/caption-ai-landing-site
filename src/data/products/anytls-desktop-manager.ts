export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: 'v0.2.16',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.16',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '124.4 MB',
      sha256: 'c9eb11bc1c4a48e1578057b825d46caa94ad1c6d89e7727777155b21dfacfbe4',
      downloadPath: '/downloads/nodepilot/NodePilot-latest-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.2.16',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '96.3 MB',
      sha256: 'b4033f827e4878a8a78040a0bc3177108be29f3b86dcdc70992e012a9249cdea',
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
