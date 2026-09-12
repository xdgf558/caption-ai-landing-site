import { publicationFingerprint } from '../../src/music/publicationValidation.js';
import { sha256 } from '@noble/hashes/sha2.js';

async function insert(db, table, values) {
  const keys = Object.keys(values);
  await db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).bind(...Object.values(values)).run();
}

// Synthetic approvals solely for local D1 transaction tests, never real rights/technical reviews.
export async function seedMusicRuntimeFixture(db, { audio, preview, accessMode = 'vip' }) {
  if (!['free','vip'].includes(accessMode)) throw new Error('Invalid fixture access mode');
  const now = Date.now(), id = audio.owner_track_id, revisionId = crypto.randomUUID(), rightsId = crypto.randomUUID();
  await insert(db, 'music_tracks', { id, slug: `fixture-${id}`, created_at: now - 3000, updated_at: now - 1000 });
  for (const a of [audio, preview]) await insert(db, 'music_assets', { ...a, created_at: now - 2000 });
  const evidence = { id: crypto.randomUUID(), owner_track_id: id, kind: 'evidence', state: 'validated',
    format: 'pdf', content_type: 'application/pdf', byte_size: 100, sha256: 'a'.repeat(64), etag: 'fixture-only',
    object_key: `fixture-evidence/${id}`, created_at: now - 2000 };
  await insert(db, 'music_assets', evidence);
  await insert(db, 'music_track_revisions', { id: revisionId, track_id: id, revision_no: 1,
    audio_asset_id: audio.id, preview_asset_id: preview.id, access_mode: accessMode, created_at: now - 2000,
    technical_reviewed_at: now - 1000, metadata_json: JSON.stringify({ originalLocale: 'zh-Hant',
      title: { 'zh-Hant': '本地合成測試', en: 'Synthetic fixture' }, summary: { 'zh-Hant': '本地測試', en: 'Not a published song.' },
      creatorName: 'Local fixture', instrumental: true, language: 'instrumental', genres: [], moods: [] }) });
  await insert(db, 'music_rights_reviews', { id: rightsId, revision_id: revisionId, review_status: 'approved',
    reviewer_id: 'fixture@example.test', reviewed_at: now - 1000, review_json: JSON.stringify({
      sourcePlatform: 'suno', sourceSongUrl: null, sourceSongId: 'synthetic-fixture-not-a-song',
      generatedAt: new Date(now - 3000).toISOString(), downloadedAt: new Date(now - 2000).toISOString(),
      termsCheckedAt: new Date(now - 1000).toISOString(), planAtGeneration: 'pro', planAtDownload: 'pro',
      outputKind: 'standard', downloadMethod: 'official', permittedUse: 'commercial',
      authorizationBasis: 'Synthetic test only, not a license.', lyricsRightsNotes: 'Test only.',
      coverRightsNotes: 'Test only.', audioInputRightsNotes: 'Test only.' }) });
  await insert(db, 'music_rights_evidence', { review_id: rightsId, asset_id: evidence.id });
  await db.prepare('UPDATE music_tracks SET draft_revision_id=? WHERE id=?').bind(revisionId, id).run();
  const track = await db.prepare('SELECT * FROM music_tracks WHERE id=?').bind(id).first();
  const revision = await db.prepare('SELECT * FROM music_track_revisions WHERE id=?').bind(revisionId).first();
  const rights = await db.prepare('SELECT * FROM music_rights_reviews WHERE id=?').bind(rightsId).first();
  const assets = (await db.prepare('SELECT * FROM music_assets WHERE owner_track_id=?').bind(id).all()).results;
  const fingerprint = await publicationFingerprint({ track, revision, rights, assets,
    evidence: [{ review_id: rightsId, asset_id: evidence.id }] });
  await db.batch([
    db.prepare('UPDATE music_track_revisions SET technical_fingerprint=? WHERE id=?').bind(fingerprint, revisionId),
    db.prepare('UPDATE music_rights_reviews SET revision_fingerprint=? WHERE id=?').bind(fingerprint, rightsId)
  ]);
  return { action: 'publish', trackId: id, revisionId, ifMatch: '"edit-1"', confirmedPolicyVersion: 1,
    idempotencyKey: crypto.randomUUID(), reason: 'Local runtime fixture, not real publication.' };
}

export function fixtureEvidenceProof(asset) {
  if (asset.kind !== 'evidence' || asset.etag !== 'fixture-only' || !asset.object_key.startsWith('fixture-evidence/')) {
    throw new Error('No real evidence verifier in local fixture');
  }
  return { id: asset.id, exists: true, etag: asset.etag, sha256: asset.sha256, byteSize: asset.byte_size,
    contentType: asset.content_type, structureValid: true };
}

// Repeated synthetic frame for allocation/concurrency stress only, not playable program material.
export async function seedLargeRuntimeAudio(bucket, { frame: values, kind }) {
  const frame = new Uint8Array(values), size = kind === 'audio' ? 33554432 : 4194304;
  if (frame.length !== 313 || !['audio', 'preview'].includes(kind)) throw new Error('Invalid stress fixture');
  const frames = Math.floor((size - 10) / frame.length), lead = new Uint8Array(size - frames * frame.length);
  lead.set([0x49, 0x44, 0x33, 3, 0, 0]);
  const tagSize = lead.length - 10;
  lead.set([(tagSize >>> 21) & 127, (tagSize >>> 14) & 127, (tagSize >>> 7) & 127, tagSize & 127], 6);
  const id = crypto.randomUUID(), owner = crypto.randomUUID(), object_key = `music/${kind === 'audio' ? 'audio' : 'previews'}/${owner}/${id}.mp3`;
  const hash = sha256.create(); let offset = 0;
  const body = new ReadableStream({ pull(controller) {
    if (offset === size) { controller.close(); return; }
    const chunk = new Uint8Array(Math.min(65536, size - offset)); let cursor = 0;
    while (cursor < chunk.length) {
      const source = offset < lead.length ? lead : frame, start = offset < lead.length ? offset : (offset - lead.length) % frame.length;
      const n = Math.min(source.length - start, chunk.length - cursor);
      chunk.set(source.subarray(start, start + n), cursor); offset += n; cursor += n;
    }
    hash.update(chunk); controller.enqueue(chunk);
  } }, { highWaterMark: 0 });
  const { readable, writable } = new FixedLengthStream(size);
  const pumping = body.pipeTo(writable);
  try {
    const [object] = await Promise.all([bucket.put(object_key, readable, { httpMetadata: { contentType: 'audio/mpeg' } }), pumping]);
    return { id, owner_track_id: owner, object_key, kind, state: 'validated', format: 'mp3', content_type: 'audio/mpeg',
      byte_size: size, duration_ms: Math.ceil(frames * 1152 * 1000 / 44100),
      sha256: Array.from(hash.digest(), b => b.toString(16).padStart(2, '0')).join(''), etag: object.etag };
  } finally { hash.destroy(); }
}
