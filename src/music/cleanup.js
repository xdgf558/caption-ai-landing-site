import { primary, rows, mutate } from './adminStore.js';
import { fail, fields, musicId, mutationKey, text } from './adminValidation.js';
import { assetKey, assetType } from './assetFormats.js';
import { publicationHash } from './publicationValidation.js';
import { isoTime } from './policy.js';

export const CLEANUP_RETENTION_MS = 7 * 86400000;
const references = ['revision_ref', 'evidence_ref', 'rights_ref', 'derived_ref', 'audit_ref'];
const select = `SELECT a.*,u.id AS upload_id,u.status AS upload_status,u.declared_bytes,
  u.expected_sha256,u.write_token,u.expires_at,u.rowid AS cursor,
  r.revision_ref,r.evidence_ref,r.rights_ref,r.derived_ref,r.audit_ref,
  c.actor_id AS cleanup_actor,c.reason AS cleanup_reason,c.plan_hash,c.claimed_at,c.proof_json,c.proved_at,c.released_at
  FROM music_upload_sessions u JOIN music_assets a ON a.id=u.asset_id
  JOIN music_asset_references r ON r.id=a.id LEFT JOIN music_upload_cleanup c ON c.upload_id=u.id`;

export async function cleanupReadiness(db) {
  try {
    const s = primary(db);
    rows(await s.prepare('SELECT proof_json,released_at FROM music_upload_cleanup LIMIT 0').all());
    rows(await s.prepare('SELECT charged_bytes FROM music_storage_charges LIMIT 0').all());
    return { retentionMs: CLEANUP_RETENTION_MS, pageSize: 25, maxExecuteItems: 1 };
  } catch { fail('MUSIC_CLEANUP_NOT_CONFIGURED', 503); }
}
async function load(db, id) {
  const row = rows(await primary(db).prepare(`${select} WHERE u.id=?`).bind(id).all())[0];
  if (!row) fail('NOT_FOUND', 404);
  return row;
}
function identity(row) {
  musicId(row.id); musicId(row.owner_track_id); musicId(row.upload_id);
  if (row.object_key !== assetKey(row) || assetType(row.kind, row.format) !== row.content_type ||
    !Number.isSafeInteger(row.declared_bytes) || row.declared_bytes < 1 ||
    typeof row.expected_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.expected_sha256)) {
    fail('CLEANUP_IDENTITY_INVALID', 409);
  }
}
function state(row) {
  return row.released_at !== null ? 'released' : row.proof_json !== null ? 'proved'
    : row.claimed_at !== null ? 'retired' : 'unclaimed';
}
function blocked(row, now) {
  if (references.some(k => row[k] !== 0)) return 'ASSET_REFERENCED';
  if (row.expires_at + CLEANUP_RETENTION_MS > now) return 'RETENTION_PENDING';
  try { identity(row); } catch { return 'CLEANUP_IDENTITY_INVALID'; }
  return null;
}
async function hashPlan(row) {
  // Includes writer identity and every mutable asset attribute; never exposes the token itself.
  return publicationHash({ asset: Object.fromEntries(['id','owner_track_id','kind','format','object_key','state',
    'content_type','byte_size','duration_ms','sha256','etag','derived_from_asset_id','source_start_ms','source_end_ms',
    'created_at'].map(k => [k,row[k]])), upload: { id: row.upload_id, status: row.upload_status,
    bytes: row.declared_bytes, sha256: row.expected_sha256, token: row.write_token, expires: row.expires_at },
    references: Object.fromEntries(references.map(k => [k,row[k]])), retentionMs: CLEANUP_RETENTION_MS });
}
function result(row, extra = {}) {
  return { uploadId: row.upload_id, assetId: row.id, cleanupState: state(row),
    chargedBytes: row.released_at === null ? row.declared_bytes : 0,
    releasedBytes: row.released_at === null ? 0 : row.declared_bytes, ...extra };
}

