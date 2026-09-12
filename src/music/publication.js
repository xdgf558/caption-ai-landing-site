import { isoTime, policyFromRevision, positiveInteger } from './policy.js';
import { publicationError, publicationHash, validMusicId, validatePublication, verifyPublicationResources } from './publicationValidation.js';

const columns = {
  music_tracks: ['id', 'slug', 'lifecycle', 'draft_revision_id', 'published_revision_id', 'edit_version', 'first_published_at', 'published_at', 'created_at', 'updated_at'],
  music_track_revisions: ['id', 'track_id', 'revision_no', 'state', 'metadata_json', 'audio_asset_id', 'preview_asset_id', 'cover_asset_id', 'lyrics_asset_id',
    'access_mode', 'early_access_until', 'post_early_access_mode', 'policy_version', 'technical_reviewed_at', 'created_at', 'technical_fingerprint'],
  music_assets: ['id', 'owner_track_id', 'kind', 'object_key', 'state', 'content_type', 'format', 'byte_size', 'duration_ms',
    'derived_from_asset_id', 'source_start_ms', 'source_end_ms', 'sha256', 'etag', 'created_at'],
  music_rights_reviews: ['id', 'revision_id', 'review_json', 'review_status', 'reviewer_id', 'reviewed_at', 'revision_fingerprint'],
  music_settings: ['key', 'value_json', 'updated_at']
};
const fail = (code, status = 409) => { throw publicationError(code, status); };
function primary(db) {
  if (typeof db?.withSession !== 'function') fail('MUSIC_PUBLICATION_UNAVAILABLE', 503);
  return db.withSession('first-primary');
}
function rows(result) {
  if (result?.success !== true || !Array.isArray(result.results)) fail('MUSIC_PUBLICATION_UNAVAILABLE', 503);
  return result.results;
}
function normalize(input, actorId) {
  const version = /^"edit-([1-9][0-9]*)"$/.exec(input?.ifMatch || '');
  if (!['publish', 'unpublish'].includes(input?.action) || !validMusicId(input.trackId) || !validMusicId(input.revisionId) ||
    typeof actorId !== 'string' || !actorId.trim() || actorId.length > 200 || /[\u0000-\u001f\u007f]/.test(actorId) ||
    typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey) ||
    !version || !positiveInteger(Number(version[1])) || Number(version[1]) >= Number.MAX_SAFE_INTEGER ||
    typeof input.reason !== 'string' || !input.reason.trim() || [...input.reason].length > 1000 || /[\u0000-\u001f\u007f]/.test(input.reason)) {
    fail('INVALID_INPUT', 400);
  }
  if (input.action === 'publish' && !positiveInteger(input.confirmedPolicyVersion)) fail('MUSIC_POLICY_NOT_CONFIRMED', 422);
  return { action: input.action, trackId: input.trackId, revisionId: input.revisionId,
    editVersion: Number(version[1]), reason: input.reason.trim(),
    confirmedPolicyVersion: input.action === 'publish' ? input.confirmedPolicyVersion : null };
}

async function receipt(db, actor, route, key, hash) {
  const result = rows(await primary(db).prepare(`SELECT request_hash, result_json FROM music_mutations
    WHERE actor_id=? AND route=? AND idempotency_key=?`).bind(actor, route, key).all());
  if (!result.length) return null;
  if (result.length !== 1 || result[0].request_hash !== hash) fail('IDEMPOTENCY_CONFLICT');
  let saved;
  try { saved = JSON.parse(result[0].result_json); } catch { fail('MUSIC_PUBLICATION_UNAVAILABLE', 503); }
  if (!saved || !validMusicId(saved.trackId) || !validMusicId(saved.revisionId) ||
    !positiveInteger(saved.editVersion) || !positiveInteger(saved.catalogVersion) || !['publish', 'unpublish'].includes(saved.action)) {
    fail('MUSIC_PUBLICATION_UNAVAILABLE', 503);
  }
  return { trackId: saved.trackId, revisionId: saved.revisionId, action: saved.action,
    editVersion: saved.editVersion, catalogVersion: saved.catalogVersion, replayed: true };
}

