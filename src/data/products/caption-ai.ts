export const captionAiProduct = {
  id: 'snapcopy',
  slug: 'caption-ai',
  name: 'SnapCopy',
  workingName: 'AI 生活文案生成器',
  status: 'waitlist',
  platforms: {
    ios: {
      status: 'coming-soon',
      appStoreUrl: '',
      waitlistFormUrl: '/api/waitlist'
    },
    android: {
      status: 'waitlist',
      googlePlayUrl: '',
      waitlistFormUrl: '/api/waitlist'
    }
  },
  locales: ['zh-Hant', 'zh-Hans', 'en', 'ja'],
  defaultLocale: 'zh-Hant',
  productPath: '/apps/caption-ai/',
  zhHantProductPath: '/zh-hant/apps/caption-ai/',
  jaProductPath: '/ja/apps/caption-ai/',
  supportEmail: 'brodstem@protonmail.com',
  appStoreCampaignBaseUrl: '',
  googlePlayCampaignBaseUrl: '',
  useCases: ['breakfast', 'cafe', 'walking', 'travel', 'outfit', 'pet'],
  hiddenFormFields: {
    product: 'snapcopy'
  },
  assets: {
    hero: '/images/caption-ai-hero-phone-placeholder.svg',
    screenshot: '/images/caption-ai-screenshot-placeholder.svg',
    scenes: {
      breakfast: '/images/scene-breakfast-placeholder.svg',
      cafe: '/images/scene-cafe-placeholder.svg',
      walking: '/images/scene-walking-placeholder.svg'
    }
  }
} as const;

export type CaptionAiProduct = typeof captionAiProduct;
