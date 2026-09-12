import { checkPublicationRights, publicationFingerprint, validatePublication, verifyPublicationResources } from './publicationValidation.js';
import { loadTrack, loadAssets, mutate, trackGuard, rightsGuard, rows } from './adminStore.js';
import { fields, musicId, editVersion, text, fail } from './adminValidation.js';

export async function reviewMusicTechnical(db, revisionId, input, context, verifyResources) {
  musicId(revisionId);
  fields(input, ['audioListened', 'previewListened', 'previewSourceConfirmed', 'artworkChecked', 'reason']);
  const command = { audioListened: input.audioListened, previewListened: input.previewListened,
    previewSourceConfirmed: input.previewSourceConfirmed, artworkChecked: input.artworkChecked,
    reason: text(input.reason, 1000), version: editVersion(context.ifMatch) };
  for (const key of ['audioListened', 'previewListened', 'previewSourceConfirmed', 'artworkChecked']) {
    if (typeof command[key] !== 'boolean') fail('INVALID_INPUT', 400);
  }
  return mutate(db, { ...context, route: `/admin/api/music/revisions/${revisionId}/technical-review`, command }, async (s, now) => {
    const ref = rows(await s.prepare('SELECT track_id FROM music_track_revisions WHERE id=?').bind(revisionId).all())[0];
    if (!ref) fail('NOT_FOUND', 404);
    const snap = await loadTrack(db, ref.track_id), guard = trackGuard(snap, command.version), r = snap.revision;
    if (snap.track.draft_revision_id !== revisionId || r.state !== 'draft' || snap.track.lifecycle === 'archived') fail('MUSIC_EDIT_CONFLICT', 409);
    if (!command.audioListened || (r.preview_asset_id && (!command.previewListened || !command.previewSourceConfirmed)) ||
      (r.cover_asset_id && !command.artworkChecked)) fail('MUSIC_LISTENING_REVIEW_REQUIRED');
    snap.assets = await loadAssets(db, [r.audio_asset_id, r.preview_asset_id, r.cover_asset_id, r.lyrics_asset_id, ...snap.evidence.map(e => e.asset_id)]);
    snap.settings = rows(await s.prepare("SELECT * FROM music_settings WHERE key IN ('catalogVersion','previewLimitMs') ORDER BY key").all());
    checkPublicationRights(snap, now);
    const fingerprint = await publicationFingerprint(snap);
    if (snap.rights?.review_status === 'approved' && snap.rights.revision_fingerprint !== fingerprint) fail('MUSIC_REVIEW_STALE');
    // Validate the same publication contract, with a server-only candidate approval.
    await validatePublication({ ...snap, revision: { ...r, technical_reviewed_at: now, technical_fingerprint: fingerprint } },
      { revisionId, confirmedPolicyVersion: r.policy_version }, now);
    const checkedAt = await verifyPublicationResources(snap, verifyResources, Date.now);
    const documentation = rightsGuard(snap);
    return { condition: `${guard.condition} AND ${documentation.condition}
      AND ?>=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-15000`,
      params: [...guard.params, ...documentation.params, checkedAt], writes: [
        s.prepare("UPDATE music_track_revisions SET technical_reviewed_at=?,technical_fingerprint=? WHERE id=? AND state='draft'")
          .bind(now, fingerprint, revisionId),
        s.prepare('UPDATE music_tracks SET edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?')
          .bind(now, snap.track.id, command.version)],
      action: 'music.technical.review', targetId: snap.track.id, summary: { revisionId, ...command, fingerprint },
      result: { trackId: snap.track.id, revisionId, editVersion: command.version + 1, technicalReviewedAt: now } };
  });
}
