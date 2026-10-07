import { stationHref, stationLocales } from './routes.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100;
const integer = value => Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const plain = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const providers = { netease: 'music', qishui: 'headphones', apple_music: 'apple', youtube: 'youtube', spotify: 'spotify' };

function localized(value, locale, original, max, required = true) {
  if (!object(value) || !stationLocales.includes(original)) return null;
  const source = value[original];
  if (!plain(source, max) && (required || source !== '')) return null;
  return plain(value[locale], max) ? value[locale] : value[original];
}

// Reject ambiguous IDs rather than selecting whichever row happened to arrive first.
function index(records, key = 'id') {
  const found = new Map();
  if (!Array.isArray(records)) return found;
  for (const item of records) {
    if (!object(item) || !uuid(item[key])) continue;
    const id = item[key].toLowerCase();
    found.set(id, found.has(id) ? null : item);
  }
  return found;
}
const get = (map, id) => uuid(id) ? map.get(id.toLowerCase()) : null;
const ids = values => Array.isArray(values) ? [...new Set(values.filter(uuid).map(id => id.toLowerCase()))] : [];
const published = (record, now) => record?.status === 'published' && time(record.publishedAt) && Date.parse(record.publishedAt) <= now;

function publicUrl(value, fixture, kind) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  if (fixture && /^\/__home-fixture\/platform\/(?:netease|qishui|apple_music|youtube|spotify)\/$/.test(value) && kind === 'platform') return value;
  if (fixture && /^\/preview-assets\/gentle-station\/(?:hero|music-cover|game-cover|daily)\.webp$/.test(value) && kind === 'image') return value;
  if (kind === 'image' && /^\/images\/[a-z0-9/_-]+\.(?:png|jpe?g|webp)$/i.test(value) && !value.includes('..')) return value;
  if (kind === 'image' && /^\/api\/music\/tracks\/[a-f0-9-]{36}\/cover\?v=[1-9]\d*$/.test(value)) return value;
  if (kind === 'image' && /^\/api\/station\/content\/assets\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') ||
      /(?:^|\.)(?:localhost|local|invalid|test|example)$/.test(url.hostname) ||
      [...url.searchParams.keys()].some(key => /token|secret|credential|signature|authorization|x-amz/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

/**
 * T05 frontend projection of public records, not an authorization or D1 query layer.
 * T07 must enforce publication/resource rights on the server before supplying these records.
 * Fixture-only URLs require BOTH an explicit option and a fixture-marked config.
 */
export function buildHomeView({ config, content, locale = 'zh-Hant', now = new Date().toISOString(), fixture = false }) {
  if (!stationLocales.includes(locale) || !time(now)) throw new TypeError('Invalid home locale or clock');
  const clock = Date.parse(now);
  const isFixture = fixture === true && config?.environment === 'fixture';
  const view = { locale, configId: uuid(config?.id) ? config.id : null, publishedRevision: null,
    fixture: isFixture, music: null, selectedTracks: [], clips: [], game: null, updates: [] };
  if (!object(config) || !uuid(config.id) || !integer(config.revision) ||
    config.publishedRevision !== config.revision || !published(config, clock)) return view;
  // A synthetic config is never valid in a normal consumer.
  if (config.environment === 'fixture' && !isFixture) return view;
  view.publishedRevision = config.publishedRevision;
  content = object(content) ? content : {};
  const tracks = index(content.tracks), promotions = index(content.promotions, 'trackId');
  const assets = index(content.assets), platforms = index(content.platforms), clips = index(content.clips);
  const games = index(content.games), updates = index(content.updates);
  const prefix = locale === 'zh-Hant' ? '' : locale === 'zh-Hans' ? '/zh-hans' : `/${locale}`;

  function image(id, ownerId, kind) {
    const asset = get(assets, id);
    if (!asset || asset.ownerId !== ownerId || asset.kind !== kind || asset.state !== 'ready' ||
      asset.visibility !== 'public' || asset.rightsConfirmed !== true) return null;
    return publicUrl(asset.url, isFixture, 'image');
  }
  function track(id) {
    const record = get(tracks, id);
    if (!published(record, clock) || !slug(record.slug) || !plain(record.artist, 120)) return null;
    const title = localized(record.title, locale, record.originalLocale, 200);
    const summary = localized(record.summary, locale, record.originalLocale, 500, false);
    const coverUrl = image(record.coverAssetId, record.id, 'cover');
    if (!title || summary === null || !coverUrl) return null;
    return { id: record.id, title, artist: record.artist, summary, coverUrl, href: `${prefix}/music/tracks/${record.slug}/` };
  }
  const promotion = get(promotions, config.featuredTrackId);
  const primary = track(config.featuredTrackId);
  if (primary && published(promotion, clock) && integer(promotion.revision) && promotion.enabled === true) {
    const links = ids(promotion.selectedPlatformLinkIds).map(id => get(platforms, id)).filter(link =>
      link && link.trackId === primary.id && Object.hasOwn(providers, link.provider) && link.status === 'live' &&
      time(link.verifiedAt) && Date.parse(link.verifiedAt) <= clock && publicUrl(link.url, isFixture, 'platform'))
      .map(link => ({ id: link.id, provider: link.provider, icon: providers[link.provider], href: publicUrl(link.url, isFixture, 'platform') }));
    const asset = get(assets, promotion.previewAssetId);
    const previewReady = promotion.previewEnabled === true && asset && asset.ownerId === primary.id &&
      asset.kind === 'preview' && asset.state === 'ready' && asset.visibility === 'public' && asset.rightsConfirmed === true &&
      Number.isFinite(asset.durationSec) && asset.durationSec > 0;
    // Only the duration/navigation affordance is output. No audio URL or storage key is exposed.
    view.music = { ...primary, promotionRevision: promotion.revision, platforms: links,
      preview: previewReady ? { durationSec: asset.durationSec, href: `${primary.href}#preview` } : null };
  }
  view.selectedTracks = ids(config.selectedTrackIds).filter(id => get(tracks, id)?.id !== view.music?.id).map(track).filter(Boolean).slice(0, 3);

  const game = get(games, config.featuredGameId);
  // cat-life is the existing runtime namespace, never an introduction slug.
  if (published(game, clock) && slug(game.slug) && game.slug !== 'cat-life') {
    const title = localized(game.title, locale, game.originalLocale, 200);
    const summary = localized(game.summary, locale, game.originalLocale, 500, false);
    const screenshotUrl = image(game.screenshotAssetId, game.id, 'game_screenshot');
    if (title && summary !== null && screenshotUrl) view.game = { id: game.id, title, summary, screenshotUrl,
      href: `${prefix}/games/${game.slug}/` };
  }
  // Home and promotion both select the clip. Revoked parents/assets immediately disappear on rebuild.
  if (view.music) {
    const allowed = new Set(ids(promotion.selectedClipIds));
    view.clips = ids(config.selectedClipIds).filter(id => allowed.has(id)).map(id => {
      const clip = get(clips, id);
      if (!published(clip, clock) || clip.type !== 'short_video' || clip.trackId !== view.music.id ||
        !Number.isFinite(clip.durationSec) || clip.durationSec <= 0) return null;
      const title = localized(clip.title, locale, clip.originalLocale, 200);
      const posterUrl = image(clip.posterAssetId, clip.id, 'poster');
      const media = get(assets, clip.mediaAssetId);
      if (!title || !posterUrl || media?.ownerId !== clip.id || media.kind !== 'short_video' ||
        media.state !== 'ready' || media.visibility !== 'public' || media.rightsConfirmed !== true) return null;
      return { id: clip.id, title, posterUrl, durationSec: clip.durationSec, trackId: clip.trackId,
        href: `${view.music.href}#clip-${clip.id}` };
    }).filter(Boolean).slice(0, 4);
  }
  view.updates = ids(config.selectedUpdateIds).map(id => {
    const update = get(updates, id);
    if (!published(update, clock) || !['music', 'games', 'life'].includes(update.kind)) return null;
    const title = localized(update.title, locale, update.originalLocale, 200);
    const summary = localized(update.summary, locale, update.originalLocale, 500);
    const target = update.kind === 'music' ? track(update.targetId) : update.kind === 'games' && view.game?.id === update.targetId ? view.game : null;
    if (!title || !summary || (update.kind !== 'life' && !target)) return null;
    const imageUrl = update.kind === 'life' ? image(update.coverAssetId, update.id, 'cover') : target.coverUrl || target.screenshotUrl;
    if (!imageUrl) return null;
    return { id: update.id, kind: update.kind, title, summary, imageUrl,
      href: update.kind === 'life' ? stationHref(locale, 'about') : target.href };
  }).filter(Boolean).slice(0, 3);
  return view;
}
