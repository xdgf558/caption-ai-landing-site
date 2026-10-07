import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createAdminMusicTrack, saveAdminMusicTrack, readAdminMusicTrack } from '../src/music/admin.js';
import { planMusicCleanup, executeMusicCleanup } from '../src/music/cleanup.js';
import { executeMusicPublication } from '../src/music/publication.js';
import { seedMusicRuntimeFixture } from './helpers/music-runtime-fixture.js';
import { sqliteRehearsalDatabase, applyRedesignMigration, seedLegacyFixture, seedPostMigrationFixture,
  rehearseMigration, localD1Rehearsal, databaseRows, fixtureId, homeId, rehearsalTime as now } from './helpers/station-redesign-database.mjs';

const instances = [];
afterEach(() => { for (const f of instances.splice(0)) f.sql.close(); });
async function fixture({ seeded = true, migrated = true } = {}) {
  const f = sqliteRehearsalDatabase(); instances.push(f);
  if (seeded) f.legacy = await seedLegacyFixture(f.db);
  if (migrated) await applyRedesignMigration(f.db);
  f.insert = (table, values, mode = '') => {
    const keys = Object.keys(values);
    return f.sql.prepare('INSERT ' + mode + ' INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')')
      .run(...Object.values(values));
  };
  f.run = (sql, ...values) => f.sql.prepare(sql).run(...values);
  f.row = (sql, ...values) => f.sql.prepare(sql).get(...values);
  return f;
}
const common = { created_at: now, updated_at: now };
function addClip(f, id = fixtureId(200), track = f.legacy.tracks[0].id) {
  f.insert('station_clips', { id, track_id: track, type: 'short_video', ...common });
  return id;
}
function addVideo(f, clip, id = fixtureId(201), patch = {}) {
  f.insert('station_media_assets', { id, owner_clip_id: clip, kind: 'short_video', object_key: 'fixture-only/' + id + '.mp4',
    content_type: 'video/mp4', created_at: now, ...patch });
  return id;
}
function addUnusedMusicAsset(f, index, kind = 'cover') {
  const id = fixtureId(index), upload = fixtureId(index + 1), track = f.legacy.tracks[0];
  const format = kind === 'preview' ? 'mp3' : kind === 'lyrics' ? 'lrc' : 'png';
  f.insert('music_assets', { id, owner_track_id: track.id, kind, object_key: 'music/' + (kind === 'preview' ? 'previews' : kind === 'lyrics' ? 'lyrics' : 'covers') + '/' + track.id + '/' + id + '.' + format,
    state: 'reserved', format, content_type: kind === 'preview' ? 'audio/mpeg' : kind === 'lyrics' ? 'text/plain' : 'image/png',
    created_at: now - 10 * 86400000, ...(kind === 'preview' ? { derived_from_asset_id: track.audio, source_start_ms: 0, source_end_ms: 30000 } : {}) });
  f.insert('music_upload_sessions', { id: upload, asset_id: id, actor_id: 'fixture-admin', declared_bytes: 100,
    status: 'reserved', expected_sha256: 'a'.repeat(64), created_at: now - 10 * 86400000, expires_at: now - 9 * 86400000 });
  return { id, upload, track: track.id };
}

test('populated migration, repeated application and old-reader rollback retain both old and new data', async () => {
  const f = await fixture({ seeded: false, migrated: false });
  const report = await rehearseMigration(f.db);
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(report.newTableCount, 18);
});

test('empty migration seeds only an unpublished home draft with no selected materials', async () => {
  const f = await fixture({ seeded: false }), rows = await databaseRows(f.db, 'station_');
  assert.equal(rows.station_home_configs[0].id, homeId);
  assert.equal(rows.station_home_configs[0].published_revision, null);
  assert.equal(rows.station_home_configs[0].status, 'draft');
  assert.equal(rows.station_home_revisions[0].selected_track_ids_json, '[]');
  for (const [name, values] of Object.entries(rows)) if (!name.startsWith('station_home_')) assert.equal(values.length, 0, name);
});

