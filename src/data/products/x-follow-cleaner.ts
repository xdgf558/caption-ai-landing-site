export const xFollowCleanerProduct = {
  id: 'x-follow-cleaner',
  slug: 'x-follow-cleaner',
  name: 'X Follow Cleaner',
  version: '0.3.2',
  platform: 'Chrome Extension',
  minimumSystem: 'Chrome or Chromium browser',
  fileSize: '45.0 KB',
  sha256: '7fed952d5a263a37d970f8445a979186dc4d0d3258ba6dd8de331be19e42bf25',
  releaseDate: '2026-05-31',
  downloadUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/download/v0.3.2/x-follow-cleaner-v0.3.2.zip',
  releaseUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/tag/v0.3.2',
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
