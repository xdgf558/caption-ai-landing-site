import { fail, fields, musicId, mutationKey, text } from '../music/adminValidation.js';
import { primary, rows, mutate } from '../music/adminStore.js';
import { uploadReadiness } from '../music/uploads.js';
import { boundedBody } from '../music/storage.js';
import { STATION_MEDIA_LIMITS, STATION_VIDEO_LIMITS, stationMediaKey, stationMediaType } from './mediaFormats.js';
import { measureStationMedia } from './mediaResources.js';

const route = '/admin/api/music/site-uploads';
const charged = '(SELECT COALESCE(SUM(charged_bytes),0) FROM music_storage_charges)';
export async function stationMediaReadiness(db) {
  try {
    const s = primary(db);
    rows(await s.prepare('SELECT expected_sha256,write_token,validation_started_at,error_code FROM station_media_upload_sessions LIMIT 0').all());
    const sql = rows(await s.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='music_storage_charges'").all())[0]?.sql;
    if (!sql || !sql.includes('station_media_upload_sessions') || !sql.includes('station_media_assets') || !sql.includes('COALESCE(a.byte_size')) throw new Error('quota view');
    return { ...await uploadReadiness(db), limits: STATION_MEDIA_LIMITS, videoLimits: STATION_VIDEO_LIMITS };
  } catch { fail('STATION_MEDIA_SCHEMA_UNAVAILABLE', 503); }
}
async function session(db, id, actorId) {
  text(actorId, 200);
  const s = primary(db), u = rows(await s.prepare('SELECT * FROM station_media_upload_sessions WHERE id=? AND actor_id=?')
    .bind(musicId(id), actorId).all())[0];
  if (!u) fail('NOT_FOUND', 404);
  const a = rows(await s.prepare('SELECT * FROM station_media_assets WHERE id=?').bind(u.asset_id).all())[0];
  if (!a) fail('STATION_MEDIA_SCHEMA_UNAVAILABLE', 503);
  return { u, a };
}
function sessionView({ u, a }) {
  const expired = u.status !== 'completed' && u.expires_at <= Date.now();
  const terminal = ['rejected', 'expired'].includes(u.status) || expired;
  const phase = u.status === 'completed' ? 'ready' : terminal || u.error_code ? 'failed' : u.status === 'validating' ? 'validating' : 'uploading';
  return { uploadId: u.id, assetId: a.id, ownerId: a.owner_clip_id || a.owner_game_id, kind: a.kind,
    status: u.status, phase, expired, declaredBytes: u.declared_bytes, actualBytes: u.actual_bytes,
    durationMs: a.duration_ms, width: a.width, height: a.height, contentType: a.content_type,
    expiresAt: u.expires_at, createdAt: u.created_at, errorCode: u.error_code,
    recovery: terminal ? 'replace' : u.status === 'completed' ? null : u.status === 'reserved' ? 'start' : 'confirm' };
}
export async function readStationMediaUpload(db, id, actorId) { return sessionView(await session(db, id, actorId)); }
function live(u, now) {
  if (u.expires_at <= now || u.status === 'expired') fail('UPLOAD_EXPIRED', 410);
  if (u.status === 'rejected') fail('UPLOAD_REJECTED', 409);
}
function ownerGuard(kind, ownerId) {
  return kind === 'game_screenshot'
    ? { sql: "EXISTS (SELECT 1 FROM station_games g JOIN station_game_revisions r ON r.id=g.id AND r.revision=g.draft_revision WHERE g.id=? AND g.status<>'archived' AND r.state='draft')", params: [ownerId] }
    : { sql: "EXISTS (SELECT 1 FROM station_clips c JOIN station_clip_revisions r ON r.id=c.id AND r.revision=c.draft_revision JOIN music_tracks t ON t.id=c.track_id WHERE c.id=? AND c.status<>'archived' AND t.lifecycle<>'archived' AND r.state='draft' AND (?='poster' OR c.type=?))", params: [ownerId, kind, kind] };
}
function pageCursor(value) {
  if (value === undefined) return [Number.MAX_SAFE_INTEGER, ''];
  const match = /^(\d{1,16}):([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 0) fail('INVALID_INPUT', 400);
  return [Number(match[1]), match[2]];
}
export async function stationMediaOwners(db, input) {
  fields(input, ['kind', 'cursor']);
  if (!Object.hasOwn(STATION_MEDIA_LIMITS, input.kind)) fail('INVALID_INPUT', 400);
  const [before, after] = pageCursor(input.cursor);
  const game = input.kind === 'game_screenshot', s = primary(db);
  const items = rows(await s.prepare(game
    ? `SELECT g.id,g.slug,g.created_at,r.metadata_json FROM station_games g JOIN station_game_revisions r ON r.id=g.id AND r.revision=g.draft_revision
      WHERE g.status<>'archived' AND r.state='draft' AND (g.created_at<? OR (g.created_at=? AND g.id>?)) ORDER BY g.created_at DESC,g.id LIMIT 31`
    : `SELECT c.id,c.type,c.created_at,r.metadata_json,t.slug,
      (SELECT metadata_json FROM music_track_revisions WHERE id=COALESCE(t.draft_revision_id,t.published_revision_id)) AS parent_metadata_json
      FROM station_clips c JOIN station_clip_revisions r ON r.id=c.id AND r.revision=c.draft_revision JOIN music_tracks t ON t.id=c.track_id
      WHERE c.status<>'archived' AND t.lifecycle<>'archived' AND r.state='draft' AND (?='poster' OR c.type=?) AND (c.created_at<? OR (c.created_at=? AND c.id>?)) ORDER BY c.created_at DESC,c.id LIMIT 31`)
    .bind(...(game ? [before, before, after] : [input.kind, input.kind, before, before, after])).all());
  return { items: items.slice(0, 30).map(r => {
    let metadata; try { metadata = JSON.parse(r.metadata_json); } catch { fail('STATION_MEDIA_SCHEMA_UNAVAILABLE', 503); }
    const title = metadata?.title?.[metadata?.originalLocale] || Object.values(metadata?.title || {}).find(v => typeof v === 'string' && v.trim());
    let parent; try { parent = r.parent_metadata_json ? JSON.parse(r.parent_metadata_json) : null; } catch { fail('STATION_MEDIA_SCHEMA_UNAVAILABLE', 503); }
    const parentTitle = parent?.title?.[parent?.originalLocale];
    return { id: r.id, kind: r.type || 'game_screenshot', title: typeof title === 'string' ? title.slice(0, 120) : game ? '未命名游戏' : '未命名视频',
      parentTitle: typeof parentTitle === 'string' ? parentTitle.slice(0, 120) : null };
  }), nextCursor: items.length > 30 ? `${items[29].created_at}:${items[29].id}` : null };
}
export async function listStationMediaUploads(db, actorId, input) {
  fields(input, ['cursor']); text(actorId, 200);
  const [before, after] = pageCursor(input.cursor);
  // One snapshot avoids N+1 reads and stays within free-plan D1 query budgets.
  const found = rows(await primary(db).prepare(`SELECT u.*,a.id AS found_asset,a.owner_clip_id,a.owner_game_id,a.kind,a.content_type,a.duration_ms,a.width,a.height
    FROM station_media_upload_sessions u LEFT JOIN station_media_assets a ON a.id=u.asset_id
    WHERE u.actor_id=? AND (u.created_at<? OR (u.created_at=? AND u.id>?)) ORDER BY u.created_at DESC,u.id LIMIT 21`).bind(actorId, before, before, after).all());
  if (found.some(r => r.found_asset !== r.asset_id)) fail('STATION_MEDIA_SCHEMA_UNAVAILABLE', 503);
  const items = found.slice(0, 20).map(r => sessionView({ u: r, a: { ...r, id: r.asset_id } }));
  return { items, nextCursor: found.length > 20 ? `${found[19].created_at}:${found[19].id}` : null };
}
export async function createStationMediaUpload(db, input, context) {
  fields(input, ['ownerId', 'kind', 'format', 'byteSize', 'sha256']);
  const ownerId = musicId(input.ownerId), type = stationMediaType(input.kind, input.format);
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) fail('INVALID_INPUT', 400);
  if (input.byteSize > STATION_MEDIA_LIMITS[input.kind]) fail('FILE_TOO_LARGE', 413);
  await stationMediaReadiness(db);
  const command = { ...input, ownerId }, owner = ownerGuard(input.kind, ownerId);
  return mutate(db, { ...context, route, command, conflictCode: 'STATION_MEDIA_UPLOAD_CONFLICT' }, async (s, now) => {
    const usage = await uploadReadiness(db);
    if (!usage.quotaBytes) fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
    if (usage.chargedBytes + command.byteSize > usage.quotaBytes) fail('MUSIC_STORAGE_QUOTA', 409);
    if (!rows(await s.prepare(`SELECT 1 AS ok WHERE ${owner.sql}`).bind(...owner.params).all()).length) fail('STATION_MEDIA_DRAFT_REQUIRED', 409);
    const id = crypto.randomUUID(), assetId = crypto.randomUUID(), expiresAt = now + 86400000;
    const a = { id: assetId, kind: command.kind, content_type: type, [command.kind === 'game_screenshot' ? 'owner_game_id' : 'owner_clip_id']: ownerId };
    return { condition: `${owner.sql} AND EXISTS (SELECT 1 FROM music_settings WHERE key='storageQuotaBytes' AND value_json=?)
      AND ${charged}+?<=? AND (SELECT COUNT(*) FROM station_media_upload_sessions WHERE actor_id=? AND status IN ('reserved','uploading','uploaded','validating') AND expires_at>?)<10`,
      params: [...owner.params, JSON.stringify(usage.quotaBytes), command.byteSize, usage.quotaBytes, context.actorId, now],
      writes: [s.prepare('INSERT INTO station_media_assets(id,owner_clip_id,owner_game_id,kind,object_key,content_type,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind(assetId, a.owner_clip_id ?? null, a.owner_game_id ?? null, a.kind, stationMediaKey(a), type, now),
      s.prepare('INSERT INTO station_media_upload_sessions(id,asset_id,actor_id,declared_bytes,expected_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
        .bind(id, assetId, context.actorId, command.byteSize, command.sha256, now, expiresAt)],
      action: 'station.media.reserve', targetId: assetId, summary: { kind: a.kind, ownerId, byteSize: command.byteSize },
      result: { uploadId: id, assetId, status: 'reserved', phase: 'uploading', expiresAt } };
  });
}
async function recordFailure(db, id, context, code, terminal = false) {
  return mutate(db, { ...context, route: `${route}/${id}/${terminal ? 'reject' : 'error'}`, command: { code } }, async s => {
    const { u, a } = await session(db, id, context.actorId);
    return { condition: "EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=? AND status IN ('uploading','uploaded','validating'))",
      params: [id], writes: [s.prepare(`UPDATE station_media_upload_sessions SET error_code=?${terminal ? ",status='rejected'" : ''} WHERE id=?`).bind(code, u.id),
        ...(terminal ? [s.prepare("UPDATE station_media_assets SET state='rejected' WHERE id=? AND state IN ('uploading','uploaded')").bind(a.id)] : [])],
      action: terminal ? 'station.media.reject' : 'station.media.unconfirmed', targetId: a.id, summary: { code }, result: { status: terminal ? 'rejected' : u.status } };
  });
}

// One immutable object key and one PUT claimant per reservation. Replays query
// the original session; they never write again after an ambiguous acknowledgement.
export async function writeStationMediaUpload(db, bucket, id, request, context) {
  mutationKey(context.key);
  const initial = await session(db, id, context.actorId), { u, a } = initial;
  const dispose = () => { try { void request.body?.cancel().catch(() => {}); } catch {} };
  if (u.status === 'completed') { dispose(); return sessionView(initial); }
  live(u, Date.now());
  if (request.headers.get('content-type') !== a.content_type || request.headers.has('content-encoding')) fail('UNSUPPORTED_MEDIA_TYPE', 415);
  if (!request.body) fail('INVALID_INPUT', 400);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== u.declared_bytes)) fail('UPLOAD_SIZE_MISMATCH', 413);
  if (typeof bucket.put !== 'function' || typeof FixedLengthStream !== 'function') fail('MUSIC_UPLOADS_NOT_CONFIGURED', 503);
  const claimed = await mutate(db, { ...context, route: `${route}/${id}/body`, command: {}, conflictCode: 'STATION_MEDIA_UPLOAD_CONFLICT' }, async (s, now) => ({
    condition: "EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=? AND actor_id=? AND status='reserved' AND expires_at>?)",
    params: [id, context.actorId, now], writes: [s.prepare("UPDATE station_media_upload_sessions SET status='uploading',write_token=? WHERE id=? AND status='reserved'").bind(context.key, id),
      s.prepare("UPDATE station_media_assets SET state='uploading' WHERE id=? AND state='reserved'").bind(a.id)],
    action: 'station.media.start', targetId: a.id, summary: {}, result: { uploadId: id, status: 'uploading' }
  }));
  if (claimed.replayed) { dispose(); return readStationMediaUpload(db, id, context.actorId); }
  const input = boundedBody(request.body), { readable, writable } = new FixedLengthStream(u.declared_bytes);
  const controller = new AbortController(), onAbort = () => controller.abort();
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) controller.abort();
  let received = 0, inputError, timer;
  const counted = new TransformStream({ transform(chunk, output) {
    received += chunk.byteLength;
    if (received > u.declared_bytes) { inputError = Object.assign(new Error('UPLOAD_SIZE_MISMATCH'), { code: 'UPLOAD_SIZE_MISMATCH', status: 413 }); throw inputError; }
    output.enqueue(chunk);
  }, flush() {
    if (received !== u.declared_bytes) { inputError = Object.assign(new Error('UPLOAD_SIZE_MISMATCH'), { code: 'UPLOAD_SIZE_MISMATCH', status: 413 }); throw inputError; }
  } });
  const pumping = input.stream.pipeThrough(counted).pipeTo(writable, { signal: controller.signal });
  pumping.catch(() => {});
  try {
    const pending = Promise.resolve().then(() => bucket.put(a.object_key, readable, { onlyIf: { etagDoesNotMatch: '*' }, sha256: u.expected_sha256,
      httpMetadata: { contentType: a.content_type }, customMetadata: { stationUpload: id, stationAsset: a.id }, storageClass: 'Standard' }));
    const [object] = await Promise.race([Promise.all([pending, pumping]), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('UPLOAD_WRITE_UNCONFIRMED'), { code: 'UPLOAD_WRITE_UNCONFIRMED', status: 503 })), 120000);
    })]);
    if (!object) fail('UPLOAD_OBJECT_EXISTS', 409);
    if (object.size !== u.declared_bytes) fail('UPLOAD_SIZE_MISMATCH', 413);
    const current = await session(db, id, context.actorId);
    if (current.u.status === 'uploading') await mutate(db, { ...context, route: `${route}/${id}/stored`, command: {} }, async s => ({
      condition: "EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=? AND status='uploading')", params: [id],
      writes: [s.prepare("UPDATE station_media_assets SET state='uploaded',byte_size=?,sha256=? WHERE id=? AND state='uploading'").bind(u.declared_bytes, u.expected_sha256, a.id),
        s.prepare("UPDATE station_media_upload_sessions SET status='uploaded',actual_bytes=?,error_code=NULL WHERE id=? AND status='uploading'").bind(u.declared_bytes, id)],
      action: 'station.media.stored', targetId: a.id, summary: {}, result: { status: 'uploaded' }
    }));
    return { ...await readStationMediaUpload(db, id, context.actorId), readyToComplete: true };
  } catch (error) {
    const code = inputError?.code || 'UPLOAD_WRITE_UNCONFIRMED';
    try { await recordFailure(db, id, context, code, !!inputError); } catch { /* Keep reservation and charge on unknown DB outcome. */ }
    if (inputError) throw inputError;
    if (error.status) throw error;
    fail('UPLOAD_WRITE_UNCONFIRMED', 503);
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort', onAbort); controller.abort(); input.close(); }
}

