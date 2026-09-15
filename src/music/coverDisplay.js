import { musicDisplayCoverManifest } from './displayCoverManifest.js';
import { checkAssetIdentity, checkStoredObject } from './resources.js';
import { cancelBody } from './storage.js';

const headers = { 'Cache-Control': 'private, max-age=0, must-revalidate',
  'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };
const matches = (value, etag) => value?.split(',').some(part => ['*', etag, `W/${etag}`].includes(part.trim()));
const validVariant = (variant, asset) => variant && variant.sourceBytes === asset.byte_size &&
  ['image/jpeg', 'image/webp'].includes(variant.contentType) && /^[a-f0-9]{64}$/.test(variant.sha256) &&
  variant.path === `/api/music/__cover-files/${variant.sha256}.${variant.contentType === 'image/jpeg' ? 'jpg' : 'webp'}` &&
  Number.isSafeInteger(variant.bytes) && variant.bytes > 0 && variant.bytes < asset.byte_size;

// Callers establish live publication/version first. Raw generated files are
// blocked at the Worker boundary, including when the public music gate is off.
export async function musicDisplayCover(request, bucket, asset, { assets, manifest = musicDisplayCoverManifest } = {}) {
  checkAssetIdentity(asset);
  if (asset.kind !== 'cover' || asset.state !== 'validated') throw new Error('COVER_INVALID');
  let object, response, stopped = false, timer;
  try {
    const pending = Promise.resolve().then(() => bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } }));
    pending.then(value => { if (stopped) cancelBody(value); }, () => {});
    object = await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('COVER_STORAGE_TIMEOUT')), 5000);
    })]);
    clearTimeout(timer); checkStoredObject(object, asset);
    const variant = manifest[asset.sha256];
    if (assets?.fetch && validVariant(variant, asset)) {
      const etag = `"music-display-static-v1-${variant.sha256}"`;
      if (matches(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
      try {
        response = await assets.fetch(new Request(new URL(variant.path, request.url), { method: request.method }));
        if (response.status === 200 && response.headers.get('Content-Type')?.split(';')[0] === variant.contentType &&
          (response.headers.get('Content-Length') === null || Number(response.headers.get('Content-Length')) === variant.bytes)) {
          const body = request.method === 'HEAD' ? null : response.body;
          if (request.method === 'HEAD') cancelBody(response);
          response = null;
          return new Response(body, { headers: { ...headers, 'Content-Type': variant.contentType,
            'Content-Length': String(variant.bytes), ETag: etag } });
        }
      } catch { /* Missing generated assets never make the original cover unusable. */ }
      cancelBody(response); response = null;
    }
    // New artwork remains visible until the next release generates its display
    // asset. No image decoding or encoding runs in the request-serving Worker.
    const body = request.method === 'HEAD' ? null : object.body;
    if (request.method === 'HEAD') cancelBody(object);
    object = null;
    return new Response(body, { headers: { ...headers, 'Cache-Control': 'no-store',
      'Content-Type': asset.content_type, 'Content-Length': String(asset.byte_size) } });
  } finally { stopped = true; clearTimeout(timer); cancelBody(object); cancelBody(response); }
}

// Asset routing can decode escaped path segments; deny the reserved directory
// before dispatch even when an incoming URL uses percent-encoded characters.
export function isMusicDisplayAssetPath(pathname) {
  let value = pathname;
  for (let i = 0; i < 4; i++) {
    if (/(?:^|\/)__cover-files(?:\/|$)/.test(value.replaceAll('\\', '/'))) return true;
    try { const next = decodeURIComponent(value); if (next === value) break; value = next; }
    catch { break; }
  }
  return false;
}
