export const xFollowCleanerProduct = {
  id: 'x-follow-cleaner',
  slug: 'x-follow-cleaner',
  name: 'X Follow Cleaner',
  version: '0.3.1',
  platform: 'Chrome Extension',
  minimumSystem: 'Chrome or Chromium browser',
  fileSize: '44.9 KB',
  sha256: '7c294b2acd1ad7fb05ae4be1a5fd8457dafbf90760ca4d4f8b92db754163e3f9',
  releaseDate: '2026-05-30',
  downloadUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/download/v0.3.1/x-follow-cleaner-v0.3.1.zip',
  releaseUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/tag/v0.3.1',
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
