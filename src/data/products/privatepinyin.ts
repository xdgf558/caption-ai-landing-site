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
      id: 'windows-msi',
      label: 'Windows MSI installer',
      version: '0.1.10',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '3.5 MB',
      sha256: '59c4935b95c283133cfef2f0648233f7fe292f900395cbc14a44cc7aaa5fd78a',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.10.msi',
      r2ObjectKey: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10.msi',
      channel: 'internal-test'
    },
    {
      id: 'windows-zip',
      label: 'Windows ZIP test bundle',
      version: '0.1.10',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '3.6 MB',
      sha256: 'f9eb19256e1efcb9651370a816057562a632e1454ad7a02dfac4c35b7491de06',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.10.zip',
      r2ObjectKey: 'privatepinyin/0.1.10/PrivatePinyin-0.1.10.zip',
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
