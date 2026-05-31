export const xFollowCleanerProduct = {
  id: 'x-follow-cleaner',
  slug: 'x-follow-cleaner',
  name: 'X Follow Cleaner',
  version: '0.4.0',
  platform: 'Chrome Extension',
  minimumSystem: 'Chrome or Chromium browser',
  fileSize: '47.7 KB',
  sha256: 'dc93364fbf2e7e13eaee3360f718788a9a0f6d0d235dcec372f05755f051f16c',
  releaseDate: '2026-05-31',
  downloadUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/download/v0.4.0/x-follow-cleaner-v0.4.0.zip',
  releaseUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/tag/v0.4.0',
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
