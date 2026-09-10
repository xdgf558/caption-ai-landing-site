import { inspectMp3 } from './mp3.js';
import { mp3Error } from './mp3Stream.js';
import { validMusicId } from './publicationValidation.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value > 0;

// M2 supplies the private object's trusted metadata/body. No fetch, R2 binding or authorization here.
export async function verifyMusicAudioAsset(asset, object, options = {}) {
  if (!asset || !['audio', 'preview'].includes(asset.kind) || !validMusicId(asset.id) || !validMusicId(asset.owner_track_id) ||
    asset.state !== 'validated' || !hash(asset.sha256) || asset.format !== 'mp3' || asset.content_type !== 'audio/mpeg' ||
    !integer(asset.duration_ms) || !integer(asset.byte_size) || typeof asset.etag !== 'string' || !asset.etag ||
    !object || object.etag !== asset.etag || object.size !== asset.byte_size || object.contentType !== asset.content_type) throw mp3Error('MUSIC_MP3_OBJECT_MISMATCH');
  const measured = await inspectMp3(object.body, { ...options, kind: asset.kind, expectedBytes: object.size, contentType: object.contentType });
  if (measured.sha256 !== asset.sha256 || measured.durationMs !== asset.duration_ms) throw mp3Error('MUSIC_MP3_MEASUREMENT_MISMATCH');
  return { id: asset.id, exists: true, etag: object.etag, ...measured };
}

export function validateMeasuredPreview(full, preview, fullResult, previewResult, { previewLimitMs = 45000 } = {}) {
  if (!Number.isSafeInteger(previewLimitMs) || previewLimitMs < 15000 || previewLimitMs > 45000) throw mp3Error('MUSIC_MP3_PREVIEW_LIMIT_INVALID');
  for (const [asset, result, kind] of [[full, fullResult, 'audio'], [preview, previewResult, 'preview']]) {
    if (!asset || !result || !validMusicId(asset.id) || !validMusicId(asset.owner_track_id) || asset.kind !== kind || asset.state !== 'validated' ||
      asset.format !== 'mp3' || asset.content_type !== 'audio/mpeg' || !integer(asset.byte_size) || asset.byte_size > (kind === 'audio' ? 33554432 : 4194304) ||
      result.id !== asset.id || result.measurement !== 'mp3-frames' || result.structureValid !== true || result.exists !== true ||
      !hash(result.sha256) || result.sha256 !== asset.sha256 || !integer(result.durationMs) || result.durationMs !== asset.duration_ms ||
      result.byteSize !== asset.byte_size || result.etag !== asset.etag || result.contentType !== 'audio/mpeg') throw mp3Error('MUSIC_MP3_PREVIEW_SOURCE_MISMATCH');
  }
  if (preview.id === full.id || typeof full.object_key !== 'string' || !full.object_key || typeof preview.object_key !== 'string' || !preview.object_key ||
    preview.object_key === full.object_key || preview.owner_track_id !== full.owner_track_id || preview.derived_from_asset_id !== full.id ||
    preview.sha256 === full.sha256) throw mp3Error('MUSIC_MP3_PREVIEW_SOURCE_MISMATCH');
  const start = preview.source_start_ms, end = preview.source_end_ms, fullDuration = fullResult.durationMs, duration = previewResult.durationMs;
  const limit = Math.min(previewLimitMs, Math.floor(fullDuration / 2));
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(end) || end <= start || end > fullDuration ||
    end - start > limit || duration > limit + 250 || Math.abs(duration - (end - start)) > 250) throw mp3Error('MUSIC_MP3_PREVIEW_INVALID');
  return { durationMs: duration, sourceStartMs: start, sourceEndMs: end, limitMs: limit };
}
