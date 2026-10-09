import { sha256 } from '@noble/hashes/sha2.js';
import { fail } from '../music/adminValidation.js';
import { boundedBody, cancelBody } from '../music/storage.js';
import { inspectSmallAsset } from '../music/assetFormats.js';
import { stationMediaKey, stationMediaFormat, STATION_MEDIA_LIMITS } from './mediaFormats.js';
import { createMp4Inspector } from './mp4Validation.js';

export async function measureStationMedia(bucket, asset, upload, { timeoutMs = 30000, signal } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000 ||
    (signal !== undefined && !(signal instanceof AbortSignal))) fail('INVALID_INPUT', 400);
  if (asset.object_key !== stationMediaKey(asset) || !STATION_MEDIA_LIMITS[asset.kind] ||
    !Number.isSafeInteger(upload.declared_bytes) || upload.declared_bytes < 1 || upload.declared_bytes > STATION_MEDIA_LIMITS[asset.kind]) fail('STATION_MEDIA_IDENTITY_INVALID');
  let timer, stopped = false, input, end;
  const hash = sha256.create();
  const stop = new Promise((_, reject) => {
    end = error => { stopped = true; input?.close(error); reject(error); };
    timer = setTimeout(() => end(Object.assign(new Error('STATION_MEDIA_STORAGE_TIMEOUT'), { code: 'STATION_MEDIA_STORAGE_TIMEOUT', status: 503 })), timeoutMs);
    if (signal?.aborted) end(Object.assign(new Error('STATION_MEDIA_ABORTED'), { code: 'STATION_MEDIA_ABORTED', status: 503 }));
  });
  const abort = () => end(Object.assign(new Error('STATION_MEDIA_ABORTED'), { code: 'STATION_MEDIA_ABORTED', status: 503 }));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const work = async () => {
      if (stopped) fail('STATION_MEDIA_ABORTED', 503);
      const object = await bucket.head(asset.object_key);
      if (stopped) fail('STATION_MEDIA_STORAGE_TIMEOUT', 503);
      if (!object) fail('UPLOAD_WRITE_UNCONFIRMED', 503);
      if (object.key !== asset.object_key || object.size !== upload.declared_bytes ||
        object.httpMetadata?.contentType !== asset.content_type || object.httpMetadata?.contentEncoding ||
        object.customMetadata?.stationUpload !== upload.id || object.customMetadata?.stationAsset !== asset.id ||
        typeof object.etag !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(object.etag) || /["\\]/.test(object.etag)) fail('STATION_MEDIA_STORAGE_MISMATCH');
      const stored = await bucket.get(asset.object_key, { onlyIf: { etagMatches: object.etag } });
      if (stopped) { cancelBody(stored); fail('STATION_MEDIA_STORAGE_TIMEOUT', 503); }
      if (!stored?.body || (stored.range && (stored.range.offset !== 0 || stored.range.length !== object.size || stored.range.suffix !== undefined)) || stored.key !== object.key || stored.etag !== object.etag ||
        stored.size !== object.size || stored.httpMetadata?.contentType !== asset.content_type || stored.httpMetadata?.contentEncoding ||
        stored.customMetadata?.stationUpload !== upload.id || stored.customMetadata?.stationAsset !== asset.id) {
        cancelBody(stored); fail('STATION_MEDIA_STORAGE_MISMATCH');
      }
      input = boundedBody(stored.body);
      const reader = input.stream.getReader(), video = ['short_video', 'mv'].includes(asset.kind);
      const inspector = video ? createMp4Inspector(upload.declared_bytes) : null;
      const image = video ? null : new Uint8Array(upload.declared_bytes);
      let length = 0, reads = 0;
      try {
        while (true) {
          if (stopped || signal?.aborted) fail('STATION_MEDIA_ABORTED', 503);
          if (++reads > 131072) fail('STATION_MEDIA_READ_LIMIT', 503);
          const { value, done } = await reader.read();
          if (done) break;
          if ((length += value.byteLength) > upload.declared_bytes) fail('UPLOAD_SIZE_MISMATCH');
          hash.update(value);
          if (video) inspector.push(value); else image.set(value, length - value.byteLength);
        }
      } finally { reader.releaseLock(); }
      if (length !== upload.declared_bytes) fail('UPLOAD_SIZE_MISMATCH');
      const digest = Array.from(hash.digest(), b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== upload.expected_sha256) fail('STATION_MEDIA_HASH_MISMATCH');
      const details = video ? inspector.finish() : { ...inspectSmallAsset({ kind: 'cover', format: stationMediaFormat(asset.content_type) }, image), measurement: 'static-image-container-v1' };
      return { ...details, sha256: digest, byteSize: length, etag: object.etag, storageRead: input.metrics() };
    };
    return await Promise.race([work(), stop]);
  } catch (error) {
    if (error.code === 'MUSIC_FILE_STRUCTURE_INVALID') fail('STATION_MEDIA_STRUCTURE_INVALID');
    if (error.status) throw error;
    fail('STATION_MEDIA_STORAGE_UNAVAILABLE', 503);
  } finally { stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); input?.close(); hash.destroy(); }
}
