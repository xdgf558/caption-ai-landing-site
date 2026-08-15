export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  supportEmail: 'brodstem@protonmail.com',
  latestVersion: '0.1.30',
  releaseDate: '2026-07-31',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.30',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '13.8 MB',
      sha256: 'd4ef4c8e0122d7a22acd7a0e252a33e48eb18424c92c74a6df73d095cd381142',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.30.pkg',
      r2ObjectKey: 'privatepinyin/0.1.30/PrivatePinyin-0.1.30.pkg',
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
  iosAppStore: {
    label: 'iOS App Store release',
    platform: 'iOS',
    channel: 'app-store',
    version: '1.0',
    releaseDate: '2026-08-14',
    minimumSystem: 'iOS 18 or later',
    devices: 'iPhone / iPad',
    appId: '6789098978',
    url: 'https://apps.apple.com/app/id6789098978'
  },
  productPath: '/apps/privatepinyin/',
  downloadPagePath: '/apps/privatepinyin/download/',
  zhHantProductPath: '/zh-hant/apps/privatepinyin/',
  zhHantDownloadPagePath: '/zh-hant/apps/privatepinyin/download/',
  zhHansProductPath: '/zh-hans/apps/privatepinyin/',
  zhHansDownloadPagePath: '/zh-hans/apps/privatepinyin/download/',
  jaProductPath: '/ja/apps/privatepinyin/',
  jaDownloadPagePath: '/ja/apps/privatepinyin/download/',
  privacyPaths: {
    en: '/apps/privatepinyin/privacy/',
    zhHans: '/zh-hans/apps/privatepinyin/privacy/',
    zhHant: '/zh-hant/apps/privatepinyin/privacy/',
    ja: '/ja/apps/privatepinyin/privacy/'
  },
  supportPaths: {
    en: '/apps/privatepinyin/support/',
    zhHans: '/zh-hans/apps/privatepinyin/support/',
    zhHant: '/zh-hant/apps/privatepinyin/support/',
    ja: '/ja/apps/privatepinyin/support/'
  },
  assets: {
    icon: '/images/apps/privatepinyin-icon.png'
  }
} as const;

export type PrivatePinyinProduct = typeof privatePinyinProduct;
