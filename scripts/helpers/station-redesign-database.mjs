import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { musicTestDatabase } from './music-test-database.mjs';
import { loadPublicMusicSnapshot, loadPublishedMusicRecord } from '../../src/music/publicStore.js';
import { buildPublicCatalog, projectPublicTrackDetail } from '../../src/music/catalog.js';
import { checkMusicDatabase } from '../../src/music/runtime.js';

export const rehearsalTime = Date.parse('2026-10-05T00:00:00Z');
export const homeId = 'ca710000-0000-4000-8000-000000000001';
export const migrationName = '0012_station_redesign.sql';
export const legacyMigrations = [
  '0001_music_foundation.sql', '0002_music_publication.sql', '0003_music_uploads.sql',
  '0004_music_cleanup.sql', '0005_music_rate_limits.sql', '0006_music_analytics.sql',
  '0007_music_albums.sql', '0008_music_featured.sql', '0009_music_album_covers.sql',
  '0010_music_limited_free.sql', '0011_music_share_rate_limits.sql',
];
export const migrationSource = readFileSync(new URL('../../migrations-music/' + migrationName, import.meta.url), 'utf8');
export const migrationHash = createHash('sha256').update(migrationSource).digest('hex');
export const fixtureId = value => 'ca760000-0000-4000-8000-' + String(value).padStart(12, '0');
const plain = value => JSON.parse(JSON.stringify(value));

// SQLite parses complete statements, including trigger bodies. This helper has
// no remote database option, credentials, Wrangler configuration or HTTP client.
export function migrationStatements() {
  const parser = new DatabaseSync(':memory:');
  const groups = [];
  parser.exec('PRAGMA foreign_keys=ON');
  try {
    for (const name of [...legacyMigrations, migrationName]) {
      let remaining = readFileSync(new URL('../../migrations-music/' + name, import.meta.url), 'utf8');
      const statements = [];
      while (remaining.trim()) {
        const statement = parser.prepare(remaining);
        const source = statement.sourceSQL;
        assert.ok(source.length > 0 && remaining.startsWith(source));
        statement.run();
        statements.push(source);
        remaining = remaining.slice(source.length);
      }
      groups.push({ name, statements });
    }
    return groups;
  } finally { parser.close(); }
}

export function sqliteRehearsalDatabase() { return musicTestDatabase(); }
export async function applyRedesignMigration(db, statements = migrationStatements().at(-1).statements) {
  return db.batch(statements.map(sql => db.prepare(sql)));
}
export async function insertFixture(db, table, values) {
  const keys = Object.keys(values);
  return db.prepare('INSERT INTO ' + table + '(' + keys.join(',') + ') VALUES(' + keys.map(() => '?').join(',') + ')')
    .bind(...Object.values(values)).run();
}

export async function databaseRows(db, prefix = 'music_') {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE ? ORDER BY name")
    .bind(prefix + '%').all()).results;
  const rows = await db.batch(tables.map(({ name }) => db.prepare('SELECT * FROM ' + name + ' ORDER BY rowid')));
  return plain(Object.fromEntries(tables.map(({ name }, index) => [name, rows[index].results])));
}