// Read-only planning: no state changes, R2 writes, body reads or unbounded bucket listing.
export async function planMusicCleanup(db, { before = Number.MAX_SAFE_INTEGER } = {}, { clock = Date.now } = {}) {
  if (!Number.isSafeInteger(before) || before < 1) fail('INVALID_INPUT', 400);
  const now = clock(); isoTime(now); await cleanupReadiness(db);
  const found = rows(await primary(db).prepare(`${select} WHERE u.rowid<? AND u.expires_at<=?
    ORDER BY u.rowid DESC LIMIT 26`).bind(before, now).all());
  const items = [];
  for (const row of found.slice(0,25)) {
    const reason = blocked(row, now);
    items.push({ ...result(row), objectKey: row.object_key, kind: row.kind, uploadStatus: row.upload_status,
      eligibleAt: row.expires_at + CLEANUP_RETENTION_MS, blockedReason: reason,
      references: Object.fromEntries(references.map(k => [k.replace('_ref',''),Boolean(row[k])])),
      writerEvidence: row.proof_json ? JSON.parse(row.proof_json).kind : row.write_token ? 'object_proof_required' : 'never_started',
      planHash: reason ? null : row.plan_hash ?? await hashPlan(row) });
  }
  return { dryRun: true, items, nextBefore: found.length > 25 ? found[24].cursor : null,
    retentionMs: CLEANUP_RETENTION_MS, objectChecksPending: true };
}

async function storageCall(fn, timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('CLEANUP_STORAGE_TIMEOUT'),
        { code: 'CLEANUP_STORAGE_TIMEOUT', status: 503 })), timeoutMs);
    })]);
  } catch (error) {
    if (error.code === 'CLEANUP_STORAGE_TIMEOUT') throw error;
    fail('CLEANUP_STORAGE_UNAVAILABLE', 503);
  } finally { clearTimeout(timer); }
}
function observedProof(row, object) {
  if (object.key !== row.object_key || object.size !== row.declared_bytes ||
    object.customMetadata?.musicUpload !== row.upload_id || object.customMetadata?.musicAsset !== row.id ||
    object.httpMetadata?.contentType !== row.content_type || typeof object.etag !== 'string' || !object.etag ||
    typeof object.version !== 'string' || !object.version || (row.etag !== null && object.etag !== row.etag)) {
    fail('CLEANUP_OBJECT_MISMATCH', 409);
  }
  return { kind: 'object_observed', version: object.version, etag: object.etag, size: object.size };
}
async function phase(db, row, context, name, proof = null) {
  // One durable receipt per upload/phase, also when another administrator resumes the job.
  await mutate(db, { actorId: row.cleanup_actor, key: row.upload_id, clock: context.clock,
    route: `/admin/api/music/cleanup/${row.upload_id}/${name}`, command: { uploadId: row.upload_id },
    conflictCode: 'CLEANUP_CONFLICT' }, async (s, now) => ({
    condition: `EXISTS (SELECT 1 FROM music_upload_cleanup c JOIN music_asset_references r ON r.id=c.asset_id
      WHERE c.upload_id=? AND c.plan_hash=? AND c.released_at IS NULL
      AND r.revision_ref=0 AND r.evidence_ref=0 AND r.rights_ref=0 AND r.derived_ref=0 AND r.audit_ref=0
      AND c.proof_json IS ?)`, params: [row.upload_id,row.plan_hash,row.proof_json],
    writes: [name === 'prove'
      ? s.prepare('UPDATE music_upload_cleanup SET proof_json=?,proved_at=? WHERE upload_id=? AND proof_json IS NULL')
        .bind(JSON.stringify(proof),now,row.upload_id)
      : s.prepare('UPDATE music_upload_cleanup SET released_at=? WHERE upload_id=? AND proof_json IS NOT NULL AND released_at IS NULL')
        .bind(now,row.upload_id)],
    action: `music.cleanup.${name}`, targetId: row.id,
    summary: { uploadId: row.upload_id, executor: context.actorId,
      ...(name === 'prove' ? { proof } : { releasedBytes: row.declared_bytes }) },
    result: { uploadId: row.upload_id, phase: name }
  }));
}

