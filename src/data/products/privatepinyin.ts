export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.10',
  releaseDate: '2026-07-09',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.10',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 12 or later',
      fileSize: '2.1 MB',
      sha256: 'b96563c60ed8ac0c1190f611a93021d92edcc3ef7e4d75f5f6a7359acd1dbf46',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.10.pkg',
      r2ObjectKey: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.10',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '1.6 MB',
      sha256: '4016b84921db43237b838caefb086d7704e8389fb352d0bef4d498e6b5993afc',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.10-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10-setup.exe',
      channel: 'internal-test'
    }
  ],
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
