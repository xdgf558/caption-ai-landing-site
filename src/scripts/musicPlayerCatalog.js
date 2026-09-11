// Browser adapter for the existing public contract. No fixture or media fetches.
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
const seconds = value => Number.isFinite(value) && value > 0 && value <= 86400;
export function readPlayerCatalog(body) {
  if (body?.schemaVersion !== 2 || !Array.isArray(body.tracks) || body.tracks.length > 500) throw new Error('INVALID_CATALOG');
  const seen = new Set();
  return body.tracks.map(track => {
    if (!track || !idPattern.test(track.id) || seen.has(track.id) || !text(track.title, 200) ||
      !text(track.creatorName, 120) || !seconds(track.durationSec) || !Number.isSafeInteger(track.audioVersion) || track.audioVersion < 1 ||
      !Number.isSafeInteger(track.policyVersion) || track.policyVersion < 1 || !['free', 'vip'].includes(track.effectiveAccess) ||
      typeof track.previewAvailable !== 'boolean' || (track.previewAvailable && (!seconds(track.previewDurationSec) ||
        track.previewDurationSec > Math.min(45, track.durationSec / 2) + 0.25 || !Number.isFinite(track.previewSourceStartSec) || track.previewSourceStartSec < 0))) {
      throw new Error('INVALID_CATALOG');
    }
    seen.add(track.id);
    // Reconstruct canonical same-origin URLs, never trust a URL from JSON.
    return { id: track.id, title: track.title, creatorName: track.creatorName, durationSec: track.durationSec,
      audioVersion: track.audioVersion, policyVersion: track.policyVersion, effectiveAccess: track.effectiveAccess,
      previewAvailable: track.previewAvailable, previewDurationSec: track.previewDurationSec,
      previewSourceStartSec: track.previewSourceStartSec,
      coverUrl: track.coverUrl ? `/api/music/tracks/${track.id}/cover?v=${track.audioVersion}` : null };
  });
}
export function playerVariant(track, capabilities) {
  if (track.effectiveAccess === 'free') return 'full';
  if (capabilities?.canPlayVipFull === true && capabilities?.musicVipDeliveryEnabled === true && capabilities?.membershipStatus === 'active') return 'full';
  return track.previewAvailable ? 'preview' : null;
}
export function formatMusicTime(value) {
  if (!Number.isFinite(value) || value < 0) return '--:--';
  const seconds = Math.floor(value);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
