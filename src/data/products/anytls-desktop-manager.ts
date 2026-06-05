export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'AnyTLS Desktop Manager',
  latestVersion: '0.2.0',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.0',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '112 MB',
      sha256: '5b7ff72d53465a8bd0b21c4448ae32558d26ff6c388f2163079f3942701685a6',
      downloadPath: '/downloads/anytls-desktop-manager/AnyTLS-Desktop-Manager-0.2.0-arm64.dmg',
      r2ObjectKey: 'anytls-desktop-manager/0.2.0/AnyTLS-Desktop-Manager-0.2.0-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.1.0',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '89 MB',
      sha256: 'acaeea7444baa2935ae1f4e8582135cde574793ddae7e798127846feb66cfbe9',
      downloadPath: '/downloads/anytls-desktop-manager/AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe',
      r2ObjectKey: 'anytls-desktop-manager/0.1.0/AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe'
    }
  ],
  productPath: '/apps/anytls-desktop-manager/',
  zhHantProductPath: '/zh-hant/apps/anytls-desktop-manager/',
  zhHansProductPath: '/zh-hans/apps/anytls-desktop-manager/',
  jaProductPath: '/ja/apps/anytls-desktop-manager/',
  assets: {
    icon: '/images/apps/anytls-desktop-manager-icon.png',
    screenshot: '/images/anytls-desktop-manager-preview.svg'
  }
} as const;

export type AnyTlsDesktopManagerProduct = typeof anyTlsDesktopManagerProduct;
