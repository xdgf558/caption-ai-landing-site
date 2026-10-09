import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { musicTestDatabase } from './music-test-database.mjs';
import { migrationStatements, insertFixture } from './station-redesign-database.mjs';
import { createAdminMusicTrack } from '../../src/music/admin.js';

export const mediaUploadMigration = '0013_station_media_uploads.sql';
export const mediaUploadSql = readFileSync(new URL('../../migrations-music/' + mediaUploadMigration, import.meta.url), 'utf8');
export const mediaActor = 'media-fixture@example.test';
export function stationMediaMigrationStatements() {
  const groups = migrationStatements(), parser = new DatabaseSync(':memory:');
  parser.exec('PRAGMA foreign_keys=ON');
  try {
    for (const g of groups) for (const sql of g.statements) parser.exec(sql);
    const statements = []; let remaining = mediaUploadSql;
    while (remaining.trim()) { const s = parser.prepare(remaining), source = s.sourceSQL; s.run(); statements.push(source); remaining = remaining.slice(source.length); }
    return [...groups, { name: mediaUploadMigration, statements }];
  } finally { parser.close(); }
}
export function stationMediaTestDatabase({ migrated = true, quota = 512 * 1048576 } = {}) {
  const f = musicTestDatabase();
  f.sql.exec(readFileSync(new URL('../../migrations-music/0012_station_redesign.sql', import.meta.url), 'utf8'));
  if (migrated) f.sql.exec(mediaUploadSql);
  f.sql.prepare("UPDATE music_settings SET value_json=? WHERE key='storageQuotaBytes'").run(JSON.stringify(quota));
  return f;
}
export async function seedStationMediaDrafts(db, now = Date.now()) {
  const track = await createAdminMusicTrack(db, { slug: `media-fixture-${randomUUID()}`, metadata: { originalLocale: 'zh-Hans',
    title: { 'zh-Hans': '本机素材测试作品' }, summary: { 'zh-Hans': '仅供隔离上传验证。' }, creatorName: 'Station Cat 测试', instrumental: true, language: 'instrumental', genres: [], moods: [] } },
  { actorId: mediaActor, key: randomUUID() });
  const owners = {};
  for (const [kind, title] of [['short_video', '小站夜晚 · 短片草稿'], ['mv', '小站夜晚 · MV 草稿']]) {
    const id = randomUUID(); owners[kind] = id;
    await insertFixture(db, 'station_clips', { id, track_id: track.trackId, type: kind, created_at: now, updated_at: now });
    await insertFixture(db, 'station_clip_revisions', { id, revision: 1, metadata_json: JSON.stringify({ originalLocale: 'zh-Hans', title: { 'zh-Hans': title } }), created_at: now });
    await db.prepare('UPDATE station_clips SET draft_revision=1 WHERE id=?').bind(id).run();
  }
  owners.poster = owners.short_video; owners.game_screenshot = randomUUID();
  await insertFixture(db, 'station_games', { id: owners.game_screenshot, slug: 'upload-game-' + owners.game_screenshot, runtime_key: 'cat-life', created_at: now, updated_at: now });
  await insertFixture(db, 'station_game_revisions', { id: owners.game_screenshot, revision: 1,
    metadata_json: JSON.stringify({ originalLocale: 'zh-Hans', title: { 'zh-Hans': '打工养猫日记 · 素材测试' } }), launch_url: '/games/cat-life/', created_at: now });
  await db.prepare('UPDATE station_games SET draft_revision=1 WHERE id=?').bind(owners.game_screenshot).run();
  return { track, owners };
}
