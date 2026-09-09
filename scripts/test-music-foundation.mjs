import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { MUSIC_LOCALES, createDraftPolicy, createEarlyAccessPolicy, effectivePolicy, isoTime, utcMillis,
  validatePolicy, validatePolicyTransition, variantRequirement } from '../src/music/policy.js';
import { buildPublicCatalog, projectPublicTrack } from '../src/music/catalog.js';

const migration = readFileSync(new URL('../migrations-music/0001_music_foundation.sql', import.meta.url), 'utf8');
const now = Date.parse('2026-09-09T00:00:00Z');
const dbs = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function database() {
  const db = new DatabaseSync(':memory:'); dbs.push(db);
  db.exec('PRAGMA foreign_keys = ON'); db.exec(migration); return db;
}
function insert(db, table, values) {
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(values));
}
const policy = (accessMode = 'vip', extra = {}) => ({ ...createDraftPolicy(), accessMode, ...extra });
const early = (post = 'free') => policy('early_access', { earlyAccessUntil: isoTime(now), postEarlyAccessMode: post });

function seed(db, access = 'vip') {
  const id = randomUUID();
  insert(db, 'music_tracks', { id, slug: `song-${id}`, created_at: now - 2000, updated_at: now });
  const audio = randomUUID(); const preview = randomUUID(); const cover = randomUUID(); const evidence = randomUUID();
  const base = { owner_track_id: id, state: 'validated', byte_size: 1000, sha256: 'a'.repeat(64), created_at: now - 1000 };
  insert(db, 'music_assets', { ...base, id: audio, kind: 'audio', format: 'mp3', object_key: `private/audio/${audio}`, content_type: 'audio/mpeg', duration_ms: 120000 });
  insert(db, 'music_assets', { ...base, id: preview, kind: 'preview', format: 'mp3', object_key: `private/preview/${preview}`, content_type: 'audio/mpeg', duration_ms: 45000, derived_from_asset_id: audio, source_start_ms: 10000, source_end_ms: 55000 });
  insert(db, 'music_assets', { ...base, id: cover, kind: 'cover', format: 'png', object_key: `private/cover/${cover}`, content_type: 'image/png' });
  insert(db, 'music_assets', { ...base, id: evidence, kind: 'evidence', format: 'pdf', object_key: `private/evidence/${evidence}`, content_type: 'application/pdf' });
  const revisionId = randomUUID();
  const metadata = { originalLocale: 'zh-Hant', title: { 'zh-Hant': '原始作品', en: 'Original Song', ja: '原曲' },
    summary: { 'zh-Hant': '作品簡介', en: 'A short introduction' }, creatorName: 'Station Cat',
    language: 'instrumental', instrumental: true, genres: ['ambient'], moods: ['calm'],
    prompt: 'PRIVATE-PROMPT', administrator: 'PRIVATE-ADMIN', canPlayFull: true,
    story: 'PRIVATE-LONG-STORY', sourceUrl: 'javascript:alert(1)' };
  insert(db, 'music_track_revisions', { id: revisionId, track_id: id, revision_no: 1,
    metadata_json: JSON.stringify(metadata), audio_asset_id: audio, preview_asset_id: preview, cover_asset_id: cover,
    access_mode: access, early_access_until: access === 'early_access' ? now : null,
    post_early_access_mode: access === 'early_access' ? 'free' : null,
    technical_reviewed_at: now - 1000, created_at: now - 1000 });
  const reviewId = randomUUID();
  insert(db, 'music_rights_reviews', { id: reviewId, revision_id: revisionId,
    review_json: '{"evidence":"PRIVATE-RIGHTS"}', review_status: 'approved', reviewer_id: 'PRIVATE-ADMIN', reviewed_at: now - 1000 });
  insert(db, 'music_rights_evidence', { review_id: reviewId, asset_id: evidence });
  db.prepare("UPDATE music_track_revisions SET state = 'sealed' WHERE id = ?").run(revisionId);
  db.prepare("UPDATE music_tracks SET lifecycle = 'published', published_revision_id = ?, first_published_at = ?, published_at = ? WHERE id = ?")
    .run(revisionId, now - 1000, now - 1000, id);
  return { id, audio, preview, cover, evidence, revisionId, reviewId };
}
function record(db, ids) {
  return { track: db.prepare('SELECT * FROM music_tracks WHERE id = ?').get(ids.id),
    revision: db.prepare('SELECT * FROM music_track_revisions WHERE id = ?').get(ids.revisionId),
    assets: db.prepare('SELECT * FROM music_assets WHERE owner_track_id = ?').all(ids.id) };
}
const catalog = (records, extra = {}) => buildPublicCatalog({ records, catalogVersion: 1, locale: 'en', now, ...extra });

