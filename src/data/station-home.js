// File-based configuration, like site.ts. T16 will supply the existing admin editor.
// User has not selected promotion material. A draft must never select a fallback song.
export const stationHomeConfig = Object.freeze({
  id: 'ca710000-0000-4000-8000-000000000001',
  revision: 1,
  publishedRevision: null,
  status: 'draft',
  publishedAt: null,
  featuredTrackId: null,
  selectedTrackIds: Object.freeze([]),
  selectedClipIds: Object.freeze([]),
  featuredGameId: null,
  selectedUpdateIds: Object.freeze([]),
});

// T07 will provide the public query adapter. Do not import raw D1 rows or private media.
export const emptyHomeContent = Object.freeze({
  tracks: Object.freeze([]), promotions: Object.freeze([]), platforms: Object.freeze([]),
  assets: Object.freeze([]), clips: Object.freeze([]), games: Object.freeze([]), updates: Object.freeze([]),
});
