export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: 'v0.2.12',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.12',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '112.1 MB',
      sha256: 'b9db0d74fa55e5e9aa3ef74c3f4ba70a1a7d2ba914c292e11d4122d00cb0c25f',
      downloadPath: '/downloads/nodepilot/NodePilot-latest-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.2.12',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '90.3 MB',
      sha256: '9a7f763917c725fa1f410847ead46d819a823aba4539ff5c0032f5191f2986f6',
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
