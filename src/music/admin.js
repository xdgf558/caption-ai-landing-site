import { isoTime, policyFromRevision, utcMillis, validatePolicyTransition } from './policy.js';
import { checkRights, publicationFingerprint } from './publicationValidation.js';
import { draftInput, rightsInput, editVersion, fail, fields, musicId, text } from './adminValidation.js';
import { primary, rows, loadTrack, loadAssets, mutate, trackGuard } from './adminStore.js';

const assetIds = r => r ? [r.audio_asset_id, r.preview_asset_id, r.cover_asset_id, r.lyrics_asset_id] : [];
function revisionView(r) {
  return r ? { id: r.id, number: r.revision_no, state: r.state, metadata: JSON.parse(r.metadata_json),
    policy: policyFromRevision(r), assets: { audio: r.audio_asset_id, preview: r.preview_asset_id, cover: r.cover_asset_id, lyrics: r.lyrics_asset_id },
    technicalReviewedAt: r.technical_reviewed_at } : null;
}
export async function readAdminMusicTrack(db, id) {
  const snap = await loadTrack(db, musicId(id));
  const { track: t, rights: r } = snap;
  // Both saved revisions are needed for display-only role previews. No R2 or reader identity reads.
  const assets = await loadAssets(db, [...assetIds(snap.revision), ...snap.evidence.map(e => e.asset_id)]);
  assets.push(...await loadAssets(db, assetIds(snap.previous).filter(id => !assets.some(a => a.id === id))));
  return { serverNow: isoTime(Date.now()), id: t.id, slug: t.slug, lifecycle: t.lifecycle, editVersion: t.edit_version, draft: t.draft_revision_id ? revisionView(snap.revision) : null,
    published: revisionView(snap.previous), rights: r ? { status: r.review_status, review: JSON.parse(r.review_json),
      reviewer: r.reviewer_id, reviewedAt: r.reviewed_at, evidenceIds: snap.evidence.map(e => e.asset_id) } : null,
    assets: assets.map(a => ({ id: a.id, kind: a.kind, state: a.state, byteSize: a.byte_size, durationMs: a.duration_ms,
      derivedFromAssetId: a.derived_from_asset_id, sourceStartMs: a.source_start_ms, sourceEndMs: a.source_end_ms })) };
}
export async function listAdminMusicTracks(db, { before = Number.MAX_SAFE_INTEGER, status = '', q = '' } = {}) {
  if (!Number.isSafeInteger(before) || before < 1 || !['', 'draft', 'published', 'unpublished', 'archived'].includes(status)) fail('INVALID_INPUT', 400);
  text(q, 120, true);
  const result = rows(await primary(db).prepare(`SELECT t.rowid AS cursor,t.id,t.slug,t.lifecycle,t.edit_version,r.metadata_json
    FROM music_tracks t LEFT JOIN music_track_revisions r ON r.id=COALESCE(t.draft_revision_id,t.published_revision_id)
    WHERE t.rowid<? AND (?='' OR t.lifecycle=?) AND (?='' OR instr(lower(t.slug),lower(?))>0 OR instr(lower(r.metadata_json),lower(?))>0)
    ORDER BY t.rowid DESC LIMIT 51`).bind(before, status, status, q, q, q).all());
  const items = result.slice(0, 50).map(r => ({ id: r.id, slug: r.slug, lifecycle: r.lifecycle,
    editVersion: r.edit_version, title: r.metadata_json ? JSON.parse(r.metadata_json).title : null }));
  return { items, nextBefore: result.length > 50 ? result[49].cursor : null };
}
export async function listAdminMusicAudit(db, before = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(before) || before < 1) fail('INVALID_INPUT', 400);
  const result = rows(await primary(db).prepare(`SELECT rowid AS cursor,id,actor_id,action,target_id,summary_json,created_at
    FROM music_admin_audit_logs WHERE rowid<? ORDER BY rowid DESC LIMIT 51`).bind(before).all());
  return { items: result.slice(0, 50).map(r => ({ id: r.id, actorId: r.actor_id, action: r.action,
    targetId: r.target_id, summary: JSON.parse(r.summary_json), createdAt: r.created_at })), nextBefore: result.length > 50 ? result[49].cursor : null };
}