test('independent fresh schema, no account seeds, one-time migration and integrity', () => {
  const db = database();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.equal(tables.length, 14); assert(tables.every(name => name.startsWith('music_')));
  for (const table of tables) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.throws(() => db.exec(migration), /already exists/);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert(!readdirSync(new URL('../migrations/', import.meta.url)).includes('0001_music_foundation.sql'));
  assert(!readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8').includes('MUSIC_DB'));
});

test('new drafts default VIP; explicit free publication stays free while editing', () => {
  const db = database(); const ids = seed(db, 'free'); const draftId = randomUUID();
  insert(db, 'music_track_revisions', { id: draftId, track_id: ids.id, revision_no: 2, created_at: now });
  assert.equal(db.prepare('SELECT access_mode FROM music_track_revisions WHERE id = ?').get(draftId).access_mode, 'vip');
  db.prepare('UPDATE music_tracks SET draft_revision_id = ? WHERE id = ?').run(draftId, ids.id);
  assert.equal(projectPublicTrack(record(db, ids), { locale: 'en', now }).effectiveAccess, 'free');
  assert.equal(db.prepare('SELECT published_revision_id FROM music_tracks WHERE id = ?').get(ids.id).published_revision_id, ids.revisionId);
  assert.equal(createDraftPolicy().accessMode, 'vip');
});

test('foreign keys/kind guards reject cross-track publication/media and evidence-as-audio', () => {
  const db = database(); const a = seed(db); const b = seed(db);
  assert.throws(() => db.prepare('UPDATE music_tracks SET published_revision_id = ? WHERE id = ?').run(b.revisionId, a.id), /FOREIGN KEY/);
  const draft = { id: randomUUID(), track_id: a.id, revision_no: 2, created_at: now };
  assert.throws(() => insert(db, 'music_track_revisions', { ...draft, audio_asset_id: b.audio }), /FOREIGN KEY/);
  assert.throws(() => insert(db, 'music_track_revisions', { ...draft, audio_asset_id: a.evidence }), /MUSIC_ASSET_REFERENCE/);
  assert.throws(() => insert(db, 'music_track_revisions', { ...draft, audio_asset_id: a.audio, preview_asset_id: b.preview }), /MUSIC_ASSET_REFERENCE|FOREIGN KEY/);
  insert(db, 'music_track_revisions', draft);
  assert.throws(() => db.prepare('UPDATE music_tracks SET published_revision_id = ? WHERE id = ?').run(draft.id, a.id), /MUSIC_REVISION_POINTER/);
  assert.throws(() => db.prepare('UPDATE music_track_revisions SET cover_asset_id = ? WHERE id = ?').run(a.evidence, draft.id), /MUSIC_ASSET_REFERENCE/);
});

test('sealed revisions, assets, rights, evidence and public slug are retained and immutable', () => {
  const db = database(); const ids = seed(db);
  for (const [sql, id] of [
    ["UPDATE music_track_revisions SET access_mode = 'free' WHERE id = ?", ids.revisionId],
    ['DELETE FROM music_track_revisions WHERE id = ?', ids.revisionId],
    ["UPDATE music_assets SET object_key = 'replacement' WHERE id = ?", ids.audio],
    ['DELETE FROM music_assets WHERE id = ?', ids.audio],
    ["UPDATE music_rights_reviews SET review_status = 'blocked' WHERE id = ?", ids.reviewId],
    ['DELETE FROM music_rights_reviews WHERE id = ?', ids.reviewId],
    ['DELETE FROM music_rights_evidence WHERE review_id = ?', ids.reviewId],
    ["UPDATE music_tracks SET slug = 'changed' WHERE id = ?", ids.id],
    ['UPDATE music_tracks SET first_published_at = NULL WHERE id = ?', ids.id],
    ["UPDATE music_tracks SET lifecycle = 'archived', published_revision_id = NULL WHERE id = ?", ids.id]
  ]) assert.throws(() => db.prepare(sql).run(id));
  db.prepare("UPDATE music_tracks SET lifecycle = 'unpublished' WHERE id = ?").run(ids.id);
  assert.equal(projectPublicTrack(record(db, ids), { locale: 'en', now }), null);
  db.prepare("UPDATE music_tracks SET lifecycle = 'archived', published_revision_id = NULL WHERE id = ?").run(ids.id);
});

test('database policy combinations, JSON and integer dates fail closed', () => {
  const db = database(); const ids = seed(db);
  const base = { id: randomUUID(), track_id: ids.id, revision_no: 2, created_at: now };
  for (const override of [{ access_mode: 'unknown' }, { access_mode: null }, { access_mode: 'early_access' },
    { access_mode: 'free', early_access_until: now }, { policy_version: 0 }, { created_at: 'tomorrow' },
    { metadata_json: '[]' }, { metadata_json: 'invalid' }, { state: 'sealed' }]) {
    assert.throws(() => insert(db, 'music_track_revisions', { ...base, ...override }));
  }
});

test('completed uploads cannot reopen; append-only audits and scoped mutation uniqueness', () => {
  const db = database(); const ids = seed(db);
  const session = { id: randomUUID(), asset_id: ids.audio, actor_id: 'admin', declared_bytes: 1000, actual_bytes: 1000,
    status: 'completed', created_at: now, expires_at: now + 1000 };
  insert(db, 'music_upload_sessions', session);
  assert.throws(() => db.prepare("UPDATE music_upload_sessions SET status = 'uploading' WHERE id = ?").run(session.id), /MUSIC_UPLOAD_TERMINAL/);
  assert.throws(() => insert(db, 'music_upload_sessions', { ...session, id: randomUUID() }), /MUSIC_UPLOAD_TERMINAL/);
  const audit = { id: randomUUID(), actor_id: 'admin', action: 'fixture', target_id: ids.id, summary_json: '{}', request_id: 'req1', created_at: now };
  insert(db, 'music_admin_audit_logs', audit);
  assert.throws(() => db.prepare("UPDATE music_admin_audit_logs SET summary_json = '{}' WHERE id = ?").run(audit.id), /MUSIC_APPEND_ONLY_AUDIT/);
  assert.throws(() => db.prepare('DELETE FROM music_admin_audit_logs WHERE id = ?').run(audit.id), /MUSIC_APPEND_ONLY_AUDIT/);
  const mutation = { actor_id: 'admin', route: 'publish', idempotency_key: 'key1', request_hash: 'a'.repeat(64), result_json: '{}', expires_at: now + 1000, created_at: now };
  insert(db, 'music_mutations', mutation);
  assert.throws(() => insert(db, 'music_mutations', mutation), /UNIQUE/);
  insert(db, 'music_mutations', { ...mutation, actor_id: 'other-admin' });
  insert(db, 'music_mutations', { ...mutation, route: 'unpublish' });
});

test('strict UTC and exact millisecond early-access end boundary', () => {
  for (const invalid of ['2026-02-30T00:00:00Z', '2026-09-09', '2026-09-09T00:00:00',
    '2026-09-09T00:00:00+00:00', '2026-09-09T24:00:00Z', '2026-09-09T00:00:60Z', null, 0]) assert.throws(() => utcMillis(invalid), /MUSIC_INVALID_UTC/);
  assert.equal(utcMillis('2024-02-29T00:00:00Z'), Date.parse('2024-02-29T00:00:00Z'));
  for (const after of ['free', 'vip']) {
    assert.equal(effectivePolicy(early(after), now - 1).effectiveAccess, 'vip');
    assert.equal(effectivePolicy(early(after), now).effectiveAccess, after);
    assert.equal(effectivePolicy(early(after), now + 1).effectiveAccess, after);
    assert.equal(effectivePolicy(early(after), now).nextPolicyChangeAt, null);
  }
});

test('unknown policies and implicit variants never authorize full playback', () => {
  for (const input of [null, {}, policy('bogus'), { accessMode: 'free' }, policy('free', { earlyAccessUntil: 'garbage' }), early('bogus'), policy('vip', { policyVersion: 0 })]) assert.throws(() => validatePolicy(input));
  for (const variant of [undefined, null, '', 'FULL', 'audio', '../full']) assert.throws(() => variantRequirement(policy(), variant, now), /MUSIC_INVALID_VARIANT/);
  assert.deepEqual(variantRequirement(policy(), 'full', now), { variant: 'full', requiredAccess: 'vip' });
  assert.equal(variantRequirement(policy(), 'preview', now).requiredAccess, 'public');
  assert.equal(variantRequirement(policy('free'), 'full', now).requiredAccess, 'public');
  assert.throws(() => variantRequirement(policy('unknown'), 'preview', now));
});

test('policy editing retains historical early window and versions actual changes', () => {
  assert.equal(utcMillis(createEarlyAccessPolicy(now, 'free').earlyAccessUntil), now + 7 * 86400000);
  assert.throws(() => createEarlyAccessPolicy(now), /INVALID_POLICY/);
  assert.throws(() => validatePolicyTransition(early(), null, now), /NOT_FUTURE/);
  assert.deepEqual(validatePolicyTransition(early(), early(), now + 1000), early());
  assert.throws(() => validatePolicyTransition(policy('free'), policy(), now), /VERSION_CONFLICT/);
  assert.equal(validatePolicyTransition(policy('free', { policyVersion: 2 }), policy(), now).accessMode, 'free');
  assert.throws(() => validatePolicyTransition(policy('vip', { policyVersion: 2 }), policy(), now), /VERSION_CONFLICT/);
});

test('real database rows project four locales with original fallback and no private fields', async () => {
  const db = database(); const input = record(db, seed(db)); const before = JSON.stringify(input);
  for (const locale of MUSIC_LOCALES) {
    const result = await catalog([input], { locale });
    assert(!/PRIVATE-|private\/|object_key|sha256|canPlayFull|accountId|validUntil|story|javascript:/.test(JSON.stringify(result)));
    const track = result.body.tracks[0]; assert.equal(track.accessMode, 'vip'); assert.equal(track.previewDurationSec, 45);
    assert.equal(track.coverUrl, `/api/music/tracks/${input.track.id}/cover?v=1`);
    assert.equal(track.title, locale === 'en' ? 'Original Song' : locale === 'ja' ? '原曲' : '原始作品');
  }
  assert.equal(JSON.stringify(input), before);
  await assert.rejects(catalog([input], { locale: 'fr' }), /INVALID_LOCALE/);
});

test('ETag changes at natural expiry without a database write; remains stable otherwise', async () => {
  const db = database(); const row = record(db, seed(db, 'early_access'));
  const a = await catalog([row], { now: now - 2 }); const b = await catalog([row], { now: now - 1 });
  const c = await catalog([row]); const d = await catalog([row], { now: now + 1 });
  assert.equal(a.etag, b.etag); assert.notEqual(b.etag, c.etag); assert.equal(c.etag, d.etag);
  assert.equal(b.body.nextPolicyChangeAt, isoTime(now)); assert.equal(c.body.nextPolicyChangeAt, null);
  assert.equal(b.body.tracks[0].effectiveAccess, 'vip'); assert.equal(c.body.tracks[0].effectiveAccess, 'free');
  assert.notEqual(c.etag, (await catalog([row], { locale: 'ja' })).etag);
  assert.equal(b.body.catalogVersion, c.body.catalogVersion);
});

test('malformed published records cannot poison catalog; preview metadata fails closed', async () => {
  const db = database(); const row = record(db, seed(db));
  const changes = [r => r.track.lifecycle = 'draft', r => r.track.published_revision_id = randomUUID(),
    r => r.revision.access_mode = null, r => r.revision.state = 'draft', r => r.revision.technical_reviewed_at = now + 1,
    r => r.revision.metadata_json = 'invalid', r => r.revision.metadata_json = '[]',
    r => { const m = JSON.parse(r.revision.metadata_json); m.title['zh-Hant'] = ''; r.revision.metadata_json = JSON.stringify(m); },
    r => r.assets.find(a => a.kind === 'preview').derived_from_asset_id = randomUUID(),
    r => r.assets.find(a => a.kind === 'preview').duration_ms = 45251,
    r => r.assets.find(a => a.kind === 'preview').object_key = r.assets.find(a => a.kind === 'audio').object_key,
    r => r.assets.find(a => a.kind === 'audio').state = 'uploaded', r => r.assets.find(a => a.kind === 'cover').kind = 'evidence',
    r => r.assets.push(null)];
  for (const change of changes) {
    const bad = structuredClone(row); change(bad);
    assert.equal(projectPublicTrack(bad, { locale: 'en', now }), null);
    assert.equal((await catalog([bad, row])).body.tracks.length, 1);
  }
  const short = structuredClone(row); short.assets.find(a => a.kind === 'audio').duration_ms = 60000;
  assert.equal(projectPublicTrack(short, { locale: 'en', now }), null);
  const p = short.assets.find(a => a.kind === 'preview'); p.duration_ms = 30250; p.source_end_ms = 40000;
  assert.equal(projectPublicTrack(short, { locale: 'en', now }).previewDurationSec, 30.25);
});

test('collections filter hidden tracks, preserve order and cannot unlock VIP', async () => {
  const db = database(); const vip = seed(db); const free = seed(db, 'free'); const hidden = seed(db);
  db.prepare("UPDATE music_tracks SET lifecycle = 'unpublished' WHERE id = ?").run(hidden.id);
  const c = { id: randomUUID(), slug: 'collection', original_locale: 'en', title_json: '{"en":"Songs"}', description_json: '{"en":"Selection"}', status: 'published', created_at: now, updated_at: now };
  insert(db, 'music_collections', c);
  for (const [position, track_id] of [vip.id, hidden.id, free.id].entries()) insert(db, 'music_collection_tracks', { collection_id: c.id, track_id, position });
  assert.throws(() => insert(db, 'music_collection_tracks', { collection_id: c.id, track_id: free.id, position: 4 }), /UNIQUE/);
  const collection = db.prepare('SELECT * FROM music_collections WHERE id = ?').get(c.id);
  const items = db.prepare('SELECT * FROM music_collection_tracks WHERE collection_id = ? ORDER BY position DESC').all(c.id);
  const result = await catalog([record(db, vip), record(db, free), record(db, hidden)], { collections: [{ collection, items }] });
  assert.deepEqual(result.body.collections[0].trackIds, [vip.id, free.id]);
  assert.equal(result.body.tracks.find(t => t.id === vip.id).effectiveAccess, 'vip');
  assert.equal((await catalog([], { collections: [{ collection, items }] })).body.collections[0].trackIds.length, 0);
});

test('500-track limit, deterministic order and ETag, duplicate rejection', async () => {
  const db = database(); const original = record(db, seed(db));
  const records = Array.from({ length: 500 }, () => {
    const r = structuredClone(original); const id = randomUUID(); r.track.id = id; r.track.slug = `song-${id}`;
    r.revision.track_id = id; for (const asset of r.assets) asset.owner_track_id = id; return r;
  });
  const a = await catalog(records); const b = await catalog([...records].reverse());
  assert.equal(a.body.tracks.length, 500); assert.equal(a.etag, b.etag);
  await assert.rejects(catalog([...records, original]), /INVALID_CATALOG/);
  await assert.rejects(catalog([original, original]), /DUPLICATE_TRACK/);
  assert.equal((await catalog([])).body.tracks.length, 0);
  assert.equal((await catalog([null, {}], { collections: [null] })).body.tracks.length, 0);
});

test('OR REPLACE cannot bypass immutable publication, assets or append-only audit', () => {
  const db = database(); const ids = seed(db);
  assert.equal(db.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0);
  assert.throws(() => db.prepare(`INSERT OR REPLACE INTO music_track_revisions
    (id, track_id, revision_no, created_at) VALUES (?, ?, 1, ?)` ).run(ids.revisionId, ids.id, now), /MUSIC_SEALED_REVISION/);
  assert.throws(() => db.prepare(`INSERT OR REPLACE INTO music_track_revisions
    (id, track_id, revision_no, created_at) VALUES (?, ?, 1, ?)` ).run(randomUUID(), ids.id, now), /MUSIC_SEALED_REVISION/);
  assert.throws(() => db.prepare(`INSERT OR REPLACE INTO music_tracks
    (id, slug, created_at, updated_at) VALUES (?, ?, ?, ?)` ).run(ids.id, 'replacement', now, now), /MUSIC_TRACK_IDENTITY/);
  assert.throws(() => db.prepare(`INSERT OR REPLACE INTO music_assets
    (id, owner_track_id, kind, object_key, content_type, format, created_at)
    VALUES (?, ?, 'audio', 'replacement', 'audio/mpeg', 'mp3', ?)` ).run(ids.audio, ids.id, now), /MUSIC_ASSET_IDENTITY/);
  assert.equal(record(db, ids).revision.state, 'sealed');
  const audit = { id: randomUUID(), actor_id: 'admin', action: 'fixture', target_id: ids.id, summary_json: '{}', request_id: 'req1', created_at: now };
  insert(db, 'music_admin_audit_logs', audit);
  assert.throws(() => db.prepare(`INSERT OR REPLACE INTO music_admin_audit_logs
    (id, actor_id, action, target_id, summary_json, request_id, created_at) VALUES (?, 'other', 'overwrite', ?, '{}', 'req1', ?)`)
    .run(randomUUID(), ids.id, now), /MUSIC_APPEND_ONLY_AUDIT/);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});

test('private evidence belongs to the same draft; unvalidated files cannot be sealed', () => {
  const db = database(); const a = seed(db); const b = seed(db);
  const draft = randomUUID(); const review = randomUUID();
  insert(db, 'music_track_revisions', { id: draft, track_id: a.id, revision_no: 2, created_at: now, audio_asset_id: a.audio, technical_reviewed_at: now });
  insert(db, 'music_rights_reviews', { id: review, revision_id: draft });
  assert.throws(() => insert(db, 'music_rights_evidence', { review_id: review, asset_id: b.evidence }), /MUSIC_EVIDENCE_REFERENCE/);
  assert.throws(() => insert(db, 'music_rights_evidence', { review_id: review, asset_id: a.cover }), /MUSIC_EVIDENCE_REFERENCE/);
  insert(db, 'music_rights_evidence', { review_id: review, asset_id: a.evidence });
  const asset = randomUUID();
  insert(db, 'music_assets', { id: asset, owner_track_id: a.id, kind: 'audio', content_type: 'audio/mpeg', format: 'mp3', object_key: 'reserved', created_at: now });
  db.prepare('UPDATE music_track_revisions SET audio_asset_id = ? WHERE id = ?').run(asset, draft);
  assert.throws(() => db.prepare("UPDATE music_track_revisions SET state = 'sealed' WHERE id = ?").run(draft), /MUSIC_ASSET_REFERENCE/);
});

test('analytics models reject arbitrary attributes and cannot become a VIP ledger', () => {
  const db = database(); const ids = seed(db);
  const event = { event_id: randomUUID(), event_type: 'play_start', play_session_id: randomUUID(), anonymous_session_id: randomUUID(),
    track_id: ids.id, revision_no: 1, variant: 'full', occurred_at: now, received_at: now, entry_source: 'player' };
  insert(db, 'music_analytics_events', event);
  assert.throws(() => insert(db, 'music_analytics_events', event), /UNIQUE/);
  assert.throws(() => insert(db, 'music_analytics_events', { ...event, event_id: randomUUID(), email: 'not-accepted' }), /no column/);
  assert.throws(() => insert(db, 'music_analytics_events', { ...event, event_id: randomUUID(), entry_source: 'https://private.test' }), /CHECK/);
  const columns = db.prepare('PRAGMA table_info(music_membership_attributions)').all().map(c => c.name);
  for (const field of ['account_id', 'expires_at', 'membership_level', 'is_vip']) assert(!columns.includes(field));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM music_analytics_daily').get().n, 0);
});
