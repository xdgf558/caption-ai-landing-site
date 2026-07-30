export const novelForgeAiProduct = {
  id: 'novelforge-ai',
  slug: 'novelforge-ai',
  name: 'NovelForge AI',
  latestVersion: '0.1.110',
  releaseDate: '2026-07-30',
  downloads: [
    {
      id: 'mac-arm64-pkg',
      label: 'macOS installer',
      version: '0.1.110',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 12 or later',
      fileSize: '430.7 MB',
      sha256: '26e0a41117b167244d633bc1dd2813fdd81a5c4bbd6e9a417c92f31baecd2109',
      downloadPath: '/downloads/novelforge-ai/NovelForge-AI-0.1.110-mac-arm64.pkg',
      r2ObjectKey: 'novelforge-ai/0.1.110/NovelForge-AI-0.1.110-mac-arm64.pkg',
      channel: 'public-test'
    }
  ],
  productPath: '/apps/novelforge-ai/',
  downloadPagePath: '/apps/novelforge-ai/download/',
  zhHantProductPath: '/zh-hant/apps/novelforge-ai/',
  zhHantDownloadPagePath: '/zh-hant/apps/novelforge-ai/download/',
  zhHansProductPath: '/zh-hans/apps/novelforge-ai/',
  zhHansDownloadPagePath: '/zh-hans/apps/novelforge-ai/download/',
  jaProductPath: '/ja/apps/novelforge-ai/',
  jaDownloadPagePath: '/ja/apps/novelforge-ai/download/',
  repositoryUrl: 'https://github.com/xdgf558/novelforge-ai',
  assets: {
    icon: '/images/apps/novelforge-ai-icon.png'
  }
} as const;

export type NovelForgeAiProduct = typeof novelForgeAiProduct;
