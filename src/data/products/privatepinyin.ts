export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.21',
  releaseDate: '2026-07-18',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.21',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '2.5 MB',
      sha256: '660d1cc7d8674c8be0e3f30683deb0d6351fa0f76a4842c6cad46bb55f0a5026',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.21.pkg',
      r2ObjectKey: 'privatepinyin/0.1.21/PrivatePinyin-0.1.21.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.20',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '2.7 MB',
      sha256: '28263c4aecaab8ac0a6d559f28efd6f9c13d1fe7cd81a11037c19150816c432d',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.20-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.20/PrivatePinyin-0.1.20-setup.exe',
      channel: 'internal-test'
    }
  ],
  iosTestflight: {
    label: 'iOS TestFlight external test',
    platform: 'iOS',
    channel: 'external-test',
    url: 'https://testflight.apple.com/join/QnWqrAaH'
  },
  productPath: '/apps/privatepinyin/',
  downloadPagePath: '/apps/privatepinyin/download/',
  zhHantProductPath: '/zh-hant/apps/privatepinyin/',
  zhHantDownloadPagePath: '/zh-hant/apps/privatepinyin/download/',
  zhHansProductPath: '/zh-hans/apps/privatepinyin/',
  zhHansDownloadPagePath: '/zh-hans/apps/privatepinyin/download/',
  jaProductPath: '/ja/apps/privatepinyin/',
  jaDownloadPagePath: '/ja/apps/privatepinyin/download/',
  assets: {
    icon: '/images/apps/privatepinyin-icon.png'
  }
} as const;

export type PrivatePinyinProduct = typeof privatePinyinProduct;
