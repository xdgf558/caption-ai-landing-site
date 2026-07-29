export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.29',
  releaseDate: '2026-07-29',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.29',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '13.8 MB',
      sha256: 'a2e036f668dec4e15058db51f3caeacd3722a2131462752a7cbc5d15bef60832',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.29.pkg',
      r2ObjectKey: 'privatepinyin/0.1.29/PrivatePinyin-0.1.29.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.25',
      platform: 'Windows',
      architecture: 'x64 / x86 TSF',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '12.8 MB',
      sha256: 'f819de9a17ad319ce3abf5f8551b674278e3e90709167cb457e73932fff41600',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.25-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.25/PrivatePinyin-0.1.25-setup.exe',
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
