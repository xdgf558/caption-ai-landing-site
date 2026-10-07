import { uuid, platform, platformUrl, strictJson, millis } from './publicValidation.js';

export const platformProviders = Object.freeze(['netease', 'qishui', 'apple_music', 'youtube', 'spotify']);
const provider = value => platformProviders.includes(value);

// Public status only: unpublished/withdrawn/territory-limited URLs never leave
// the server. The trusted country changes availability, never provider order.
export function platformAvailability(rows, trackId, country, now) {
  const notes = []; let removed = false, available = false;
  for (const row of rows) {
    if (!uuid(row.id) || row.track_id !== trackId || !provider(row.provider)) continue;
    if (row.status === 'planned') { notes.push({ provider: row.provider, status: 'planned' }); continue; }
    if (row.status === 'removed') { removed = true; continue; }
    if (row.status !== 'live') continue;
    let territories;
    try { territories = strictJson(row.territories_json, 1024); } catch { continue; }
    // Validate against an actually registered territory before explaining why
    // this visitor has no link. Do not infer a release from invalid metadata.
    if (!Array.isArray(territories) || !platform(row, territories[0], now)) continue;
    if (platform(row, country, now)) available = true;
    else notes.push({ provider: row.provider, status: country ? 'region_unavailable' : 'region_unconfirmed' });
  }
  const unique = notes.filter((note, i) => notes.findIndex(item => item.provider === note.provider && item.status === note.status) === i);
  return { state: available ? 'available' : unique.some(note => note.status.startsWith('region_')) ? 'region_restricted' :
    unique.some(note => note.status === 'planned') ? 'unreleased' : removed ? 'removed' : 'unconfirmed', notes: unique };
}

// Revalidate the public DTO before rendering an anchor or a copy control.
// Preserve the operator's existing order; do not guess preferences from UA/IP.
export function stationPlatformLinks(track, now = Date.now()) {
  if (!uuid(track?.id) || !Array.isArray(track.platforms) || track.platforms.length > 25) return [];
  const counts = new Map();
  for (const link of track.platforms) if (uuid(link?.id)) {
    const id = link.id.toLowerCase(); counts.set(id, (counts.get(id) || 0) + 1);
  }
  return track.platforms.flatMap(link => {
    const verified = typeof link?.verifiedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(link.verifiedAt) ? Date.parse(link.verifiedAt) : NaN;
    const href = platformUrl(link?.href, link?.provider);
    if (!uuid(link?.id) || counts.get(link.id.toLowerCase()) !== 1 || link.status !== 'live' || !provider(link.provider) ||
      !millis(verified) || verified > now || !href) return [];
    return [{ id: link.id, provider: link.provider, href, verifiedAt: link.verifiedAt }];
  });
}

export function stationPlatformNotes(value) {
  if (!Array.isArray(value?.notes) || value.notes.length > 25) return [];
  return value.notes.filter(note => provider(note?.provider) && ['planned', 'region_unavailable', 'region_unconfirmed'].includes(note.status))
    .filter((note, i, all) => all.findIndex(item => item.provider === note.provider && item.status === note.status) === i)
    .map(note => ({ provider: note.provider, status: note.status }));
}