export async function seedLegacyFixture(db) {
  const now = rehearsalTime, tracks = [];
  const policies = [
    { name: 'permanent-free', access_mode: 'free' },
    { name: 'vip', access_mode: 'vip' },
    { name: 'limited-active', access_mode: 'vip', free_until: now + 60000 },
    { name: 'limited-expired', access_mode: 'vip', free_until: now - 60000 },
    { name: 'early-access', access_mode: 'early_access', early_access_until: now + 60000, post_early_access_mode: 'vip' },
    { name: 'unpublished', access_mode: 'vip', lifecycle: 'unpublished' },
  ];
  for (let index = 0; index < policies.length; index++) {
    const policy = policies[index], base = (index + 1) * 10;
    const track = { id: fixtureId(base), revision: fixtureId(base + 1),
      audio: fixtureId(base + 2), preview: fixtureId(base + 3), cover: fixtureId(base + 4), lyrics: fixtureId(base + 5),
      slug: policy.name };
    await insertFixture(db, 'music_tracks', { id: track.id, slug: track.slug, created_at: now - 30000, updated_at: now - 10000 });
    const common = { owner_track_id: track.id, state: 'validated', byte_size: 100,
      sha256: 'a'.repeat(64), etag: 'fixture-metadata-only', created_at: now - 20000 };
    for (const asset of [
      { id: track.audio, kind: 'audio', format: 'mp3', content_type: 'audio/mpeg',
        duration_ms: 120000, object_key: 'music/audio/' + track.id + '/' + track.audio + '.mp3' },
      { id: track.preview, kind: 'preview', format: 'mp3', content_type: 'audio/mpeg', duration_ms: 30000,
        derived_from_asset_id: track.audio, source_start_ms: 0, source_end_ms: 30000,
        object_key: 'music/previews/' + track.id + '/' + track.preview + '.mp3' },
      { id: track.cover, kind: 'cover', format: 'png', content_type: 'image/png',
        object_key: 'music/covers/' + track.id + '/' + track.cover + '.png' },
      { id: track.lyrics, kind: 'lyrics', format: 'lrc', content_type: 'text/plain',
        object_key: 'music/lyrics/' + track.id + '/' + track.lyrics + '.lrc' },
    ]) await insertFixture(db, 'music_assets', { ...common, ...asset });
    track.metadata = { originalLocale: 'en', title: { en: policy.name, 'zh-Hant': '夾具 ' + policy.name },
      summary: { en: 'Isolated fixture.' }, creatorName: 'Station Cat fixture', instrumental: false,
      language: 'en', genres: ['ambient'], moods: ['calm'], story: 'Synthetic metadata, no actual release or license.' };
    await insertFixture(db, 'music_track_revisions', { id: track.revision, track_id: track.id,
      revision_no: 1, state: 'sealed', metadata_json: JSON.stringify(track.metadata),
      audio_asset_id: track.audio, preview_asset_id: track.preview, cover_asset_id: track.cover, lyrics_asset_id: track.lyrics,
      access_mode: policy.access_mode, ...(policy.free_until ? { free_until: policy.free_until } : {}),
      ...(policy.early_access_until ? { early_access_until: policy.early_access_until, post_early_access_mode: policy.post_early_access_mode } : {}),
      technical_reviewed_at: now - 12000, technical_fingerprint: 'b'.repeat(64), created_at: now - 15000 });
    await db.prepare("UPDATE music_tracks SET lifecycle=?,published_revision_id=?,first_published_at=?,published_at=? WHERE id=?")
      .bind(policy.lifecycle || 'published', track.revision, now - 10000, now - 10000, track.id).run();
    tracks.push(track);
  }
  const draft = { id: fixtureId(70), slug: 'draft-no-audio' };
  const archived = { id: fixtureId(80), slug: 'archived-no-audio' };
  await insertFixture(db, 'music_tracks', { ...draft, created_at: now - 20000, updated_at: now - 20000 });
  await insertFixture(db, 'music_tracks', { ...archived, lifecycle: 'archived', created_at: now - 20000, updated_at: now - 20000 });
  await insertFixture(db, 'music_collections', { id: fixtureId(90), slug: 'old-collection', collection_type: 'playlist',
    original_locale: 'en', title_json: '{"en":"Old collection"}', description_json: '{}',
    status: 'published', created_at: now - 10000, updated_at: now - 10000 });
  await insertFixture(db, 'music_collection_tracks', { collection_id: fixtureId(90), track_id: tracks[0].id, position: 0 });
  await insertFixture(db, 'music_featured_items', { slot_kind: 'primary', position: 0, track_id: tracks[0].id });
  await insertFixture(db, 'music_admin_audit_logs', { id: fixtureId(91), actor_id: 'isolated-fixture',
    action: 'fixture.seed', target_id: tracks[0].id, summary_json: '{"fixture":true}', request_id: fixtureId(92), created_at: now });
  return { tracks, draft, archived };
}

export async function legacyReads(db, fixture) {
  const output = { readiness: await checkMusicDatabase(db), catalogs: {}, details: {},
    cleanupReferences: (await db.prepare('SELECT * FROM music_asset_references ORDER BY id').all()).results };
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const snapshot = await loadPublicMusicSnapshot(db, rehearsalTime);
    output.catalogs[locale] = await buildPublicCatalog({ ...snapshot, locale, now: rehearsalTime });
    output.details[locale] = await Promise.all(fixture.tracks.map(async track =>
      projectPublicTrackDetail(await loadPublishedMusicRecord(db, track.id), { locale, now: rehearsalTime })));
  }
  return plain(output);
}

