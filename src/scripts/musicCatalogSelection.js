import { musicSelection } from '../music/pagePaths.js';
import { readPlayerCatalog, readPlayerCollections, readPlayerFeatured } from './musicPlayerCatalog.js';

// Each public response remains capped at 500. A bounded lookup also retains the
// current queue while another collection is viewed; display and queue stay <=500.
export const MUSIC_LOOKUP_LIMIT = 1502;
export function readMusicLookup(values) {
  if (!Array.isArray(values) || values.length > MUSIC_LOOKUP_LIMIT) throw new Error('INVALID_LOOKUP');
  const result = [];
  for (let i = 0; i < values.length; i += 500) result.push(...readPlayerCatalog({ schemaVersion: 2, tracks: values.slice(i, i + 500) }));
  if (new Set(result.map(track => track.id)).size !== result.length) throw new Error('INVALID_LOOKUP');
  return result;
}
export async function readMusicSelectionCatalog(body, { read, locale, selection = {}, activeId = null, retained = [] } = {}) {
  const ids = Object.fromEntries(musicSelection(new URLSearchParams(selection)));
  const catalogTracks = readPlayerCatalog(body), collections = readPlayerCollections(body, catalogTracks);
  const featured = readPlayerFeatured(body,catalogTracks,collections);
  const lookup = new Map(readPlayerCatalog({ schemaVersion: 2, tracks: retained.slice(0, 500) }).map(track => [track.id, track]));
  for (const track of catalogTracks) lookup.set(track.id, track);
  let selectedCollection = null;
  const issues = {};
  if (ids.collection) {
    try {
      const response = await read(`/api/music/collections/${ids.collection}?locale=${locale}`);
      if (response.status !== 200) throw new Error([404, 410].includes(response.status) ? 'missing' : 'unavailable');
      const values = readPlayerCatalog(response.body), groups = readPlayerCollections({ collections: [response.body.collection] }, values);
      if (groups.length !== 1 || groups[0].slug !== ids.collection || groups[0].trackIds.length !== values.length) throw new Error('unavailable');
      selectedCollection = { ...groups[0], tracks: values };
      for (const track of values) lookup.set(track.id, track);
    } catch (error) { issues.collection = error.message === 'missing' ? 'missing' : 'unavailable'; }
  }
  const fresh = new Set([...catalogTracks, ...(selectedCollection?.tracks || [])].map(track => track.id));
  await Promise.all([...new Set([ids.track, activeId].filter(Boolean))].filter(id => !fresh.has(id)).map(async id => {
    try {
      const response = await read(`/api/music/tracks/${id}?locale=${locale}`);
      if (response.status !== 200) throw new Error([404, 410].includes(response.status) ? 'missing' : 'unavailable');
      const values = readPlayerCatalog({ schemaVersion: response.body?.schemaVersion, tracks: [response.body?.track] });
      if (values[0].id !== id) throw new Error('unavailable');
      lookup.set(id, values[0]);
    } catch (error) { lookup.delete(id); if (id === ids.track) issues.track = error.message === 'missing' ? 'missing' : 'unavailable'; }
  }));
  const groups = collections.filter(group => group.slug !== ids.collection);
  if (selectedCollection) groups.push(selectedCollection);
  return { tracks: readMusicLookup([...lookup.values()]), collections: groups,
    view: { catalogTracks, selectedCollection, selection: ids, issues, featured } };
}
