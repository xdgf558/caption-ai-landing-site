export const stationCatRadarProduct = {
  id: 'stationcat-radar',
  slug: 'stationcat-radar',
  name: 'StationCat Radar',
  version: '0.1.0',
  platform: 'macOS',
  architecture: 'Apple Silicon',
  minimumSystem: 'macOS 10.15+',
  fileSize: '187 MB',
  sha256: 'e4bfc4916011de45a96b8795d24e4f75ac597cf2d82d35cffae8ee005b0e0b2d',
  downloadPath: '/downloads/stationcat-radar/StationCat-Radar-0.1.0-arm64.dmg',
  r2ObjectKey: 'stationcat-radar/0.1.0/StationCat-Radar-0.1.0-arm64.dmg',
  productPath: '/apps/stationcat-radar/',
  downloadPagePath: '/apps/stationcat-radar/download/',
  zhHantProductPath: '/zh-hant/apps/stationcat-radar/',
  zhHantDownloadPagePath: '/zh-hant/apps/stationcat-radar/download/',
  zhHansProductPath: '/zh-hans/apps/stationcat-radar/',
  zhHansDownloadPagePath: '/zh-hans/apps/stationcat-radar/download/',
  jaProductPath: '/ja/apps/stationcat-radar/',
  jaDownloadPagePath: '/ja/apps/stationcat-radar/download/',
  assets: {
    screenshot: '/images/stationcat-radar-preview.svg'
  }
} as const;

export type StationCatRadarProduct = typeof stationCatRadarProduct;

