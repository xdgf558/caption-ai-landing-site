const prefix = '/api/music/__share-card-files/';

// The key binds the offline raster to exactly the currently published copy and cover.
export async function stationMusicShareAssetPath(target, kind, slug, locale) {
  const identity = JSON.stringify(['station-music-share-3-v1', kind, slug, locale,
    target.title, target.artist || '', target.description || '', target.cover?.sha256 || null]);
  const bytes = new TextEncoder().encode(identity);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  return prefix + digest + '.png';
}

// Static asset routing decodes aliases; reserve this directory before any dispatch.
export function isStationMusicShareAssetPath(pathname) {
  let value = pathname;
  for (let i = 0; i < 4; i++) {
    if (/(?:^|\/)__share-card-files(?:\/|$)/.test(value.replaceAll('\\', '/'))) return true;
    try { const next = decodeURIComponent(value); if (next === value) break; value = next; }
    catch { break; }
  }
  return false;
}
