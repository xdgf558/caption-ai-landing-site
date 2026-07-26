export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.28',
  releaseDate: '2026-07-27',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.28',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '13.7 MB',
      sha256: '778cd5b53565131126c2734acc4771badd48f52d5b275a3ad671b166c4595ea8',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.28.pkg',
      r2ObjectKey: 'privatepinyin/0.1.28/PrivatePinyin-0.1.28.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.24',
      platform: 'Windows',
      architecture: 'x64 / x86 TSF',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '13.4 MB',
      sha256: '1252f8d00888be0cb2b0f25aaa5d4bdc357a441b94ffa183a76112851668be62',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.24-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.24/PrivatePinyin-0.1.24-setup.exe',
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
