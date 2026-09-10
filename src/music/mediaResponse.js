import { resolveMusicAccess } from './access.js';
import { positiveInteger } from './policy.js';
import { validMusicId } from './publicationValidation.js';
import { loadPublishedMusicRecord } from './publicStore.js';
import { musicRuntime, musicRuntimeFlags } from './runtime.js';
import { cancelBody, validateMusicMediaAsset } from './storage.js';

const MEDIA_PATH = /^\/api\/music\/tracks\/([^/]+)\/audio$/;
const PRIVATE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff'
});

export const isMusicMediaPath = pathname => typeof pathname === 'string' && MEDIA_PATH.test(pathname);

function jsonResponse(request, status, code, headers = {}) {
  const body = request.method === 'HEAD' ? null : JSON.stringify({ error: { code } });
  return new Response(body, { status, headers: {
    ...PRIVATE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  } });
}

function accessResponse(request, decision) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(decision.body), {
    status: decision.status,
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function requestInput(request) {
  const url = new URL(request.url), match = MEDIA_PATH.exec(url.pathname);
  if (!match || !validMusicId(match[1])) return { error: 'INVALID_INPUT' };
  if ([...url.searchParams.keys()].some(key => key !== 'v' && key !== 'variant') ||
    url.searchParams.getAll('v').length !== 1 || url.searchParams.getAll('variant').length !== 1) {
    return { error: 'INVALID_INPUT' };
  }
  const rawVersion = url.searchParams.get('v'), variant = url.searchParams.get('variant');
  if (!/^[1-9][0-9]*$/.test(rawVersion || '') || !positiveInteger(Number(rawVersion))) return { error: 'INVALID_INPUT' };
  if (!['full', 'preview'].includes(variant)) return { error: 'INVALID_VARIANT' };
  return { trackId: match[1].toLowerCase(), revisionNo: Number(rawVersion), variant };
}

// Invalid or unsupported ranges are deliberately ignored and become a full 200 response.
export function parseMusicByteRange(value, total) {
  if (typeof value !== 'string' || !positiveInteger(total) || value.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (match[1]) {
    const start = Number(match[1]);
    if (!Number.isSafeInteger(start)) return null;
    const requestedEnd = match[2] ? Number(match[2]) : total - 1;
    if (!Number.isSafeInteger(requestedEnd) || (match[2] && requestedEnd < start)) return null;
    if (start >= total) return { unsatisfiable: true };
    const end = Math.min(requestedEnd, total - 1);
    return { start, end, length: end - start + 1 };
  }
  const suffix = Number(match[2]);
  if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
  const length = Math.min(suffix, total);
  return { start: total - length, end: total - 1, length };
}

function strongEtag(etag) {
  return `"${etag}"`;
}

export function musicIfRangeMatches(value, etag, lastModified) {
  if (value === null) return true;
  const text = value.trim(), expected = strongEtag(etag);
  if (text.startsWith('W/')) return false;
  if (text.startsWith('"')) return text === expected;
  if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) return false;
  const parsed = Date.parse(text);
  return Number.isSafeInteger(parsed) && new Date(parsed).toUTCString() === text && parsed >= lastModified;
}

function fullObject(object, asset) {
  return object?.range === undefined || (object.range?.offset === 0 && object.range?.length === asset.byte_size &&
    object.range?.suffix === undefined);
}

function validObject(object, asset, range) {
  if (!object?.body || object.key !== asset.object_key || object.etag !== asset.etag || object.size !== asset.byte_size ||
    object.httpMetadata?.contentType !== 'audio/mpeg') return false;
  if (!range || range.unsatisfiable) return fullObject(object, asset);
  return object.range?.offset === range.start && object.range?.length === range.length && object.range?.suffix === undefined;
}

function mediaHeaders(asset, track, length) {
  return {
    ...PRIVATE_HEADERS,
    'Content-Type': 'audio/mpeg',
    'Content-Length': String(length),
    'Accept-Ranges': 'bytes',
    'ETag': strongEtag(asset.etag),
    'Last-Modified': new Date(Math.floor(track.published_at / 1000) * 1000).toUTCString(),
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
}

export async function handleMusicMedia(request, env, { clock = Date.now, timeoutMs = 1500 } = {}) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return jsonResponse(request, 405, 'METHOD_NOT_ALLOWED', { Allow: 'GET, HEAD' });
  }
  const input = requestInput(request);
  if (input.error) return jsonResponse(request, 400, input.error);
  if (!musicRuntimeFlags(env).public) return jsonResponse(request, 503, 'MUSIC_PUBLIC_DISABLED');

  let runtime, record;
  try {
    runtime = musicRuntime(env);
    record = await loadPublishedMusicRecord(runtime.db, input.trackId);
  } catch (error) {
    return jsonResponse(request, Number.isInteger(error?.status) ? error.status : 503,
      error?.code === 'MUSIC_NOT_CONFIGURED' ? error.code : 'MUSIC_DATABASE_UNAVAILABLE');
  }

  const decision = await resolveMusicAccess(request, env, {
    record,
    revisionNo: input.revisionNo,
    variant: input.variant,
    vipDeliveryEnabled: runtime.flags.vipDelivery,
    clock,
    timeoutMs
  });
  if (decision.status !== 200) return accessResponse(request, decision);

  const assetId = input.variant === 'full' ? record.revision.audio_asset_id : record.revision.preview_asset_id;
  let asset;
  try {
    const matches = record.assets.filter(row => row.id === assetId);
    if (matches.length !== 1) throw new Error('asset');
    asset = validateMusicMediaAsset(matches[0], input.variant === 'full' ? 'audio' : 'preview', input.trackId);
  } catch {
    return jsonResponse(request, 503, 'MEDIA_UNAVAILABLE');
  }

  const lastModified = Math.floor(record.track.published_at / 1000) * 1000;
  let range = null;
  if (request.method === 'GET' && request.headers.has('Range') &&
    musicIfRangeMatches(request.headers.get('If-Range'), asset.etag, lastModified)) {
    range = parseMusicByteRange(request.headers.get('Range'), asset.byte_size);
  }

  let object;
  try {
    const options = { onlyIf: { etagMatches: asset.etag } };
    if (range && !range.unsatisfiable) options.range = { offset: range.start, length: range.length };
    object = await runtime.bucket.get(asset.object_key, options);
    if (!validObject(object, asset, range)) {
      cancelBody(object);
      return jsonResponse(request, 503, 'MEDIA_UNAVAILABLE');
    }
  } catch {
    cancelBody(object);
    return jsonResponse(request, 503, 'MEDIA_UNAVAILABLE');
  }

  if (range?.unsatisfiable) {
    cancelBody(object);
    return jsonResponse(request, 416, 'RANGE_NOT_SATISFIABLE', {
      'Content-Range': `bytes */${asset.byte_size}`
    });
  }

  const partial = range !== null;
  const headers = mediaHeaders(asset, record.track, partial ? range.length : asset.byte_size);
  if (partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${asset.byte_size}`;
  if (request.method === 'HEAD') {
    cancelBody(object);
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: partial ? 206 : 200, headers });
}
