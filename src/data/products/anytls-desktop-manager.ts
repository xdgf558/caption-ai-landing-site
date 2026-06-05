export const anyTlsDesktopManagerProduct = {
  id: 'anytls-desktop-manager',
  slug: 'anytls-desktop-manager',
  name: 'AnyTLS Desktop Manager',
  version: '0.1.0',
  platform: 'Windows',
  architecture: 'x64',
  minimumSystem: 'Windows 10 or later',
  fileSize: '89 MB',
  sha256: 'acaeea7444baa2935ae1f4e8582135cde574793ddae7e798127846feb66cfbe9',
  downloadPath: '/downloads/anytls-desktop-manager/AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe',
  r2ObjectKey: 'anytls-desktop-manager/0.1.0/AnyTLS-Desktop-Manager-Setup-0.1.0-x64.exe',
  productPath: '/apps/anytls-desktop-manager/',
  zhHantProductPath: '/zh-hant/apps/anytls-desktop-manager/',
  zhHansProductPath: '/zh-hans/apps/anytls-desktop-manager/',
  jaProductPath: '/ja/apps/anytls-desktop-manager/',
  assets: {
    screenshot: '/images/anytls-desktop-manager-preview.svg'
  }
} as const;

export type AnyTlsDesktopManagerProduct = typeof anyTlsDesktopManagerProduct;
