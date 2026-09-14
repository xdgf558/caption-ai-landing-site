// Independent collection ownership; same one-writer and retained-charge protocol as track uploads.
import { assetKey, assetType, ASSET_LIMITS } from './assetFormats.js';
import { fail, fields, musicId, mutationKey } from './adminValidation.js';
import { primary, rows, mutate } from './adminStore.js';
import { verifyStoredMusicAsset } from './resources.js';
import { uploadReadiness } from './uploads.js';
import { boundedBody } from './storage.js';

const chargedSql = '(SELECT COALESCE(SUM(charged_bytes),0) FROM music_storage_charges)';
async function session(db, id, actorId) {
  const u = rows(await primary(db).prepare(`SELECT u.*,NULL AS cleanup_claimed_at,NULL AS cleanup_released_at
    FROM music_collection_upload_sessions u
    WHERE u.id=? AND u.actor_id=?`).bind(musicId(id), actorId).all())[0];
  if (!u) fail('NOT_FOUND', 404);
  const a = rows(await primary(db).prepare('SELECT * FROM music_collection_assets WHERE id=?').bind(u.asset_id).all())[0];
  if (!a) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  return { u, a };
}
function sessionView({ u, a }) {
  return { uploadId: u.id, assetId: a.id, collectionId: a.owner_collection_id, status: u.status,
    expired: u.status !== 'completed' && u.expires_at <= Date.now(), state: a.state,
    declaredBytes: u.declared_bytes, actualBytes: u.actual_bytes,
    contentType: a.content_type, expiresAt: u.expires_at,
    cleanupState: u.cleanup_released_at !== null ? 'released' : u.cleanup_claimed_at !== null ? 'retired' : null };
}
export async function readAlbumCoverUpload(db, id, actorId) { return sessionView(await session(db, id, actorId)); }
function live(u, now) {
  if (u.cleanup_claimed_at !== null) fail('UPLOAD_RETIRED', 410);
  if (u.expires_at <= now || u.status === 'expired') fail('UPLOAD_EXPIRED', 410);
  if (u.status === 'rejected') fail('UPLOAD_REJECTED', 409);
}
async function rejectUpload(db, id, context, code) {
  await mutate(db, { ...context, route: `/admin/api/music/collection-uploads/${id}/reject`, command: { code } }, async s => {
    const { u, a } = await session(db, id, context.actorId);
    return { condition: "EXISTS (SELECT 1 FROM music_collection_upload_sessions WHERE id=? AND status='uploading')",
      params: [u.id], writes: [s.prepare("UPDATE music_collection_assets SET state='rejected' WHERE id=? AND state='uploading'").bind(a.id),
        s.prepare("UPDATE music_collection_upload_sessions SET status='rejected' WHERE id=? AND status='uploading'").bind(u.id)],
      action: 'music.upload.reject', targetId: a.id, summary: { code }, result: { status: 'rejected' } };
  });
}
export async function createAlbumCoverUpload(db, input, context) {
  fields(input, ['collectionId', 'format', 'byteSize', 'sha256']);
  const collectionId = musicId(input.collectionId), type = assetType('cover', input.format);
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1) fail('INVALID_INPUT', 400);
  if (input.byteSize > ASSET_LIMITS.cover) fail('FILE_TOO_LARGE', 413);
  if (typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('INVALID_INPUT', 400);
  const command = { collectionId, kind:'cover', format:input.format, byteSize:input.byteSize, sha256:input.sha256 };
  return mutate(db, { ...context, route: '/admin/api/music/collection-uploads', command }, async (s, now) => {
    const usage = await uploadReadiness(db);
    if (!usage.quotaBytes) fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
    if (usage.chargedBytes + command.byteSize > usage.quotaBytes) fail('MUSIC_STORAGE_QUOTA', 409);
    const collection = rows(await s.prepare("SELECT id FROM music_collections WHERE id=? AND collection_type='album' AND status='draft'").bind(collectionId).all())[0];
    if (!collection) fail('MUSIC_DRAFT_REQUIRED', 409);
    const id = crypto.randomUUID(), assetId = crypto.randomUUID(), expires = now + 86400000;
    const key = assetKey({ id: assetId, owner_collection_id: collectionId, kind: command.kind, format: command.format });
    return { condition: `EXISTS (SELECT 1 FROM music_collections WHERE id=? AND collection_type='album' AND status='draft')
      AND EXISTS (SELECT 1 FROM music_settings WHERE key='storageQuotaBytes' AND value_json=?)
      AND (${chargedSql}) + ? <= ?
      AND (SELECT COUNT(*) FROM music_collection_upload_sessions WHERE actor_id=? AND status IN ('reserved','uploading') AND expires_at>?)<10`,
      params: [collectionId, JSON.stringify(usage.quotaBytes), command.byteSize, usage.quotaBytes, context.actorId, now],
      writes: [s.prepare(`INSERT INTO music_collection_assets(id,owner_collection_id,kind,object_key,content_type,format,
        created_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(assetId, collectionId, command.kind, key, type, command.format, now),
      s.prepare(`INSERT INTO music_collection_upload_sessions(id,asset_id,actor_id,declared_bytes,expires_at,created_at,expected_sha256)
        VALUES(?,?,?,?,?,?,?)`).bind(id, assetId, context.actorId, command.byteSize, expires, now, command.sha256)],
      action: 'music.upload.reserve', targetId: assetId, summary: { collectionId, kind: command.kind, byteSize: command.byteSize },
      result: { uploadId: id, assetId, status: 'reserved', expiresAt: expires } };
  });
}

// One writer forever per object key. Unknown outcomes recover through GET/complete, never a second PUT.
export async function writeAlbumCoverUpload(db, bucket, id, request, context) {
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
  const claimed = await mutate(db, { ...context, route: `/admin/api/music/collection-uploads/${id}/body`, command: {} }, async (s, now) => {
    live(u, now);
    return { condition: "EXISTS (SELECT 1 FROM music_collection_upload_sessions u JOIN music_collection_assets a ON a.id=u.asset_id JOIN music_collections c ON c.id=a.owner_collection_id WHERE u.id=? AND u.actor_id=? AND u.status='reserved' AND u.expires_at>? AND c.status='draft' AND c.collection_type='album')",
      params: [id, context.actorId, now], writes: [s.prepare("UPDATE music_collection_upload_sessions SET status='uploading',write_token=? WHERE id=? AND status='reserved'")
        .bind(context.key, id), s.prepare("UPDATE music_collection_assets SET state='uploading' WHERE id=? AND state='reserved'").bind(a.id)],
      action: 'music.upload.start', targetId: a.id, summary: {}, result: { uploadId: id, status: 'uploading' } };
  });
  if (claimed.replayed) { void request.body.cancel().catch(() => {}); return readAlbumCoverUpload(db, id, context.actorId); }
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
    return { ...await readAlbumCoverUpload(db, id, context.actorId), readyToComplete: true };
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

export async function completeAlbumCoverUpload(db, bucket, id, input, context) {
  fields(input, []);
  if ((await session(db, id, context.actorId)).u.cleanup_claimed_at !== null) fail('UPLOAD_RETIRED', 410);
  try { return await completeUpload(db, bucket, id, context); }
  catch (error) {
    if (error.code === 'UPLOAD_ALREADY_COMPLETED') return { ...await readAlbumCoverUpload(db, id, context.actorId), replayed: true };
    if (error.status === 422) {
      // A rejected album file stays private and charged; no album cleanup is enabled.
      try {
        await rejectUpload(db, id, context, error.code);
      } catch { /* Preserve the validation error; never mask a concurrent successful completion or free quota. */ }
    }
    throw error;
  }
}
async function completeUpload(db, bucket, id, context) {
  return mutate(db, { ...context, route: `/admin/api/music/collection-uploads/${id}/complete`, command: {} }, async (s, now) => {
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
    return { condition: "EXISTS (SELECT 1 FROM music_collection_upload_sessions WHERE id=? AND actor_id=? AND status='uploading' AND write_token=? AND expires_at>?)",
      params: [id, context.actorId, u.write_token, Date.now()], writes: [
        s.prepare("UPDATE music_collection_assets SET state='validated',byte_size=?,sha256=?,etag=? WHERE id=? AND state='uploading'")
          .bind(valid.byte_size, valid.sha256, valid.etag, a.id),
        s.prepare("UPDATE music_collection_upload_sessions SET status='completed',actual_bytes=? WHERE id=? AND status='uploading'").bind(valid.byte_size, id)],
      action: 'music.upload.complete', targetId: a.id, summary: { byteSize: valid.byte_size, durationMs: valid.duration_ms },
      result: { uploadId: id, assetId: a.id, state: 'validated', status: 'completed', durationMs: valid.duration_ms } };
  });
}
