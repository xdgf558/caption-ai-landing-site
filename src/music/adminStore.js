import { publicationHash } from './publicationValidation.js';
import { isoTime } from './policy.js';
import { fail, mutationKey, text } from './adminValidation.js';

export function primary(db) {
  if (typeof db?.withSession !== 'function') fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  return db.withSession('first-primary');
}
export function rows(result) {
  if (result?.success !== true || !Array.isArray(result.results)) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  return result.results;
}
export async function loadTrack(db, id) {
  const s = primary(db);
  const data = (await s.batch([
    s.prepare('SELECT * FROM music_tracks WHERE id=?').bind(id),
    s.prepare(`SELECT * FROM music_track_revisions WHERE id IN
      (SELECT COALESCE(draft_revision_id,published_revision_id) FROM music_tracks WHERE id=?
       UNION SELECT published_revision_id FROM music_tracks WHERE id=?)`).bind(id, id),
    s.prepare('SELECT COALESCE(MAX(revision_no),0) AS n FROM music_track_revisions WHERE track_id=?').bind(id),
    s.prepare(`SELECT * FROM music_rights_reviews WHERE revision_id=
      (SELECT COALESCE(draft_revision_id,published_revision_id) FROM music_tracks WHERE id=?)`).bind(id),
    s.prepare(`SELECT e.* FROM music_rights_evidence e JOIN music_rights_reviews r ON r.id=e.review_id
      WHERE r.revision_id=(SELECT COALESCE(draft_revision_id,published_revision_id) FROM music_tracks WHERE id=?) ORDER BY e.asset_id LIMIT 11`).bind(id)
  ])).map(rows);
  const track = data[0][0];
  if (!track) fail('NOT_FOUND', 404);
  const revision = data[1].find(r => r.id === (track.draft_revision_id ?? track.published_revision_id));
  const previous = data[1].find(r => r.id === track.published_revision_id) ?? null;
  if (track.lifecycle !== 'archived' && (!revision || revision.track_id !== id)) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  if (data[4].length > 10) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  return { track, revision, previous, lastRevision: data[2][0].n, rights: data[3][0] ?? null, evidence: data[4] };
}
export async function loadAssets(db, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  if (unique.length > 14) fail('INVALID_INPUT', 400);
  return rows(await primary(db).prepare(`SELECT * FROM music_assets WHERE id IN (${unique.map(() => '?').join(',')}) ORDER BY id`)
    .bind(...unique).all());
}

