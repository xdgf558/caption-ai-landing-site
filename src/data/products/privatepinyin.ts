export const privatePinyinProduct = {
  id: 'privatepinyin',
  slug: 'privatepinyin',
  name: 'PrivatePinyin',
  latestVersion: '0.1.9',
  releaseDate: '2026-07-08',
  downloads: [
    {
      id: 'macos-pkg',
      label: 'macOS installer',
      version: '0.1.9',
      platform: 'macOS',
      architecture: 'Apple Silicon / Intel',
      minimumSystem: 'macOS 12 or later',
      fileSize: '2.1 MB',
      sha256: '2b24e016e57825b7490274eeb95941e43ebacab794cbcdcb25da4756f6c65d70',
      downloadPath: '/downloads/privatepinyin/PrivatePinyin-0.1.9.pkg',
      r2ObjectKey: 'privatepinyin/0.1.9/PrivatePinyin-0.1.9.pkg'
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
