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
    const optionalText = (key, max) => {
      if (track[key] === undefined) return '';
      if (typeof track[key] !== 'string' || track[key].length > max || /[\u0000-\u001f\u007f]/.test(track[key])) throw new Error('INVALID_CATALOG');
      return track[key];
    };
    const tags = key => {
      if (track[key] === undefined) return [];
      if (!Array.isArray(track[key]) || track[key].length > 12 || track[key].some(value => !text(value, 40))) throw new Error('INVALID_CATALOG');
      return [...new Set(track[key])];
    };
    const publishedAt = optionalText('publishedAt', 30);
    if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) throw new Error('INVALID_CATALOG');
    if (track.instrumental !== undefined && typeof track.instrumental !== 'boolean') throw new Error('INVALID_CATALOG');
    if (track.lyricsKind !== undefined && !['none', 'txt', 'lrc'].includes(track.lyricsKind)) throw new Error('INVALID_CATALOG');
    seen.add(track.id);
    // Reconstruct canonical same-origin URLs, never trust a URL from JSON.
    return { summary: optionalText('summary', 500), genres: tags('genres'), moods: tags('moods'), publishedAt,
      instrumental: track.instrumental === true, lyricsKind: track.lyricsKind || 'none',
      id: track.id, title: track.title, creatorName: track.creatorName, durationSec: track.durationSec,
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

export function readPlayerCollections(body, tracks) {
  if (body.collections === undefined) return [];
  if (!Array.isArray(body.collections) || body.collections.length > 500) throw new Error('INVALID_COLLECTIONS');
  const ids = new Map(tracks.map(track => [track.id,track])), seen = new Set(), slugs = new Set();
  return body.collections.map(item => {
    if (!item || !idPattern.test(item.id) || seen.has(item.id) || slugs.has(item.slug) ||
      typeof item.slug !== 'string' || item.slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
      !text(item.title, 200) || typeof item.description !== 'string' || item.description.length > 500 ||
      !Array.isArray(item.trackIds) || item.trackIds.length > 500 || new Set(item.trackIds).size !== item.trackIds.length ||
      item.trackIds.some(id => !idPattern.test(id))) throw new Error('INVALID_COLLECTIONS');
    const type = item.type === undefined ? 'playlist' : item.type;
    const listeningMode = item.listeningMode ?? 'mixed';
    if (!['playlist','album'].includes(type) || !['mixed','free','vip'].includes(listeningMode) ||
      (type === 'album' && (item.trackIds.some(id => !ids.has(id)) ||
        (listeningMode !== 'mixed' && item.trackIds.some(id => ids.get(id).effectiveAccess !== listeningMode)) ||
        (item.coverTrackId != null && (!item.trackIds.includes(item.coverTrackId) || !ids.get(item.coverTrackId)?.coverUrl))))) throw new Error('INVALID_COLLECTIONS');
    seen.add(item.id); slugs.add(item.slug);
    return { id: item.id, slug: item.slug, title: item.title, description: item.description, type, listeningMode,
      coverUrl:type === 'album' ? ids.get(item.coverTrackId)?.coverUrl || null : null,
      trackIds: item.trackIds.filter(id => ids.has(id)) };
  }).filter(item => item.trackIds.length);
}
