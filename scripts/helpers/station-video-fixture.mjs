import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { mediaFixture, now } from './station-content-fixture.mjs';
import { fixtureId, insertFixture } from './station-redesign-database.mjs';

export function stationVideoBytes() {
  const base = new URL('../../tests/fixtures/station-video/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', base))), item = manifest.files[0];
  const bytes = readFileSync(new URL(item.file, base));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
  assert.equal(bytes.length, item.bytes); assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
  assert.equal(item.durationMs, 30000);
  return { bytes, width: item.width, height: item.height };
}

// Opt-in ONLY. The ordinary T07/T08 fixture keeps its original metadata bytes.
// Two playable records intentionally reuse one illustration/tone MP4; the third
// has matching storage identity but corrupt codec bytes to exercise UI fallback.
export async function seedStationVideoCases(db, bucket, content) {
  const material = stationVideoBytes(), poster = await sharp(readFileSync(new URL('../fixtures/station-redesign/assets/gentle-station/hero.webp', import.meta.url))).resize(640, 360, { fit: 'cover' }).png().toBuffer();
  const scenarios = { short: content.clip.id };
  for (const [offset, type, key, titles] of [
    [8000, 'mv', 'mv', ['小站的夜晚 · MV 示例', '小站的夜晚 · MV 示例', 'A station evening · MV sample', '小さな駅の夜 · MV サンプル']],
    [8010, 'short_video', 'error', ['暫時無法播放 · 測試片段', '暂时无法播放 · 测试片段', 'Unavailable · test clip', '再生エラー · テスト動画']]
  ]) {
    const id = fixtureId(offset), video = fixtureId(offset + 1), cover = fixtureId(offset + 2);
    await insertFixture(db, 'station_clips', { id, track_id: content.tracks[1].id, type, created_at: now, updated_at: now });
    await mediaFixture(db, bucket, id, type, video, async () => key === 'error' ? null : material);
    await mediaFixture(db, bucket, id, 'poster', cover, async () => ({ bytes: poster, width: 640, height: 360 }));
    await insertFixture(db, 'station_clip_revisions', { id, revision: 1, state: 'sealed', metadata_json: JSON.stringify({ originalLocale: 'zh-Hant',
      title: Object.fromEntries(['zh-Hant', 'zh-Hans', 'en', 'ja'].map((lang, index) => [lang, titles[index]])) }),
      media_asset_id: video, poster_asset_id: cover, duration_ms: 30000, created_at: now });
    await db.prepare("UPDATE station_clips SET status='published',published_revision=1,published_at=? WHERE id=?").bind(now - offset, id).run();
    await insertFixture(db, 'station_clip_publications', { id: fixtureId(offset + 3), clip_id: id, channel: 'youtube', post_id: 'synthetic-fixture-' + key,
      post_url: 'https://www.youtube.com/watch?v=synthetic-fixture-' + key, external_published_at: now - 1000, created_at: now });
    scenarios[key] = id;
  }
  return scenarios;
}
