import { Resvg } from '@cf-wasm/resvg';
import encodeJpeg from 'jpeg-js/lib/encoder.js';
import { encodeMusicRgbaPng } from './rasterPng.js';
import { inspectSmallAsset } from './assetFormats.js';
import { checkAssetIdentity, checkStoredObject } from './resources.js';
import { boundedBody, cancelBody } from './storage.js';

const VERSION = 'display-768-q82-v2';
const MAX_BYTES = 5242880, MAX_PIXELS = 4194304;
const clientHeaders = {
  // Always revisit publication/storage checks before reusing browser bytes.
  'Cache-Control': 'private, max-age=0, must-revalidate',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff'
};
const matches = (value, etag) => value?.split(',').some(part =>
  ['*', etag, `W/${etag}`].includes(part.trim()));

async function readBytes(body, expected) {
  const input = boundedBody(body), reader = input.stream.getReader(), bytes = new Uint8Array(expected);
  let timer, offset = 0;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { input.close(); reject(new Error('COVER_READ_TIMEOUT')); }, 5000);
  });
  try {
    for (let reads = 0; reads < 65536; reads++) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) {
        if (offset !== expected) throw new Error('COVER_TRUNCATED');
        return bytes;
      }
      if (offset + value.length > expected) throw new Error('COVER_TOO_LARGE');
      bytes.set(value, offset); offset += value.length;
    }
    throw new Error('COVER_READ_BUDGET');
  } finally { clearTimeout(timer); input.close(); }
}

export async function renderMusicDisplayCover(bytes, asset) {
  const dimensions = inspectSmallAsset(asset, bytes);
  if (dimensions.width * dimensions.height > MAX_PIXELS) return null;
  // WebP is already compressed. Keep it intact rather than growing a second
  // WASM heap alongside the renderer used by sharing posters in this isolate.
  if (asset.content_type === 'image/webp') return { bytes, contentType: asset.content_type };
  const ratio = Math.min(1, 768 / Math.max(dimensions.width, dimensions.height));
  const width = Math.max(1, Math.round(dimensions.width * ratio));
  const height = Math.max(1, Math.round(dimensions.height * ratio));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  }
  let renderer, raster, pixels;
  try {
    renderer = await Resvg.async(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" preserveAspectRatio="none" href="data:${asset.content_type};base64,${btoa(binary)}"/></svg>`, {
      imageRendering: 1, font: { loadSystemFonts: false }
    });
    raster = renderer.render(); pixels = raster.pixels;
  } finally { raster?.free(); renderer?.free(); }
  let transparent = false;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 255) { transparent = true; break; }
  // Encode after releasing the raster. Resvg's shared heap is reused by posters;
  // JPEG encoding allocates only garbage-collectable JavaScript memory.
  const encoded = transparent ? await encodeMusicRgbaPng(pixels, width, height)
    : encodeJpeg({ data: pixels, width, height }, 82).data;
  return encoded.length < bytes.length ? { bytes: encoded, contentType: transparent ? 'image/png' : 'image/jpeg' }
    : { bytes, contentType: asset.content_type };
}

// Internal helper: callers MUST establish live public visibility and revision first.
// Cached bytes are never an authorization source or a directly addressable route.
export async function musicDisplayCover(request, bucket, asset, { cache = globalThis.caches?.default, ctx } = {}) {
  checkAssetIdentity(asset);
  if (asset.kind !== 'cover' || asset.state !== 'validated' || asset.byte_size > MAX_BYTES) throw new Error('COVER_INVALID');
  let object, stopped = false, timer;
  try {
    const pending = Promise.resolve().then(() => bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } }));
    pending.then(value => { if (stopped) cancelBody(value); }, () => {});
    object = await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('COVER_STORAGE_TIMEOUT')), 5000);
    })]);
    clearTimeout(timer);
    checkStoredObject(object, asset);
    const etag = `"music-${VERSION}-${asset.sha256}"`;
    if (matches(request.headers.get('If-None-Match'), etag)) {
      return new Response(null, { status: 304, headers: { ...clientHeaders, ETag: etag } });
    }
    // The identity includes the asset id, digest and transform version. This path
    // sits under run_worker_first /api/* with no public handler. Incoming cookies
    // and conditional headers aren't copied.
    const key = new Request(new URL(`/api/music/__cover-cache/${asset.id}/${asset.sha256}/${VERSION}`, request.url));
    let cached;
    try { cached = await cache?.match(key); } catch { /* Cache availability is optional. */ }
    if (cached?.status === 200 && cached.headers.get('ETag') === etag) {
      const headers = new Headers(cached.headers);
      for (const [name, value] of Object.entries(clientHeaders)) headers.set(name, value);
      if (request.method === 'HEAD') { cancelBody(cached); return new Response(null, { headers }); }
      return new Response(cached.body, { headers });
    }
    cancelBody(cached);
    const bytes = await readBytes(object.body, asset.byte_size);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw new Error('COVER_HASH_MISMATCH');
    const rendered = await renderMusicDisplayCover(bytes, asset);
    // Oversized pixel dimensions retain the original streaming contract, without
    // storing that large fallback in the thumbnail cache or claiming a variant ETag.
    if (!rendered) return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
      ...clientHeaders, 'Cache-Control': 'no-store', 'Content-Type': asset.content_type, 'Content-Length': String(bytes.length)
    } });
    const headers = { ...clientHeaders, 'Content-Type': rendered.contentType,
      'Content-Length': String(rendered.bytes.length), ETag: etag };
    if (cache) {
      const stored = new Response(rendered.bytes, { headers: { ...headers, 'Cache-Control': 'public, max-age=86400' } });
      const write = Promise.resolve().then(() => cache.put(key, stored)).catch(() => {});
      if (ctx) ctx.waitUntil(write); else await write;
    }
    return new Response(request.method === 'HEAD' ? null : rendered.bytes, { headers });
  } finally { stopped = true; clearTimeout(timer); cancelBody(object); }
}
