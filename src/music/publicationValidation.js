import { projectPublicTrack } from './catalog.js';
import { MUSIC_LOCALES, isoTime, musicError, policyFromRevision, utcMillis, validatePolicyTransition } from './policy.js';

export const publicationError = (code, status = 422) => Object.assign(musicError(code), { status });
export const validMusicId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const nonempty = (value, max) => typeof value === 'string' && value.trim().length > 0 &&
  [...value].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const parse = value => { try { const parsed = JSON.parse(value); if (object(parsed)) return parsed; } catch {}
  throw publicationError('MUSIC_INVALID_METADATA'); };

export async function publicationHash(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Shared by future trusted review handlers. Never accept a client's fingerprint as an approval.
export function publicationFingerprint({ track, revision, assets, rights, evidence }) {
  return publicationHash({ trackId: track.id, slug: track.slug, revisionId: revision.id,
    revisionNo: revision.revision_no, metadata: revision.metadata_json, policy: policyFromRevision(revision),
    audio: revision.audio_asset_id, preview: revision.preview_asset_id,
    cover: revision.cover_asset_id, lyrics: revision.lyrics_asset_id,
    rightsId: rights?.id, rights: rights?.review_json,
    evidence: evidence.map(row => row.asset_id).sort(),
    assets: [...assets].sort((a, b) => a.id.localeCompare(b.id)).map(a => ({
      id: a.id, owner: a.owner_track_id, kind: a.kind, key: a.object_key, state: a.state,
      bytes: a.byte_size, hash: a.sha256, etag: a.etag, format: a.format, type: a.content_type,
      duration: a.duration_ms, source: a.derived_from_asset_id, start: a.source_start_ms, end: a.source_end_ms
    })) });
}

export function checkRights(snapshot, now) {
  const { revision, rights, evidence, assets } = snapshot;
  if (!rights || rights.revision_id !== revision.id || rights.review_status !== 'approved' ||
    !nonempty(rights.reviewer_id, 200) || !Number.isSafeInteger(rights.reviewed_at) ||
    rights.reviewed_at < revision.created_at || rights.reviewed_at > now || evidence.length < 1 || evidence.length > 10) {
    throw publicationError('RIGHTS_REVIEW_REQUIRED');
  }
  const review = parse(rights.review_json);
  if (review.sourcePlatform !== 'suno' || review.permittedUse !== 'commercial' || review.downloadMethod !== 'official' ||
    !['free', 'pro', 'premier', 'other'].includes(review.planAtGeneration) ||
    !['free', 'pro', 'premier', 'other'].includes(review.planAtDownload) ||
    !['standard', 'remix', 'other'].includes(review.outputKind) ||
    !['authorizationBasis', 'lyricsRightsNotes', 'coverRightsNotes', 'audioInputRightsNotes'].every(key => nonempty(review[key], 4000))) {
    throw publicationError('RIGHTS_REVIEW_REQUIRED');
  }
  try {
    const generated = utcMillis(review.generatedAt), downloaded = utcMillis(review.downloadedAt), terms = utcMillis(review.termsCheckedAt);
    if (generated > downloaded || downloaded > now || terms > now) throw new Error('dates');
    if (review.sourceSongUrl !== null) {
      const url = new URL(review.sourceSongUrl);
      if (url.protocol !== 'https:' || !['suno.com', 'www.suno.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('url');
    }
  } catch { throw publicationError('RIGHTS_REVIEW_REQUIRED'); }
  // Exceptions require a separately identified permission document, not a generic approval note.
  if ((review.planAtGeneration === 'free' || review.planAtDownload === 'free' || review.outputKind !== 'standard') &&
    (!nonempty(review.exceptionAuthorizationBasis, 4000) || !evidence.some(e => e.asset_id === review.exceptionEvidenceAssetId))) {
    throw publicationError('RIGHTS_EXCEPTION_REQUIRED');
  }
  for (const row of evidence) {
    const a = assets.find(asset => asset.id === row.asset_id);
    if (row.review_id !== rights.id || !a || a.kind !== 'evidence' || a.owner_track_id !== revision.track_id ||
      a.state !== 'validated' || a.byte_size > 10485760) throw publicationError('RIGHTS_REVIEW_REQUIRED');
  }
}

// Source documentation is optional. An explicit block still stops publication;
// opting into an approved rights record must still satisfy its original contract.
export function checkPublicationRights(snapshot, now) {
  const { rights, revision, evidence, assets } = snapshot;
  if (!rights) {
    if (evidence.length) throw publicationError('RIGHTS_REVIEW_REQUIRED');
    return;
  }
  if (rights.revision_id !== revision.id || !['pending', 'approved', 'blocked'].includes(rights.review_status)) {
    throw publicationError('RIGHTS_REVIEW_REQUIRED');
  }
  if (rights.review_status === 'blocked') throw publicationError('MUSIC_RIGHTS_BLOCKED');
  if (rights.review_status === 'approved') return checkRights(snapshot, now);
  parse(rights.review_json);
  if (evidence.length > 10 || evidence.some(row => {
    const asset = assets.find(a => a.id === row.asset_id);
    return row.review_id !== rights.id || !asset || asset.owner_track_id !== revision.track_id ||
      asset.kind !== 'evidence' || asset.state !== 'validated' || asset.byte_size > 10485760;
  })) throw publicationError('RIGHTS_REVIEW_REQUIRED');
}

export async function validatePublication(snapshot, command, now) {
  isoTime(now);
  const { track, revision, previous, assets, settings } = snapshot;
  if (!revision || revision.id !== command.revisionId || revision.track_id !== track.id || revision.state !== 'draft' ||
    track.draft_revision_id !== revision.id || (previous && revision.revision_no <= previous.revision_no)) {
    throw publicationError('MUSIC_PUBLICATION_CONFLICT', 409);
  }
  const policy = policyFromRevision(revision);
  const priorPolicy = previous ? policyFromRevision(previous) : null;
  validatePolicyTransition(policy, priorPolicy, now);
  if ((!previous && policy.policyVersion !== 1) || command.confirmedPolicyVersion !== policy.policyVersion) {
    throw publicationError('MUSIC_POLICY_NOT_CONFIRMED');
  }
  // A previously free promise (including an expired early-to-free policy) cannot acquire a paywall here.
  if (previous && (priorPolicy.accessMode === 'free' || (priorPolicy.postEarlyAccessMode === 'free' && utcMillis(priorPolicy.earlyAccessUntil) <= now)) &&
    (policy.accessMode !== 'free' && !(policy.accessMode === 'early_access' && policy.postEarlyAccessMode === 'free' && utcMillis(policy.earlyAccessUntil) <= now))) {
    throw publicationError('MUSIC_FREE_PROMISE_PROTECTED');
  }
  const candidate = { track: { ...track, lifecycle: 'published', published_revision_id: revision.id,
    first_published_at: track.first_published_at ?? now, published_at: now }, revision: { ...revision, state: 'sealed' }, assets };
  if (!projectPublicTrack(candidate, { locale: 'zh-Hant', now })) throw publicationError('MUSIC_INVALID_PUBLICATION');
  const meta = parse(revision.metadata_json);
  if (!object(meta.title) || !object(meta.summary) || !Array.isArray(meta.genres) || !Array.isArray(meta.moods)) {
    throw publicationError('MUSIC_INVALID_METADATA');
  }
  for (const [field, max] of [['title', 120], ['summary', 500]]) {
    for (const [locale, value] of Object.entries(meta[field])) {
      if (!MUSIC_LOCALES.includes(locale) || typeof value !== 'string' || [...value].length > max || /[\u0000-\u001f\u007f]/.test(value)) {
        throw publicationError('MUSIC_INVALID_METADATA');
      }
    }
  }
  if (!nonempty(meta.creatorName, 80) || [...meta.genres, ...meta.moods].some(v => [...v].length > 32) ||
    (meta.story !== undefined && (typeof meta.story !== 'string' || [...meta.story].length > 8000))) throw publicationError('MUSIC_INVALID_METADATA');
  const previewLimit = JSON.parse(settings.find(s => s.key === 'previewLimitMs').value_json);
  if (!Number.isSafeInteger(previewLimit) || previewLimit < 15000 || previewLimit > 45000) throw publicationError('MUSIC_INVALID_SETTINGS', 503);
  const full = assets.find(a => a.id === revision.audio_asset_id), preview = assets.find(a => a.id === revision.preview_asset_id);
  if (policy.accessMode !== 'free' && !preview) throw publicationError('PREVIEW_REQUIRED');
  if (preview && (preview.source_end_ms - preview.source_start_ms > Math.min(previewLimit, Math.floor(full.duration_ms / 2)) ||
    preview.duration_ms > Math.min(previewLimit, Math.floor(full.duration_ms / 2)) + 250)) throw publicationError('PREVIEW_INVALID');
  checkPublicationRights(snapshot, now);
  const fingerprint = await publicationFingerprint(snapshot);
  if ((snapshot.rights?.review_status === 'approved' && snapshot.rights.revision_fingerprint !== fingerprint) || revision.technical_fingerprint !== fingerprint) {
    throw publicationError('MUSIC_REVIEW_STALE');
  }
  return fingerprint;
}

// M1-05/M2 must supply this trusted server verifier. No production fallback accepts DB metadata alone.
export async function verifyPublicationResources(snapshot, verifyResources, clock) {
  if (typeof verifyResources !== 'function') throw publicationError('MUSIC_TECHNICAL_VERIFIER_UNAVAILABLE', 503);
  const proof = await verifyResources(structuredClone(snapshot.assets));
  const now = clock(); isoTime(now);
  if (!proof || !Number.isSafeInteger(proof.checkedAt) || proof.checkedAt > now || proof.checkedAt < now - 15000 ||
    !Array.isArray(proof.assets) || proof.assets.length !== snapshot.assets.length) throw publicationError('MUSIC_RESOURCE_VERIFICATION_FAILED');
  for (const asset of snapshot.assets) {
    const matches = proof.assets.filter(p => p.id === asset.id);
    const verified = matches[0];
    if (matches.length !== 1 || verified.exists !== true || !nonempty(asset.etag, 200) || verified.etag !== asset.etag ||
      verified.sha256 !== asset.sha256 || verified.byteSize !== asset.byte_size || verified.contentType !== asset.content_type ||
      verified.structureValid !== true) throw publicationError('MUSIC_RESOURCE_VERIFICATION_FAILED');
    if (['audio', 'preview'].includes(asset.kind) && (verified.measurement !== 'mp3-frames' || verified.durationMs !== asset.duration_ms)) {
      throw publicationError('MUSIC_MP3_MEASUREMENT_REQUIRED');
    }
    if (asset.kind === 'cover' && (!Number.isSafeInteger(verified.width) || !Number.isSafeInteger(verified.height) ||
      verified.width < 1 || verified.height < 1 || verified.width > 4096 || verified.height > 4096 || verified.animated !== false)) {
      throw publicationError('MUSIC_COVER_INVALID');
    }
    if (asset.kind === 'lyrics' && (verified.utf8 !== true || !Number.isSafeInteger(verified.lines) || verified.lines < 0 || verified.lines > 5000)) {
      throw publicationError('MUSIC_LYRICS_INVALID');
    }
  }
  return proof.checkedAt;
}
