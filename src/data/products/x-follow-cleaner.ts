export const xFollowCleanerProduct = {
  id: 'x-follow-cleaner',
  slug: 'x-follow-cleaner',
  name: 'X Follow Cleaner',
  version: '0.2.0',
  platform: 'Chrome Extension',
  minimumSystem: 'Chrome or Chromium browser',
  fileSize: '35.3 KB',
  sha256: '53befc556ae8461c539a9543e29747bee253f87b1194d1de66bd531fa0aaf2ee',
  releaseDate: '2026-05-30',
  downloadUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/download/v0.2.0/x-follow-cleaner-v0.2.0.zip',
  releaseUrl: 'https://github.com/xdgf558/x-follow-cleaner/releases/tag/v0.2.0',
  productPath: '/apps/x-follow-cleaner/',
  zhHantProductPath: '/zh-hant/apps/x-follow-cleaner/',
  zhHansProductPath: '/zh-hans/apps/x-follow-cleaner/',
  jaProductPath: '/ja/apps/x-follow-cleaner/',
  assets: {
    screenshot: '/images/x-follow-cleaner-preview.svg'
  }
} as const;

export type XFollowCleanerProduct = typeof xFollowCleanerProduct;
