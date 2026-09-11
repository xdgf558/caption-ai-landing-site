export const MUSIC_LOCAL_KEY = 'stationcat.music.v2';
export const MUSIC_OLD_KEY = 'stationcat.music.v1';
const DAY = 86400000, MAX_BYTES = 512 * 1024;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const ids = (values, max) => Array.isArray(values) ? [...new Set(values.filter(uuid))].slice(0, max) : [];
const empty = () => ({ schemaVersion: 2, favorites: [], recent: [], queue: [], settings: { volume: 1, muted: false, shuffle: false, repeat: 'off' }, positions: [], current: null });
const settings = value => ({ volume: Number.isFinite(value?.volume) && value.volume >= 0 && value.volume <= 1 ? value.volume : 1,
  muted: value?.muted === true, shuffle: value?.shuffle === true, repeat: ['off', 'all', 'one'].includes(value?.repeat) ? value.repeat : 'off' });
const position = (row, now) => object(row) && uuid(row.trackId) && positive(row.revisionNo) && positive(row.assetVersion) &&
  ['full', 'preview'].includes(row.variant) && Number.isFinite(row.positionSec) && row.positionSec >= 0 && row.positionSec <= 86400 &&
  Number.isSafeInteger(row.savedAt) && row.savedAt <= now && row.savedAt >= now - 30 * DAY
  ? { trackId: row.trackId, revisionNo: row.revisionNo, variant: row.variant, assetVersion: row.assetVersion, positionSec: row.positionSec, savedAt: row.savedAt } : null;
export const positionKey = row => `${row.trackId}:${row.revisionNo}:${row.variant}:${row.assetVersion}`;
// audioVersion is the immutable published-revision selector in today's /audio URL.
// Bind both version slots to it; never invent or persist an R2 asset ID/key.
export const localSource = (track, variant) => ({ trackId: track.id, revisionNo: track.audioVersion, assetVersion: track.audioVersion, variant });

export function readMusicLocal(raw, now = Date.now(), legacy = false) {
  if (typeof raw !== 'string' || raw.length > MAX_BYTES || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('INVALID_LOCAL_DATA');
  const value = JSON.parse(raw);
  if (!object(value) || value.schemaVersion !== (legacy ? 1 : 2)) throw new Error('INVALID_LOCAL_SCHEMA');
  for (const key of ['favorites', 'queue', ...(legacy ? [] : ['recent', 'positions'])]) {
    if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error('INVALID_LOCAL_DATA');
  }
  if (value.settings !== undefined && !object(value.settings)) throw new Error('INVALID_LOCAL_DATA');
  const result = empty();
  result.favorites = ids(value.favorites, 500); result.queue = ids(value.queue, 500); result.settings = settings(value.settings);
  if (!legacy) {
    result.recent = ids(value.recent, 50);
    const unique = new Map();
    for (const row of (Array.isArray(value.positions) ? value.positions.slice(0, 1000) : [])) {
      const parsed = position(row, now); if (parsed) unique.set(positionKey(parsed), parsed);
    }
    result.positions = [...unique.values()]; result.current = position(value.current, now);
  }
  return result;
}

export function createMusicLocalData({ storage = () => globalThis.localStorage, now = Date.now } = {}) {
  let data = empty(), backend, writable = true, warning = null, original = null;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(api.snapshot()); };
  const flush = () => {
    if (!writable) return false;
    try { backend.setItem(MUSIC_LOCAL_KEY, JSON.stringify(data)); return true; }
    catch { writable = false; warning = 'storage'; emit(); return false; }
  };
  try {
    backend = storage();
    const raw = backend.getItem(MUSIC_LOCAL_KEY);
    if (raw !== null) {
      original = raw; data = readMusicLocal(raw, now()); original = null;
    } else {
      const old = backend.getItem(MUSIC_OLD_KEY);
      if (old !== null) { original = old; data = readMusicLocal(old, now(), true); warning = 'migration'; }
    }
  } catch { writable = false; warning = original !== null ? 'corrupt' : 'storage'; }
  const api = {
    snapshot: () => structuredClone({ ...data, warning, persistent: writable, canExportOriginal: original !== null }),
    subscribe(listener) { listeners.add(listener); listener(api.snapshot()); return () => listeners.delete(listener); },
    original: () => original,
    toggleFavorite(id) {
      if (!uuid(id)) return false;
      if (data.favorites.includes(id)) data.favorites = data.favorites.filter(value => value !== id);
      else { if (data.favorites.length >= 500) { warning = 'limit'; emit(); return false; } data.favorites.push(id); }
      if (warning === 'limit') warning = writable ? null : 'storage';
      flush(); emit(); return true;
    },
    recordPlayed(id) {
      if (!uuid(id) || data.recent[0] === id) return;
      data.recent = [id, ...data.recent.filter(value => value !== id)].slice(0, 50); flush(); emit();
    },
    savePlayback({ queue, settings: options, current }, write = true) {
      const before = JSON.stringify(data);
      data.queue = ids(queue, 500); data.settings = settings(options);
      if (current !== undefined) {
        data.current = current === null ? null : position({ ...current, savedAt: now() }, now());
        if (data.current) data.positions = [data.current, ...data.positions.filter(row => positionKey(row) !== positionKey(data.current) && position(row, now()))].slice(0, 1000);
      }
      if (write && before !== JSON.stringify(data)) flush();
    },
    findPosition(track, variant) {
      const key = positionKey(localSource(track, variant));
      return data.positions.find(row => positionKey(row) === key && position(row, now())) || null;
    },
    flush,
    clear() {
      try { backend?.removeItem(MUSIC_LOCAL_KEY); backend?.removeItem(MUSIC_OLD_KEY); writable = Boolean(backend); warning = writable ? null : 'storage'; original = null; }
      catch { writable = false; warning = 'storage'; }
      data = empty(); emit();
    },
    destroy() { listeners.clear(); }
  };
  // Keep v1 untouched, including on migration or write failure, for explicit export.
  if (warning === 'migration') flush();
  return api;
}
