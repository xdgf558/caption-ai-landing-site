export const xFollowCleanerProduct = {
  id: 'x-follow-cleaner',
  slug: 'x-follow-cleaner',
  name: 'X Follow Cleaner',
  version: '0.6.0',
  platform: 'Chrome Extension',
  minimumSystem: 'Chrome or Chromium browser',
  fileSize: '51.9 KB',
  sha256: 'f3c044c6ca1f2300cb8ad66cdc3bcfcac22d068c405235a6e82c252646f13bad',
  releaseDate: '2026-06-01',
  downloadUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/download/v0.6.0/x-follow-cleaner-v0.6.0.zip',
  releaseUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/tag/v0.6.0',
  sourceUrl: 'https://github.com/xdgf558/x-follow-cleaner',
  productPath: '/apps/x-follow-cleaner/',
  zhHantProductPath: '/zh-hant/apps/x-follow-cleaner/',
  zhHansProductPath: '/zh-hans/apps/x-follow-cleaner/',
  jaProductPath: '/ja/apps/x-follow-cleaner/',
  assets: {
    screenshot: '/images/x-follow-cleaner-preview.svg'
  }
} as const;

export type XFollowCleanerProduct = typeof xFollowCleanerProduct;
