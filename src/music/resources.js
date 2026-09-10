import { sha256 } from '@noble/hashes/sha2.js';
import { ASSET_LIMITS, assetKey, assetType, inspectSmallAsset } from './assetFormats.js';
import { boundedBody, cancelBody, verifyStoredMusicAudio, measureUploadedMusicAudio } from './storage.js';
import { validateMeasuredPreview } from './audioValidation.js';
import { validMusicId } from './publicationValidation.js';
import { fail } from './adminValidation.js';

export function checkAssetIdentity(a) {
  if (!a || !validMusicId(a.id) || !validMusicId(a.owner_track_id) ||
    !['uploaded', 'validated'].includes(a.state) || !Number.isSafeInteger(a.byte_size) || a.byte_size < 1 ||
    a.byte_size > ASSET_LIMITS[a.kind] || assetType(a.kind, a.format) !== a.content_type || assetKey(a) !== a.object_key ||
    !/^[a-f0-9]{64}$/.test(a.sha256 || '') || typeof a.etag !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(a.etag) || /["\\]/.test(a.etag)) fail('MUSIC_STORAGE_ASSET_INVALID');
}
export function checkStoredObject(object, a) {
  if (!object) fail('MUSIC_STORAGE_OBJECT_MISSING');
  if (!object.body || object.key !== a.object_key || object.etag !== a.etag || object.size !== a.byte_size ||
    object.httpMetadata?.contentType !== a.content_type || (object.range &&
      (object.range.offset !== 0 || object.range.length !== a.byte_size || object.range.suffix !== undefined))) {
    cancelBody(object); fail('MUSIC_STORAGE_OBJECT_CHANGED', 409);
  }
}
export async function verifyStoredMusicAsset(bucket, a, { signal, timeoutMs = 10000 } = {}) {
  checkAssetIdentity(a);
  if (['audio', 'preview'].includes(a.kind)) return (a.state === 'uploaded' ? measureUploadedMusicAudio : verifyStoredMusicAudio)(bucket, a, { signal, timeoutMs });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) fail('INVALID_INPUT', 400);
  let input, stopped = false, timer, abort;
  const hash = sha256.create();
  const stop = new Promise((_, reject) => {
    abort = () => { stopped = true; input?.close(); reject(Object.assign(new Error('MUSIC_STORAGE_TIMEOUT'), { code: 'MUSIC_STORAGE_TIMEOUT', status: 503 })); };
    timer = setTimeout(abort, timeoutMs); signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
  stop.catch(() => {});
  try {
    const pending = Promise.resolve().then(() => bucket.get(a.object_key, { onlyIf: { etagMatches: a.etag } }));
    pending.then(o => { if (stopped) cancelBody(o); }, () => {});
    const object = await Promise.race([pending, stop]); checkStoredObject(object, a);
    input = boundedBody(object.body);
    // Only small formats are buffered, capped at 10 MiB. Audio always uses the frame stream parser.
    const bytes = new Uint8Array(a.byte_size), reader = input.stream.getReader(); let offset = 0, reads = 0;
    while (true) {
      if (++reads > 65536) fail('MUSIC_STORAGE_READ_BUDGET');
      const { value, done } = await Promise.race([reader.read(), stop]);
      if (done) break;
      if (offset + value.length > bytes.length) fail('MUSIC_STORAGE_SIZE_MISMATCH');
      bytes.set(value, offset); offset += value.length; hash.update(value);
    }
    if (offset !== bytes.length) fail('MUSIC_STORAGE_SIZE_MISMATCH');
    const digest = Array.from(hash.digest(), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== a.sha256) fail('MUSIC_STORAGE_HASH_MISMATCH');
    const details = inspectSmallAsset(a, bytes);
    return { ...details, id: a.id, exists: true, etag: a.etag, sha256: digest, byteSize: offset,
      contentType: a.content_type, structureValid: true, storageRead: input.metrics() };
  } finally {
    stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); input?.close(); hash.destroy();
  }
}

export function musicResourceVerifier(bucket, previewLimitMs) {
  return async assets => {
    const started = Date.now(), proofs = [];
    // One whole-resource deadline and sequential reads bound both freshness and allocation.
    for (const asset of assets) {
      const remaining = 10000 - (Date.now() - started);
      if (remaining < 1) fail('MUSIC_STORAGE_TIMEOUT', 503);
      proofs.push(await verifyStoredMusicAsset(bucket, asset, { timeoutMs: remaining }));
    }
    const full = assets.find(a => a.kind === 'audio'), preview = assets.find(a => a.kind === 'preview');
    if (preview) validateMeasuredPreview(full, preview, proofs.find(p => p.id === full?.id), proofs.find(p => p.id === preview.id), { previewLimitMs });
    if (Date.now() - started >= 10000) fail('MUSIC_STORAGE_TIMEOUT', 503);
    return { checkedAt: Date.now(), assets: proofs };
  };
}