// Internal writes only: actor identity and normalized command must come from the guarded HTTP adapter.
export async function mutate(db, { actorId, route, key, command, clock = Date.now, conflictCode = 'MUSIC_EDIT_CONFLICT' }, build) {
  text(actorId, 200); mutationKey(key);
  const hash = await publicationHash(command);
  const receipt = async () => {
    const saved = rows(await primary(db).prepare(`SELECT request_hash,result_json FROM music_mutations
      WHERE actor_id=? AND route=? AND idempotency_key=?`).bind(actorId, route, key).all())[0];
    if (!saved) return null;
    if (saved.request_hash !== hash) fail('IDEMPOTENCY_CONFLICT', 409);
    return { ...JSON.parse(saved.result_json), replayed: true };
  };
  try {
    const saved = await receipt(); if (saved) return saved;
    const now = clock(); isoTime(now);
    const s = primary(db), token = crypto.randomUUID();
    const plan = await build(s, now);
    const batch = [s.prepare(`INSERT INTO music_publication_guards(operation_token,passed)
      VALUES (?,CASE WHEN (${plan.condition}) AND NOT EXISTS
      (SELECT 1 FROM music_mutations WHERE actor_id=? AND route=? AND idempotency_key=?) THEN 1 ELSE NULL END)`)
      .bind(token, ...plan.params, actorId, route, key)];
    const checked = (statement, expected = 1) => {
      batch.push(statement);
      batch.push(s.prepare('UPDATE music_publication_guards SET passed=CASE WHEN changes()=? THEN 1 ELSE NULL END WHERE operation_token=?')
        .bind(expected, token));
    };
    // Native D1PreparedStatement also has a .statement SQL string. Only unwrap explicit count descriptors.
    for (const step of plan.writes) {
      if (Object.hasOwn(step, 'expected')) checked(step.statement, step.expected);
      else checked(step);
    }
    checked(s.prepare(`INSERT INTO music_admin_audit_logs(id,actor_id,action,target_id,summary_json,request_id,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(token, actorId, plan.action, plan.targetId, JSON.stringify(plan.summary), token, now));
    checked(s.prepare(`INSERT INTO music_mutations(actor_id,route,idempotency_key,request_hash,result_json,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(actorId, route, key, hash, JSON.stringify(plan.result), now + 86400000, now));
    batch.push(s.prepare('DELETE FROM music_publication_guards WHERE operation_token=?').bind(token));
    if ((await s.batch(batch)).some(r => r.success !== true)) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
    const committed = await receipt();
    if (!committed) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
    return { ...committed, replayed: false };
  } catch (error) {
    // Unknown commit outcomes and identical races only replay the caller's original receipt.
    try { const saved = await receipt(); if (saved) return saved; }
    catch (e) { if (e.code === 'IDEMPOTENCY_CONFLICT') throw e; }
    if (error.status) throw error;
    if (['MUSIC_INVALID_POLICY', 'MUSIC_INVALID_UTC', 'MUSIC_EARLY_ACCESS_NOT_FUTURE', 'MUSIC_POLICY_VERSION_CONFLICT'].includes(error.code)) {
      fail(error.code, error.code.endsWith('CONFLICT') ? 409 : 422);
    }
    if (/music_publication_guards\.passed|MUSIC_IMMUTABLE_MUTATION|UNIQUE constraint failed/.test(error.message)) fail(conflictCode, 409);
    fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  }
}

// Match optional documentation, including absence, in the same write transaction.
// A concurrent block or first review must invalidate an in-flight technical check.
export function rightsGuard({ revision, rights, evidence }) {
  if (!rights) return { condition: 'NOT EXISTS (SELECT 1 FROM music_rights_reviews WHERE revision_id=?)', params: [revision.id] };
  const fields = ['id', 'revision_id', 'review_json', 'review_status', 'reviewer_id', 'reviewed_at', 'revision_fingerprint'];
  const conditions = [`EXISTS (SELECT 1 FROM music_rights_reviews WHERE ${fields.map(field => `${field} IS ?`).join(' AND ')})`,
    '(SELECT COUNT(*) FROM music_rights_evidence WHERE review_id=?)=?'];
  const params = [...fields.map(field => rights[field]), rights.id, evidence.length];
  for (const row of evidence) {
    conditions.push('EXISTS (SELECT 1 FROM music_rights_evidence WHERE review_id=? AND asset_id=?)');
    params.push(row.review_id, row.asset_id);
  }
  return { condition: conditions.join(' AND '), params };
}

export function trackGuard(snapshot, version) {
  const { track, revision } = snapshot;
  if (track.edit_version !== version) fail('MUSIC_EDIT_CONFLICT', 409);
  const conditions = ['EXISTS (SELECT 1 FROM music_tracks WHERE id=? AND edit_version=? AND lifecycle=? AND draft_revision_id IS ? AND published_revision_id IS ? AND slug=?)'];
  const params = [track.id, version, track.lifecycle, track.draft_revision_id, track.published_revision_id, track.slug];
  if (revision) {
    conditions.push(`EXISTS (SELECT 1 FROM music_track_revisions WHERE id=? AND state=? AND metadata_json=?
      AND audio_asset_id IS ? AND preview_asset_id IS ? AND cover_asset_id IS ? AND lyrics_asset_id IS ?
      AND access_mode=? AND early_access_until IS ? AND post_early_access_mode IS ? AND policy_version=?)`);
    params.push(revision.id, revision.state, revision.metadata_json, revision.audio_asset_id, revision.preview_asset_id,
      revision.cover_asset_id, revision.lyrics_asset_id, revision.access_mode, revision.early_access_until, revision.post_early_access_mode, revision.policy_version);
  }
  return { condition: conditions.join(' AND '), params };
}
