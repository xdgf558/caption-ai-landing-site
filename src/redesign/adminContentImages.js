import { primary, rows } from '../music/adminStore.js';
import { fail, musicId } from '../music/adminValidation.js';
import { cancelBody } from '../music/storage.js';
import { stationMediaKey, stationMediaFormat, stationMediaType, STATION_MEDIA_LIMITS } from './mediaFormats.js';
import { storedIdentity } from './publicResources.js';

// Administrative review only: the caller verifies Access and the content flag
// on every GET/HEAD. A pending rights record does not prevent private inspection.
export async function readAdminContentImage(request, runtime, rawId) {
  const id = musicId(rawId);
  const asset = rows(await primary(runtime.db).prepare('SELECT * FROM station_media_assets WHERE id=? LIMIT 2').bind(id).all())[0];
  if (!asset || asset.state !== 'validated' || !['poster', 'game_screenshot'].includes(asset.kind)) fail('NOT_FOUND', 404);
  const owner = asset.kind === 'game_screenshot' ? asset.owner_game_id : asset.owner_clip_id;
  musicId(owner);
  if ((asset.kind === 'game_screenshot' ? asset.owner_clip_id !== null : asset.owner_game_id !== null) ||
      !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 1 || asset.byte_size > STATION_MEDIA_LIMITS[asset.kind] ||
      asset.content_type !== stationMediaType(asset.kind, stationMediaFormat(asset.content_type)) || stationMediaKey(asset) !== asset.object_key ||
      !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || typeof asset.etag !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(asset.etag) || /["\\]/.test(asset.etag) ||
      !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 4096 || asset.height > 4096) fail('STATION_ASSET_NOT_READY', 409);
  let stopped = false, timer, object;
  const pending = Promise.resolve().then(() => runtime.bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } }));
  pending.then(value => { if (stopped) cancelBody(value); }, () => {});
  try {
    object = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => { stopped = true; reject(Object.assign(new Error('STATION_IMAGE_TIMEOUT'), { code: 'STATION_IMAGE_TIMEOUT', status: 503 })); }, 10000); })]);
    if (!object?.body || !storedIdentity(object, asset)) { cancelBody(object); fail('STATION_ASSET_OBJECT_CHANGED', 409); }
    const headers = { 'Content-Type': asset.content_type, 'Content-Length': String(asset.byte_size), 'Cache-Control': 'private, no-store',
      Vary: 'Cookie, Cf-Access-Jwt-Assertion', 'Accept-Ranges': 'none', 'Content-Disposition': `inline; filename="${id}.${stationMediaFormat(asset.content_type)}"`,
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'none'; sandbox" };
    if (request.method === 'HEAD') cancelBody(object);
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  } finally { clearTimeout(timer); }
}