function revisionInsert(s, id, trackId, number, input, now) {
  const p = input.policy;
  return s.prepare(`INSERT INTO music_track_revisions(id,track_id,revision_no,metadata_json,audio_asset_id,preview_asset_id,
    cover_asset_id,lyrics_asset_id,access_mode,early_access_until,post_early_access_mode,policy_version,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, trackId, number, JSON.stringify(input.metadata), input.assets.audio, input.assets.preview,
      input.assets.cover, input.assets.lyrics, p.accessMode, p.earlyAccessUntil === null ? null : utcMillis(p.earlyAccessUntil), p.postEarlyAccessMode, p.policyVersion, now);
}
function validateAssets(assets, references, owner) {
  for (const [kind, id] of Object.entries(references)) {
    if (!id) continue;
    const a = assets.find(a => a.id === id);
    if (!a || a.owner_track_id !== owner || a.kind !== kind || a.state !== 'validated' ||
      (kind === 'preview' && a.derived_from_asset_id !== references.audio)) fail('MUSIC_ASSET_REFERENCE');
  }
}
export async function createAdminMusicTrack(db, input, context) {
  const clean = draftInput(input, true);
  return mutate(db, { ...context, route: '/admin/api/music/tracks', command: clean }, async (s, now) => {
    validatePolicyTransition(clean.policy, null, now);
    const id = crypto.randomUUID(), revisionId = crypto.randomUUID();
    return { condition: 'NOT EXISTS (SELECT 1 FROM music_tracks WHERE slug=?)', params: [clean.slug],
      writes: [s.prepare('INSERT INTO music_tracks(id,slug,created_at,updated_at) VALUES(?,?,?,?)').bind(id, clean.slug, now, now),
        revisionInsert(s, revisionId, id, 1, clean, now),
        s.prepare('UPDATE music_tracks SET draft_revision_id=? WHERE id=?').bind(revisionId, id)],
      action: 'music.draft.create', targetId: id, summary: { revisionId }, result: { trackId: id, revisionId, editVersion: 1 } };
  });
}
export async function saveAdminMusicTrack(db, id, input, context) {
  id = musicId(id);
  const clean = draftInput(input), version = editVersion(context.ifMatch);
  return mutate(db, { ...context, route: `/admin/api/music/tracks/${id}`, command: { ...clean, version } }, async (s, now) => {
    const snap = await loadTrack(db, id), guard = trackGuard(snap, version);
    if (snap.track.lifecycle === 'archived' || snap.revision.id !== clean.revisionId) fail('MUSIC_EDIT_CONFLICT', 409);
    if (snap.track.first_published_at !== null && clean.slug !== snap.track.slug) fail('MUSIC_PUBLISHED_IDENTITY', 409);
    validatePolicyTransition(clean.policy, snap.previous ? policyFromRevision(snap.previous) : null, now);
    if (!snap.previous && clean.policy.policyVersion !== 1) fail('MUSIC_POLICY_NOT_CONFIRMED');
    const assets = await loadAssets(db, Object.values(clean.assets));
    validateAssets(assets, clean.assets, id);
    const revisionId = crypto.randomUUID(), number = snap.lastRevision + 1;
    if (!Number.isSafeInteger(number)) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
    return { ...guard, writes: [revisionInsert(s, revisionId, id, number, clean, now),
      s.prepare('UPDATE music_tracks SET slug=?,draft_revision_id=?,edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?')
        .bind(clean.slug, revisionId, now, id, version)],
      action: 'music.draft.save', targetId: id, summary: { revisionId, previousRevisionId: clean.revisionId, reason: clean.reason },
      result: { trackId: id, revisionId, editVersion: version + 1 } };
  });
}

export async function saveAdminMusicRights(db, revisionId, input, context) {
  revisionId = musicId(revisionId);
  const clean = rightsInput(input), version = editVersion(context.ifMatch);
  return mutate(db, { ...context, route: `/admin/api/music/revisions/${revisionId}/rights-review`, command: { ...clean, version } }, async (s, now) => {
    const ref = rows(await s.prepare('SELECT track_id FROM music_track_revisions WHERE id=?').bind(revisionId).all())[0];
    if (!ref) fail('NOT_FOUND', 404);
    const snap = await loadTrack(db, ref.track_id), guard = trackGuard(snap, version);
    if (snap.track.lifecycle === 'archived' || snap.track.draft_revision_id !== revisionId || snap.revision.state !== 'draft') fail('MUSIC_EDIT_CONFLICT', 409);
    const rightsId = snap.rights?.id ?? crypto.randomUUID();
    const assets = await loadAssets(db, [...assetIds(snap.revision), ...clean.evidenceIds]);
    for (const id of clean.evidenceIds) {
      const a = assets.find(a => a.id === id);
      if (!a || a.owner_track_id !== snap.track.id || a.kind !== 'evidence' || a.state !== 'validated') fail('MUSIC_EVIDENCE_REFERENCE');
    }
    const rights = { id: rightsId, revision_id: revisionId, review_json: JSON.stringify(clean.review), review_status: clean.status,
      reviewer_id: context.actorId, reviewed_at: now };
    const evidence = clean.evidenceIds.map(asset_id => ({ review_id: rightsId, asset_id }));
    const candidate = { ...snap, rights, assets, evidence };
    if (clean.status === 'approved') checkRights(candidate, now);
    const fingerprint = clean.status === 'approved' ? await publicationFingerprint(candidate) : null;
    const writes = [];
    if (snap.rights) {
      writes.push(s.prepare(`UPDATE music_rights_reviews SET review_json=?,review_status=?,reviewer_id=?,reviewed_at=?,revision_fingerprint=? WHERE id=?`)
        .bind(rights.review_json, clean.status, context.actorId, now, fingerprint, rightsId));
      writes.push({ statement: s.prepare('DELETE FROM music_rights_evidence WHERE review_id=?').bind(rightsId), expected: snap.evidence.length });
    } else {
      writes.push(s.prepare(`INSERT INTO music_rights_reviews(id,revision_id,review_json,review_status,reviewer_id,reviewed_at,revision_fingerprint)
        VALUES(?,?,?,?,?,?,?)`).bind(rightsId, revisionId, rights.review_json, clean.status, context.actorId, now, fingerprint));
    }
    for (const e of evidence) writes.push(s.prepare('INSERT INTO music_rights_evidence(review_id,asset_id) VALUES(?,?)').bind(rightsId, e.asset_id));
    // A changed rights package invalidates technical approval. The HTTP caller cannot set either fingerprint.
    writes.push(s.prepare('UPDATE music_track_revisions SET technical_reviewed_at=NULL,technical_fingerprint=NULL WHERE id=? AND state=\'draft\'').bind(revisionId));
    writes.push(s.prepare('UPDATE music_tracks SET edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?').bind(now, snap.track.id, version));
    return { ...guard, writes, action: 'music.rights.review', targetId: snap.track.id,
      summary: { revisionId, status: clean.status, evidenceIds: clean.evidenceIds, reason: clean.reason },
      result: { trackId: snap.track.id, revisionId, editVersion: version + 1, rightsStatus: clean.status } };
  });
}

export async function archiveAdminMusicTrack(db, id, input, context) {
  id = musicId(id); fields(input, ['reason']);
  const command = { reason: text(input.reason, 1000), version: editVersion(context.ifMatch) };
  return mutate(db, { ...context, route: `/admin/api/music/tracks/${id}/archive`, command }, async (s, now) => {
    const snap = await loadTrack(db, id), guard = trackGuard(snap, command.version);
    if (snap.track.lifecycle !== 'unpublished') fail('MUSIC_UNPUBLISH_FIRST', 409);
    return { ...guard, writes: [s.prepare(`UPDATE music_tracks SET lifecycle='archived',published_revision_id=NULL,draft_revision_id=NULL,
      edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?`).bind(now, id, command.version)],
      action: 'music.archive', targetId: id, summary: { reason: command.reason, publishedRevisionId: snap.track.published_revision_id,
        draftRevisionId: snap.track.draft_revision_id }, result: { trackId: id, editVersion: command.version + 1, lifecycle: 'archived' } };
  });
}
