// Legacy file and route names stay as caption-ai so existing URLs do not break.
export const snapCopyProduct = {
  id: 'snapcopy',
  slug: 'caption-ai',
  name: 'SnapCopy',
  workingName: 'AI 生活文案生成器',
  status: 'available',
  platforms: {
    ios: {
      status: 'available',
      appStoreUrl: 'https://apps.apple.com/app/id6769939265',
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
  productPath: '/en/apps/caption-ai/',
  zhHantProductPath: '/zh-hant/apps/caption-ai/',
  zhHansProductPath: '/zh-hans/apps/caption-ai/',
  jaProductPath: '/ja/apps/caption-ai/',
  supportEmail: 'brodstem@protonmail.com',
  appStoreCampaignBaseUrl: '',
  googlePlayCampaignBaseUrl: '',
  useCases: ['breakfast', 'cafe', 'walking', 'travel', 'outfit', 'pet'],
  hiddenFormFields: {
    product: 'snapcopy'
  },
  assets: {
    icon: '/images/apps/snapcopy-app-icon.png',
    hero: '/images/caption-ai-hero-phone-placeholder.svg',
    screenshot: '/images/caption-ai-screenshot-placeholder.svg',
    scenes: {
      breakfast: '/images/scene-breakfast-placeholder.svg',
      cafe: '/images/scene-cafe-placeholder.svg',
      walking: '/images/scene-walking-placeholder.svg'
    }
  }
} as const;

export const captionAiProduct = snapCopyProduct;

export type SnapCopyProduct = typeof snapCopyProduct;
export type CaptionAiProduct = typeof captionAiProduct;
