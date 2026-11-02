import { checkedContentRuntime, contentTrack, requestDeadline } from './publicStore.js';
import { projectTrack } from './publicContent.js';
import { resourceReady } from './publicResources.js';
import { buildPublicCatalog } from '../music/catalog.js';
import { loadPublicMusicCollectionSnapshot } from '../music/publicStore.js';
import { checkAssetIdentity, checkStoredObject } from '../music/resources.js';
import { checkMusicRateLimit } from '../music/rateLimits.js';
import { cancelBody } from '../music/storage.js';
import { MUSIC_SHARE_FONT, MUSIC_SHARE_FONT_BYTES, MUSIC_SHARE_FONT_SHA256 } from '../music/shareCard.js';
import { readMusicShareBytes } from '../music/shareCardHttp.js';
import { stationAppStoreUrl } from './iphoneApp.js';

const origin = 'https://wwwstationcat.org';
const route = /^\/music\/share\/(tracks|albums)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(card\.png|cover\.png))?\/?$/;
const locales = ['zh-Hans', 'zh-Hant', 'en', 'ja'];
const e = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const headers = { 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Robots-Tag':'noindex, nofollow' };
const labels = {
  'zh-Hans': { track:'单曲', album:'专辑', download:'在 App Store 下载', brand:'Station Cat Music' },
  'zh-Hant': { track:'單曲', album:'專輯', download:'在 App Store 下載', brand:'Station Cat Music' },
  en: { track:'Single', album:'Album', download:'Download on the App Store', brand:'Station Cat Music' },
  ja: { track:'シングル', album:'アルバム', download:'App Store でダウンロード', brand:'Station Cat Music' }
};

export const isStationMusicSharePath = pathname => route.test(pathname);
function response(request, status, body = '', extra = {}) {
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: { ...headers, ...extra } });
}
function safeDescription(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
}
async function loadShareTarget(request, env, kind, slug, locale, now, run) {
  const runtime = await run(() => checkedContentRuntime(env));
  if (kind === 'tracks') {
    const row = await run(() => contentTrack(runtime.session, now, { slug }));
    const result = await run(() => projectTrack(runtime, row, { locale, now, country:'US', run }));
    if (!result || result.dto.slug !== slug) return null;
    // The published summary takes precedence. Many releases have no summary
    // but do have a published story, which is also an authentic introduction.
    const description = safeDescription(result.dto.summary) || safeDescription(result.meta.story);
    return { title: result.dto.title, artist: result.dto.artist, description,
      kind:'track', cover: result.ready.get(row.cover_asset_id) || null, bucket:runtime.bucket };
  }
  const snapshot = await run(() => loadPublicMusicCollectionSnapshot(runtime.db, slug, now));
  const catalog = await run(() => buildPublicCatalog({ ...snapshot, locale, now }));
  const album = catalog.body.collections.find(item => item.slug === slug && item.type === 'album');
  if (!album) return null;
  const raw = snapshot.collections.find(item => item.collection.id === album.id);
  if (!raw || !Number.isSafeInteger(raw.collection.updated_at) || raw.collection.updated_at > now) return null;
  const cover = album.coverUrl ? raw.coverAsset : null;
  if (cover) {
    checkAssetIdentity(cover);
    if (!await resourceReady(runtime, cover, run)) throw new Error('COVER_UNAVAILABLE');
  }
  return { title: album.title, artist:'', description:safeDescription(album.description), kind:'album', cover, bucket:runtime.bucket };
}
async function checkedImage(bucket, asset) {
  const object = await bucket.get(asset.object_key, { onlyIf: { etagMatches:asset.etag } });
  try {
    checkStoredObject(object, asset);
    const bytes = await readMusicShareBytes(object.body, asset.byte_size, 5242880);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
    if (digest !== asset.sha256) throw new Error('COVER_CHANGED');
    const { normalizeMusicCardCover } = await import('../music/shareCardRender.js');
    return normalizeMusicCardCover(bytes, asset.content_type);
  } finally { cancelBody(object); }
}
async function fontBytes(env) {
  if (!env.ASSETS?.fetch) throw new Error('FONT_UNAVAILABLE');
  const font = await env.ASSETS.fetch(new Request(origin + MUSIC_SHARE_FONT));
  try {
    if (font.status !== 200) throw new Error('FONT_UNAVAILABLE');
    const bytes = await readMusicShareBytes(font.body, MUSIC_SHARE_FONT_BYTES, MUSIC_SHARE_FONT_BYTES);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
    if (digest !== MUSIC_SHARE_FONT_SHA256) throw new Error('FONT_CHANGED');
    return bytes;
  } finally { cancelBody(font); }
}

