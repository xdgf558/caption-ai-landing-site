import { inspectSmallAsset, ASSET_LIMITS } from './assetFormats.js';
import { boundedBody } from './storage.js';

const unavailable = () => Object.assign(new Error('MUSIC_THUMBNAIL_UNAVAILABLE'), { code: 'MUSIC_THUMBNAIL_UNAVAILABLE', status: 404 });
const headers = { 'Cache-Control': 'private, max-age=0, must-revalidate',
  'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff' };

// Only called after Access, current D1 state and conditional R2 identity checks.
// Browser revalidation avoids repeated decoding. No public URL or stored copy is
// created for private artwork, and an original never becomes a list response.
export async function generatedAdminThumbnail(request, object, asset) {
  const etag = `"music-admin-card-v1-${asset.sha256}"`;
  if (request.headers.get('If-None-Match')?.split(',').some(value => [etag, `W/${etag}`].includes(value.trim()))) {
    return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
  }
  if (!Number.isSafeInteger(asset.byte_size) || asset.byte_size < 1 || asset.byte_size > ASSET_LIMITS.cover) throw unavailable();
  const stream = boundedBody(object.body), reader = stream.stream.getReader(), bytes = new Uint8Array(asset.byte_size);
  let timer, offset = 0, reads = 0, input, output;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { stream.close(); reject(unavailable()); }, 5000); });
  try {
    while (true) {
      if (++reads > 65536) throw unavailable();
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (offset + value.length > bytes.length) throw unavailable();
      bytes.set(value, offset); offset += value.length;
    }
    clearTimeout(timer);
    if (offset !== bytes.length) throw unavailable();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    if (digest !== asset.sha256) throw unavailable();
    const { width, height } = inspectSmallAsset(asset, bytes);
    // Match the existing Worker image decoder budget. Larger artwork still uses
    // release-generated cards; never allocate a full 4096-square raster here.
    if (width * height > 4194304) throw unavailable();
    const { PhotonImage, resize, SamplingFilter } = await import('@cf-wasm/photon');
    input = PhotonImage.new_from_byteslice(bytes);
    if (input.get_width() !== width || input.get_height() !== height) throw unavailable();
    const ratio = Math.min(1, 192 / Math.max(width, height));
    output = resize(input, Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)), SamplingFilter.Lanczos3);
    const card = output.get_bytes_webp();
    if (!card.length || card.length > 192 * 1024) throw unavailable();
    return new Response(request.method === 'HEAD' ? null : card, { headers: { ...headers,
      'Content-Type': 'image/webp', 'Content-Length': String(card.length), ETag: etag } });
  } catch { throw unavailable(); }
  finally { clearTimeout(timer); stream.close(); output?.free(); input?.free(); }
}