// Write new content AFTER migration, then exercise the old reader again. This
// rehearses application rollback while retaining new rows; it never drops tables.
export async function seedPostMigrationFixture(db, fixture) {
  const now = rehearsalTime, trackId = fixture.draft.id;
  await db.batch([
    db.prepare("UPDATE station_track_revisions SET metadata_json=?,state='sealed' WHERE track_id=? AND revision=1")
      .bind('{"originalLocale":"en","title":{"en":"Platform-only fixture"},"creatorName":"Fixture"}', trackId),
    db.prepare("UPDATE station_track_publications SET status='published',published_revision=1,draft_revision=NULL,published_at=?,edit_version=2,updated_at=? WHERE track_id=?")
      .bind(now, now, trackId),
  ]);
  await insertFixture(db, 'station_track_revisions', { track_id: trackId, revision: 2,
    metadata_json: '{"title":{"en":"Unpublished edit"}}', created_at: now });
  await db.prepare('UPDATE station_track_publications SET draft_revision=2,edit_version=3 WHERE track_id=?').bind(trackId).run();
  await db.batch([
    db.prepare("UPDATE station_track_routes SET role='alias' WHERE track_id=? AND role='canonical'").bind(trackId),
    db.prepare("INSERT INTO station_track_routes(slug,track_id,role,created_at) VALUES('platform-only-new',?,'canonical',?)").bind(trackId, now),
  ]);
  await insertFixture(db, 'station_platform_links', { id: fixtureId(101), track_id: trackId, provider: 'apple_music',
    status: 'live', url: 'https://example.invalid/isolated-platform-fixture', verified_at: now,
    external_released_at: now - 60000, created_at: now, updated_at: now });
  await insertFixture(db, 'station_promotions', { track_id: trackId, created_at: now, updated_at: now });
  await insertFixture(db, 'station_promotion_revisions', { track_id: trackId, revision: 1, state: 'sealed',
    enabled: 1, selected_platform_ids_json: JSON.stringify([fixtureId(101)]), created_at: now });
  await db.prepare("UPDATE station_promotions SET status='published',published_revision=1,published_at=? WHERE track_id=?").bind(now, trackId).run();
  await insertFixture(db, 'station_games', { id: fixtureId(102), slug: 'cat-life-game', runtime_key: 'cat-life', created_at: now, updated_at: now });
  await insertFixture(db, 'station_game_revisions', { id: fixtureId(102), revision: 1,
    metadata_json: '{"title":{"en":"Game fixture"}}', launch_url: '/games/cat-life/', created_at: now });
  await db.prepare('UPDATE station_games SET draft_revision=1 WHERE id=?').bind(fixtureId(102)).run();
  await db.batch([
    db.prepare("UPDATE station_home_revisions SET featured_track_id=?,state='sealed' WHERE id=? AND revision=1").bind(trackId, homeId),
    db.prepare("UPDATE station_home_configs SET status='published',draft_revision=NULL,published_revision=1,published_at=?,edit_version=2,updated_at=? WHERE id=?").bind(now, now, homeId),
  ]);
  await insertFixture(db, 'station_home_revisions', { id: homeId, revision: 2, created_at: now });
  await db.prepare('UPDATE station_home_configs SET draft_revision=2,edit_version=3 WHERE id=?').bind(homeId).run();
  await insertFixture(db, 'station_campaigns', { id: fixtureId(103), source: 'fixture', medium: 'isolated',
    track_id: trackId, landing_path: '/music/tracks/platform-only-new/', created_at: now, updated_at: now });
  await insertFixture(db, 'station_analytics_events', { event_id: fixtureId(104), event_name: 'track_view',
    occurred_at: now, received_at: now, track_id: trackId, campaign_id: fixtureId(103), session_id: 'fixture-session' });
  await insertFixture(db, 'station_route_migrations', { old_path: '/fixture-old/', action: 'redirect',
    new_path: '/music/tracks/platform-only-new/', reason: 'Isolated proposal only.', created_at: now });
}