export function musicShareHtml(target, kind, slug, locale) {
  const copy = labels[locale], path = `/music/share/${kind}/${slug}/`, query = new URLSearchParams({locale}).toString();
  const url = origin + path + '?' + query, image = origin + path + 'card.png?' + query;
  const title = target.title + (target.artist ? ` · ${target.artist}` : '') + ' | Station Cat Music';
  const description = target.description;
  const meta = { 'og:type':'website', 'og:site_name':copy.brand, 'og:title':title, 'og:url':url,
    'og:image':image, 'og:image:type':'image/png', 'og:image:width':'1200', 'og:image:height':'1500', 'og:image:alt':target.title,
    ...(description ? { 'og:description':description } : {}) };
  const twitter = { 'twitter:card':'summary_large_image', 'twitter:title':title, 'twitter:image':image,
    'twitter:image:alt':target.title, ...(description ? { 'twitter:description':description } : {}) };
  return `<!doctype html><html lang="${e(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(title)}</title><link rel="canonical" href="${e(url)}">` +
    Object.entries(meta).map(([k,v]) => `<meta property="${e(k)}" content="${e(v)}">`).join('') +
    Object.entries(twitter).map(([k,v]) => `<meta name="${e(k)}" content="${e(v)}">`).join('') +
    `</head><body style="margin:0;background:#eeedf5;color:#101a4a;font-family:system-ui,sans-serif"><main style="max-width:720px;margin:auto;padding:32px 20px"><img src="${e(image)}" alt="${e(target.title)}" style="display:block;width:100%;border-radius:16px"><p>${e(copy[target.kind])}</p><h1>${e(target.title)}</h1>${target.artist ? `<p>${e(target.artist)}</p>` : ''}${description ? `<p style="white-space:pre-wrap">${e(description)}</p>` : ''}<a href="${e(stationAppStoreUrl)}" rel="noopener noreferrer" style="display:inline-block;padding:14px 24px;border-radius:32px;background:#111b4d;color:white;text-decoration:none">${e(copy.download)}</a></main></body></html>`;
}

export async function handleStationMusicShare(request, env, { clock = Date.now, deadlineMs = 10000, load = loadShareTarget, render = null } = {}) {
  const url = new URL(request.url), match = route.exec(url.pathname);
  if (!match || match[2].length > 100 || (match[3] === 'cover.png' && match[1] !== 'albums')) return response(request, 404);
  if (!['GET','HEAD'].includes(request.method)) return response(request, 405, '', { Allow:'GET, HEAD' });
  if ([...url.searchParams.keys()].some(key => key !== 'locale' || url.searchParams.getAll(key).length !== 1)) return response(request, 400);
  const locale = url.searchParams.get('locale') || 'zh-Hans';
  if (!locales.includes(locale)) return response(request, 400);
  if (env.STATION_MUSIC_SHARE_ENABLED !== 'true' || ![true, 'true'].includes(env.STATION_CONTENT_PUBLIC_ENABLED)) return response(request, 503);
  const run = requestDeadline(deadlineMs), now = clock();
  try {
    const limited = await run(() => checkMusicRateLimit(request, env, match[3] ? 'share' : 'catalog', { clock:() => now }));
    if (limited) return response(request, limited.status, '', { 'Retry-After':String(limited.retryAfter) });
    const target = await run(() => load(request, env, match[1], match[2], locale, now, run));
    if (!target) return response(request, 404);
    if (!match[3]) return response(request, 200, musicShareHtml(target, match[1], match[2], locale), { 'Content-Type':'text/html; charset=utf-8', 'Content-Security-Policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" });
    if (match[3] === 'cover.png' && !target.cover) return response(request, 404);
    if (request.method === 'HEAD') return response(request, 200, '', { 'Content-Type':'image/png' });
    const cover = target.cover ? await run(() => checkedImage(target.bucket, target.cover)) : null;
    if (match[3] === 'cover.png') {
      const { stationShareCoverThumbnail } = await import('./musicShareRender.js');
      const thumbnail = stationShareCoverThumbnail(cover);
      return response(request, 200, thumbnail, { 'Content-Type':'image/png', 'Content-Length':String(thumbnail.length) });
    }
    const font = await run(() => fontBytes(env));
    const iconResponse = await run(() => env.ASSETS.fetch(new Request(origin + '/images/station-music-app/icon.webp')));
    let icon;
    try {
      if (iconResponse.status !== 200) throw new Error('ICON_UNAVAILABLE');
      icon = await readMusicShareBytes(iconResponse.body, 6912, 6912);
      const iconHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', icon)), b => b.toString(16).padStart(2,'0')).join('');
      if (iconHash !== '09982b6d542f43087aa196e15c17bdd2640ea0bb2a2d56eadbc6118fa5cae9de') throw new Error('ICON_CHANGED');
    } finally { cancelBody(iconResponse); }
    const renderer = render || (await import('./musicShareRender.js')).renderStationMusicShareCard;
    const image = await run(() => renderer(target, labels[locale], cover, font, icon));
    return response(request, 200, image, { 'Content-Type':'image/png', 'Content-Length':String(image.length) });
  } catch { return response(request, 503); }
}
