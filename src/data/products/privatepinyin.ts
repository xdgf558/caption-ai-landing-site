export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.26',
  releaseDate: '2026-07-24',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.26',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '13.4 MB',
      sha256: '5c83e1770f7eb8d18096c08bf4e4e2e2fa05fdcb82e402060b73f3e8160e4200',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.26.pkg',
      r2ObjectKey: 'privatepinyin/0.1.26/PrivatePinyin-0.1.26.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.23',
      platform: 'Windows',
      architecture: 'x64 / x86 TSF',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '4.1 MB',
      sha256: '8ed9510556d14a7744547355881f3cfcfa8b58e5e36db0150ac298cf26f5fa7c',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.23-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.23/PrivatePinyin-0.1.23-setup.exe',
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
