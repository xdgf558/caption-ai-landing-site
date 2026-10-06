import { stationHomeConfig, emptyHomeContent } from '../../../src/data/station-home.js';

const id = n => `ca710005-0000-4000-8000-${String(n).padStart(12, '0')}`;
const translate = (hant, hans = hant, en = hant, ja = hant) => ({ 'zh-Hant': hant, 'zh-Hans': hans, en, ja });
const publishedAt = '2026-10-01T00:00:00.000Z';
const publication = { status: 'published', publishedAt };
const image = name => `/preview-assets/gentle-station/${name}.webp`;
export const homeScenarioNames = Object.freeze({
  pending: '素材待定', complete: '完整素材示例', 'no-video': '缺视频', 'no-platform': '缺平台入口',
  'preview-enabled': '试听入口开启', revoked: '撤销素材',
});
export const fixtureIds = Object.freeze({ track: id(1), game: id(2), preview: id(6), firstClip: id(20), firstPlatform: id(10) });

/** Synthetic data ONLY. Platform buttons stay on the loopback fixture server. */
export function homeScenario(name) {
  if (!Object.hasOwn(homeScenarioNames, name)) throw new TypeError('Unknown home fixture scenario');
  if (name === 'pending') return { config: stationHomeConfig, content: emptyHomeContent };
  const cover = { id: id(3), ownerId: id(1), kind: 'cover', url: image('music-cover'), state: 'ready', visibility: 'public', rightsConfirmed: true };
  const assets = [cover,
    { ...cover, id: id(4), ownerId: id(2), kind: 'game_screenshot', url: image('game-cover') },
    { ...cover, id: id(5), ownerId: id(42), url: image('daily') },
    { id: id(6), ownerId: id(1), kind: 'preview', state: 'ready', visibility: 'public', rightsConfirmed: true, durationSec: 30 },
  ];
  const tracks = [{ ...publication, id: id(1), slug: 'sample-song', originalLocale: 'zh-Hant',
    title: translate('晚一點告白', '晚一点告白'), artist: 'Station Cat', coverAssetId: id(3),
    summary: translate('寫給還沒說出口的心意，也寫給每一個溫柔的夜晚。', '写给还没说出口的心意，也写给每一个温柔的夜晚。', 'For the words we haven’t said yet, and every gentle evening.', 'まだ言葉にできない気持ちと、やさしい夜に寄り添う一曲。'),
  }];
  for (const [index, name] of ['quiet-night', 'little-light', 'kinder-days'].entries()) {
    const trackId = id(50 + index), coverId = id(60 + index);
    tracks.push({ ...tracks[0], id: trackId, slug: name,
      title: translate(['靜夜版本', '小小的光', '更溫柔的日子'][index], ['静夜版本', '小小的光', '更温柔的日子'][index], ['Quiet night', 'A little light', 'Kinder days'][index], ['静かな夜', '小さな灯り', 'やさしい日々'][index]), coverAssetId: coverId });
    assets.push({ ...cover, id: coverId, ownerId: trackId });
  }
  const platforms = ['netease', 'qishui', 'apple_music'].map((provider, i) => ({
    id: id(10 + i), trackId: id(1), provider, status: 'live', verifiedAt: publishedAt,
    url: `/__home-fixture/platform/${provider}/`,
  }));
  const clips = Array.from({ length: 5 }, (_, i) => {
    const clipId = id(20 + i), posterId = id(30 + i), mediaId = id(70 + i);
    assets.push({ ...cover, id: posterId, ownerId: clipId, kind: 'poster', url: image(['music-cover', 'daily', 'hero', 'music-cover', 'daily'][i]) },
      { id: mediaId, ownerId: clipId, kind: 'short_video', state: 'ready', visibility: 'public', rightsConfirmed: true });
    return { ...publication, id: clipId, trackId: id(1), originalLocale: 'zh-Hant', type: 'short_video',
      title: translate(`小站片刻 ${i + 1}`, `小站片刻 ${i + 1}`, `Station moment ${i + 1}`, `駅のひとこま ${i + 1}`),
      durationSec: 15 + i * 5, posterAssetId: posterId, mediaAssetId: mediaId };
  });
  const games = [{ ...publication, id: id(2), slug: 'cat-life-game', originalLocale: 'zh-Hant',
    title: translate('打工養貓日記', '打工养猫日记', 'Cat Life Diary', '猫との暮らし日記'), screenshotAssetId: id(4),
    summary: translate('在一座溫柔的小鎮，和貓咪一起工作、生活、發現更多可能。', '在一座温柔的小镇，和猫咪一起工作、生活、发现更多可能。', 'In a warm little town, work, live, and discover with your cat.', 'やさしい小さな町で、猫と働き、暮らし、発見しよう。'),
  }];
  const updates = [
    { ...publication, id: id(40), kind: 'music', targetId: id(1), originalLocale: 'zh-Hant', title: tracks[0].title, summary: tracks[0].summary },
    { ...publication, id: id(41), kind: 'games', targetId: id(2), originalLocale: 'zh-Hant', title: games[0].title, summary: games[0].summary },
    { ...publication, id: id(42), kind: 'life', originalLocale: 'zh-Hant', coverAssetId: id(5),
      title: translate('深夜的小站', '深夜的小站', 'The station after dark', '夜更けの小さな駅'),
      summary: translate('無論多晚，這裡都會為你留一盞燈。', '无论多晚，这里都会为你留一盏灯。', 'However late it gets, a light stays on for you.', 'どんなに遅い夜も、ひとつの灯りを残します。') },
  ];
  const promotions = [{ ...publication, trackId: id(1), revision: 1, enabled: true, previewEnabled: name === 'preview-enabled',
    previewAssetId: id(6), selectedPlatformLinkIds: platforms.map(link => link.id), selectedClipIds: clips.map(clip => clip.id) }];
  const config = { ...stationHomeConfig, ...publication, environment: 'fixture', publishedRevision: 1,
    featuredTrackId: id(1), selectedTrackIds: tracks.slice(1).map(track => track.id),
    selectedClipIds: clips.map(clip => clip.id), featuredGameId: id(2), selectedUpdateIds: updates.map(update => update.id) };
  if (name === 'no-video') clips.forEach(clip => { clip.status = 'draft'; });
  if (name === 'no-platform') platforms.forEach(link => { link.status = 'planned'; });
  if (name === 'revoked') {
    clips[0].status = 'archived'; platforms[0].status = 'removed';
    assets.find(asset => asset.id === clips[1].posterAssetId).state = 'revoked';
  }
  return { config, content: { tracks, promotions, platforms, assets, clips, games, updates } };
}
