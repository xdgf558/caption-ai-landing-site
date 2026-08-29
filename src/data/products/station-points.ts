export const stationPointsProduct = {
  name: 'Station Points',
  supportEmail: 'brodstem@protonmail.com',
  statusEndpoint: '/api/novels/payments/status',
  paths: {
    en: '/en/points/',
    ja: '/ja/points/',
    zhHant: '/zh-hant/points/',
    zhHans: '/zh-hans/points/'
  },
  libraryPaths: {
    en: '/en/library/',
    ja: '/ja/library/',
    zhHant: '/zh-hant/library/',
    zhHans: '/zh-hans/library/'
  },
  termsPaths: {
    en: '/en/terms/',
    ja: '/ja/terms/',
    zhHant: '/zh-hant/terms/',
    zhHans: '/zh-hans/terms/'
  },
  privacyPaths: {
    en: '/en/privacy/',
    ja: '/ja/privacy/',
    zhHant: '/zh-hant/privacy/',
    zhHans: '/zh-hans/privacy/'
  }
} as const;
