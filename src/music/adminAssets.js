import { loadAssets } from './adminStore.js';
import { musicId, fail } from './adminValidation.js';
import { checkAssetIdentity, checkStoredObject } from './resources.js';
import { cancelBody } from './storage.js';

// Caller must authenticate each GET/HEAD. No public route or signed capability is issued.
export async function readAdminMusicAsset(db, bucket, id, request) {
  const asset = (await loadAssets(db, [musicId(id)]))[0];
  if (!asset || asset.state !== 'validated') fail('NOT_FOUND', 404);
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
