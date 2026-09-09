import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { executeMusicPublication } from '../src/music/publication.js';
import { publicationFingerprint } from '../src/music/publicationValidation.js';
import { projectPublicTrack } from '../src/music/catalog.js';

const dbs = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const migration = n => readFileSync(new URL(`../migrations-music/${n}`, import.meta.url), 'utf8');
function insert(db, table, values) {
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(values));
}
function database() {
  const sql = new DatabaseSync(':memory:'); dbs.push(sql); sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(migration('0001_music_foundation.sql')); sql.exec(migration('0002_music_publication.sql'));
  const state = { fail: null, skip: null, beforeWrite: null, lose: false, binds: 0 };
  class Statement {
    constructor(query, params = []) { Object.assign(this, { query, params }); }
    bind(...params) { state.binds = Math.max(state.binds, params.length); assert.ok(params.length <= 100); return new Statement(this.query, params); }
    async all() { return { success: true, results: sql.prepare(this.query).all(...this.params) }; }
  }
  const db = { withSession(mode) {
    assert.equal(mode, 'first-primary');
    return { prepare: query => new Statement(query), async batch(statements) {
      const writes = statements.some(s => !/^SELECT/.test(s.query));
      if (writes && state.beforeWrite) { const callback = state.beforeWrite; state.beforeWrite = null; await callback(); }
      sql.exec('BEGIN');
      let result;
      try {
        result = statements.map(s => {
          if (writes && state.fail?.test(s.query)) throw new Error('injected failure');
          if (writes && state.skip?.test(s.query)) { sql.prepare('UPDATE music_tracks SET edit_version=edit_version WHERE id=?').run('missing'); return { success: true, results: [] }; }
          return { success: true, results: sql.prepare(s.query).all(...s.params) };
        });
        sql.exec('COMMIT');
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
      if (writes && state.lose) { state.lose = false; throw new Error('lost commit response'); }
      return result;
    } };
  } };
  return { sql, db, state };
}
function reviewData(now) {
  return { sourcePlatform: 'suno', sourceSongUrl: null, sourceSongId: 'fixture-song',
    generatedAt: new Date(now - 3000).toISOString(), downloadedAt: new Date(now - 2000).toISOString(),
    termsCheckedAt: new Date(now - 1000).toISOString(), planAtGeneration: 'pro', planAtDownload: 'pro',
    outputKind: 'standard', downloadMethod: 'official', permittedUse: 'commercial',
    authorizationBasis: 'Isolated permission fixture, not an actual license.',
    lyricsRightsNotes: 'Instrumental fixture.', coverRightsNotes: 'No custom cover.', audioInputRightsNotes: 'No third-party inputs.' };
}
async function seed(f, mode = 'vip') {
  const now = Date.now(), { sql } = f;
  const ids = { id: randomUUID(), revisionId: randomUUID(), audio: randomUUID(), preview: randomUUID(), evidence: randomUUID(), rightsId: randomUUID() };
  insert(sql, 'music_tracks', { id: ids.id, slug: `song-${ids.id}`, created_at: now - 3000, updated_at: now - 1000 });
  const asset = { owner_track_id: ids.id, state: 'validated', byte_size: 1000, sha256: 'a'.repeat(64), etag: 'fixture-etag', created_at: now - 2000 };
  insert(sql, 'music_assets', { ...asset, id: ids.audio, kind: 'audio', format: 'mp3', content_type: 'audio/mpeg', duration_ms: 120000, object_key: `private/${ids.audio}` });
  insert(sql, 'music_assets', { ...asset, id: ids.preview, kind: 'preview', format: 'mp3', content_type: 'audio/mpeg', duration_ms: 30000,
    object_key: `private/${ids.preview}`, derived_from_asset_id: ids.audio, source_start_ms: 10000, source_end_ms: 40000 });
  insert(sql, 'music_assets', { ...asset, id: ids.evidence, kind: 'evidence', format: 'pdf', content_type: 'application/pdf', object_key: `private/${ids.evidence}` });
  insert(sql, 'music_track_revisions', { id: ids.revisionId, track_id: ids.id, revision_no: 1, audio_asset_id: ids.audio,
    preview_asset_id: ids.preview, access_mode: mode, early_access_until: mode === 'early_access' ? now + 86400000 : null,
    post_early_access_mode: mode === 'early_access' ? 'free' : null, created_at: now - 2000, technical_reviewed_at: now - 1000,
    metadata_json: JSON.stringify({ originalLocale: 'zh-Hant', title: { 'zh-Hant': '測試作品', en: 'Fixture song' },
      summary: { 'zh-Hant': '測試摘要' }, creatorName: 'Fixture', instrumental: true, language: 'instrumental', genres: [], moods: [] }) });
  insert(sql, 'music_rights_reviews', { id: ids.rightsId, revision_id: ids.revisionId, review_json: JSON.stringify(reviewData(now)),
    review_status: 'approved', reviewer_id: 'reviewer@example.test', reviewed_at: now - 1000 });
  insert(sql, 'music_rights_evidence', { review_id: ids.rightsId, asset_id: ids.evidence });
  sql.prepare('UPDATE music_tracks SET draft_revision_id=? WHERE id=?').run(ids.revisionId, ids.id);
  await stamp(f, ids); return ids;
}
function snapshot(f, ids) {
  return { track: f.sql.prepare('SELECT * FROM music_tracks WHERE id=?').get(ids.id),
    revision: f.sql.prepare('SELECT * FROM music_track_revisions WHERE id=?').get(ids.revisionId),
    assets: f.sql.prepare('SELECT * FROM music_assets WHERE owner_track_id=? ORDER BY id').all(ids.id),
    rights: f.sql.prepare('SELECT * FROM music_rights_reviews WHERE id=?').get(ids.rightsId),
    evidence: f.sql.prepare('SELECT * FROM music_rights_evidence WHERE review_id=? ORDER BY asset_id').all(ids.rightsId) };
}
async function stamp(f, ids) {
  const hash = await publicationFingerprint(snapshot(f, ids));
  f.sql.prepare('UPDATE music_track_revisions SET technical_fingerprint=? WHERE id=?').run(hash, ids.revisionId);
  f.sql.prepare('UPDATE music_rights_reviews SET revision_fingerprint=? WHERE id=?').run(hash, ids.rightsId);
}
const verifier = async assets => ({ checkedAt: Date.now(), assets: assets.map(a => ({ id: a.id, exists: true,
  sha256: a.sha256, etag: a.etag, byteSize: a.byte_size, contentType: a.content_type, structureValid: true,
  measurement: 'mp3-frames', durationMs: a.duration_ms, width: 1200, height: 1200, animated: false, utf8: true, lines: 10 })) });
function command(f, ids, patch = {}) {
  return { action: 'publish', trackId: ids.id, revisionId: ids.revisionId,
    ifMatch: `"edit-${snapshot(f, ids).track.edit_version}"`, confirmedPolicyVersion: snapshot(f, ids).revision.policy_version,
    idempotencyKey: randomUUID(), reason: 'Isolated publication test.', ...patch };
}
const run = (f, input, opts = {}) => executeMusicPublication(f.db, input, { actorId: 'admin@example.test', verifyResources: verifier, ...opts });
const dump = f => Object.fromEntries(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, f.sql.prepare(`SELECT * FROM ${name}`).all()]));
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
async function newDraft(f, ids) {
  const before = snapshot(f, ids), revisionId = randomUUID(), rightsId = randomUUID();
  insert(f.sql, 'music_track_revisions', { ...before.revision, id: revisionId, revision_no: before.revision.revision_no + 1,
    state: 'draft', technical_fingerprint: null });
  insert(f.sql, 'music_rights_reviews', { ...before.rights, id: rightsId, revision_id: revisionId, revision_fingerprint: null });
  insert(f.sql, 'music_rights_evidence', { review_id: rightsId, asset_id: ids.evidence });
  f.sql.prepare('UPDATE music_tracks SET draft_revision_id=?,edit_version=edit_version+1 WHERE id=?').run(revisionId, ids.id);
  const next = { ...ids, revisionId, rightsId }; await stamp(f, next); return next;
}