async function load(db, command) {
  const s = primary(db), { trackId, revisionId } = command;
  const queries = [s.prepare('SELECT * FROM music_tracks WHERE id=?').bind(trackId),
    s.prepare("SELECT * FROM music_settings WHERE key IN ('catalogVersion','previewLimitMs') ORDER BY key")];
  if (command.action === 'publish') queries.push(
    s.prepare('SELECT * FROM music_track_revisions WHERE id=? AND track_id=?').bind(revisionId, trackId),
    s.prepare('SELECT * FROM music_track_revisions WHERE id=(SELECT published_revision_id FROM music_tracks WHERE id=?)').bind(trackId),
    s.prepare('SELECT * FROM music_rights_reviews WHERE revision_id=?').bind(revisionId),
    s.prepare(`SELECT e.* FROM music_rights_evidence e JOIN music_rights_reviews r ON e.review_id=r.id
      WHERE r.revision_id=? ORDER BY e.asset_id LIMIT 11`).bind(revisionId),
    s.prepare(`SELECT a.* FROM music_assets a WHERE a.id IN (
      SELECT audio_asset_id FROM music_track_revisions WHERE id=? UNION SELECT preview_asset_id FROM music_track_revisions WHERE id=?
      UNION SELECT cover_asset_id FROM music_track_revisions WHERE id=? UNION SELECT lyrics_asset_id FROM music_track_revisions WHERE id=?
      UNION SELECT e.asset_id FROM music_rights_evidence e JOIN music_rights_reviews r ON r.id=e.review_id WHERE r.revision_id=?
    ) ORDER BY a.id LIMIT 15`).bind(revisionId, revisionId, revisionId, revisionId, revisionId)
  );
  const result = (await s.batch(queries)).map(rows);
  const track = result[0][0], settings = result[1];
  if (!track) fail('NOT_FOUND', 404);
  if (settings.length !== 2) fail('MUSIC_INVALID_SETTINGS', 503);
  let catalogVersion;
  try { catalogVersion = JSON.parse(settings.find(r => r.key === 'catalogVersion').value_json); } catch { fail('MUSIC_INVALID_SETTINGS', 503); }
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 0 || catalogVersion >= Number.MAX_SAFE_INTEGER) fail('MUSIC_INVALID_SETTINGS', 503);
  if (track.edit_version !== command.editVersion || !['draft', 'published', 'unpublished'].includes(track.lifecycle)) fail('MUSIC_PUBLICATION_CONFLICT');
  if (command.action === 'unpublish' && (track.lifecycle !== 'published' || track.published_revision_id !== revisionId)) fail('MUSIC_PUBLICATION_CONFLICT');
  const snapshot = { track, settings, catalogVersion, revision: result[2]?.[0] || null, previous: result[3]?.[0] || null,
    rights: result[4]?.[0] || null, evidence: result[5] || [], assets: result[6] || [] };
  if (command.action === 'publish' && track.published_revision_id !== null && !snapshot.previous) fail('MUSIC_PUBLICATION_CONFLICT');
  return snapshot;
}

