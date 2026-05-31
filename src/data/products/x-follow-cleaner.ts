export const xFollowCleanerProduct = {
  id: 'x-follow-cleaner',
  slug: 'x-follow-cleaner',
  name: 'X Follow Cleaner',
  version: '0.5.0',
  platform: 'Chrome Extension',
  minimumSystem: 'Chrome or Chromium browser',
  fileSize: '49.9 KB',
  sha256: '49239f2286b1a124b6837db94c83e5f63bbadba4a8561f542dab9f6c8252df75',
  releaseDate: '2026-05-31',
  downloadUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/download/v0.5.0/x-follow-cleaner-v0.5.0.zip',
  releaseUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/tag/v0.5.0',
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