export async function completeStationMediaUpload(db, bucket, id, input, context, options = {}) {
  fields(input, []); mutationKey(context.key);
  let initial = await session(db, id, context.actorId);
  if (initial.u.status === 'completed') return { ...sessionView(initial), replayed: true };
  live(initial.u, Date.now());
  if (!['uploading','uploaded','validating'].includes(initial.u.status) || !initial.u.write_token) fail('UPLOAD_NOT_READY', 409);
  const attempt = { ...context, key: crypto.randomUUID() };
  try {
    if (initial.u.status === 'validating') {
      await mutate(db, { ...attempt, route: `${route}/${id}/validation`, command: {}, conflictCode: 'STATION_MEDIA_UPLOAD_CONFLICT' }, async (s, now) => ({
        condition: "EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=? AND actor_id=? AND status='validating' AND expires_at>?)",
        params: [id, context.actorId, now], writes: [s.prepare("UPDATE station_media_upload_sessions SET validation_started_at=?,error_code=NULL WHERE id=? AND status='validating'").bind(now, id)],
        action: 'station.media.validate', targetId: initial.a.id, summary: { retry: true }, result: { status: 'validating' }
      }));
    } else {
      await mutate(db, { ...attempt, route: `${route}/${id}/validation`, command: {}, conflictCode: 'STATION_MEDIA_UPLOAD_CONFLICT' }, async (s, now) => ({
        condition: "EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=? AND actor_id=? AND status IN ('uploading','uploaded') AND expires_at>?)",
        params: [id, context.actorId, now], writes: [s.prepare("UPDATE station_media_upload_sessions SET status='validating',validation_started_at=?,error_code=NULL WHERE id=?").bind(now, id)],
        action: 'station.media.validate', targetId: initial.a.id, summary: {}, result: { status: 'validating' }
      }));
    }
  } catch (error) {
    if (error.code !== 'STATION_MEDIA_UPLOAD_CONFLICT') throw error;
    const current = await session(db, id, context.actorId);
    if (current.u.status === 'completed') return { ...sessionView(current), replayed: true };
    if (current.u.status !== 'validating') throw error;
  }
  initial = await session(db, id, context.actorId);
  try {
    // Revalidation is safe after a Worker interruption: the only writer has been
    // claimed forever, and every successful proof covers the declared SHA/bytes.
    const proof = await measureStationMedia(bucket, initial.a, initial.u, options);
    await mutate(db, { ...context, route: `${route}/${id}/complete`, command: {}, conflictCode: 'STATION_MEDIA_UPLOAD_CONFLICT' }, async (s, now) => ({
      condition: "EXISTS (SELECT 1 FROM station_media_upload_sessions WHERE id=? AND actor_id=? AND status='validating' AND expires_at>?)",
      params: [id, context.actorId, now], writes: [s.prepare("UPDATE station_media_assets SET state='validated',byte_size=?,sha256=?,etag=?,duration_ms=?,width=?,height=? WHERE id=? AND state IN ('uploading','uploaded')")
        .bind(proof.byteSize, proof.sha256, proof.etag, proof.durationMs ?? null, proof.width, proof.height, initial.a.id),
      s.prepare("UPDATE station_media_upload_sessions SET status='completed',actual_bytes=?,error_code=NULL WHERE id=? AND status='validating'").bind(proof.byteSize, id)],
      action: 'station.media.complete', targetId: initial.a.id, summary: { measurement: proof.measurement, durationMs: proof.durationMs ?? null, width: proof.width, height: proof.height },
      result: { uploadId: id, assetId: initial.a.id, status: 'completed' }
    }));
    return { ...await readStationMediaUpload(db, id, context.actorId), measurement: proof.measurement };
  } catch (error) {
    const current = await session(db, id, context.actorId).catch(() => null);
    if (current?.u.status === 'completed') return { ...sessionView(current), replayed: true };
    try { await recordFailure(db, id, attempt, error.status === 422 ? error.code : 'STATION_MEDIA_VALIDATION_UNCONFIRMED', error.status === 422); }
    catch { /* Failed confirmation never releases storage or publishes media. */ }
    throw error;
  }
}
