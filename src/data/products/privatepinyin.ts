export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: '猫栈拼音',
  latestVersion: '0.1.15',
  releaseDate: '2026-07-11',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.15',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 14 or later',
      fileSize: '2.2 MB',
      sha256: 'cb48d25bfd31345ba91f9a9d073a9cf49cabb407d376edaa304b04cffdf59211',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.15.pkg',
      r2ObjectKey: 'privatepinyin/0.1.15/PrivatePinyin-0.1.15.pkg',
      channel: 'public-test'
    },
    {
      id: 'windows-exe',
      label: 'Windows EXE installer',
      version: '0.1.12',
      platform: 'Windows',
      architecture: 'x64',
      minimumSystem: 'Windows 10 / 11',
      fileSize: '1.7 MB',
      sha256: 'a0929a6b0faac70d3d5374c7f91ee92f44d06834ab65aa0230460df31511ba98',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.12-setup.exe',
      r2ObjectKey: 'privatepinyin/0.1.12/PrivatePinyin-0.1.12-setup.exe',
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
