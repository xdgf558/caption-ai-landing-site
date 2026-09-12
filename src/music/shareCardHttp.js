import { projectPublicTrack } from './catalog.js';
import { checkAssetIdentity, checkStoredObject } from './resources.js';
import { loadPublishedMusicRecord } from './publicStore.js';
import { musicRuntime } from './runtime.js';
import { checkMusicRateLimit } from './rateLimits.js';
import { boundedBody, cancelBody } from './storage.js';
import { MUSIC_LOCALES } from './policy.js';
import { validMusicId } from './publicationValidation.js';
import { MUSIC_SHARE_FONT, MUSIC_SHARE_FONT_BYTES, MUSIC_SHARE_FONT_SHA256, musicShareCardData, MUSIC_SHARE_FORMATS } from './shareCard.js';

const path = /^\/api\/music\/tracks\/([^/]+)\/share\.png$/;
export const isMusicShareCardPath = pathname => path.test(pathname);
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
const failure = (request, status, code, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: { code } }), {
  status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra }
});

export async function readMusicShareBytes(body, expected, maxBytes) {
  if (!body || !Number.isSafeInteger(expected) || expected < 1 || expected > maxBytes) { cancelBody({ body }); throw new Error('SHARE_INPUT_INVALID'); }
  const input = boundedBody(body), reader = input.stream.getReader(), bytes = new Uint8Array(expected);
  let timer, offset = 0, reads = 0;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { input.close(); reject(new Error('SHARE_READ_TIMEOUT')); }, 5000); });
  try {
    while (true) {
      if (++reads > 65536) throw new Error('SHARE_READ_BUDGET');
      const { done, value } = await Promise.race([reader.read(), deadline]); if (done) break;
      if (offset + value.length > expected) throw new Error('SHARE_INPUT_TOO_LARGE');
      bytes.set(value, offset); offset += value.length;
    }
    if (offset !== expected) throw new Error('SHARE_INPUT_TRUNCATED');
    return bytes;
  } finally { clearTimeout(timer); input.close(); }
}
async function bounded(task, cancel = () => {}, ms = 5000) {
  let timer, stopped = false;
  const pending = Promise.resolve().then(task);
  pending.then(value => { if (stopped) cancel(value); }, () => {});
  try { return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SHARE_TIMEOUT')), ms); })]); }
  finally { stopped = true; clearTimeout(timer); }
}
async function coverBytes(bucket, asset, normalize) {
  const object = await bounded(() => bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } }), cancelBody);
  try {
    checkStoredObject(object, asset);
    const bytes = await readMusicShareBytes(object.body, asset.byte_size, 5242880);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw new Error('SHARE_COVER_CHANGED');
    return normalize(bytes, asset.content_type);
  } finally { cancelBody(object); }
}

export async function handleMusicShareCard(request, env, { clock = Date.now, render = null } = {}) {
  const url = new URL(request.url), match = path.exec(url.pathname);
  if (!match) return failure(request, 404, 'NOT_FOUND');
  if (!['GET', 'HEAD'].includes(request.method)) return failure(request, 405, 'METHOD_NOT_ALLOWED', { Allow: 'GET, HEAD' });
  const locale = url.searchParams.get('locale'), version = url.searchParams.get('v'), format = url.searchParams.get('format');
  if (!validMusicId(match[1]) || !MUSIC_LOCALES.includes(locale) || !/^[1-9][0-9]*$/.test(version || '') || !Number.isSafeInteger(Number(version)) ||
    !Object.hasOwn(MUSIC_SHARE_FORMATS, format) || [...url.searchParams.keys()].sort().join(',') !== 'format,locale,v') return failure(request, 400, 'INVALID_INPUT');
  // Flags before runtime, source counters, publication, R2, fonts or WASM work.
  if (env.MUSIC_PUBLIC_ENABLED !== 'true') return failure(request, 503, 'MUSIC_PUBLIC_DISABLED');
  if (env.MUSIC_SHARE_CARDS_ENABLED !== 'true') return failure(request, 503, 'MUSIC_SHARE_CARDS_DISABLED');
  const now = clock(), limited = await checkMusicRateLimit(request, env, 'artwork', { clock: () => now, ceiling: { source: 6, global: 120 } });
  if (limited) return failure(request, limited.status, limited.code, { 'Retry-After': String(limited.retryAfter) });
  try {
    const runtime = musicRuntime(env), id = match[1].toLowerCase();
    const record = await bounded(() => loadPublishedMusicRecord(runtime.db, id));
    if (['unpublished', 'archived'].includes(record.track?.lifecycle)) return failure(request, 410, 'TRACK_UNAVAILABLE');
    for (const asset of record.assets) checkAssetIdentity(asset);
    const track = projectPublicTrack(record, { locale, now });
    if (!track) return failure(request, 404, 'NOT_FOUND');
    if (track.audioVersion !== Number(version)) return failure(request, 409, 'VERSION_CONFLICT');
    const responseHeaders = { ...headers, 'Content-Type': 'image/png', 'Content-Language': locale,
      'Content-Disposition': `inline; filename="station-cat-${id}-${format}.png"` };
    if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders });
    if (!env.ASSETS?.fetch) throw new Error('SHARE_FONT_UNAVAILABLE');
    const { normalizeMusicCardCover, renderMusicShareCard } = await import('./shareCardRender.js');
    const cover = record.assets.find(asset => asset.id === record.revision.cover_asset_id);
    const png = cover ? await coverBytes(runtime.bucket, cover, normalizeMusicCardCover) : null;
    const font = await bounded(() => env.ASSETS.fetch(new Request(new URL(MUSIC_SHARE_FONT, url.origin))), response => cancelBody(response));
    const declared = font.headers.get('content-length');
    if (font.status !== 200 || (declared !== null && Number(declared) !== MUSIC_SHARE_FONT_BYTES)) { cancelBody(font); throw new Error('SHARE_FONT_UNAVAILABLE'); }
    const fontBytes = await readMusicShareBytes(font.body, MUSIC_SHARE_FONT_BYTES, MUSIC_SHARE_FONT_BYTES);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', fontBytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== MUSIC_SHARE_FONT_SHA256) throw new Error('SHARE_FONT_UNAVAILABLE');
    const bytes = await (render || renderMusicShareCard)(musicShareCardData(track, url.origin, locale), format, png, fontBytes);
    return new Response(bytes, { headers: { ...responseHeaders, 'Content-Length': String(bytes.length) } });
  } catch { return failure(request, 503, 'MUSIC_SHARE_CARD_UNAVAILABLE'); }
}