test('append-only migration preserves legacy data and blocks mutation UPDATE/REPLACE/DELETE', async () => {
  const f = database(), ids = await seed(f); await run(f, command(f, ids));
  for (const sql of ["UPDATE music_mutations SET result_json='{}'", 'DELETE FROM music_mutations',
    'INSERT OR REPLACE INTO music_mutations SELECT * FROM music_mutations']) {
    assert.throws(() => f.sql.exec(sql), /MUSIC_IMMUTABLE_MUTATION/);
  }
  assert.equal(f.sql.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_publication_guards').get().n, 0);
  const old = new DatabaseSync(':memory:'); dbs.push(old); old.exec(migration('0001_music_foundation.sql'));
  old.exec("INSERT INTO music_mutations VALUES('actor','route','key','" + 'a'.repeat(64) + "','{\"old\":true}',2,1)");
  old.exec(migration('0002_music_publication.sql'));
  assert.equal(old.prepare('SELECT result_json FROM music_mutations').get().result_json, '{"old":true}');
});

test('publish atomically seals revision, switches pointers, bumps versions and writes one audit/receipt', async () => {
  const f = database(), ids = await seed(f), input = command(f, ids);
  const result = await run(f, input); assert.equal(result.replayed, false); assert.equal(result.catalogVersion, 1);
  const current = snapshot(f, ids); assert.equal(current.track.draft_revision_id, null);
  assert.equal(current.track.published_revision_id, ids.revisionId); assert.equal(current.track.edit_version, 2);
  assert.equal(current.revision.state, 'sealed');
  assert.ok(projectPublicTrack(current, { locale: 'en', now: Date.now() }));
  const audit = f.sql.prepare('SELECT * FROM music_admin_audit_logs').all(); assert.equal(audit.length, 1);
  assert.equal(JSON.parse(audit[0].summary_json).newPolicy.accessMode, 'vip');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_mutations').get().n, 1);
  assert.ok(f.state.binds <= 100);
});

test('same key replays exact result, changed payload conflicts, lost commit response recovers', async () => {
  const f = database(), ids = await seed(f), input = command(f, ids);
  f.state.lose = true; const first = await run(f, input); assert.equal(first.replayed, true);
  const before = dump(f); assert.deepEqual(await run(f, input), first); assert.deepEqual(dump(f), before);
  await rejects(run(f, { ...input, reason: 'Different command.' }), 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(dump(f), before);
});

test('identical concurrent requests share one receipt and audit', async () => {
  const f = database(), ids = await seed(f), input = command(f, ids);
  const results = await Promise.all([run(f, input), run(f, input)]);
  assert.equal(results[0].catalogVersion, results[1].catalogVersion);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_admin_audit_logs').get().n, 1);
});

test('replacement failure retains old public revision; success switches without losing first publication time', async () => {
  const f = database(), ids = await seed(f); await run(f, command(f, ids));
  const original = snapshot(f, ids), next = await newDraft(f, ids), input = command(f, next);
  f.state.fail = /INSERT INTO music_mutations/;
  const before = dump(f);
  await rejects(run(f, input), 'MUSIC_PUBLICATION_UNAVAILABLE');
  assert.deepEqual(dump(f), before);
  assert.equal(snapshot(f, ids).track.published_revision_id, ids.revisionId);
  assert.ok(projectPublicTrack(snapshot(f, ids), { locale: 'en', now: Date.now() }));
  f.state.fail = null; await run(f, input);
  assert.equal(snapshot(f, next).track.published_revision_id, next.revisionId);
  assert.equal(snapshot(f, next).track.first_published_at, original.track.first_published_at);
  assert.equal(snapshot(f, ids).revision.state, 'sealed');
});

test('concurrent different tracks cannot lose catalogVersion updates; loser can retry same key', async () => {
  const f = database(), a = await seed(f), b = await seed(f), inputA = command(f, a), inputB = command(f, b);
  f.state.beforeWrite = () => run(f, inputB);
  await rejects(run(f, inputA), 'MUSIC_PUBLICATION_CONFLICT');
  assert.equal(snapshot(f, a).track.lifecycle, 'draft');
  assert.equal(snapshot(f, b).track.lifecycle, 'published');
  const result = await run(f, inputA); assert.equal(result.catalogVersion, 2);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_admin_audit_logs').get().n, 2);
});

test('unpublish zero-write failures roll back status, versions, audit and receipt', async () => {
  const f = database(), ids = await seed(f); await run(f, command(f, ids));
  const input = command(f, ids, { action: 'unpublish' }), before = dump(f);
  for (const skip of [/UPDATE music_tracks SET lifecycle='unpublished'/, /UPDATE music_settings/,
    /INSERT INTO music_admin_audit_logs/, /INSERT INTO music_mutations/]) {
    f.state.skip = skip;
    await rejects(run(f, input), 'MUSIC_PUBLICATION_CONFLICT');
    assert.deepEqual(dump(f), before);
  }
  f.state.skip = null;
  assert.equal((await run(f, input)).action, 'unpublish');
});

test('early-to-free promise expiring between validation and SQL cannot acquire a VIP paywall', async () => {
  const f = database(), ids = await seed(f, 'early_access'), end = Date.now() + 5000;
  f.sql.prepare('UPDATE music_track_revisions SET early_access_until=? WHERE id=?').run(end, ids.revisionId);
  await stamp(f, ids); await run(f, command(f, ids));
  const next = await newDraft(f, ids);
  f.sql.prepare("UPDATE music_track_revisions SET access_mode='vip',early_access_until=NULL,post_early_access_mode=NULL,policy_version=2 WHERE id=?")
    .run(next.revisionId);
  await stamp(f, next);
  const input = command(f, next), before = dump(f);
  f.state.beforeWrite = () => f.sql.function('julianday', value => {
    assert.equal(value, 'now'); return 2440587.5 + (end + 100) / 86400000;
  });
  await rejects(run(f, input), 'MUSIC_PUBLICATION_CONFLICT');
  assert.deepEqual(dump(f), before);
});

test('actor-scoped keys and stale If-Match never overwrite the winner', async () => {
  const f = database(), ids = await seed(f), input = command(f, ids); await run(f, input); const before = dump(f);
  await rejects(run(f, input, { actorId: 'other@example.test' }), 'MUSIC_PUBLICATION_CONFLICT');
  await rejects(run(f, { ...input, idempotencyKey: randomUUID() }), 'MUSIC_PUBLICATION_CONFLICT');
  assert.deepEqual(dump(f), before);
});

test('every business zero-write is forced to roll back all preceding writes', async () => {
  for (const skip of [/UPDATE music_tracks SET draft_revision_id/, /UPDATE music_track_revisions SET state/,
    /UPDATE music_tracks SET lifecycle/, /UPDATE music_settings SET/, /INSERT INTO music_admin_audit_logs/, /INSERT INTO music_mutations/]) {
    const f = database(), ids = await seed(f), before = dump(f); f.state.skip = skip;
    await rejects(run(f, command(f, ids)), 'MUSIC_PUBLICATION_CONFLICT'); assert.deepEqual(dump(f), before, String(skip));
  }
});

test('SQL failures at all steps roll back; retry can safely complete', async () => {
  for (const fail of [/INSERT INTO music_publication_guards/, /UPDATE music_tracks SET draft/, /UPDATE music_track_revisions SET/,
    /UPDATE music_settings SET/, /INSERT INTO music_admin_audit_logs/, /INSERT INTO music_mutations/, /DELETE FROM music_publication_guards/]) {
    const f = database(), ids = await seed(f), before = dump(f), input = command(f, ids); f.state.fail = fail;
    await rejects(run(f, input), 'MUSIC_PUBLICATION_UNAVAILABLE'); assert.deepEqual(dump(f), before);
    f.state.fail = null; assert.equal((await run(f, input)).catalogVersion, 1);
  }
});

test('racing unversioned metadata, review, evidence and settings edits fail the transaction snapshot guard', async () => {
  for (const change of [
    f => f.sql.exec("UPDATE music_track_revisions SET metadata_json=json_set(metadata_json,'$.creatorName','Changed')"),
    f => f.sql.exec("UPDATE music_rights_reviews SET review_status='blocked'"),
    f => f.sql.exec('DELETE FROM music_rights_evidence'),
    f => f.sql.exec("UPDATE music_settings SET value_json='20000' WHERE key='previewLimitMs'"),
    f => f.sql.exec('UPDATE music_tracks SET edit_version=edit_version+1')
  ]) {
    const f = database(), ids = await seed(f); let afterOtherWriter;
    f.state.beforeWrite = () => { change(f); afterOtherWriter = dump(f); };
    await rejects(run(f, command(f, ids)), 'MUSIC_PUBLICATION_CONFLICT'); assert.deepEqual(dump(f), afterOtherWriter);
  }
});

test('rights are commercial + official + version-specific, not an approved boolean alone', async () => {
  for (const patch of [{ permittedUse: 'personal_only' }, { downloadMethod: 'unknown' }, { planAtGeneration: 'unknown' },
    { authorizationBasis: '' }, { lyricsRightsNotes: '' }, { termsCheckedAt: 'invalid' },
    { sourceSongUrl: 'https://evil.example/song' }, { sourceSongUrl: 'javascript:alert(1)' }]) {
    const f = database(), ids = await seed(f), review = { ...reviewData(Date.now()), ...patch };
    f.sql.prepare('UPDATE music_rights_reviews SET review_json=?').run(JSON.stringify(review)); await stamp(f, ids);
    const before = dump(f); await rejects(run(f, command(f, ids)), 'RIGHTS_REVIEW_REQUIRED'); assert.deepEqual(dump(f), before);
  }
});

test('free-origin/remix exceptions require a specific permission document and explanation', async () => {
  const f = database(), ids = await seed(f), data = { ...reviewData(Date.now()), planAtGeneration: 'free', outputKind: 'remix' };
  f.sql.prepare('UPDATE music_rights_reviews SET review_json=?').run(JSON.stringify(data)); await stamp(f, ids);
  await rejects(run(f, command(f, ids)), 'RIGHTS_EXCEPTION_REQUIRED');
  data.exceptionEvidenceAssetId = ids.evidence; data.exceptionAuthorizationBasis = 'Fixture explicit exception permission.';
  f.sql.prepare('UPDATE music_rights_reviews SET review_json=?').run(JSON.stringify(data)); await stamp(f, ids);
  assert.equal((await run(f, command(f, ids))).action, 'publish');
});

test('approval fingerprints become stale after edits and cannot be copied to new revisions', async () => {
  const f = database(), ids = await seed(f);
  f.sql.exec("UPDATE music_track_revisions SET metadata_json=json_set(metadata_json,'$.creatorName','Other')");
  await rejects(run(f, command(f, ids)), 'MUSIC_REVIEW_STALE'); await stamp(f, ids); await run(f, command(f, ids));
  const old = snapshot(f, ids), next = await newDraft(f, ids);
  f.sql.prepare('UPDATE music_track_revisions SET technical_fingerprint=? WHERE id=?').run(old.revision.technical_fingerprint, next.revisionId);
  await rejects(run(f, command(f, next)), 'MUSIC_REVIEW_STALE');
});

test('slug and metadata limits share public projection checks; invalid drafts stay private', async () => {
  for (const change of [f => f.sql.exec("UPDATE music_tracks SET slug='Not A Slug'"),
    f => f.sql.exec("UPDATE music_track_revisions SET metadata_json=json_set(metadata_json,'$.title.en','')"),
    f => f.sql.prepare("UPDATE music_track_revisions SET metadata_json=json_set(metadata_json,'$.creatorName',?)").run('x'.repeat(81))]) {
    const f = database(), ids = await seed(f); change(f); await stamp(f, ids);
    // Empty translations are a valid original-language fallback; other invalid values must fail.
    if (snapshot(f, ids).revision.metadata_json.includes('"en":""')) { await run(f, command(f, ids)); continue; }
    await assert.rejects(run(f, command(f, ids)), error => ['MUSIC_INVALID_PUBLICATION', 'MUSIC_INVALID_METADATA'].includes(error.code));
    assert.equal(snapshot(f, ids).track.lifecycle, 'draft');
  }
});

test('protected tracks require a separate preview and configurable half-length/limit validation', async () => {
  const f = database(), ids = await seed(f);
  f.sql.prepare('UPDATE music_track_revisions SET preview_asset_id=NULL').run();
  // Fingerprint uses only referenced resources in production; validation rejects before it is needed.
  await rejects(run(f, command(f, ids)), 'PREVIEW_REQUIRED');
  f.sql.prepare('UPDATE music_track_revisions SET preview_asset_id=?').run(ids.preview);
  f.sql.exec("UPDATE music_settings SET value_json='15000' WHERE key='previewLimitMs'");
  await rejects(run(f, command(f, ids)), 'PREVIEW_INVALID');
  f.sql.exec("UPDATE music_settings SET value_json='45001' WHERE key='previewLimitMs'");
  await rejects(run(f, command(f, ids)), 'MUSIC_INVALID_SETTINGS');
});

test('missing verifier/metadata-only duration/missing object/stale proof never publishes', async () => {
  const f = database(), ids = await seed(f), input = command(f, ids);
  await rejects(run(f, input, { verifyResources: undefined }), 'MUSIC_TECHNICAL_VERIFIER_UNAVAILABLE');
  for (const [mutate, code] of [
    [p => { p.assets[0].exists = false; }, 'MUSIC_RESOURCE_VERIFICATION_FAILED'],
    [p => { p.assets[0].etag = 'changed'; }, 'MUSIC_RESOURCE_VERIFICATION_FAILED'],
    [p => { p.checkedAt -= 16000; }, 'MUSIC_RESOURCE_VERIFICATION_FAILED'],
    [p => { p.assets.find(a => a.durationMs).measurement = 'metadata'; }, 'MUSIC_MP3_MEASUREMENT_REQUIRED']
  ]) {
    await rejects(run(f, input, { verifyResources: async assets => { const p = await verifier(assets); mutate(p); return p; } }), code);
  }
  assert.equal(snapshot(f, ids).track.lifecycle, 'draft');
});

test('publication count guard enforces 500 even when another publisher takes the last slot', async () => {
  const f = database(), ids = await seed(f);
  f.state.beforeWrite = () => {
    // Structurally valid isolated rows fill the catalog without bypassing foreign keys or checks.
    for (let i = 0; i < 500; i++) {
      const id = randomUUID(), rev = randomUUID(), audio = randomUUID();
      insert(f.sql, 'music_tracks', { id, slug: `capacity-${i}`, created_at: 1, updated_at: 1 });
      insert(f.sql, 'music_assets', { id: audio, owner_track_id: id, kind: 'audio', object_key: audio,
        state: 'validated', byte_size: 1, sha256: 'b'.repeat(64), duration_ms: 1000, format: 'mp3', content_type: 'audio/mpeg', created_at: 1 });
      insert(f.sql, 'music_track_revisions', { id: rev, track_id: id, revision_no: 1, state: 'sealed', audio_asset_id: audio, technical_reviewed_at: 1, created_at: 1 });
      f.sql.prepare("UPDATE music_tracks SET lifecycle='published',published_revision_id=?,first_published_at=1,published_at=1 WHERE id=?").run(rev, id);
    }
  };
  await rejects(run(f, command(f, ids)), 'MUSIC_PUBLICATION_CONFLICT');
  assert.equal(snapshot(f, ids).track.lifecycle, 'draft');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM music_admin_audit_logs').get().n, 0);
});

test('unpublish is atomic, retains sealed media and works with verifier offline; old publish receipt cannot republish', async () => {
  const f = database(), ids = await seed(f), publish = command(f, ids); await run(f, publish);
  const input = command(f, ids, { action: 'unpublish' }); const firstPublished = snapshot(f, ids).track.first_published_at;
  await run(f, input, { verifyResources: undefined });
  assert.equal(snapshot(f, ids).track.lifecycle, 'unpublished'); assert.equal(snapshot(f, ids).revision.state, 'sealed');
  assert.equal(snapshot(f, ids).track.first_published_at, firstPublished);
  assert.equal((await run(f, publish)).replayed, true); assert.equal(snapshot(f, ids).track.lifecycle, 'unpublished');
  assert.equal((await run(f, input)).replayed, true);
});

test('previously free publication cannot acquire a paywall; explicit policy version must match', async () => {
  const f = database(), ids = await seed(f, 'free'); await run(f, command(f, ids));
  const next = await newDraft(f, ids);
  f.sql.prepare("UPDATE music_track_revisions SET access_mode='vip',policy_version=2 WHERE id=?").run(next.revisionId); await stamp(f, next);
  await rejects(run(f, command(f, next)), 'MUSIC_FREE_PROMISE_PROTECTED');
  await rejects(run(f, command(f, next, { confirmedPolicyVersion: 1 })), 'MUSIC_POLICY_NOT_CONFIRMED');
});

test('early-access expired window survives a copy edit; policy change requires a future end', async () => {
  const f = database(), ids = await seed(f, 'early_access'); await run(f, command(f, ids));
  const end = snapshot(f, ids).revision.early_access_until;
  const next = await newDraft(f, ids);
  f.sql.prepare("UPDATE music_track_revisions SET metadata_json=json_set(metadata_json,'$.creatorName','New caption') WHERE id=?").run(next.revisionId);
  await stamp(f, next);
  const futureClock = () => end + 1;
  await run(f, command(f, next), { clock: futureClock, verifyResources: async assets => ({ ...await verifier(assets), checkedAt: end + 1 }) });
  assert.equal(snapshot(f, next).revision.policy_version, 1);
});

test('invalid command, absent migration and missing bindings fail closed', async () => {
  const f = database(), ids = await seed(f), input = command(f, ids);
  for (const patch of [{ ifMatch: '*' }, { ifMatch: 'edit-1' }, { revisionId: 'x' }, { reason: '' }, { idempotencyKey: 'short' }]) {
    await rejects(run(f, { ...input, ...patch }), 'INVALID_INPUT');
  }
  await rejects(executeMusicPublication({}, input, { actorId: 'admin' }), 'MUSIC_PUBLICATION_UNAVAILABLE');
  f.sql.exec('DROP TABLE music_publication_guards');
  await rejects(run(f, input), 'MUSIC_PUBLICATION_UNAVAILABLE');
  assert.equal(snapshot(f, ids).track.lifecycle, 'draft');
});
