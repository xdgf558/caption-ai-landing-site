// Explicit, bounded operator fixture seeding. Not a publication or rights-review tool.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { stagingRoot, stagingSql, stagingConfig, stagingClient, privateJson, sqlValue as q } from '../scripts/helpers/music-staging-ops.mjs';

assert.ok(process.env.MUSIC_STAGING_RECORD_DIR, 'Set a private MUSIC_STAGING_RECORD_DIR outside the repository.');
const dir = resolve(process.env.MUSIC_STAGING_RECORD_DIR), stateFile = resolve(dir, 'fixture-private.json');
assert.ok(!dir.startsWith(stagingRoot), 'Do not write tokens or operator records into the repository.');
await mkdir(dir, { recursive: true, mode: 0o700 });
await stagingConfig();
let state;
try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const [counts] = await stagingSql(`SELECT (SELECT COUNT(*) FROM music_tracks) AS tracks,
    (SELECT COUNT(*) FROM music_assets) AS assets,(SELECT COUNT(*) FROM music_collections) AS collections,
    (SELECT value_json FROM music_settings WHERE key='catalogVersion') AS catalogVersion`);
  assert.deepEqual(counts.results, [{ tracks: 0, assets: 0, collections: 0, catalogVersion: '0' }], 'New fixture run requires an empty staging catalog.');
  state = { createKey: randomUUID(), uploads: {}, fixtureKind: 'synthetic-read-path-only' };
  await privateJson(stateFile, state);
}
assert.equal(state.fixtureKind, 'synthetic-read-path-only');
const save = () => privateJson(stateFile, state);
const client = await stagingClient();
const api = async (path, options) => {
  const r = await client.request(`/admin/api/music${path}`, options);
  assert.equal(r.status, 200, `Admin ${path}: ${r.status} ${r.json?.code || ''}`);
  assert.equal(r.json.ok, true);
  return r.json;
};
try {
  const status = await api('/status');
  assert.equal(status.flags.uploads, true, 'Uploads must be explicitly enabled for the fixture window.');
  assert.equal(status.flags.public, false, 'Keep reads closed until fixtures are ready.');
  assert.equal(status.flags.analytics, false);
  assert.equal(status.cleanup.executionEnabled, false);
  assert.ok([0, 1048576].includes(status.storage.quotaBytes), 'Do not resize a different staging budget.');
  await stagingSql("UPDATE music_settings SET value_json='1048576',updated_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE key='storageQuotaBytes'");
  const metadata = { originalLocale: 'en', title: { en: '[STAGING] Synthetic sine wave' },
    summary: { en: 'Read-path test fixture only. Not a commercial release or an approved rights review.' },
    creatorName: 'Station Cat staging fixture', language: 'instrumental', instrumental: true, genres: [], moods: [],
    story: 'Locally synthesized sine wave from the checked-in MP3 test corpus. No third-party song or voice. Synthetic catalog state is seeded for isolated HTTP tests only.' };
  if (!state.trackId) {
    Object.assign(state, await api('/tracks', { method: 'POST', json: { slug: 'staging-http-synthetic-vip', metadata },
      headers: { 'Idempotency-Key': state.createKey } }));
    await save();
  }
  const sources = [
    { kind: 'audio', format: 'mp3', type: 'audio/mpeg', data: await readFile(resolve(stagingRoot, 'tests/fixtures/music-mp3/cbr-stereo.mp3')) },
    { kind: 'preview', format: 'mp3', type: 'audio/mpeg', data: await readFile(resolve(stagingRoot, 'tests/fixtures/music-mp3/preview.mp3')) },
    { kind: 'cover', format: 'png', type: 'image/png', data: await sharp({ create: { width: 32, height: 32, channels: 3, background: '#426880' } }).png().toBuffer() },
    { kind: 'lyrics', format: 'txt', type: 'text/plain', data: Buffer.from('[STAGING TEST]\nSynthetic tone; this is not song lyrics.\n') }
  ];
  assert.ok(sources.reduce((sum, f) => sum + f.data.length, 0) < 1048576);
  for (const f of sources) {
    const u = state.uploads[f.kind] ||= { reserveKey: randomUUID(), bodyKey: randomUUID(), completeKey: randomUUID() };
    await save();
    if (!u.uploadId) {
      Object.assign(u, await api('/uploads', { method: 'POST', headers: { 'Idempotency-Key': u.reserveKey }, json: {
        trackId: state.trackId, kind: f.kind, format: f.format, byteSize: f.data.length,
        sha256: createHash('sha256').update(f.data).digest('hex'),
        ...(f.kind === 'preview' ? { sourceAssetId: state.uploads.audio.assetId, sourceStartMs: 0, sourceEndMs: 1000 } : {})
      } }));
      await save();
    }
    let current = await api(`/uploads/${u.uploadId}`);
    if (current.status === 'reserved') {
      await api(`/uploads/${u.uploadId}/body`, { method: 'PUT', body: f.data,
        headers: { 'Idempotency-Key': u.bodyKey, 'Content-Type': f.type } });
      current = await api(`/uploads/${u.uploadId}`);
    }
    // An unconfirmed writer is never retried with PUT. Only completion may recover it.
    if (current.status !== 'completed') {
      current = await api(`/uploads/${u.uploadId}/complete`, { method: 'POST', json: {}, headers: { 'Idempotency-Key': u.completeKey } });
    }
    assert.equal(current.status, 'completed');
    Object.assign(u, { completed: true, bytes: f.data.length });
    await save();
  }
  if (!state.savedRevisionId) {
    const track = await api(`/tracks/${state.trackId}`);
    state.saveCommand ||= { slug: track.slug, metadata, policy: track.draft.policy, revisionId: track.draft.id,
      assets: Object.fromEntries(Object.entries(state.uploads).map(([kind, u]) => [kind, u.assetId])),
      reason: 'Attach real validated uploads to the isolated synthetic read fixture.' };
    state.saveKey ||= randomUUID(); state.saveVersion ||= track.editVersion;
    await save();
    const result = await api(`/tracks/${state.trackId}`, { method: 'PATCH', json: state.saveCommand,
      headers: { 'If-Match': `"edit-${state.saveVersion}"`, 'Idempotency-Key': state.saveKey } });
    state.savedRevisionId = result.revisionId;
    await save();
  }
  if (!state.catalogSeeded) {
    const now = Date.now(), track = q(state.trackId), revision = q(state.savedRevisionId);
    // There is deliberately NO rights approval, fictitious Suno fact or approval fingerprint.
    // The files were verified by the real upload API; timestamps below satisfy the synthetic read contract only.
    await stagingSql(`INSERT INTO music_admin_audit_logs(id,actor_id,action,target_id,summary_json,created_at,request_id)
      SELECT ${q(randomUUID())},'staging-fixture-operator','music.staging.fixture',${track},
      ${q(JSON.stringify({ synthetic: true, publicationApiAccepted: false, rightsApproved: false, quotaBytes: 1048576 }))},${now},${q(randomUUID())}
      WHERE NOT EXISTS(SELECT 1 FROM music_admin_audit_logs WHERE target_id=${track} AND action='music.staging.fixture');
      UPDATE music_track_revisions SET state='sealed',technical_reviewed_at=${now}
      WHERE id=${revision} AND track_id=${track} AND state='draft';
      UPDATE music_tracks SET lifecycle='published',published_revision_id=${revision},draft_revision_id=NULL,
      first_published_at=COALESCE(first_published_at,${now}),published_at=${now},updated_at=${now}
      WHERE id=${track} AND lifecycle='draft';
      UPDATE music_settings SET value_json='1',updated_at=${now} WHERE key='catalogVersion';`);
    state.catalogSeeded = true;
    await save();
  }
  state.audioVersion = (await api(`/tracks/${state.trackId}`)).published.number;
  await save();
  const collection = { slug: 'staging-http-fixtures', originalLocale: 'en',
    title: { en: '[STAGING] Synthetic HTTP fixtures' }, description: { en: 'Test data only; no commercial releases.' } };
  if (!state.collectionId) {
    state.collectionCreateKey ||= randomUUID(); await save();
    const result = await api('/collections', { method: 'POST', json: collection,
      headers: { 'Idempotency-Key': state.collectionCreateKey } });
    state.collectionId = result.collectionId; await save();
  }
  if (!state.collectionPublished) {
    let current = await api(`/collections/${state.collectionId}`);
    if (!current.tracks.some(track => track.id === state.trackId)) {
      await api(`/collections/${state.collectionId}/tracks`, { method: 'PUT',
        json: { trackIds: [state.trackId], reason: 'Isolated synthetic fixture collection.' },
        headers: { 'If-Match': `"edit-${current.editVersion}"` } });
      current = await api(`/collections/${state.collectionId}`);
    }
    await api(`/collections/${state.collectionId}`, { method: 'PATCH',
      json: { ...collection, status: 'published', reason: 'Expose only the labelled staging read fixture.' },
      headers: { 'If-Match': `"edit-${current.editVersion}"` } });
    state.collectionPublished = true; await save();
  }
  if (!state.identitiesSeeded) {
    const [count] = await stagingSql('SELECT COUNT(*) AS count FROM reader_accounts', 'MUSIC_STAGING_MEMBERSHIP_DB');
    assert.equal(count.results[0].count, 0);
    const now = Date.now(), past = new Date(now - 3600000).toISOString(), future = new Date(now + 86400000).toISOString();
    state.sessions ||= Object.fromEntries(['normal', 'vip', 'expired', 'revoked', 'restricted', 'future', 'sessionExpired'].map((name, i) =>
      [name, { id: i + 1, token: randomBytes(32).toString('base64url') }]));
    await save();
    let sql = '';
    for (const [name, { id, token }] of Object.entries(state.sessions)) {
      const hash = createHash('sha256').update(token).digest('hex');
      sql += `INSERT INTO reader_accounts VALUES(${id},${q(name === 'restricted' ? 'restricted' : 'active')});
        INSERT INTO reader_sessions VALUES(${q(hash)},${id},${q(past)},${q(name === 'sessionExpired' ? new Date(now - 1000).toISOString() : future)},${q(name === 'revoked' ? past : null)});`;
      if (name !== 'normal') sql += `INSERT INTO reader_memberships VALUES(${id},'member',
        ${q(name === 'future' ? new Date(now + 3600000).toISOString() : past)},
        ${q(name === 'expired' ? new Date(now - 1000).toISOString() : future)});`;
    }
    await stagingSql(sql, 'MUSIC_STAGING_MEMBERSHIP_DB');
    state.identitiesSeeded = true;
    await save();
  }
  const info = { trackId: state.trackId, revisionId: state.savedRevisionId, audioVersion: state.audioVersion,
    collectionId: state.collectionId, quotaBytes: 1048576,
    chargedBytes: Object.values(state.uploads).reduce((sum, u) => sum + u.bytes, 0), assets: 4, syntheticAccounts: 7,
    source: 'Checked-in locally synthesized sine waves; no third-party recording', rightsApproved: false, publicationApiAccepted: false };
  await privateJson(resolve(dir, 'fixture-summary.json'), info);
  console.log(JSON.stringify(info));
} finally { await client.close(); }
