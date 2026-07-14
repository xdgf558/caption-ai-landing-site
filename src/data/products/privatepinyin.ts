export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.18',
  releaseDate: '2026-07-14',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.18',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '2.3 MB',
      sha256: 'b87d76ffcd9847f8ec5a1074eb7c9dcb86ea9e298a4a3718ccc725663e3db318',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.18.pkg',
      r2ObjectKey: 'privatepinyin/0.1.18/PrivatePinyin-0.1.18.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.13',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '1.7 MB',
      sha256: '7bcc0125b1e57aa129a85f773aa5feca543c70a852704b80762440d4615c9b88',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.13-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.13/PrivatePinyin-0.1.13-setup.exe',
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
