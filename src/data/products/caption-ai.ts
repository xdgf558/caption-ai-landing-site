export const captionAiProduct = {
  id: 'caption-ai',
  slug: 'caption-ai',
  name: 'Caption AI',
  workingName: 'AI 生活文案生成器',
  status: 'waitlist',
  platforms: {
    ios: {
      status: 'coming-soon',
      appStoreUrl: '',
      waitlistFormUrl: 'TALLY_IOS_FORM_URL'
    },
    android: {
      status: 'waitlist',
      googlePlayUrl: '',
      waitlistFormUrl: 'TALLY_ANDROID_FORM_URL'
    }
  },
  locales: ['zh-Hant', 'en', 'ja'],
  defaultLocale: 'zh-Hant',
  productPath: '/apps/caption-ai/',
  zhHantProductPath: '/zh-hant/apps/caption-ai/',
  jaProductPath: '/ja/apps/caption-ai/',
  supportEmail: 'support@example.com',
  appStoreCampaignBaseUrl: '',
  googlePlayCampaignBaseUrl: '',
  useCases: ['breakfast', 'cafe', 'walking', 'travel', 'outfit', 'pet'],
  hiddenFormFields: {
    product: 'caption-ai'
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