function conditionalBatch(db, snapshot, command, actorId, key, hash, route, now, proofCheckedAt) {
  const s = primary(db), token = crypto.randomUUID(), params = [], conditions = [];
  // Compare all loaded business fields, not only editVersion. This catches stale approvals and unversioned edits too.
  const match = (table, row) => {
    const fields = columns[table];
    const json = JSON.stringify(Object.fromEntries(fields.map(field => [field, row[field]])));
    conditions.push(`EXISTS (SELECT 1 FROM ${table} WHERE json_object(${fields.map(f => `'${f}',${f}`).join(',')})=?)`);
    params.push(json);
  };
  match('music_tracks', snapshot.track);
  snapshot.settings.forEach(row => match('music_settings', row));
  if (command.action === 'publish') {
    match('music_track_revisions', snapshot.revision);
    if (snapshot.previous) match('music_track_revisions', snapshot.previous);
    if (snapshot.rights) match('music_rights_reviews', snapshot.rights);
    else {
      conditions.push('NOT EXISTS (SELECT 1 FROM music_rights_reviews WHERE revision_id=?)');
      params.push(snapshot.revision.id);
    }
    snapshot.assets.forEach(row => match('music_assets', row));
    conditions.push('(SELECT COUNT(*) FROM music_rights_evidence WHERE review_id=?)=?');
    params.push(snapshot.rights?.id ?? null, snapshot.evidence.length);
    for (const e of snapshot.evidence) {
      conditions.push('EXISTS (SELECT 1 FROM music_rights_evidence WHERE review_id=? AND asset_id=?)'); params.push(e.review_id, e.asset_id);
    }
    conditions.push("(SELECT COUNT(*) FROM music_tracks WHERE lifecycle='published' AND id<>?)<500"); params.push(command.trackId);
    // Guard proof freshness and newly requested early windows again at transaction execution time.
    const sqlNow = "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)";
    conditions.push(`? >= ${sqlNow}-15000`); params.push(proofCheckedAt);
    const r = snapshot.revision, p = snapshot.previous;
    if (p?.access_mode === 'early_access' && p.post_early_access_mode === 'free' &&
      r.access_mode !== 'free' && !(r.access_mode === 'early_access' && r.post_early_access_mode === 'free' && r.early_access_until <= now)) {
      conditions.push(`? > ${sqlNow}`); params.push(p.early_access_until);
    }
    if (r.access_mode === 'early_access' && (!p || r.early_access_until !== p.early_access_until || r.post_early_access_mode !== p.post_early_access_mode || r.access_mode !== p.access_mode)) {
      conditions.push(`? > ${sqlNow}`); params.push(r.early_access_until);
    }
  }
  conditions.push('NOT EXISTS (SELECT 1 FROM music_mutations WHERE actor_id=? AND route=? AND idempotency_key=?)');
  params.push(actorId, route, key);
  const batch = [s.prepare(`INSERT INTO music_publication_guards(operation_token,passed)
    VALUES (?, CASE WHEN ${conditions.join(' AND ')} THEN 1 ELSE NULL END)`).bind(token, ...params)];
  const gate = 'EXISTS (SELECT 1 FROM music_publication_guards WHERE operation_token=?)';
  const checked = statement => {
    batch.push(statement);
    batch.push(s.prepare(`UPDATE music_publication_guards SET passed=CASE WHEN changes()=1 THEN 1 ELSE NULL END WHERE operation_token=?`).bind(token));
  };
  if (command.action === 'publish') {
    checked(s.prepare(`UPDATE music_tracks SET draft_revision_id=NULL WHERE id=? AND edit_version=? AND ${gate}`)
      .bind(command.trackId, command.editVersion, token));
    checked(s.prepare(`UPDATE music_track_revisions SET state='sealed' WHERE id=? AND state='draft' AND ${gate}`)
      .bind(command.revisionId, token));
    checked(s.prepare(`UPDATE music_tracks SET lifecycle='published',published_revision_id=?,first_published_at=COALESCE(first_published_at,?),
      published_at=?,updated_at=?,edit_version=edit_version+1 WHERE id=? AND edit_version=? AND ${gate}`)
      .bind(command.revisionId, now, now, now, command.trackId, command.editVersion, token));
  } else {
    checked(s.prepare(`UPDATE music_tracks SET lifecycle='unpublished',updated_at=?,edit_version=edit_version+1
      WHERE id=? AND lifecycle='published' AND edit_version=? AND ${gate}`).bind(now, command.trackId, command.editVersion, token));
  }
  checked(s.prepare(`UPDATE music_settings SET value_json=?,updated_at=? WHERE key='catalogVersion' AND ${gate}`)
    .bind(String(snapshot.catalogVersion + 1), now, token));
  const result = { trackId: command.trackId, revisionId: command.revisionId, action: command.action,
    editVersion: command.editVersion + 1, catalogVersion: snapshot.catalogVersion + 1 };
  const summary = { revisionId: command.revisionId, reason: command.reason,
    oldLifecycle: snapshot.track.lifecycle, newLifecycle: command.action === 'publish' ? 'published' : 'unpublished',
    oldPolicy: snapshot.previous ? policyFromRevision(snapshot.previous) : null,
    newPolicy: snapshot.revision ? policyFromRevision(snapshot.revision) : null };
  checked(s.prepare(`INSERT INTO music_admin_audit_logs(id,actor_id,action,target_id,summary_json,request_id,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(token, actorId, `music.${command.action}`, command.trackId, JSON.stringify(summary), token, now, token));
  checked(s.prepare(`INSERT INTO music_mutations(actor_id,route,idempotency_key,request_hash,result_json,expires_at,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${gate}`).bind(actorId, route, key, hash, JSON.stringify(result), now + 86400000, now, token));
  batch.push(s.prepare('DELETE FROM music_publication_guards WHERE operation_token=?').bind(token));
  return { statements: batch, session: s };
}

// Internal command service. M2 must supply a verified admin identity, enforce Origin and parse If-Match.
export async function executeMusicPublication(db, input, { actorId, verifyResources, clock = Date.now } = {}) {
  const command = normalize(input, actorId);
  const route = `/admin/api/music/tracks/${command.trackId}/${command.action}`, key = input.idempotencyKey;
  const hash = await publicationHash(command);
  try {
    const previousResult = await receipt(db, actorId, route, key, hash);
    if (previousResult) return previousResult;
    const snapshot = await load(db, command);
    let proofCheckedAt = null;
    if (command.action === 'publish') {
      await validatePublication(snapshot, command, clock());
      proofCheckedAt = await verifyPublicationResources(snapshot, verifyResources, clock);
      await validatePublication(snapshot, command, clock());
    }
    const now = clock(); isoTime(now);
    const { session, statements } = conditionalBatch(db, snapshot, command, actorId, key, hash, route, now, proofCheckedAt);
    const written = await session.batch(statements);
    if (written.some(result => result.success !== true)) fail('MUSIC_PUBLICATION_UNAVAILABLE', 503);
    const committed = await receipt(db, actorId, route, key, hash);
    if (!committed) fail('MUSIC_PUBLICATION_UNAVAILABLE', 503);
    return { ...committed, replayed: false };
  } catch (error) {
    // Includes a lost post-commit response or a racing identical request. Never manufacture a new key.
    try { const saved = await receipt(db, actorId, route, key, hash); if (saved) return saved; }
    catch (readError) { if (readError.code === 'IDEMPOTENCY_CONFLICT') throw readError; }
    if (error.status) throw error;
    if (/music_publication_guards\.passed|MUSIC_IMMUTABLE_MUTATION/.test(error.message)) fail('MUSIC_PUBLICATION_CONFLICT');
    if (error.code?.startsWith('MUSIC_')) fail(error.code, error.code.endsWith('VERSION_CONFLICT') ? 409 : 422);
    fail('MUSIC_PUBLICATION_UNAVAILABLE', 503);
  }
}
