import { musicSelection } from '../music/pagePaths.js';
export const normalizeMusicSearch = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en');
export function libraryFilters(tracks) {
  return Object.fromEntries(['genres', 'moods'].map(key => [key, [...new Set(tracks.flatMap(track => track[key] || []))].sort()]));
}
export function browseMusic(tracks, collections, { query = '', genres = [], moods = [], access = '', collection = '', mode = 'latest' } = {}, local = {}) {
  // The album overview has no implicit playback selection. Opening an album
  // only changes this view; queue and /audio authorization remain separate.
  if (mode === 'albums' && !collections.some(item => item.slug === collection && item.type === 'album')) return [];
  const collectionIds = collection ? collections.find(item => item.slug === collection)?.trackIds || [] : null;
  const ids = mode === 'favorites' ? local.favorites || [] : mode === 'recent' ? local.recent || [] : collectionIds;
  const inCollection = collectionIds && new Set(collectionIds);
  const rank = ids && new Map(ids.map((id, index) => [id, index]));
  const needle = normalizeMusicSearch(query);
  return tracks.filter(track => (!rank || rank.has(track.id)) &&
    (!inCollection || inCollection.has(track.id)) &&
    (!access || track.effectiveAccess === access) && (mode !== 'picks' || track.effectiveAccess === 'free') &&
    (!genres.length || genres.some(tag => track.genres?.includes(tag))) && (!moods.length || moods.some(tag => track.moods?.includes(tag))) &&
    (!needle || normalizeMusicSearch([track.title, track.creatorName, ...track.genres, ...track.moods].join(' ')).includes(needle)))
    .sort((a, b) => rank ? rank.get(a.id) - rank.get(b.id) : (b.publishedAt || '').localeCompare(a.publishedAt || '') || a.id.localeCompare(b.id));
}
export const libraryLocation = search => Object.fromEntries(musicSelection(search));
