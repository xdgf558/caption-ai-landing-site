export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'NodePilot',
  latestVersion: '0.2.8',
  downloads: [
    {
      id: 'mac-arm64',
      label: 'macOS Apple Silicon',
      version: '0.2.8',
      platform: 'macOS',
      architecture: 'arm64',
      minimumSystem: 'macOS 12 or later',
      fileSize: '116 MB',
      sha256: '47170c443dd54ad24cf37f22d8e92e10ab6b0727a8cbed78830f4c0b5a0e8111',
      downloadPath: '/downloads/nodepilot/NodePilot-0.2.8-arm64.dmg',
      r2ObjectKey: 'anytls-desktop-manager/0.2.8/NodePilot-0.2.8-arm64.dmg'
    },
    {
      id: 'windows-x64',
      label: 'Windows x64',
      version: '0.2.8',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 or later',
      fileSize: '90 MB',
      sha256: '508ec7ff712804136fd9cd2eecb8c28868aead11dacd0b71daccaac5ffeb40cf',
      downloadPath: '/downloads/nodepilot/NodePilot-Setup-0.2.8-x64.exe',
      r2ObjectKey: 'anytls-desktop-manager/0.2.8/NodePilot-Setup-0.2.8-x64.exe'
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
