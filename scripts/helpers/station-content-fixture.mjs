import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { musicTestDatabase } from './music-test-database.mjs';
import { applyRedesignMigration, seedLegacyFixture, insertFixture, fixtureId, homeId, rehearsalTime, migrationName } from './station-redesign-database.mjs';
export const now = rehearsalTime;
export const iso = value => new Date(value).toISOString();
export const base = '/api/station/content';
export const readerSources = ['0003_reader_accounts.sql', '0009_reader_memberships.sql']
  .map(name => readFileSync(new URL('../../migrations/' + name, import.meta.url), 'utf8'));

// Synthetic local publications, licenses and objects. None are operational
// content or evidence of MP3/video decoding, ownership or a real release.
export function memoryBucket() {
  const objects = new Map(), state = { reads: [], failHead: false, failGet: false, delay: 0, beforeGet: null };
  const metadata = value => ({ key: value.key, size: value.bytes.length, etag: value.etag,
    httpMetadata: value.httpMetadata });
  const bucket = {
    async put(key, data, options) {
      const bytes = new Uint8Array(data);
      const value = { key, bytes, etag: createHash('md5').update(bytes).digest('hex'), httpMetadata: options.httpMetadata };
      objects.set(key, value); return metadata(value);
    },
    async head(key) {
      state.reads.push({ method: 'head', key });
      if (state.failHead) throw new Error('private R2 details');
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      const value = objects.get(key); return value ? metadata(value) : null;
    },
    async get(key, options) {
      state.reads.push({ method: 'get', key, options });
      if (state.failGet) throw new Error('private R2 details');
      if (state.beforeGet) await state.beforeGet(key);
      const value = objects.get(key);
      if (!value || (options?.onlyIf && options.onlyIf.etagMatches !== value.etag)) return null;
      const range = options?.range, bytes = range ? value.bytes.slice(range.offset, range.offset + range.length) : value.bytes;
      return { ...metadata(value), ...(range ? { range } : {}),
        body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
    }
  };
  return { bucket, objects, state };
}
export async function ledgerFixture(db) {
  // Mimic Wrangler's default ledger only in this disposable test database.
  await db.prepare('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE, applied_at TEXT)').run();
  await db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(migrationName, iso(now)).run();
}
export function readerStatements() {
  const sql = new DatabaseSync(':memory:'), statements = [];
  try {
    for (let remaining of readerSources) while (remaining.trim()) {
      const statement = sql.prepare(remaining), source = statement.sourceSQL;
      assert.ok(source.length && remaining.startsWith(source));
      statement.run(); statements.push(source); remaining = remaining.slice(source.length);
    }
    return statements;
  } finally { sql.close(); }
}
export async function seedReaders(db) {
  for (const id of [1, 2, 3]) {
    await insertFixture(db, 'reader_accounts', { id, email: 'private' + id + '@example.test', normalized_email: 'private' + id + '@example.test' });
    await insertFixture(db, 'reader_sessions', { account_id: id,
      session_hash: createHash('sha256').update('fixture-session-' + id).digest('hex'),
      created_at: iso(now - 60000), expires_at: iso(now + 3600000), last_seen_at: iso(now - 60000) });
  }
  for (const [id, end] of [[1, now + 3600000], [3, now - 1]]) {
    await insertFixture(db, 'reader_memberships', { account_id: id, membership_level: 'member',
      started_at: iso(now - 60000), expires_at: iso(end) });
  }
}
export function readerFixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON'); readerSources.forEach(source => sql.exec(source));
  const state = { reads: [], fail: false, delay: 0 };
  class Statement {
    constructor(query, params = []) { Object.assign(this, { query, params }); }
    bind(...params) { return new Statement(this.query, params); }
    async all() {
      state.reads.push(this.query); assert.match(this.query, /^SELECT\s/);
      if (state.fail) throw new Error('private member SQL');
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      return { success: true, results: sql.prepare(this.query).all(...this.params) };
    }
    async run() { return { success: true, meta: sql.prepare(this.query).run(...this.params) }; }
  }
  const db = { prepare: query => new Statement(query), withSession(mode) { assert.equal(mode, 'first-primary'); return db; } };
  return { sql, db, state };
}
export async function approve(db, id, kind, media = false) {
  await insertFixture(db, 'station_asset_rights', { id: randomUUID(),
    [media ? 'media_asset_id' : 'music_asset_id']: id, scope: kind, status: 'approved',
    basis: 'Synthetic test license only', reviewer_id: 'local-fixture', reviewed_at: now - 1000, created_at: now - 1000 });
}
export async function publishTrack(db, track, overrides = {}) {
  const existing = await db.prepare('SELECT * FROM station_track_revisions WHERE track_id=? ORDER BY revision DESC LIMIT 1').bind(track.id).first();
  const revision = existing.revision + 1;
  await insertFixture(db, 'station_track_revisions', { track_id: track.id, revision, state: 'sealed',
    metadata_json: overrides.metadata_json || existing.metadata_json, legacy_revision_id: existing.legacy_revision_id,
    site_audio_mode: existing.site_audio_mode, duration_ms: existing.duration_ms,
    cover_asset_id: existing.cover_asset_id, lyrics_asset_id: existing.lyrics_asset_id, created_at: now, ...overrides });
  await db.prepare("UPDATE station_track_publications SET status='published',published_revision=?,draft_revision=NULL,published_at=?,edit_version=edit_version+1,updated_at=? WHERE track_id=?")
    .bind(revision, now - 100, now, track.id).run();
  return revision;
}
export async function promotionFixture(db, track, { enabled = 1, preview = 1, platforms = [], clips = [], order = 0 } = {}) {
  const head = await db.prepare('SELECT published_revision FROM station_promotions WHERE track_id=?').bind(track.id).first();
  if (!head) await insertFixture(db, 'station_promotions', { track_id: track.id, created_at: now, updated_at: now });
  const latest = await db.prepare('SELECT max(revision) AS n FROM station_promotion_revisions WHERE track_id=?').bind(track.id).first();
  const revision = (latest.n || 0) + 1;
  await insertFixture(db, 'station_promotion_revisions', { track_id: track.id, revision, state: 'sealed', enabled,
    preview_enabled: preview, preview_asset_id: preview ? track.preview : null,
    selected_platform_ids_json: JSON.stringify(platforms), selected_clip_ids_json: JSON.stringify(clips), sort_order: order, created_at: now });
  await db.prepare("UPDATE station_promotions SET status='published',published_revision=?,draft_revision=NULL,published_at=?,edit_version=edit_version+1 WHERE track_id=?")
    .bind(revision, now - 100, track.id).run();
  return revision;
}
export async function homeFixture(db, { track = null, game = null, tracks = [], clips = [] } = {}) {
  const head = await db.prepare('SELECT max(revision) AS n FROM station_home_revisions WHERE id=?').bind(homeId).first();
  const revision = (head.n || 0) + 1;
  await insertFixture(db, 'station_home_revisions', { id: homeId, revision, state: 'sealed', featured_track_id: track,
    featured_game_id: game, selected_track_ids_json: JSON.stringify(tracks), selected_clip_ids_json: JSON.stringify(clips), created_at: now });
  await db.prepare("UPDATE station_home_configs SET status='published',published_revision=?,draft_revision=NULL,published_at=?,edit_version=edit_version+1 WHERE id=?")
    .bind(revision, now - 100, homeId).run();
  return revision;
}
export async function platformFixture(db, track, values = {}) {
  const id = values.id || randomUUID();
  await insertFixture(db, 'station_platform_links', { id, track_id: track.id, provider: 'apple_music',
    status: 'live', url: 'https://music.apple.com/sg/album/synthetic-fixture/1', verified_at: now - 500,
    external_released_at: now - 1000, created_at: now - 1000, updated_at: now, ...values });
  return id;
}
export async function mediaFixture(db, bucket, owner, kind, id, materializeMedia) {
  const key = 'station-test-only/' + owner + '/' + id;
  const material = materializeMedia ? await materializeMedia(kind) : null;
  const bytes = material?.bytes || new Uint8Array(100).fill(kind === 'poster' ? 11 : 29);
  const content_type = ['poster', 'game_screenshot'].includes(kind) ? 'image/png' : 'video/mp4';
  const object = await bucket.put(key, bytes, { httpMetadata: { contentType: content_type } });
  await insertFixture(db, 'station_media_assets', { id, [kind === 'game_screenshot' ? 'owner_game_id' : 'owner_clip_id']: owner,
    kind, object_key: key, content_type, state: 'validated', byte_size: bytes.length,
    ...(kind === 'short_video' || kind === 'mv' ? { duration_ms: 30000 } : {}),
    width: material?.width || 1280, height: material?.height || 720, sha256: createHash('sha256').update(bytes).digest('hex'), etag: object.etag, created_at: now });
  await approve(db, id, kind, true);
}
export async function seedContent(db, bucket, { publish = true, materializeAsset, materializeMedia, externalLinks = true } = {}) {
  const legacy = await seedLegacyFixture(db, { materializeAsset: async asset => {
    if (materializeAsset) return materializeAsset(asset, bucket);
    const bytes = new Uint8Array(100).fill(asset.kind === 'preview' ? 71 : 37);
    const object = await bucket.put(asset.object_key, bytes, { httpMetadata: { contentType: asset.content_type } });
    return { sha256: createHash('sha256').update(bytes).digest('hex'), etag: object.etag };
  } });
  await applyRedesignMigration(db); await ledgerFixture(db);
  const assets = (await db.prepare('SELECT * FROM music_assets').all()).results;
  for (const asset of assets) {
    if (asset.kind !== 'audio') await approve(db, asset.id, asset.kind);
  }
  if (!publish) return { ...legacy };
  for (const track of legacy.tracks) await publishTrack(db, track);
  const platformTrack = legacy.draft;
  await publishTrack(db, platformTrack, { metadata_json: JSON.stringify({ originalLocale: 'en',
    title: { en: 'Platform-only song' }, summary: {}, creatorName: 'Fixture', story: 'Two lines\nSecond line' }) });
  const platformId = externalLinks ? await platformFixture(db, legacy.tracks[1]) : null;
  const clip = { id: fixtureId(500), video: fixtureId(501), poster: fixtureId(502) };
  await insertFixture(db, 'station_clips', { id: clip.id, track_id: legacy.tracks[1].id, type: 'short_video', created_at: now, updated_at: now });
  await mediaFixture(db, bucket, clip.id, 'short_video', clip.video, materializeMedia);
  await mediaFixture(db, bucket, clip.id, 'poster', clip.poster, materializeMedia);
  await insertFixture(db, 'station_clip_revisions', { id: clip.id, revision: 1, state: 'sealed',
    metadata_json: JSON.stringify({ originalLocale: 'en', title: { en: 'Synthetic video' } }),
    media_asset_id: clip.video, poster_asset_id: clip.poster, duration_ms: 30000, created_at: now });
  await db.prepare("UPDATE station_clips SET status='published',published_revision=1,published_at=? WHERE id=?").bind(now - 100, clip.id).run();
  if (externalLinks) await insertFixture(db, 'station_clip_publications', { id: fixtureId(503), clip_id: clip.id, channel: 'youtube',
    post_id: 'synthetic-fixture', post_url: 'https://www.youtube.com/watch?v=synthetic-fixture',
    external_published_at: now - 1000, created_at: now });
  const game = { id: fixtureId(600), slug: 'cat-life-game', screenshot: fixtureId(601) };
  await insertFixture(db, 'station_games', { id: game.id, slug: game.slug, runtime_key: 'cat-life', created_at: now, updated_at: now });
  await mediaFixture(db, bucket, game.id, 'game_screenshot', game.screenshot, materializeMedia);
  await insertFixture(db, 'station_game_revisions', { id: game.id, revision: 1, state: 'sealed',
    metadata_json: JSON.stringify({ originalLocale: 'en', title: { en: 'Synthetic game' }, summary: { en: 'Existing runtime' } }),
    launch_url: '/games/cat-life/', supported_devices_json: '["desktop","mobile"]', screenshot_ids_json: JSON.stringify([game.screenshot]), created_at: now });
  await db.prepare("UPDATE station_games SET status='published',published_revision=1,published_at=? WHERE id=?").bind(now - 100, game.id).run();
  await promotionFixture(db, legacy.tracks[1], { platforms: platformId ? [platformId] : [], clips: [clip.id] });
  await homeFixture(db, { track: legacy.tracks[1].id, game: game.id, clips: [clip.id] });
  return { ...legacy, platformTrack, platformId, clip, game };
}
export async function contentFixture(options) {
  const music = musicTestDatabase(), reader = readerFixture(), r2 = memoryBucket();
  try {
    const content = await seedContent(music.db, r2.bucket, options);
    await seedReaders(reader.db);
    const env = { MUSIC_DB: music.db, WAITLIST_DB: reader.db, MUSIC_BUCKET: r2.bucket,
      STATION_CONTENT_PUBLIC_ENABLED: true, MUSIC_PUBLIC_ENABLED: true, MUSIC_VIP_DELIVERY_ENABLED: true,
      MUSIC_RATE_LIMIT_SECRET: 'station-content-fixture-secret-not-for-production' };
    return { music, reader, r2, content, env, close() { music.sql.close(); reader.sql.close(); } };
  } catch (error) { music.sql.close(); reader.sql.close(); throw error; }
}
