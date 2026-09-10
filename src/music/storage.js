import { verifyMusicAudioAsset } from './audioValidation.js';
import { MP3_LIMITS, mp3Error } from './mp3Stream.js';
import { validMusicId } from './publicationValidation.js';

function audioIdentity(asset) {
  const folder = asset?.kind === 'audio' ? 'audio' : asset?.kind === 'preview' ? 'previews' : null;
  const max = asset?.kind === 'audio' ? MP3_LIMITS.audioBytes : MP3_LIMITS.previewBytes;
  if (!folder || !validMusicId(asset.id) || !validMusicId(asset.owner_track_id) || asset.state !== 'validated' ||
    asset.object_key !== `music/${folder}/${asset.owner_track_id}/${asset.id}.mp3` ||
    asset.format !== 'mp3' || asset.content_type !== 'audio/mpeg' ||
    typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !Number.isSafeInteger(asset.duration_ms) || asset.duration_ms < 1 ||
    !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 1 || asset.byte_size > max ||
    typeof asset.etag !== 'string' || !/^[\x21-\x7e]{1,200}$/.test(asset.etag) || /["\\]/.test(asset.etag)) {
    throw mp3Error('MUSIC_STORAGE_ASSET_INVALID');
  }
}

function cancelBody(object) {
  try { Promise.resolve(object?.body?.cancel()).catch(() => {}); } catch { /* May already be locked or closed. */ }
}

// A BYOB reader limits the allocation at the native R2 boundary, not just the parser input.
// No default-reader fallback: splitting an arbitrarily large buffered chunk is not bounded I/O.
function boundedBody(body) {
  let reader;
  try { reader = body.getReader({ mode: 'byob' }); }
  catch { cancelBody({ body }); throw mp3Error('MUSIC_STORAGE_STREAM_UNSUPPORTED', 503); }
  let finished = false, maxChunkBytes = 0, chunks = 0, output;
  function close(error = mp3Error('MUSIC_STORAGE_ABORTED', 499)) {
    if (finished) return;
    finished = true;
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
    try { reader.releaseLock(); } catch {}
    try { output.error(error); } catch {}
  }
  const stream = new ReadableStream({
    start(controller) { output = controller; },
    async pull(controller) {
      try {
        const { value, done } = await reader.read(new Uint8Array(MP3_LIMITS.chunkBytes));
        if (finished) return;
        if (value?.byteLength) {
          if (!(value instanceof Uint8Array) || value.byteLength > MP3_LIMITS.chunkBytes) throw mp3Error('MUSIC_STORAGE_CHUNK_INVALID', 503);
          maxChunkBytes = Math.max(maxChunkBytes, value.byteLength); chunks++;
          controller.enqueue(value);
        } else if (!done) throw mp3Error('MUSIC_STORAGE_CHUNK_INVALID', 503);
        if (done) { finished = true; reader.releaseLock(); controller.close(); }
      } catch (error) { if (!finished) close(error); }
    },
    cancel: close
  }, { highWaterMark: 0 });
  return { stream, close, metrics: () => ({ maxChunkBytes, chunks }) };
}

// Trusted internal caller only. This neither authenticates a user nor issues a playback response.
// Covers the conditional GET and parsing with one wall/I/O deadline; not a CPU interruption.
export async function verifyStoredMusicAudio(bucket, asset, { signal, timeoutMs = 10000, limits = {} } = {}) {
  audioIdentity(asset);
  if (typeof bucket?.get !== 'function') throw mp3Error('MUSIC_NOT_CONFIGURED', 503);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000 ||
    (signal !== undefined && !(signal instanceof AbortSignal))) throw mp3Error('MUSIC_STORAGE_OPTIONS_INVALID', 400);
  if (signal?.aborted) throw mp3Error('MUSIC_STORAGE_ABORTED', 499);
  let timer, onAbort, stopped = false, input;
  const stop = new Promise((_, reject) => {
    const fail = error => { stopped = true; reject(error); input?.close(error); };
    timer = setTimeout(() => fail(mp3Error('MUSIC_STORAGE_TIMEOUT', 503)), timeoutMs);
    onAbort = () => fail(mp3Error('MUSIC_STORAGE_ABORTED', 499));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  stop.catch(() => {});
  try {
    const pending = Promise.resolve().then(() => bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } }));
    // R2 GET has no AbortSignal option. Dispose any body arriving after a cancelled request.
    pending.then(object => { if (stopped) cancelBody(object); }, () => {});
    const object = await Promise.race([pending, stop]);
    if (!object) throw mp3Error('MUSIC_STORAGE_OBJECT_MISSING');
    if (!object.body) throw mp3Error('MUSIC_STORAGE_OBJECT_CHANGED', 409);
    const fullRange = object.range === undefined || (object.range?.offset === 0 &&
      object.range?.length === object.size && object.range?.suffix === undefined);
    if (object.key !== asset.object_key || object.etag !== asset.etag || object.size !== asset.byte_size ||
      object.httpMetadata?.contentType !== asset.content_type || !fullRange) {
      cancelBody(object); throw mp3Error('MUSIC_STORAGE_OBJECT_CHANGED', 409);
    }
    input = boundedBody(object.body);
    const measured = await Promise.race([verifyMusicAudioAsset(asset, { size: object.size, etag: object.etag,
      contentType: object.httpMetadata.contentType, body: input.stream }, { signal, limits }), stop]);
    return { ...measured, storageRead: input.metrics() };
  } catch (error) {
    if (/^MUSIC_(STORAGE|MP3|NOT_CONFIGURED)/.test(error?.code || '')) throw error;
    throw mp3Error('MUSIC_STORAGE_UNAVAILABLE', 503);
  } finally {
    stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); input?.close();
  }
}
