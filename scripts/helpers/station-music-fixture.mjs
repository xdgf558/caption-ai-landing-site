import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { seedContent, publishTrack, homeFixture, approve, now } from './station-content-fixture.mjs';
import { fixtureId, insertFixture } from './station-redesign-database.mjs';
import { stationVideoBytes } from './station-video-fixture.mjs';

// This module is test tooling. Covers are T04 design illustrations; audio is
// the checked-in FFmpeg sine-wave fixture, never an operational song/license.
export async function seedStationMusicPages(db, bucket, { videoCases = false } = {}) {
  const cover = readFileSync(new URL('../fixtures/station-redesign/assets/gentle-station/music-cover.webp', import.meta.url));
  const hero = readFileSync(new URL('../fixtures/station-redesign/assets/gentle-station/hero.webp', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('../../tests/fixtures/music-mp3/manifest.json', import.meta.url)));
  const audioFile = name => {
    const item = manifest.files.find(file => file.file === name), bytes = readFileSync(new URL('../../tests/fixtures/music-mp3/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    return { bytes, durationMs: item.packetDurationMs };
  };
  const full = audioFile('cbr-stereo.mp3'), preview = audioFile('preview.mp3');
  const poster = await sharp(hero).resize(640, 360, { fit: 'cover' }).png().toBuffer();
  const materializeAsset = async (asset, bucket) => {
    let bytes, content_type = asset.content_type, key = asset.object_key, extra = {};
    if (asset.kind === 'cover') { bytes = cover; content_type = 'image/webp'; key = key.replace(/\.png$/, '.webp'); extra.format = 'webp'; }
    else if (asset.kind === 'audio') { bytes = full.bytes; extra.duration_ms = full.durationMs; }
    else if (asset.kind === 'preview') { bytes = preview.bytes; extra.duration_ms = preview.durationMs; extra.source_end_ms = preview.durationMs; }
    else bytes = new TextEncoder().encode('[00:00.00]這是本地示例歌詞，不對應真實作品。\n[00:00.50]把今天輕輕放進小站。');
    const object = await bucket.put(key, bytes, { httpMetadata: { contentType: content_type } });
    return { ...extra, object_key: key, content_type, byte_size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), etag: object.etag };
  };
  const fixture = await seedContent(db, bucket, { materializeAsset,
    materializeMedia: async kind => ['poster', 'game_screenshot'].includes(kind) ? { bytes: poster, width: 640, height: 360 } : videoCases ? stationVideoBytes() : null,
    externalLinks: false });
  const names = [
    ['小小的光', '小小的光', 'A Little Light', '小さな光'],
    ['晚一點告白', '晚一点告白', 'A Little Late to Say', '少し遅い告白'],
    ['溫柔的明天', '温柔的明天', 'A Kinder Tomorrow', 'やさしい明日'],
    ['深夜的小站', '深夜的小站', 'The Station at Night', '夜更けの小さな駅'],
    ['沿著海岸慢慢走', '沿着海岸慢慢走', 'Along the Shore', '海岸をゆっくり歩く'],
    ['等風停下的時候', '等风停下的时候', 'When the Wind Settles', '風がやむころ']
  ];
  for (let index = 0; index < fixture.tracks.length; index++) {
    const titles = Object.fromEntries(['zh-Hant', 'zh-Hans', 'en', 'ja'].map((locale, i) => [locale, names[index][i]]));
    await publishTrack(db, fixture.tracks[index], { metadata_json: JSON.stringify({ originalLocale: 'zh-Hant', title: titles,
      summary: { 'zh-Hant': '設計示例作品。這裡記錄一些日常，也留住一點溫柔。', 'zh-Hans': '设计示例作品。这里记录一些日常，也留住一点温柔。', en: 'A local design sample, for the small and gentle moments.', ja: '日常の小さな気持ちを記録する、ローカルのデザイン例です。' },
      creatorName: 'Station Cat', story: '本地交互夾具，並非真實發行或本期主推。\n音頻是合成測試音；封面沿用已確認的視覺示例。',
      relatedTrackIds: fixture.tracks.filter(track => track.id !== fixture.tracks[index].id).slice(0, 5).map(track => track.id) }) });
  }
  const additional = [];
  const coverAsset = await db.prepare('SELECT * FROM music_assets WHERE id=?').bind(fixture.tracks[0].cover).first();
  for (let index = 1; index <= 18; index++) {
    const id = fixtureId(1000 + index * 10), coverId = fixtureId(1001 + index * 10), name = 'local-sample-' + index;
    await insertFixture(db, 'music_tracks', { id, slug: name, created_at: now, updated_at: now });
    await insertFixture(db, 'station_track_publications', { track_id: id, created_at: now, updated_at: now });
    await insertFixture(db, 'station_track_routes', { track_id: id, slug: name, role: 'canonical', created_at: now });
    const key = 'music/covers/' + id + '/' + coverId + '.webp', object = await bucket.put(key, cover, { httpMetadata: { contentType: 'image/webp' } });
    await insertFixture(db, 'music_assets', { ...coverAsset, id: coverId, owner_track_id: id, object_key: key, etag: object.etag });
    await approve(db, coverId, 'cover');
    const long = index === 18;
    const title = long ? '當一首歌的名字很長很長，仍然希望每一個字都能在小小的螢幕上被溫柔地讀完，帶著今天的心情回家' : '日常片段 ' + String(index).padStart(2, '0');
    await insertFixture(db, 'station_track_revisions', { track_id: id, revision: 1, state: 'sealed',
      metadata_json: JSON.stringify({ originalLocale: 'zh-Hant', title: { 'zh-Hant': title, 'zh-Hans': title, en: long ? 'A very long song title about carrying the small memories of today home and reading every word on a little screen' : 'Everyday moment ' + index, ja: long ? '小さな画面でも一文字ずつ読めるように、今日の思い出を大切に家へ持ち帰るためのとても長い曲名' : '日常のひとこま ' + index },
        creatorName: 'Station Cat', summary: { 'zh-Hant': '網站作品展示示例，沒有站內音頻或平台發行安排。', en: 'A website-only design sample. No audio or release is configured.' }, story: '本地示例作品。', relatedTrackIds: [] }),
      cover_asset_id: coverId, created_at: now });
    await db.prepare("UPDATE station_track_publications SET status='published',published_revision=1,published_at=? WHERE track_id=?").bind(now - index * 1000, id).run();
    additional.push({ id, slug: name });
  }
  await homeFixture(db, { track: fixture.tracks[1].id, tracks: [fixture.tracks[0].id, fixture.tracks[2].id, fixture.tracks[3].id], clips: videoCases ? [fixture.clip.id] : [] });
  return { ...fixture, additional, mediaProof: { fullMs: full.durationMs, previewMs: preview.durationMs,
    coverBytes: cover.length, audioIsSynthetic: true, videoBytesAreMetadataOnly: !videoCases } };
}
