import { assetKey, assetType, ASSET_LIMITS } from './assetFormats.js';
import { fail, fields, musicId, mutationKey } from './adminValidation.js';
import { primary, rows, mutate, loadAssets } from './adminStore.js';
import { verifyStoredMusicAsset } from './resources.js';
import { validateMeasuredPreview } from './audioValidation.js';
import { boundedBody } from './storage.js';

const chargedSql = '(SELECT COALESCE(SUM(charged_bytes),0) FROM music_storage_charges)';
export async function uploadReadiness(db) {
  try {
    const s = primary(db);
    await s.prepare('SELECT expected_sha256,write_token FROM music_upload_sessions LIMIT 0').all();
    const record = rows(await s.prepare(`SELECT value_json,(${chargedSql}) AS charged FROM music_settings WHERE key='storageQuotaBytes'`).all())[0];
    const quota = record ? JSON.parse(record.value_json) : null;
    if (!Number.isSafeInteger(quota) || quota < 0 || !Number.isSafeInteger(record.charged)) fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
    return { quotaBytes: quota, chargedBytes: record.charged, nearQuota: quota > 0 && record.charged >= quota * 0.8 };
  } catch { fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503); }
}
async function session(db, id, actorId) {
  const u = rows(await primary(db).prepare(`SELECT u.*,c.claimed_at AS cleanup_claimed_at,c.released_at AS cleanup_released_at
    FROM music_upload_sessions u LEFT JOIN music_upload_cleanup c ON c.upload_id=u.id
    WHERE u.id=? AND u.actor_id=?`).bind(musicId(id), actorId).all())[0];
  if (!u) fail('NOT_FOUND', 404);
  const a = (await loadAssets(db, [u.asset_id]))[0];
  if (!a) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  return { u, a };
}
function sessionView({ u, a }) {
  return { uploadId: u.id, assetId: a.id, trackId: a.owner_track_id, status: u.status,
    expired: u.status !== 'completed' && u.expires_at <= Date.now(), state: a.state,
    declaredBytes: u.declared_bytes, actualBytes: u.actual_bytes, durationMs: a.duration_ms,
    contentType: a.content_type, expiresAt: u.expires_at,
    cleanupState: u.cleanup_released_at !== null ? 'released' : u.cleanup_claimed_at !== null ? 'retired' : null };
}
export async function readMusicUpload(db, id, actorId) { return sessionView(await session(db, id, actorId)); }
function live(u, now) {
  if (u.cleanup_claimed_at !== null) fail('UPLOAD_RETIRED', 410);
  if (u.expires_at <= now || u.status === 'expired') fail('UPLOAD_EXPIRED', 410);
  if (u.status === 'rejected') fail('UPLOAD_REJECTED', 409);
}
async function rejectUpload(db, id, context, code) {
  await mutate(db, { ...context, route: `/admin/api/music/uploads/${id}/reject`, command: { code } }, async s => {
    const { u, a } = await session(db, id, context.actorId);
    return { condition: "EXISTS (SELECT 1 FROM music_upload_sessions WHERE id=? AND status='uploading')",
      params: [u.id], writes: [s.prepare("UPDATE music_assets SET state='rejected' WHERE id=? AND state='uploading'").bind(a.id),
        s.prepare("UPDATE music_upload_sessions SET status='rejected' WHERE id=? AND status='uploading'").bind(u.id)],
      action: 'music.upload.reject', targetId: a.id, summary: { code }, result: { status: 'rejected' } };
  });
}
export async function createMusicUpload(db, input, context) {
  fields(input, ['trackId', 'kind', 'format', 'byteSize', 'sha256', 'sourceAssetId', 'sourceStartMs', 'sourceEndMs']);
  const trackId = musicId(input.trackId), type = assetType(input.kind, input.format);
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) fail('INVALID_INPUT', 400);
  if (input.byteSize > ASSET_LIMITS[input.kind]) fail('FILE_TOO_LARGE', 413);
  if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('INVALID_INPUT', 400);
  const source = input.kind === 'preview' ? musicId(input.sourceAssetId) : null;
  if (input.kind !== 'preview' && ['sourceAssetId', 'sourceStartMs', 'sourceEndMs'].some(k => input[k] !== undefined)) fail('INVALID_INPUT', 400);
  if (source && (!Number.isSafeInteger(input.sourceStartMs) || input.sourceStartMs < 0 ||
    !Number.isSafeInteger(input.sourceEndMs) || input.sourceEndMs <= input.sourceStartMs)) fail('PREVIEW_INVALID');
  const command = { trackId, kind: input.kind, format: input.format, byteSize: input.byteSize, sha256: input.sha256,
    source, start: source ? input.sourceStartMs : null, end: source ? input.sourceEndMs : null };
  return mutate(db, { ...context, route: '/admin/api/music/uploads', command }, async (s, now) => {
    const usage = await uploadReadiness(db);
    if (!usage.quotaBytes) fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
    if (usage.chargedBytes + command.byteSize > usage.quotaBytes) fail('MUSIC_STORAGE_QUOTA', 409);
    const track = rows(await s.prepare("SELECT id FROM music_tracks WHERE id=? AND lifecycle<>'archived' AND draft_revision_id IS NOT NULL").bind(trackId).all())[0];
    if (!track) fail('MUSIC_DRAFT_REQUIRED', 409);
    if (source) {
      const a = (await loadAssets(db, [source]))[0];
      if (!a || a.state !== 'validated' || a.kind !== 'audio' || a.owner_track_id !== trackId || command.end > a.duration_ms) fail('MUSIC_ASSET_REFERENCE');
    }
    const id = crypto.randomUUID(), assetId = crypto.randomUUID(), expires = now + 86400000;
    const key = assetKey({ id: assetId, owner_track_id: trackId, kind: command.kind, format: command.format });
    return { condition: `EXISTS (SELECT 1 FROM music_tracks WHERE id=? AND lifecycle<>'archived' AND draft_revision_id IS NOT NULL)
      AND EXISTS (SELECT 1 FROM music_settings WHERE key='storageQuotaBytes' AND value_json=?)
      AND (${chargedSql}) + ? <= ?
      AND (SELECT COUNT(*) FROM music_upload_sessions WHERE actor_id=? AND status IN ('reserved','uploading') AND expires_at>?)<10`,
      params: [trackId, JSON.stringify(usage.quotaBytes), command.byteSize, usage.quotaBytes, context.actorId, now],
      writes: [s.prepare(`INSERT INTO music_assets(id,owner_track_id,kind,object_key,content_type,format,
        derived_from_asset_id,source_start_ms,source_end_ms,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .bind(assetId, trackId, command.kind, key, type, command.format, source, command.start, command.end, now),
      s.prepare(`INSERT INTO music_upload_sessions(id,asset_id,actor_id,declared_bytes,expires_at,created_at,expected_sha256)
        VALUES(?,?,?,?,?,?,?)`).bind(id, assetId, context.actorId, command.byteSize, expires, now, command.sha256)],
      action: 'music.upload.reserve', targetId: assetId, summary: { trackId, kind: command.kind, byteSize: command.byteSize },
      result: { uploadId: id, assetId, status: 'reserved', expiresAt: expires } };
  });
}

// One writer forever per object key. Unknown outcomes recover through GET/complete, never a second PUT.
export async function writeMusicUpload(db, bucket, id, request, context) {
  mutationKey(context.key);
  if (typeof bucket.put !== 'function' || typeof FixedLengthStream !== 'function') fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
  const initial = await session(db, id, context.actorId), { u, a } = initial;
  if (u.cleanup_claimed_at !== null) fail('UPLOAD_RETIRED', 410);
  if (u.status === 'completed') { void request.body?.cancel().catch(() => {}); return sessionView(initial); }
  live(u, Date.now());
  if (!u.expected_sha256) fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
  if (request.headers.get('content-type') !== a.content_type || request.headers.has('content-encoding')) fail('UNSUPPORTED_MEDIA_TYPE', 415);
  if (!request.body) fail('INVALID_INPUT', 400);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== u.declared_bytes)) fail('UPLOAD_SIZE_MISMATCH', 413);
  const claimed = await mutate(db, { ...context, route: `/admin/api/music/uploads/${id}/body`, command: {} }, async (s, now) => {
    live(u, now);
    return { condition: "EXISTS (SELECT 1 FROM music_upload_sessions WHERE id=? AND actor_id=? AND status='reserved' AND expires_at>?)",
      params: [id, context.actorId, now], writes: [s.prepare("UPDATE music_upload_sessions SET status='uploading',write_token=? WHERE id=? AND status='reserved'")
        .bind(context.key, id), s.prepare("UPDATE music_assets SET state='uploading' WHERE id=? AND state='reserved'").bind(a.id)],
      action: 'music.upload.start', targetId: a.id, summary: {}, result: { uploadId: id, status: 'uploading' } };
  });
  if (claimed.replayed) { void request.body.cancel().catch(() => {}); return readMusicUpload(db, id, context.actorId); }
  const input = boundedBody(request.body), { readable, writable } = new FixedLengthStream(u.declared_bytes);
  const controller = new AbortController(); let timer;
  const onAbort = () => controller.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) controller.abort();
  let received = 0, inputError;
  const counted = new TransformStream({
    transform(chunk, output) {
      received += chunk.byteLength;
      if (received > u.declared_bytes) {
        inputError = Object.assign(new Error('UPLOAD_SIZE_MISMATCH'), { code: 'UPLOAD_SIZE_MISMATCH', status: 413 }); throw inputError;
      }
      output.enqueue(chunk);
    },
    flush() {
      if (received !== u.declared_bytes) {
        inputError = Object.assign(new Error('UPLOAD_SIZE_MISMATCH'), { code: 'UPLOAD_SIZE_MISMATCH', status: 413 }); throw inputError;
      }
    }
  });
  const pumping = input.stream.pipeThrough(counted).pipeTo(writable, { signal: controller.signal });
  pumping.catch(() => {});
  try {
    const pending = Promise.resolve().then(() => bucket.put(a.object_key, readable, { onlyIf: { etagDoesNotMatch: '*' }, sha256: u.expected_sha256,
      httpMetadata: { contentType: a.content_type }, customMetadata: { musicUpload: id, musicAsset: a.id }, storageClass: 'Standard' }))
      .then(object => { if (!object) fail('UPLOAD_OBJECT_EXISTS', 409); return object; });
    const [object] = await Promise.race([Promise.all([pending, pumping]), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('UPLOAD_TIMEOUT'), { code: 'UPLOAD_TIMEOUT', status: 503 })), 120000);
    })]);
    if (object.size !== u.declared_bytes) fail('UPLOAD_SIZE_MISMATCH', 413);
    return { ...await readMusicUpload(db, id, context.actorId), readyToComplete: true };
  } catch (error) {
    // Do not release the reservation or delete an object after an ambiguous R2 acknowledgement.
    if (inputError) {
      try { await rejectUpload(db, id, context, inputError.code); } catch { /* Retain charge on uncertain DB outcome. */ }
      throw inputError;
    }
    if (error.status) throw error;
    fail('UPLOAD_WRITE_UNCONFIRMED', 503);
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); controller.abort(); input.close(); }
}

export async function completeMusicUpload(db, bucket, id, input, context) {
  fields(input, []);
  if ((await session(db, id, context.actorId)).u.cleanup_claimed_at !== null) fail('UPLOAD_RETIRED', 410);
  try { return await completeUpload(db, bucket, id, context); }
  catch (error) {
    if (error.code === 'UPLOAD_ALREADY_COMPLETED') return { ...await readMusicUpload(db, id, context.actorId), replayed: true };
    if (error.status === 422) {
      // A rejected file stays private and charged. M2-05 will reconcile/delete only proven unreferenced objects.
      try {
        await rejectUpload(db, id, context, error.code);
      } catch { /* Preserve the validation error; never mask a concurrent successful completion or free quota. */ }
    }
    throw error;
  }
}
async function completeUpload(db, bucket, id, context) {
  return mutate(db, { ...context, route: `/admin/api/music/uploads/${id}/complete`, command: {} }, async (s, now) => {
    const { u, a } = await session(db, id, context.actorId);
    if (u.cleanup_claimed_at !== null) fail('UPLOAD_RETIRED', 410);
    if (u.status === 'completed') fail('UPLOAD_ALREADY_COMPLETED', 409);
    live(u, now);
    if (u.status !== 'uploading' || !u.write_token || !u.expected_sha256) fail('UPLOAD_NOT_READY', 409);
    // Recovery also works when PUT persisted in R2 but its response was lost.
    const started = Date.now(); let timer;
    const remaining = () => { const ms = 10000 - (Date.now() - started); if (ms < 1) fail('MUSIC_STORAGE_TIMEOUT', 503); return ms; };
    let object;
    try {
      object = await Promise.race([Promise.resolve().then(() => bucket.head(a.object_key)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('MUSIC_STORAGE_TIMEOUT'), { code: 'MUSIC_STORAGE_TIMEOUT', status: 503 })), remaining());
      })]);
    } finally { clearTimeout(timer); }
    if (!object) fail('UPLOAD_NOT_READY', 409);
    if (object.size !== u.declared_bytes || object.httpMetadata?.contentType !== a.content_type ||
      object.customMetadata?.musicUpload !== id || object.customMetadata?.musicAsset !== a.id) fail('UPLOAD_OBJECT_MISMATCH', 409);
    const candidate = { ...a, state: 'uploaded', sha256: u.expected_sha256, etag: object.etag, byte_size: object.size };
    const proof = await verifyStoredMusicAsset(bucket, candidate, { timeoutMs: remaining() });
    const valid = { ...candidate, state: 'validated', duration_ms: proof.durationMs ?? null };
    if (a.kind === 'preview') {
      const full = (await loadAssets(db, [a.derived_from_asset_id]))[0];
      const fullProof = await verifyStoredMusicAsset(bucket, full, { timeoutMs: remaining() });
      const limit = rows(await s.prepare("SELECT value_json FROM music_settings WHERE key='previewLimitMs'").all())[0];
      validateMeasuredPreview(full, valid, fullProof, proof, { previewLimitMs: JSON.parse(limit.value_json) });
    }
    return { condition: "EXISTS (SELECT 1 FROM music_upload_sessions WHERE id=? AND actor_id=? AND status='uploading' AND write_token=? AND expires_at>?)",
      params: [id, context.actorId, u.write_token, Date.now()], writes: [
        s.prepare("UPDATE music_assets SET state='validated',byte_size=?,duration_ms=?,sha256=?,etag=? WHERE id=? AND state='uploading'")
          .bind(valid.byte_size, valid.duration_ms, valid.sha256, valid.etag, a.id),
        s.prepare("UPDATE music_upload_sessions SET status='completed',actual_bytes=? WHERE id=? AND status='uploading'").bind(valid.byte_size, id)],
      action: 'music.upload.complete', targetId: a.id, summary: { byteSize: valid.byte_size, durationMs: valid.duration_ms },
      result: { uploadId: id, assetId: a.id, state: 'validated', status: 'completed', durationMs: valid.duration_ms } };
  });
}