test('backfill preserves stable IDs, exact legacy slugs and existing policy sources without promotion inference', async () => {
  const f = await fixture();
  const modes = f.sql.prepare('SELECT site_audio_mode FROM station_track_revisions ORDER BY track_id').all().map(r => r.site_audio_mode);
  assert.deepEqual(modes, ['free_full', 'existing_entitlement', 'existing_entitlement', 'existing_entitlement', 'existing_entitlement', 'existing_entitlement', 'none', 'none']);
  assert.equal(f.row("SELECT count(*) AS n FROM station_track_publications WHERE status='draft' AND published_revision IS NULL").n, 8);
  assert.equal(f.row('SELECT count(*) AS n FROM station_promotions').n, 0);
  assert.equal(f.row('SELECT count(*) AS n FROM station_platform_links').n, 0);
  assert.equal(f.row('SELECT count(*) AS n FROM station_asset_rights').n, 0);
  assert.deepEqual(f.sql.prepare('SELECT track_id,slug FROM station_track_routes ORDER BY track_id').all().map(r => [r.track_id, r.slug]),
    [...f.legacy.tracks, f.legacy.draft, f.legacy.archived].map(t => [t.id, t.slug]));
});

test('legacy-accepted noncanonical slugs are retained verbatim, while new managed routes use the normalized format', async () => {
  const f = await fixture({ seeded: false, migrated: false }), id = fixtureId(500);
  f.insert('music_tracks', { id, slug: '舊名 Mixed_Name', ...common });
  await applyRedesignMigration(f.db);
  assert.equal(f.row('SELECT slug,origin FROM station_track_routes WHERE track_id=?', id).slug, '舊名 Mixed_Name');
  assert.equal(f.row('SELECT origin FROM station_track_routes WHERE track_id=?', id).origin, 'legacy_backfill');
  assert.throws(() => f.insert('station_track_routes', { slug: 'New_Name', track_id: id, role: 'alias', created_at: now }), /CHECK/);
  await applyRedesignMigration(f.db);
  assert.equal(f.row('SELECT count(*) AS n FROM station_track_routes').n, 1);
});

