import { stationHomeConfig } from '../data/station-home.js';
import { buildHomeView } from './home.js';
import { uuid, slug, positive, millis, metadata, strictJson, idList, platform, platformUrl, contentBase, localizedPath } from './publicValidation.js';
import { assetPath, publicAssetIdentity, previewIdentity, resourceReady } from './publicResources.js';
import { publishedHome, contentTrack, contentClip, contentGame } from './publicStore.js';

function jsonRows(source, max) {
  try {
    const rows = strictJson(source, 131072);
    if (!Array.isArray(rows) || rows.length > max || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return null;
    return rows;
  } catch { return null; }
}
const iso = value => new Date(value).toISOString();
function assetRows(source, max) {
  const rows = jsonRows(source, max);
  return rows && rows.every(row => uuid(row.id)) && new Set(rows.map(row => row.id.toLowerCase())).size === rows.length ? rows : null;
}
const current = (row, now) => row && uuid(row.id) && positive(row.published_revision) && millis(row.published_at) && row.published_at <= now;
export function promotion(row, now) {
  if (!positive(row?.promotion_revision) || !millis(row.promotion_at) || row.promotion_at > now || row.enabled !== 1) return null;
  try {
    return { trackId: row.id, revision: row.promotion_revision, publishedAt: iso(row.promotion_at),
      selectedPlatformLinkIds: idList(row.selected_platform_ids_json), selectedClipIds: idList(row.selected_clip_ids_json),
      previewEnabled: row.preview_enabled === 1, previewAssetId: row.preview_asset_id };
  } catch { return null; }
}
export async function projectTrack(runtime, row, options, { detailed = false } = {}) {
  const { locale, now, country, run } = options;
  if (!current(row, now) || !slug(row.slug)) return null;
  const meta = metadata(row.metadata_json, locale, { artist: true });
  const assets = assetRows(row.assets_json, 4), rawLinks = jsonRows(row.platforms_json, 25);
  if (!meta || !assets || !rawLinks || new Set(rawLinks.map(link => link.id)).size !== rawLinks.length) return null;
  const ready = new Map();
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  for (const kind of detailed ? ['cover', 'lyrics'] : ['cover']) {
    const asset = byId.get(row[kind + '_asset_id']);
    if (publicAssetIdentity(asset, { ownerId: row.id, kind, now }) && await resourceReady(runtime, asset, run)) ready.set(asset.id, asset);
  }
  const promo = promotion(row, now);
  let preview = null;
  if (promo?.previewEnabled) {
    const asset = byId.get(promo.previewAssetId), source = byId.get(asset?.derived_from_asset_id);
    if (previewIdentity(asset, source, row.id, now) && await resourceReady(runtime, asset, run)) {
      ready.set(asset.id, asset);
      preview = { durationMs: asset.duration_ms, revision: promo.revision,
        playbackPath: contentBase + '/tracks/' + row.slug + '/playback?variant=preview' };
    }
  }
  const links = rawLinks.filter(link => link.track_id === row.id).map(link => platform(link, country, now)).filter(Boolean);
  const releases = links.map(link => link.releasedAt).filter(Boolean).sort();
  // A release date is global operator metadata, independent of which HTTPS
  // buttons apply to this visitor. It never makes an invalid URL clickable.
  const globalDates = rawLinks.filter(link => link.track_id === row.id && link.status === 'live' &&
    millis(link.verified_at) && link.verified_at <= now && millis(link.external_released_at) && link.external_released_at <= now)
    .map(link => link.external_released_at);
  // No spread of metadata/DB rows. In particular, site_audio_mode, legacy
  // versions, private full-audio URLs, storage keys and rights text stay inside.
  const dto = {
    id: row.id, slug: row.slug, revision: row.published_revision, originalLocale: meta.originalLocale,
    title: meta.title, artist: meta.artist, summary: meta.summary,
    publishedAt: iso(row.published_at), releasedAt: releases[0] || null,
    catalogReleasedAt: globalDates.length ? iso(Math.min(...globalDates)) : null,
    durationMs: positive(row.duration_ms) ? row.duration_ms : null,
    href: localizedPath(locale, 'music/tracks', row.slug),
    coverUrl: ready.has(row.cover_asset_id) ? assetPath(ready.get(row.cover_asset_id)) : null,
    preview,
    // This is only a permission handshake, never an audio URL or a free/VIP
    // grant. The private endpoint rechecks the existing reader policy and R2.
    fullPlayback: runtime.flags.public && row.existing_full_reference === 1 &&
      ['free_full', 'existing_entitlement'].includes(row.site_audio_mode)
      ? { playbackPath: contentBase + '/tracks/' + row.slug + '/playback?variant=full', requiresAccessCheck: true } : null,
    platforms: links.map(link => ({ id: link.id, provider: link.provider, status: link.status, href: link.href,
      verifiedAt: link.verifiedAt, releasedAt: link.releasedAt }))
  };
  if (detailed) {
    dto.story = meta.story;
    dto.lyricsUrl = ready.has(row.lyrics_asset_id) ? assetPath(ready.get(row.lyrics_asset_id)) : null;
    dto.lyricsKind = ready.has(row.lyrics_asset_id) ? ready.get(row.lyrics_asset_id).format : null;
  }
  return { dto, ready, meta, promotion: promo, links };
}
export async function projectClip(runtime, row, options) {
  const { locale, now, run } = options;
  if (!current(row, now) || !uuid(row.track_id) || !slug(row.track_slug) || !['short_video', 'mv'].includes(row.type)) return null;
  const meta = metadata(row.metadata_json, locale);
  const parent = metadata(row.parent_metadata_json, locale, { artist: true });
  const assets = assetRows(row.assets_json, 2), publications = jsonRows(row.publications_json, 10);
  if (!meta || !parent || !assets || !publications || !millis(row.parent_published_at) || row.parent_published_at > now) return null;
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const video = byId.get(row.media_asset_id), poster = byId.get(row.poster_asset_id);
  if (!publicAssetIdentity(video, { ownerId: row.id, kind: row.type, now, media: true }) ||
    !publicAssetIdentity(poster, { ownerId: row.id, kind: 'poster', now, media: true }) ||
    row.duration_ms !== video.duration_ms || !await resourceReady(runtime, poster, run) || !await resourceReady(runtime, video, run)) return null;
  const publishedLinks = publications.filter(item => millis(item.external_published_at) && item.external_published_at <= now)
    .map(item => ({ channel: item.channel, href: platformUrl(item.post_url, item.channel), publishedAt: iso(item.external_published_at) }))
    .filter(item => item.href);
  const dto = { id: row.id, trackId: row.track_id, revision: row.published_revision, type: row.type,
    originalLocale: meta.originalLocale, title: meta.title, summary: meta.summary,
    durationMs: row.duration_ms, publishedAt: iso(row.published_at),
    posterUrl: assetPath(poster), mediaUrl: assetPath(video), publications: publishedLinks,
    track: { id: row.track_id, title: parent.title, href: localizedPath(locale, 'music/tracks', row.track_slug) } };
  return { dto, ready: new Map([[video.id, video], [poster.id, poster]]), meta };
}
export async function projectGame(runtime, row, options) {
  const { locale, now, run } = options;
  if (!current(row, now) || !slug(row.slug) || row.slug === 'cat-life') return null;
  const meta = metadata(row.metadata_json, locale), assets = assetRows(row.assets_json, 10);
  let ids, devices;
  try {
    ids = idList(row.screenshot_ids_json, 10);
    devices = strictJson(row.supported_devices_json, 2048);
    if (!Array.isArray(devices) || devices.length > 10 || new Set(devices).size !== devices.length ||
      devices.some(device => typeof device !== 'string' || !device.trim() || device.length > 80 || /[\u0000-\u001f\u007f]/.test(device))) return null;
  } catch { return null; }
  if (!meta || !assets) return null;
  const ready = new Map(), byId = new Map(assets.map(asset => [asset.id, asset]));
  for (const id of ids) {
    const asset = byId.get(id);
    if (publicAssetIdentity(asset, { ownerId: row.id, kind: 'game_screenshot', now, media: true }) && await resourceReady(runtime, asset, run)) ready.set(id, asset);
  }
  // Only this already-existing runtime is registered. An arbitrary stored local
  // URL is not proof of a runnable game, save support or a new launch namespace.
  const launchPath = row.runtime_key === 'cat-life' && row.launch_url === '/games/cat-life/' ? '/games/cat-life/' : null;
  return { dto: { id: row.id, slug: row.slug, revision: row.published_revision, originalLocale: meta.originalLocale,
    title: meta.title, summary: meta.summary, publishedAt: iso(row.published_at),
    href: localizedPath(locale, 'games', row.slug), launchPath, supportedDevices: devices,
    screenshots: ids.filter(id => ready.has(id)).map(id => ({ id, url: assetPath(ready.get(id)) })) }, ready, meta };
}

function homeAsset(asset) {
  return { id: asset.id, ownerId: asset.owner_track_id || asset.owner_clip_id || asset.owner_game_id,
    kind: asset.kind, state: 'ready', visibility: 'public', rightsConfirmed: true,
    ...(asset.kind === 'preview' ? { durationSec: asset.duration_ms / 1000 } : { url: assetPath(asset) }) };
}
export async function publicHome(runtime, options) {
  const { now, locale, run } = options;
  const row = await run(() => publishedHome(runtime.session, now));
  const empty = () => buildHomeView({ config: stationHomeConfig, content: {}, locale, now: iso(now) });
  if (!current(row, now)) return empty();
  let selectedTrackIds, selectedClipIds;
  try {
    selectedTrackIds = idList(row.selected_track_ids_json, 3);
    selectedClipIds = idList(row.selected_clip_ids_json, 4);
    idList(row.selected_update_ids_json, 3); // No article/life source exists yet.
  } catch { return empty(); }
  const config = { id: row.id, revision: row.published_revision, publishedRevision: row.published_revision,
    status: 'published', publishedAt: iso(row.published_at),
    featuredTrackId: uuid(row.featured_track_id) ? row.featured_track_id : null,
    featuredGameId: uuid(row.featured_game_id) ? row.featured_game_id : null,
    selectedTrackIds, selectedClipIds, selectedUpdateIds: [] };
  const content = { tracks: [], promotions: [], assets: [], platforms: [], clips: [], games: [], updates: [] };
  const seenAssets = new Set();
  function addAssets(projection) {
    for (const asset of projection.ready.values()) if (!seenAssets.has(asset.id)) {
      seenAssets.add(asset.id); content.assets.push(homeAsset(asset));
    }
  }
  for (const id of [...new Set([config.featuredTrackId, ...selectedTrackIds].filter(Boolean))]) {
    const record = await run(() => contentTrack(runtime.session, now, { id }));
    const projected = await projectTrack(runtime, record, options);
    if (!projected) continue;
    const { dto, meta, promotion: promo } = projected;
    content.tracks.push({ id: dto.id, slug: dto.slug, title: meta.titleMap,
      summary: { [meta.originalLocale]: '', ...meta.summaryMap }, originalLocale: meta.originalLocale,
      artist: dto.artist, status: 'published', publishedAt: dto.publishedAt, coverAssetId: record.cover_asset_id });
    if (promo) content.promotions.push({ ...promo, status: 'published', enabled: true });
    content.platforms.push(...projected.links.map(link => ({ id: link.id, trackId: link.trackId,
      provider: link.provider, status: 'live', url: link.href, verifiedAt: link.verifiedAt })));
    addAssets(projected);
  }
  for (const id of selectedClipIds) {
    const record = await run(() => contentClip(runtime.session, now, id));
    const projected = await projectClip(runtime, record, options);
    if (!projected) continue;
    const { dto, meta } = projected;
    content.clips.push({ id: dto.id, trackId: dto.trackId, type: dto.type, title: meta.titleMap,
      originalLocale: meta.originalLocale, status: 'published', publishedAt: dto.publishedAt,
      durationSec: dto.durationMs / 1000, mediaAssetId: record.media_asset_id, posterAssetId: record.poster_asset_id });
    addAssets(projected);
  }
  if (config.featuredGameId) {
    const record = await run(() => contentGame(runtime.session, now, { id: config.featuredGameId }));
    const projected = await projectGame(runtime, record, options);
    if (projected) {
      const { dto, meta } = projected;
      content.games.push({ id: dto.id, slug: dto.slug, title: meta.titleMap,
        summary: { [meta.originalLocale]: '', ...meta.summaryMap }, originalLocale: meta.originalLocale,
        status: 'published', publishedAt: dto.publishedAt, screenshotAssetId: dto.screenshots[0]?.id || null });
      addAssets(projected);
    }
  }
  return buildHomeView({ config, content, locale, now: iso(now) });
}
