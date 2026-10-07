import { checkAssetIdentity } from '../music/resources.js';
import { validateMusicMediaAsset, cancelBody } from '../music/storage.js';
import { parseMusicByteRange, musicIfRangeMatches } from '../music/mediaResponse.js';
import { uuid, positive, millis, plain, contentBase } from './publicValidation.js';
import { contentFailure } from './publicStore.js';

export const assetPath = asset => contentBase + '/assets/' + asset.id;
const etag = value => typeof value === 'string' && /^[\x21-\x7e]{1,200}$/.test(value) && !/["\\]/.test(value);
const images = ['image/jpeg', 'image/png', 'image/webp'];
const videos = ['video/mp4', 'video/webm'];
function rights(asset, now) {
  return asset?.rights_status === 'approved' && plain(asset.rights_basis, 8000) && asset.rights_basis.trim() &&
    plain(asset.rights_reviewer, 200) && asset.rights_reviewer.trim() && millis(asset.rights_at) && asset.rights_at <= now;
}
export function publicAssetIdentity(asset, { ownerId, kind, now, media = false }) {
  try {
    if (!asset || asset.state !== 'validated' || asset.kind !== kind || !rights(asset, now) || asset.retired === 1 || asset.ambiguous === 1) return false;
    if (!media) {
      if (asset.owner_track_id !== ownerId || !['cover', 'lyrics', 'preview'].includes(kind)) return false;
      checkAssetIdentity(asset);
      return true;
    }
    if (!uuid(asset.id) || !uuid(ownerId) || !plain(asset.object_key, 512) || !asset.object_key.length ||
      !positive(asset.byte_size) || !/^[a-f0-9]{64}$/.test(asset.sha256 || '') || !etag(asset.etag)) return false;
    if (kind === 'game_screenshot' ? (asset.owner_game_id !== ownerId || asset.owner_clip_id !== null) :
      (asset.owner_clip_id !== ownerId || asset.owner_game_id !== null)) return false;
    if (['poster', 'game_screenshot'].includes(kind)) return images.includes(asset.content_type) && asset.byte_size <= 10485760 &&
      positive(asset.width) && positive(asset.height) && asset.width <= 4096 && asset.height <= 4096;
    return ['short_video', 'mv'].includes(kind) && videos.includes(asset.content_type) && asset.byte_size <= 268435456 &&
      positive(asset.duration_ms) && positive(asset.width) && positive(asset.height) && asset.width <= 7680 && asset.height <= 7680;
  } catch { return false; }
}

// Independently stored, owned preview, never an alias of the full file. Keep the
// approved clip's duration; do not invent a new fixed preview duration policy.
export function previewIdentity(asset, source, ownerId, now) {
  try {
    if (!publicAssetIdentity(asset, { ownerId, kind: 'preview', now })) return false;
    validateMusicMediaAsset(source, 'audio', ownerId);
    return source.retired !== 1 && source.ambiguous !== 1 && asset.derived_from_asset_id === source.id &&
      source.id !== asset.id && source.object_key !== asset.object_key &&
      positive(asset.duration_ms) && asset.duration_ms < source.duration_ms &&
      Number.isSafeInteger(asset.source_start_ms) && asset.source_start_ms >= 0 &&
      positive(asset.source_end_ms) && asset.source_end_ms > asset.source_start_ms &&
      asset.source_end_ms <= source.duration_ms &&
      asset.source_end_ms - asset.source_start_ms < source.duration_ms &&
      Math.abs(asset.duration_ms - (asset.source_end_ms - asset.source_start_ms)) <= 250;
  } catch { return false; }
}
export function storedIdentity(object, asset, range = null) {
  return object && object.key === asset.object_key && object.etag === asset.etag && object.size === asset.byte_size &&
    object.httpMetadata?.contentType === asset.content_type && (!range ?
      (object.range === undefined || (object.range.offset === 0 && object.range.length === asset.byte_size && object.range.suffix === undefined)) :
      (object.range?.offset === range.start && object.range.length === range.length && object.range.suffix === undefined));
}
export async function resourceReady(runtime, asset, run) {
  let object;
  try { object = await run(() => runtime.bucket.head(asset.object_key)); }
  catch { throw contentFailure('CONTENT_MEDIA_UNAVAILABLE'); }
  return Boolean(storedIdentity(object, asset));
}

// Callers must authorize a fresh published reference before reaching this
// helper. It streams bytes, not decoded audio/video, and cannot grant access.
export async function streamContentAsset(request, runtime, asset, publishedAt, run, { privateAudio = false } = {}) {
  const lastModified = Math.floor(publishedAt / 1000) * 1000;
  const headers = {
    'Cache-Control': privateAudio ? 'private, no-store' : 'no-store',
    ...(privateAudio ? { Vary: 'Cookie' } : {}),
    'Content-Type': asset.kind === 'lyrics' ? 'text/plain; charset=utf-8' : asset.content_type,
    'Content-Length': String(asset.byte_size),
    'Accept-Ranges': 'bytes', ETag: '"' + asset.etag + '"',
    'Last-Modified': new Date(lastModified).toUTCString(),
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox"
  };
  // The caller has already checked this request's R2 HEAD, even for conditional
  // requests. Ignoring If-None-Match avoids a stale shared authorization verdict.
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  let range = null;
  if (request.headers.has('Range') && musicIfRangeMatches(request.headers.get('If-Range'), asset.etag, lastModified)) {
    range = parseMusicByteRange(request.headers.get('Range'), asset.byte_size);
  }
  if (range?.unsatisfiable) {
    throw Object.assign(contentFailure('RANGE_NOT_SATISFIABLE', 416), { headers: { 'Content-Range': 'bytes */' + asset.byte_size } });
  }
  let object, waiting = true;
  const options = { onlyIf: { etagMatches: asset.etag },
    ...(range ? { range: { offset: range.start, length: range.length } } : {}) };
  const pending = Promise.resolve().then(() => runtime.bucket.get(asset.object_key, options));
  pending.then(value => { if (!waiting) cancelBody(value); }, () => {});
  try {
    object = await run(() => pending);
    if (!object?.body || !storedIdentity(object, asset, range)) throw new Error('object');
  } catch {
    cancelBody(object);
    throw contentFailure('CONTENT_MEDIA_UNAVAILABLE');
  } finally { waiting = false; }
  if (range) {
    headers['Content-Length'] = String(range.length);
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + asset.byte_size;
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