test('old music table definitions and five cleanup reference columns remain compatible', async () => {
  const f = await fixture({ migrated: false });
  const before = f.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'music_%' ORDER BY name").all();
  await applyRedesignMigration(f.db);
  assert.deepEqual(f.sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE 'music_%' ORDER BY name").all(), before);
  assert.deepEqual(f.sql.prepare('PRAGMA table_info(music_asset_references)').all().map(r => r.name),
    ['id', 'revision_ref', 'evidence_ref', 'rights_ref', 'derived_ref', 'audit_ref']);
});

test('old administrator create, draft save, revision conflict and idempotency receipts still work after migration', async () => {
  const f = await fixture();
  const input = { slug: 'legacy-admin-new', metadata: { originalLocale: 'en', title: { en: 'Old admin fixture' },
    summary: { en: '' }, creatorName: 'Fixture', instrumental: true, language: 'instrumental', genres: [], moods: [] } };
  const context = { actorId: 'fixture-admin', key: 't06-create-fixture-key', clock: () => now };
  const created = await createAdminMusicTrack(f.db, input, context);
  const replay = await createAdminMusicTrack(f.db, input, context);
  assert.equal(replay.trackId, created.trackId); assert.equal(replay.replayed, true);
  const read = await readAdminMusicTrack(f.db, created.trackId);
  const save = { ...input, slug: 'legacy-admin-renamed', policy: read.draft.policy,
    revisionId: created.revisionId, reason: 'Compatibility fixture.' };
  const saved = await saveAdminMusicTrack(f.db, created.trackId, save, { ...context, key: 't06-save-fixture-key', ifMatch: '"edit-1"' });
  assert.equal(saved.editVersion, 2);
  await assert.rejects(saveAdminMusicTrack(f.db, created.trackId, save,
    { ...context, key: 't06-stale-fixture-key', ifMatch: '"edit-1"' }), error => error.code === 'MUSIC_EDIT_CONFLICT');
  await applyRedesignMigration(f.db);
  assert.equal(f.row('SELECT track_id FROM station_track_routes WHERE slug=?', save.slug).track_id, created.trackId);
});

test('a website publication can have no site audio or external release, and a later draft does not replace its sealed snapshot', async () => {
  const f = await fixture(); await seedPostMigrationFixture(f.db, f.legacy);
  const head = f.row('SELECT * FROM station_track_publications WHERE track_id=?', f.legacy.draft.id);
  assert.equal(head.published_revision, 1); assert.equal(head.draft_revision, 2);
  assert.equal(f.row('SELECT site_audio_mode,legacy_revision_id FROM station_track_revisions WHERE track_id=? AND revision=1',
    f.legacy.draft.id).site_audio_mode, 'none');
  assert.equal(f.row('SELECT published_revision_id FROM music_tracks WHERE id=?', f.legacy.draft.id).published_revision_id, null);
  assert.equal(f.row('SELECT preview_enabled FROM station_promotion_revisions WHERE track_id=?', f.legacy.draft.id).preview_enabled, 0);
});

test('old guarded publication and replay still seal the original audio revision after the additive migration', async () => {
  const f = await fixture(), owner = fixtureId(510), audioId = fixtureId(511), previewId = fixtureId(512);
  const asset = { owner_track_id: owner, state: 'validated', format: 'mp3', content_type: 'audio/mpeg',
    byte_size: 1000, sha256: 'b'.repeat(64), etag: 'synthetic-audio' };
  const command = await seedMusicRuntimeFixture(f.db, {
    accessMode: 'vip',
    audio: { ...asset, id: audioId, kind: 'audio', object_key: 'music/audio/' + owner + '/' + audioId + '.mp3', duration_ms: 120000 },
    preview: { ...asset, id: previewId, kind: 'preview', object_key: 'music/previews/' + owner + '/' + previewId + '.mp3', duration_ms: 30000,
      derived_from_asset_id: audioId, source_start_ms: 0, source_end_ms: 30000 },
  });
  const context = { actorId: 'fixture-admin', verifyResources: async assets => ({ checkedAt: Date.now(), assets: assets.map(a => ({
    id: a.id, exists: true, etag: a.etag, sha256: a.sha256, byteSize: a.byte_size, contentType: a.content_type,
    structureValid: true, measurement: 'mp3-frames', durationMs: a.duration_ms,
  })) }) };
  const published = await executeMusicPublication(f.db, command, context);
  const replay = await executeMusicPublication(f.db, command, context);
  assert.equal(published.trackId, owner); assert.equal(replay.replayed, true);
  assert.equal(f.row('SELECT state,access_mode FROM music_track_revisions WHERE id=?', command.revisionId).state, 'sealed');
  assert.equal(f.row('SELECT access_mode FROM music_track_revisions WHERE id=?', command.revisionId).access_mode, 'vip');
  assert.equal(f.row('SELECT count(*) AS n FROM station_promotions WHERE track_id=?', owner).n, 0);
  // Resource proof is synthetic; this verifies SQL/publication compatibility, not R2 or a license.
});

test('full-audio modes and covers must point to the same owner; mode labels never add an entitlement', async () => {
  const f = await fixture(), id = f.legacy.draft.id;
  assert.throws(() => f.run("UPDATE station_track_revisions SET site_audio_mode='free_full' WHERE track_id=?", id), /CHECK/);
  assert.throws(() => f.run('UPDATE station_track_revisions SET legacy_revision_id=? WHERE track_id=?', f.legacy.tracks[0].revision, id), /FOREIGN KEY/);
  assert.throws(() => f.run('UPDATE station_track_revisions SET cover_asset_id=? WHERE track_id=?', f.legacy.tracks[0].cover, id), /STATION_COVER_REFERENCE/);
  assert.throws(() => f.run('UPDATE station_track_revisions SET cover_asset_id=? WHERE track_id=?', f.legacy.tracks[0].audio, f.legacy.tracks[0].id), /STATION_COVER_REFERENCE/);
  assert.throws(() => f.run('UPDATE station_track_revisions SET lyrics_asset_id=? WHERE track_id=?', f.legacy.tracks[0].cover, f.legacy.tracks[0].id), /STATION_LYRICS_REFERENCE/);
});

for (const [head, table, key, extra] of [
  ['station_track_publications', 'station_track_revisions', 'track_id', null],
  ['station_games', 'station_game_revisions', 'id', { slug: 'sealed-game' }],
  ['station_clips', 'station_clip_revisions', 'id', { type: 'short_video' }],
  ['station_promotions', 'station_promotion_revisions', 'track_id', {}],
  ['station_home_configs', 'station_home_revisions', 'id', null],
]) test(table + ': wrong-state pointers, sealed mutation/delete/replace and stale head writes are rejected', async () => {
  const f = await fixture(), id = key === 'track_id' ? f.legacy.draft.id : head === 'station_home_configs' ? homeId : fixtureId(210);
  if (extra) f.insert(head, { [key]: id, ...extra, ...(head === 'station_clips' ? { track_id: f.legacy.draft.id } : {}), ...common });
  if (extra) f.insert(table, { [key]: id, revision: 1, created_at: now });
  assert.throws(() => f.run('UPDATE ' + head + ' SET published_revision=1,status=\'published\',published_at=? WHERE ' + key + '=?', now, id), /STATION_REVISION_POINTER/);
  f.run('UPDATE ' + table + " SET state='sealed' WHERE " + key + '=? AND revision=1', id);
  f.run('UPDATE ' + head + " SET published_revision=1,draft_revision=NULL,status='published',published_at=?,edit_version=2 WHERE " + key + '=?', now, id);
  assert.throws(() => f.run('UPDATE ' + table + " SET created_at=created_at+1 WHERE " + key + '=? AND revision=1', id), /STATION_SEALED_REVISION/);
  assert.throws(() => f.run('DELETE FROM ' + table + ' WHERE ' + key + '=? AND revision=1', id), /STATION_SEALED_REVISION/);
  assert.throws(() => f.insert(table, { [key]: id, revision: 1, created_at: now }, 'OR REPLACE'), /STATION_SEALED_REVISION/);
  assert.equal(f.run('UPDATE ' + head + ' SET edit_version=edit_version+1 WHERE ' + key + '=? AND edit_version=1', id).changes, 0);
  assert.equal(f.row('SELECT published_revision FROM ' + head + ' WHERE ' + key + '=?', id).published_revision, 1);
});

test('slug changes keep the old alias and cannot reassign or reclaim another track address', async () => {
  const f = await fixture(), id = f.legacy.draft.id, other = f.legacy.archived.id;
  f.run("UPDATE station_track_routes SET role='alias' WHERE track_id=?", id);
  f.insert('station_track_routes', { slug: 'new-canonical', track_id: id, role: 'canonical', created_at: now });
  assert.throws(() => f.insert('station_track_routes', { slug: 'another-canonical', track_id: id, role: 'canonical', created_at: now }), /UNIQUE/);
  assert.throws(() => f.run("UPDATE station_track_routes SET role='canonical' WHERE slug='draft-no-audio'"), /STATION_SLUG_RETIRED/);
  assert.throws(() => f.insert('station_track_routes', { slug: 'draft-no-audio', track_id: other, role: 'alias', created_at: now }, 'OR REPLACE'), /STATION_SLUG/);
  assert.throws(() => f.run("UPDATE music_tracks SET slug='new-canonical' WHERE id=?", other), /STATION_SLUG_OWNERSHIP/);
  assert.throws(() => f.insert('music_tracks', { id: fixtureId(211), slug: 'new-canonical', ...common }), /STATION_SLUG_OWNERSHIP/);
  assert.throws(() => f.run("DELETE FROM station_track_routes WHERE slug='draft-no-audio'"), /STATION_OBJECT_RETAINED/);
  await applyRedesignMigration(f.db);
  assert.equal(f.row("SELECT slug FROM station_track_routes WHERE track_id=? AND role='canonical'", id).slug, 'new-canonical');
});

test('platform regions are canonical sets and live links require a URL and verification timestamp', async () => {
  const f = await fixture(), track_id = f.legacy.tracks[0].id;
  const values = { id: fixtureId(220), track_id, provider: 'apple_music', ...common };
  f.insert('station_platform_links', values);
  assert.equal(f.row('SELECT status,url,territories_json FROM station_platform_links WHERE id=?', values.id).url, null);
  for (const territories_json of ['["US","CN"]', '["CN","CN"]', '["cn"]', '["*","US"]', '[]', '[1]']) {
    assert.throws(() => f.insert('station_platform_links', { ...values, id: fixtureId(221), territories_json }), /STATION_TERRITORIES|CHECK/);
  }
  f.insert('station_platform_links', { ...values, id: fixtureId(222), territories_json: '["CN","US"]' });
  assert.throws(() => f.insert('station_platform_links', { ...values, id: fixtureId(223), territories_json: '["CN","US"]' }), /UNIQUE/);
  f.run('UPDATE station_platform_links SET territories_json=? WHERE id=?', '["JP"]', values.id);
  assert.equal(f.row('SELECT territories_json FROM station_platform_links WHERE id=?', values.id).territories_json, '["JP"]');
  assert.throws(() => f.run('UPDATE station_platform_links SET territories_json=? WHERE id=?', '["US","CN"]', values.id), /STATION_TERRITORIES/);
  assert.throws(() => f.run("UPDATE station_platform_links SET status='live' WHERE id=?", values.id), /CHECK/);
  f.run("UPDATE station_platform_links SET status='live',url='https://example.invalid/fixture',verified_at=? WHERE id=?", now, values.id);
  assert.throws(() => f.run('UPDATE station_platform_links SET url=? WHERE id=?', 'javascript:alert(1)', values.id), /CHECK/);
});

test('promotion previews, platform selections and clips cannot borrow another song or an audio master', async () => {
  const f = await fixture(), track = f.legacy.tracks[0], other = f.legacy.tracks[1];
  f.insert('station_promotions', { track_id: track.id, ...common });
  f.insert('station_promotion_revisions', { track_id: track.id, revision: 1, created_at: now });
  assert.throws(() => f.run('UPDATE station_promotion_revisions SET preview_enabled=1 WHERE track_id=?', track.id), /CHECK/);
  for (const asset of [track.audio, other.preview]) assert.throws(() => f.run('UPDATE station_promotion_revisions SET preview_asset_id=? WHERE track_id=?', asset, track.id), /STATION_PREVIEW_REFERENCE/);
  f.run('UPDATE station_promotion_revisions SET preview_asset_id=?,preview_enabled=1 WHERE track_id=?', track.preview, track.id);
  const clip = addClip(f, fixtureId(230), other.id);
  f.insert('station_platform_links', { id: fixtureId(231), track_id: other.id, provider: 'netease', ...common });
  for (const [field, id] of [['selected_clip_ids_json', clip], ['selected_platform_ids_json', fixtureId(231)]])
    assert.throws(() => f.run('UPDATE station_promotion_revisions SET ' + field + '=? WHERE track_id=?', JSON.stringify([id]), track.id), /STATION_SELECTED_REFERENCE/);
});

test('home selections use stable existing IDs with bounded, duplicate-free arrays', async () => {
  const f = await fixture(), ids = f.legacy.tracks.slice(0, 4).map(t => t.id);
  for (const value of [[fixtureId(999)], [ids[0], ids[0]], ids, [null]]) {
    assert.throws(() => f.run('UPDATE station_home_revisions SET selected_track_ids_json=? WHERE id=?', JSON.stringify(value), homeId), /STATION_SELECTED_REFERENCE|CHECK/);
  }
  assert.throws(() => f.run('UPDATE station_home_revisions SET featured_track_id=? WHERE id=?', ids[0], homeId), /FOREIGN KEY/);
  f.run('UPDATE station_home_revisions SET selected_track_ids_json=? WHERE id=?', JSON.stringify(ids.slice(0, 3)), homeId);
  // Existence is a SQL constraint. Public status/resource checks remain in T07/T16.
  f.run('UPDATE station_home_revisions SET selected_track_ids_json=? WHERE id=?', JSON.stringify([f.legacy.draft.id]), homeId);
});

test('game introduction slug cannot occupy the runtime directory and a runtime key grants no new save capability', async () => {
  const f = await fixture();
  assert.throws(() => f.insert('station_games', { id: fixtureId(240), slug: 'cat-life', ...common }), /CHECK/);
  f.insert('station_games', { id: fixtureId(240), slug: 'cat-life-game', ...common });
  f.run("UPDATE station_games SET runtime_key='cat-life' WHERE id=?", fixtureId(240));
  assert.throws(() => f.run("UPDATE station_games SET runtime_key='another-game' WHERE id=?", fixtureId(240)), /STATION_GAME_RUNTIME_IDENTITY/);
  f.insert('station_game_revisions', { id: fixtureId(240), revision: 1, launch_url: '/games/cat-life/', created_at: now });
  assert.throws(() => f.run('UPDATE station_game_revisions SET launch_url=? WHERE id=?', 'https://example.invalid/', fixtureId(240)), /CHECK/);
  assert.throws(() => f.run('UPDATE station_game_revisions SET screenshot_ids_json=? WHERE id=?', JSON.stringify([fixtureId(999)]), fixtureId(240)), /STATION_SELECTED_REFERENCE/);
});

test('clip assets and posters belong to the clip and media type, with immutable validated bytes and terminal revocation', async () => {
  const f = await fixture(), first = addClip(f), other = addClip(f, fixtureId(250));
  const id = addVideo(f, first), wrong = addVideo(f, other, fixtureId(251));
  f.insert('station_clip_revisions', { id: first, revision: 1, created_at: now });
  assert.throws(() => f.run('UPDATE station_clip_revisions SET media_asset_id=? WHERE id=?', wrong, first), /STATION_CLIP_ASSET_REFERENCE/);
  assert.throws(() => f.run('UPDATE station_clip_revisions SET poster_asset_id=? WHERE id=?', id, first), /STATION_CLIP_ASSET_REFERENCE/);
  assert.throws(() => f.run("UPDATE station_media_assets SET state='validated' WHERE id=?", id), /CHECK/);
  f.run("UPDATE station_media_assets SET state='validated',byte_size=100,sha256=?,duration_ms=10000 WHERE id=?", 'a'.repeat(64), id);
  f.run('UPDATE station_clip_revisions SET media_asset_id=? WHERE id=?', id, first);
  for (const sql of ["UPDATE station_media_assets SET state='uploaded' WHERE id=?", 'UPDATE station_media_assets SET byte_size=200 WHERE id=?',
    "UPDATE station_media_assets SET object_key='replacement.mp4' WHERE id=?"]) assert.throws(() => f.run(sql, id), /STATION_/);
  f.run("UPDATE station_media_assets SET state='revoked' WHERE id=?", id);
  assert.throws(() => f.run("UPDATE station_media_assets SET state='validated' WHERE id=?", id), /STATION_VALIDATED_ASSET/);
  assert.throws(() => f.run('UPDATE station_media_assets SET byte_size=200 WHERE id=?', id), /STATION_VALIDATED_ASSET/);
});

test('rights start pending, require review metadata and cannot change resource identity or scope', async () => {
  const f = await fixture(), track = f.legacy.tracks[0], id = fixtureId(260);
  f.insert('station_asset_rights', { id, music_asset_id: track.preview, scope: 'preview', created_at: now });
  assert.equal(f.row('SELECT status FROM station_asset_rights WHERE id=?', id).status, 'pending');
  assert.throws(() => f.run("UPDATE station_asset_rights SET status='approved' WHERE id=?", id), /CHECK/);
  f.run("UPDATE station_asset_rights SET status='approved',basis='Synthetic fixture',reviewer_id='fixture',reviewed_at=? WHERE id=?", now, id);
  assert.throws(() => f.run('UPDATE station_asset_rights SET music_asset_id=? WHERE id=?', track.cover, id), /STATION_/);
  assert.throws(() => f.insert('station_asset_rights', { id: fixtureId(261), music_asset_id: track.audio, scope: 'preview', created_at: now }), /STATION_RIGHTS_SCOPE/);
});

test('new cover, lyrics, preview and rights references block the old cleanup before any storage call', async () => {
  const f = await fixture(), cover = addUnusedMusicAsset(f, 270), preview = addUnusedMusicAsset(f, 272, 'preview'), rights = addUnusedMusicAsset(f, 274), lyrics = addUnusedMusicAsset(f, 286, 'lyrics');
  f.insert('station_track_revisions', { track_id: cover.track, revision: 2, cover_asset_id: cover.id, lyrics_asset_id: lyrics.id, created_at: now });
  f.insert('station_promotions', { track_id: preview.track, ...common });
  f.insert('station_promotion_revisions', { track_id: preview.track, revision: 1, preview_asset_id: preview.id, created_at: now });
  f.insert('station_asset_rights', { id: fixtureId(276), music_asset_id: rights.id, scope: 'cover', created_at: now });
  const plan = await planMusicCleanup(f.db, {}, { clock: () => now });
  assert.equal(plan.items.length, 4);
  assert.ok(plan.items.every(item => item.blockedReason === 'ASSET_REFERENCED'));
  let calls = 0;
  await assert.rejects(executeMusicCleanup(f.db, { head() { calls++; }, delete() { calls++; } }, cover.upload,
    { planHash: 'b'.repeat(64), reason: 'Must remain referenced.' },
    { actorId: 'fixture-admin', key: 't06-cleanup-fixture-key', clock: () => now }), error => error.code === 'ASSET_REFERENCED');
  assert.equal(calls, 0);
  for (const asset of [cover, preview, rights, lyrics]) assert.throws(() => f.insert('music_upload_cleanup', {
    upload_id: asset.upload, asset_id: asset.id, actor_id: 'fixture-admin', reason: 'Blocked fixture', plan_hash: 'b'.repeat(64), claimed_at: now,
  }), /MUSIC_CLEANUP_CONFLICT/);
});

test('assets already claimed by the old cleaner cannot gain a new website, preview or rights reference', async () => {
  const f = await fixture(), cover = addUnusedMusicAsset(f, 280), preview = addUnusedMusicAsset(f, 282, 'preview');
  for (const asset of [cover, preview]) f.insert('music_upload_cleanup', { upload_id: asset.upload, asset_id: asset.id,
    actor_id: 'fixture-admin', reason: 'Synthetic retirement fixture', plan_hash: 'b'.repeat(64), claimed_at: now });
  assert.throws(() => f.insert('station_track_revisions', { track_id: cover.track, revision: 2, cover_asset_id: cover.id, created_at: now }), /MUSIC_ASSET_RETIRED/);
  const lyrics = addUnusedMusicAsset(f, 286, 'lyrics');
  f.insert('music_upload_cleanup', { upload_id: lyrics.upload, asset_id: lyrics.id, actor_id: 'fixture-admin', reason: 'Synthetic retirement fixture', plan_hash: 'b'.repeat(64), claimed_at: now });
  assert.throws(() => f.insert('station_track_revisions', { track_id: lyrics.track, revision: 2, lyrics_asset_id: lyrics.id, created_at: now }), /MUSIC_ASSET_RETIRED/);
  f.insert('station_promotions', { track_id: preview.track, ...common });
  assert.throws(() => f.insert('station_promotion_revisions', { track_id: preview.track, revision: 1, preview_asset_id: preview.id, created_at: now }), /MUSIC_ASSET_RETIRED/);
  assert.throws(() => f.insert('station_asset_rights', { id: fixtureId(284), music_asset_id: cover.id, scope: 'cover', created_at: now }), /MUSIC_ASSET_RETIRED/);
});

test('clip platform publications are independent records, campaigns cannot borrow another track clip, and routes remain proposals', async () => {
  const f = await fixture(), clip = addClip(f);
  f.insert('station_clip_publications', { id: fixtureId(290), clip_id: clip, channel: 'fixture-a', post_id: 'post-1',
    post_url: 'https://example.invalid/post-1', external_published_at: now, created_at: now });
  f.insert('station_clip_publications', { id: fixtureId(291), clip_id: clip, channel: 'fixture-b', post_id: 'post-1',
    post_url: 'https://example.invalid/post-1', external_published_at: now, created_at: now });
  assert.throws(() => f.insert('station_campaigns', { id: fixtureId(292), track_id: f.legacy.tracks[1].id, clip_id: clip,
    source: 'fixture', medium: 'test', landing_path: '/music/', ...common }), /FOREIGN KEY/);
  f.insert('station_route_migrations', { old_path: '/fixture-old/', action: 'retire', reason: 'Proposal', created_at: now });
  assert.equal(f.row("SELECT approved_at FROM station_route_migrations WHERE old_path='/fixture-old/'").approved_at, null);
  assert.throws(() => f.insert('station_route_migrations', { old_path: '/api/fixture/', action: 'service',
    new_path: '/music/', reason: 'Services cannot redirect', created_at: now }), /CHECK/);
});

test('new event IDs are immutable and deduplicated while the old preview threshold remains unchanged', async () => {
  const f = await fixture(), track = f.legacy.tracks[0], event = { event_id: fixtureId(300), event_name: 'preview_qualified',
    occurred_at: now, received_at: now, track_id: track.id, session_id: 'fixture-session', playback_id: fixtureId(301) };
  f.insert('station_analytics_events', event);
  assert.throws(() => f.insert('station_analytics_events', event, 'OR REPLACE'), /STATION_EVENT_RETAINED/);
  assert.throws(() => f.run("UPDATE station_analytics_events SET event_name='preview_start' WHERE event_id=?", event.event_id), /STATION_EVENT_RETAINED/);
  assert.throws(() => f.run('DELETE FROM station_analytics_events WHERE event_id=?', event.event_id), /STATION_EVENT_RETAINED/);
  assert.throws(() => f.insert('station_analytics_events', { ...event, event_id: fixtureId(302), event_name: 'qualified_play' }), /CHECK/);
  const legacy = { event_id: fixtureId(303), event_type: 'play_start', play_session_id: fixtureId(304),
    anonymous_session_id: 'a'.repeat(64), track_id: track.id, revision_no: 1, variant: 'preview',
    occurred_at: now, received_at: now, listened_ms: 0, entry_source: 'detail', consent_version: 'music-analytics-v1' };
  f.insert('music_analytics_events', legacy);
  assert.throws(() => f.insert('music_analytics_events', { ...legacy, event_id: fixtureId(305), event_type: 'qualified_play', listened_ms: 10000 }), /MUSIC_ANALYTICS_INVALID_TRACK/);
  f.insert('music_analytics_events', { ...legacy, event_id: fixtureId(306), event_type: 'qualified_play', listened_ms: 15000 });
  assert.equal(f.row('SELECT count(*) AS n FROM music_analytics_events').n, 2);
});

test('native local D1 batches replay safely, retain new writes, and roll back wrong-binding or late failures', { timeout: 60000 }, async () => {
  const report = await localD1Rehearsal();
  assert.ok(Object.values(report.checks).every(Boolean));
});
