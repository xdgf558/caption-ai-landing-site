import { fail } from '../music/adminValidation.js';

export const STATION_MEDIA_LIMITS = Object.freeze({
  short_video: 256 * 1048576, mv: 256 * 1048576, poster: 10 * 1048576, game_screenshot: 10 * 1048576
});
export const STATION_VIDEO_LIMITS = Object.freeze({ moovBytes: 2 * 1048576, boxes: 4096, samples: 200000,
  durationMs: 30 * 60000, dimension: 7680 });
const mime = Object.freeze({ mp4: 'video/mp4', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });
export function stationMediaType(kind, format) {
  const formats = ['short_video', 'mv'].includes(kind) ? ['mp4']
    : ['poster', 'game_screenshot'].includes(kind) ? ['jpeg', 'png', 'webp'] : [];
  if (!formats.includes(format)) fail('STATION_MEDIA_FORMAT_UNSUPPORTED', 415);
  return mime[format];
}
export function stationMediaFormat(contentType) { return Object.keys(mime).find(key => mime[key] === contentType); }
export function stationMediaKey(asset) {
  const owner = asset.kind === 'game_screenshot' ? asset.owner_game_id : asset.owner_clip_id;
  return `station/media/${asset.kind}/${owner}/${asset.id}.${stationMediaFormat(asset.content_type)}`;
}