export async function rehearseMigration(db) {
  const fixture = await seedLegacyFixture(db);
  const beforeRows = await databaseRows(db);
  const beforeReads = await legacyReads(db, fixture);
  assert.equal(beforeReads.catalogs.en.body.tracks.length, 5);
  await applyRedesignMigration(db);
  assert.deepEqual(await databaseRows(db), beforeRows);
  assert.deepEqual(await legacyReads(db, fixture), beforeReads);
  const first = await databaseRows(db, 'station_');
  assert.equal(first.station_track_publications.length, 8);
  assert.ok(first.station_track_publications.every(row => row.status === 'draft' && row.published_revision === null));
  assert.equal(first.station_promotions.length, 0);
  assert.equal(first.station_asset_rights.length, 0);
  assert.equal(first.station_platform_links.length, 0);
  await applyRedesignMigration(db);
  assert.deepEqual(await databaseRows(db, 'station_'), first);
  await seedPostMigrationFixture(db, fixture);
  const afterNewWrites = await databaseRows(db, 'station_');
  await applyRedesignMigration(db);
  assert.deepEqual(await databaseRows(db, 'station_'), afterNewWrites);
  assert.deepEqual(await databaseRows(db), beforeRows);
  assert.deepEqual(await legacyReads(db, fixture), beforeReads);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  return {
    migration: migrationName, migrationSha256: migrationHash,
    legacyTrackCount: 8, legacyPublicTrackCount: 5, locales: ['zh-Hant', 'zh-Hans', 'en', 'ja'],
    newTableCount: Object.keys(first).length,
    checks: { legacyRowsUnchanged: true, legacyCatalogAndDetailsUnchanged: true,
      repeatedMigrationUnchanged: true, postMigrationRowsRetained: true,
      oldReaderRollbackWithNewData: true, foreignKeysValid: true },
    postMigrationRowsSha256: createHash('sha256').update(JSON.stringify(afterNewWrites)).digest('hex'),
  };
}

export async function localD1Rehearsal() {
  const { Miniflare } = await import('miniflare');
  const mf = new Miniflare({
    modules: true, script: "export default { fetch() { return new Response('Local migration fixture only', {status:404}); } };",
    compatibilityDate: '2026-07-30', host: '127.0.0.1', port: 0,
    d1Databases: { MUSIC_DB: 'redesign-local-music', WAITLIST_DB: 'redesign-local-reader',
      MIGRATION_FAULT_DB: 'redesign-local-fault' },
    outboundService: () => new Response('Outbound network disabled', { status: 403 }),
  });
  try {
    const groups = migrationStatements();
    const db = await mf.getD1Database('MUSIC_DB');
    for (const group of groups.slice(0, -1)) await db.batch(group.statements.map(sql => db.prepare(sql)));
    const report = await rehearseMigration(db);
    const account = await mf.getD1Database('WAITLIST_DB');
    await account.prepare('CREATE TABLE reader_sentinel(id TEXT PRIMARY KEY, balance INTEGER NOT NULL)').run();
    await account.prepare("INSERT INTO reader_sentinel VALUES('existing-account',125)").run();
    await assert.rejects(applyRedesignMigration(account));
    assert.deepEqual((await account.prepare('SELECT * FROM reader_sentinel').all()).results,
      [{ id: 'existing-account', balance: 125 }]);
    assert.equal((await account.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'station_%'").first()).n, 0);
    const fault = await mf.getD1Database('MIGRATION_FAULT_DB');
    for (const group of groups.slice(0, -1)) await fault.batch(group.statements.map(sql => fault.prepare(sql)));
    await seedLegacyFixture(fault);
    const beforeFault = await databaseRows(fault);
    const beforeView = await fault.prepare("SELECT sql FROM sqlite_master WHERE name='music_asset_references'").first();
    await assert.rejects(fault.batch([
      ...groups.at(-1).statements.map(sql => fault.prepare(sql)),
      fault.prepare("INSERT INTO station_track_publications(track_id,created_at,updated_at) VALUES('absent-parent',0,0)"),
    ]));
    assert.deepEqual(await databaseRows(fault), beforeFault);
    assert.deepEqual(await fault.prepare("SELECT sql FROM sqlite_master WHERE name='music_asset_references'").first(), beforeView);
    assert.equal((await fault.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'station_%'").first()).n, 0);
    return { ...report, checks: { ...report.checks, wrongBindingRolledBack: true, lateFailureRollsBackDdlAndBackfill: true } };
  } finally { await mf.dispose(); }
}
