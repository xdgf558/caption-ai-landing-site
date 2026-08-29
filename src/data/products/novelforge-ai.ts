export const novelForgeAiProduct = {
  id: 'novelforge-ai',
  slug: 'novelforge-ai',
  name: 'NovelForge AI',
  latestVersion: '0.1.115',
  releaseDate: '2026-08-01',
  downloads: [
    {
      id: 'mac-arm64-pkg',
      label: 'macOS installer',
      version: '0.1.115',
      platform: 'macOS',
      architecture: 'Apple Silicon',
      minimumSystem: 'macOS 12 or later',
      fileSize: '395.0 MB',
      sha256: '070284ed4156bbe2cfa158e2102b13027ee270e9d4c1e2523d72e163366b5197',
      downloadPath: '/downloads/novelforge-ai/NovelForge-AI-0.1.115-mac-arm64.pkg',
      channel: 'public-test'
    }
  ],
  productPath: '/en/apps/novelforge-ai/',
  downloadPagePath: '/en/apps/novelforge-ai/download/',
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