export async function executeMusicCleanup(db, bucket, id, input, context) {
  id = musicId(id); fields(input, ['planHash','reason']); mutationKey(context.key);
  const reason = text(input.reason,1000);
  if (typeof input.planHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.planHash)) fail('INVALID_INPUT',400);
  const timeoutMs = context.storageTimeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) fail('INVALID_INPUT',400);
  if (typeof bucket?.head !== 'function' || typeof bucket?.delete !== 'function') fail('MUSIC_CLEANUP_NOT_CONFIGURED',503);
  await cleanupReadiness(db);
  let row = await load(db,id);
  if (row.claimed_at === null) {
    await mutate(db, { ...context, route: `/admin/api/music/cleanup/${id}`, command: { planHash: input.planHash, reason },
      conflictCode: 'CLEANUP_PLAN_STALE' }, async (s, now) => {
      const current = await load(db,id), why = blocked(current,now);
      if (why) fail(why,409);
      if (await hashPlan(current) !== input.planHash) fail('CLEANUP_PLAN_STALE',409);
      // The migration trigger rechecks references and retirement in this transaction.
      const assetFields = ['id','owner_track_id','kind','format','object_key','state','content_type','byte_size',
        'duration_ms','sha256','etag','derived_from_asset_id','source_start_ms','source_end_ms','created_at'];
      return { condition: `EXISTS (SELECT 1 FROM music_upload_sessions WHERE id=? AND status=? AND write_token IS ?)
          AND EXISTS (SELECT 1 FROM music_assets WHERE ${assetFields.map(k => `${k} IS ?`).join(' AND ')})`,
        params: [id,current.upload_status,current.write_token,...assetFields.map(k => current[k])],
        writes: [s.prepare(`INSERT INTO music_upload_cleanup(upload_id,asset_id,actor_id,reason,plan_hash,claimed_at)
          VALUES(?,?,?,?,?,?)`).bind(id,current.id,context.actorId,reason,input.planHash,now)],
        action: 'music.cleanup.claim', targetId: current.id,
        summary: { uploadId: id, planHash: input.planHash, reason }, result: { uploadId: id } };
    }).catch(async error => {
      // Two callers may retire the same reviewed snapshot. Resume only the same plan/reason.
      const current = await load(db,id);
      if (current.plan_hash !== input.planHash || current.cleanup_reason !== reason) throw error;
    });
    row = await load(db,id);
  }
  if (row.plan_hash !== input.planHash || row.cleanup_reason !== reason) fail('IDEMPOTENCY_CONFLICT',409);
  if (row.released_at !== null) return result(row,{ replayed: true });
  identity(row);
  const why = blocked(row,(context.clock ?? Date.now)()); if (why) fail(why,409);
  let object = await storageCall(() => bucket.head(row.object_key),timeoutMs);
  if (row.proof_json === null) {
    let proof;
    if (row.write_token === null) {
      if (object !== null) fail('CLEANUP_OBJECT_MISMATCH',409);
      proof = { kind: 'never_started' };
    } else {
      // An absent object is NOT evidence that a timed-out PUT cannot commit later.
      if (object === null) return result(row,{ code: 'CLEANUP_WRITE_UNCONFIRMED' });
      proof = observedProof(row,object);
    }
    await phase(db,row,context,'prove',proof);
    row = await load(db,id);
  }
  if (row.released_at !== null) return result(row,{ replayed: true });
  const proof = JSON.parse(row.proof_json);
  // Persist proof before deletion so lost delete acknowledgements can recover from absence.
  object = await storageCall(() => bucket.head(row.object_key),timeoutMs);
  if (object !== null) {
    if (proof.kind !== 'object_observed' || JSON.stringify(observedProof(row,object)) !== JSON.stringify(proof)) {
      fail('CLEANUP_OBJECT_CHANGED',409);
    }
    const latest = await load(db,id);
    if (references.some(k => latest[k] !== 0)) fail('ASSET_REFERENCED',409);
    await storageCall(() => bucket.delete(row.object_key),timeoutMs);
  }
  if (await storageCall(() => bucket.head(row.object_key),timeoutMs) !== null) fail('CLEANUP_DELETE_UNCONFIRMED',503);
  await phase(db,row,context,'release');
  return result(await load(db,id));
}
