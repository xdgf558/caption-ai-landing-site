import { uuid, positive, plain, platformUrl, slug, localizedPath } from './publicValidation.js';
import { stationPlatformLinks } from './platformView.js';
import { stationLocales } from './routes.js';

const asset = value => typeof value === 'string' && /^\/api\/station\/content\/assets\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const published = (value, now) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) >= 0 && Date.parse(value) <= now;
// A card never owns its target through data-src/URL parameters. Use only a
// bounded, published DTO associated with the currently displayed song.
export function stationClips(model, now = Date.now()) {
  if (model?.mode !== 'detail' || !uuid(model.track?.id) || !Array.isArray(model.clips) || model.clips.length > 4) return [];
  const counts = new Map();
  for (const item of model.clips) if (uuid(item?.id)) {
    const id = item.id.toLowerCase(); counts.set(id, (counts.get(id) || 0) + 1);
  }
  return model.clips.filter(item => uuid(item?.id) && counts.get(item.id.toLowerCase()) === 1 && item.trackId === model.track.id &&
    item.track?.id === model.track.id && ['short_video', 'mv'].includes(item.type) && positive(item.revision) &&
    positive(item.durationMs) && item.durationMs <= 86400000 && published(item.publishedAt, now) && plain(item.title, 200) && item.title.trim() &&
    asset(item.posterUrl) && asset(item.mediaUrl) && item.posterUrl !== item.mediaUrl);
}
export function clipOriginalLinks(clip, now = Date.now()) {
  if (!Array.isArray(clip?.publications) || clip.publications.length > 10) return [];
  const seen = new Set();
  return clip.publications.flatMap(item => {
    const href = platformUrl(item?.href, item?.channel);
    if (!href || !published(item?.publishedAt, now) || seen.has(href)) return [];
    seen.add(href); return [{ href, channel: item.channel }];
  });
}

export function clipNextLinks(track, locale) {
  const name = track?.slug || track?.href?.split('/').at(-2);
  if (!stationLocales.includes(locale) || !uuid(track?.id) || !plain(track.title, 200) || !slug(name) || track.href !== localizedPath(locale, 'music/tracks', name)) return { song: null, platforms: [] };
  return { song: { href: track.href, title: track.title }, platforms: stationPlatformLinks(track) };
}

// Home selection and promotion were already projected by T05/T07. Optional
// player DTOs must match a displayed, owned poster; they cannot add new cards.
export function stationHomeClipModel(home, clips) {
  const model = { mode: 'detail', locale: home?.locale, track: home?.music, clips: [], related: [] };
  if (!clipNextLinks(home?.music, home?.locale).song || !Array.isArray(home?.clips) || home.clips.length > 4) return model;
  if (home.clips.some(c => !uuid(c?.id))) return model;
  const displayed = new Map(home.clips.map(c => [c.id.toLowerCase(), c]));
  if (displayed.size !== home.clips.length) return model;
  model.clips = stationClips({ ...model, clips }).filter(c => c.type === 'short_video' && displayed.get(c.id.toLowerCase())?.trackId === home.music.id && displayed.get(c.id.toLowerCase())?.posterUrl === c.posterUrl);
  return model;
}
