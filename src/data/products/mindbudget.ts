export const mindBudgetProduct = {
  id: 'mindbudget',
  slug: 'mindbudget',
  name: 'MindBudget',
  chineseName: '花有数',
  supportEmail: 'brodstem@protonmail.com',
  latestVersion: '0.9.4',
  buildNumber: '5',
  releaseDate: '2026-08-09',
  minimumSystem: 'iOS 17.0 or later',
  deviceFamily: 'iPhone',
  testFlightUrl: 'https://testflight.apple.com/join/gnhUNEbz',
  productPath: '/en/apps/mindbudget/',
  downloadPagePath: '/en/apps/mindbudget/download/',
  zhHantProductPath: '/zh-hant/apps/mindbudget/',
  zhHantDownloadPagePath: '/zh-hant/apps/mindbudget/download/',
  zhHansProductPath: '/zh-hans/apps/mindbudget/',
  zhHansDownloadPagePath: '/zh-hans/apps/mindbudget/download/',
  jaProductPath: '/ja/apps/mindbudget/',
  jaDownloadPagePath: '/ja/apps/mindbudget/download/',
  privacyPaths: {
    en: '/en/apps/mindbudget/privacy/',
    zhHans: '/zh-hans/apps/mindbudget/privacy/',
    zhHant: '/zh-hant/apps/mindbudget/privacy/',
    ja: '/ja/apps/mindbudget/privacy/'
  },
  supportPaths: {
    en: '/en/apps/mindbudget/support/',
    zhHans: '/zh-hans/apps/mindbudget/support/',
    zhHant: '/zh-hant/apps/mindbudget/support/',
    ja: '/ja/apps/mindbudget/support/'
  },
  assets: {
    icon: '/images/apps/mindbudget/icon.png',
    dashboard: '/images/apps/mindbudget/dashboard-zh-hans.png',
    ask: '/images/apps/mindbudget/ask-zh-hans.png',
    insights: '/images/apps/mindbudget/insights-en.png',
    warmBotanical: '/images/apps/mindbudget/warm-botanical.png'
  }
} as const;

export type MindBudgetProduct = typeof mindBudgetProduct;
