import { loadAssets, primary, rows } from './adminStore.js';
import { musicId, fail } from './adminValidation.js';
import { checkAssetIdentity, checkStoredObject } from './resources.js';
import { cancelBody } from './storage.js';
import { musicDisplayCover } from './coverDisplay.js';

async function adminAsset(db, id) {
  const asset = (await loadAssets(db, [musicId(id)]))[0];
  if (!asset || asset.state !== 'validated') fail('NOT_FOUND', 404);
  if (rows(await primary(db).prepare('SELECT upload_id FROM music_upload_cleanup WHERE asset_id=?').bind(asset.id).all()).length) fail('NOT_FOUND', 404);
  return asset;
}

// Caller must authenticate each GET/HEAD. No public route or signed capability is issued.
export async function readAdminMusicAsset(db, bucket, id, request) {
  const asset = await adminAsset(db, id);
  return readMusicAssetObject(bucket, asset, request);
}

// Access and the content-admin flag are checked before this route, including
// conditional requests. Private inspection does not publish a draft or its rights.
export async function readAdminMusicThumbnail(db, bucket, id, request, assets) {
  const asset = await adminAsset(db, id);
  if (asset.kind !== 'cover') fail('NOT_FOUND', 404);
  const result = await musicDisplayCover(request, bucket, asset, { assets, thumbnailOnly: true });
  result.headers.set('Vary', 'Cookie, Cf-Access-Jwt-Assertion');
  result.headers.set('Accept-Ranges', 'none');
  result.headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return result;
}

// Internal caller must authorize publication or administrator access before invoking.
export async function readMusicAssetObject(bucket, asset, request) {
  checkAssetIdentity(asset);
  // Ignore conditional/range headers for this private review download. Public Range delivery is M2-04.
  let stopped = false, timer;
  const pending = Promise.resolve().then(() => bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } }));
  pending.then(o => { if (stopped) cancelBody(o); }, () => {});
  try {
    const object = await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => { stopped = true; reject(Object.assign(new Error('MUSIC_STORAGE_TIMEOUT'), { code: 'MUSIC_STORAGE_TIMEOUT', status: 503 })); }, 10000);
    })]);
    checkStoredObject(object, asset);
    const attachment = ['evidence', 'lyrics'].includes(asset.kind);
    const headers = { 'Content-Type': asset.content_type, 'Content-Length': String(asset.byte_size),
      'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Cf-Access-Jwt-Assertion', 'Accept-Ranges': 'none',
      'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename="${asset.id}.${asset.format}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cross-Origin-Resource-Policy': 'same-origin' };
    if (request.method === 'HEAD') cancelBody(object);
    return new Response(request.method === 'HEAD' ? null : object.body, { headers });
  } finally { clearTimeout(timer); }
}
