import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { seedLegacyFixture, insertFixture, fixtureId } from './station-redesign-database.mjs';
import { createContentObject, saveContentRights, contentPublication, saveContentPlatform } from '../../src/redesign/contentAdmin.js';
import { contentAdminActor } from './station-content-admin-runtime.mjs';
import { stationMediaKey } from '../../src/redesign/mediaFormats.js';
import sharp from 'sharp';

// Only local, disposable D1/R2. Titles reflect the selected mock; image bytes
// reuse supplied Station Cat art. No production media, licence or order claim.
export async function seedWorkbenchFixture(db, bucket) {
  const artRoot = new URL('../../public/api/music/__cover-files/', import.meta.url);
  const art = (await readdir(artRoot)).filter(name => name.endsWith('.jpg')).sort();
  let coverIndex = 0;
  const { tracks } = await seedLegacyFixture(db, { materializeAsset: async a => {
    const data = a.kind === 'cover' ? await sharp(await readFile(new URL(art[coverIndex++ % art.length], artRoot))).png().toBuffer()
      : a.kind === 'lyrics' ? Buffer.from('[00:00.00]本机隔离夹具，不代表真实歌曲歌词。\n') : new Uint8Array(100);
    const object = await bucket.put(a.object_key, data, { httpMetadata: { contentType: a.content_type } });
    return { etag: object.etag, sha256: createHash('sha256').update(data).digest('hex'), byte_size: data.length };
  } });
  const context = () => ({ actorId: contentAdminActor, key: crypto.randomUUID() });
  const titles = ['原来已经这么远', '改天是哪一天', '再走一站', '无人接听', '城市另一端'];
  for (const [i, track] of tracks.slice(0, 5).entries()) {
    await createContentObject({ db, bucket }, 'tracks', { trackId: track.id, data: { metadata: { originalLocale: 'zh-Hans', title: { 'zh-Hans': titles[4-i] }, creatorName: 'Station Cat', story: '本机隔离夹具；实际网站展示原歌曲资料与素材。' }, coverAssetId: track.cover, lyricsAssetId: track.lyrics, siteAudioMode: 'none' }, reason: '本机设计与操作验收夹具' }, context());
  }
  const screenshotId = fixtureId(201), runtime = { db, bucket };
  await createContentObject(runtime, 'games', { slug: 'local-cat-life-game', data: { metadata: { originalLocale: 'zh-Hans', title: { 'zh-Hans': '打工养猫日记' } }, launchUrl: '/games/cat-life/', supportedDevices: ['desktop'], screenshotIds: [] }, reason: '本机游戏夹具' }, context());
  const game = (await db.prepare("SELECT id FROM station_games WHERE slug='local-cat-life-game'").all()).results[0];
  const data = await readFile(new URL('../fixtures/station-redesign/assets/gentle-station/game-cover.webp', import.meta.url));
  const dimensions = await sharp(data).metadata(), a = { id: screenshotId, owner_game_id: game.id, owner_clip_id: null, kind: 'game_screenshot', content_type: 'image/webp' };
  a.object_key = stationMediaKey(a);
  const object = await bucket.put(a.object_key, data, { httpMetadata: { contentType: a.content_type } });
  await insertFixture(db, 'station_media_assets', { ...a, state: 'validated', byte_size: data.length, etag: object.etag, sha256: createHash('sha256').update(data).digest('hex'), width: dimensions.width, height: dimensions.height, created_at: Date.now() });
  await saveContentRights(runtime, a.id, { scope: 'game_screenshot', status: 'approved', basis: '仅供本机测试的合成权利登记，不代表生产素材许可。', reason: '本机夹具' }, { ...context(), ifMatch: '"edit-1"' });
  const { saveContentObject } = await import('../../src/redesign/contentAdmin.js');
  await saveContentObject(runtime, 'games', game.id, { revision: 1, data: { metadata: { originalLocale: 'zh-Hans', title: { 'zh-Hans': '打工养猫日记' } }, launchUrl: '/games/cat-life/', supportedDevices: ['desktop'], screenshotIds: [a.id] }, reason: '本机夹具' }, { ...context(), ifMatch: '"edit-1"' });
  await contentPublication(runtime, 'games', game.id, 'publish', { revision: 2, reason: '本机公开态夹具' }, { ...context(), ifMatch: '"edit-2"' });
  return { tracks, game: { ...game, screenshotId } };
}

export async function seedHomeWorkbenchFixture(db,bucket) {
  const content=await seedWorkbenchFixture(db,bucket),runtime={db,bucket};
  const context=()=>({actorId:contentAdminActor,key:crypto.randomUUID(),ifMatch:'"edit-1"'});
  for(const track of content.tracks.slice(0,5)) {
    for(const scope of ['cover','lyrics'])await saveContentRights(runtime,track[scope],{scope,status:'approved',basis:'仅供本机隔离流程测试，不代表生产授权。'},context());
    await contentPublication(runtime,'tracks',track.id,'publish',{revision:1},context());
  }
  await saveContentPlatform(runtime,null,{trackId:content.tracks[4].id,provider:'netease',status:'live',url:'https://music.163.com/song?id=123',verifiedAt:Date.now()-1000},context());
  return content;
}
