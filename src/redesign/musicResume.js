import { uuid, slug, positive } from './publicValidation.js';

export const STATION_PLAYBACK_KEY = 'stationcat.station-playback.v1';
const MAX_AGE = 30 * 86400000;
const keys = ['schemaVersion', 'trackId', 'slug', 'revision', 'variant', 'previewRevision', 'positionSec', 'savedAt'];
export function readStationPlayback(raw, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > 1024) throw new Error('INVALID_SELECTION');
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value)) ||
    value.schemaVersion !== 1 || !uuid(value.trackId) || !slug(value.slug) || !positive(value.revision) ||
    !['preview', 'full'].includes(value.variant) || (value.variant === 'preview' ? !positive(value.previewRevision) : value.previewRevision !== null) ||
    !Number.isFinite(value.positionSec) || value.positionSec < 0 || value.positionSec > 86400 ||
    !Number.isSafeInteger(value.savedAt) || value.savedAt > now) throw new Error('INVALID_SELECTION');
  return value.savedAt < now - MAX_AGE ? null : value;
}
// A per-tab public selector, separate from legacy v2 audio revision positions.
// No audio URL, private handshake, entitlement, identity or playback ID persists.
export function createStationPlaybackStore({ storage = () => globalThis.sessionStorage, now = Date.now } = {}) {
  let backend, value = null, writable = true;
  try { backend = storage(); const raw = backend.getItem(STATION_PLAYBACK_KEY); if (raw !== null) value = readStationPlayback(raw, now()); }
  catch { writable = false; } // Preserve corrupt/future/unreadable original bytes.
  return {
    read: () => value ? { ...value } : null,
    save(selection) {
      let next;
      try { next = readStationPlayback(JSON.stringify({ schemaVersion: 1, ...selection, savedAt: now() }), now()); }
      catch { return false; } // Unexpected media progress cannot break playback.
      value = next;
      if (writable) try { backend.setItem(STATION_PLAYBACK_KEY, JSON.stringify(next)); } catch { writable = false; }
      return writable;
    },
    clear() { value = null; if (writable) try { backend.removeItem(STATION_PLAYBACK_KEY); } catch { writable = false; } },
    persistent: () => writable
  };
}
