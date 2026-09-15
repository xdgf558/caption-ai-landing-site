import { musicShareUrl } from './navigation.js';
import { MUSIC_LOCALES } from './policy.js';
import { validMusicId } from './publicationValidation.js';

export const MUSIC_SHARE_FONT = '/fonts/music/NotoSerifSC-Bold.otf';
export const MUSIC_SHARE_FONT_BYTES = 12094336;
export const MUSIC_SHARE_FONT_SHA256 = '24693d48bdb9152f0a06b02af625638a1097abd6de4010ebba027f6e82710527';
export { MUSIC_SHARE_MAX_PNG } from './rasterPng.js';
export const MUSIC_SHARE_FORMATS = Object.freeze({ card: [1200, 630], poster: [1080, 1800] });
export const musicShareCopy = locale => ({
  'zh-Hans': { station: '音乐小站', free: '免费完整收听', preview: 'VIP · 可试听', vip: 'VIP · 暂无试听', scan: '扫码打开歌曲' },
  'zh-Hant': { station: '音樂小站', free: '免費完整聆聽', preview: 'VIP · 可試聽', vip: 'VIP · 暫無試聽', scan: '掃碼開啟歌曲' },
  en: { station: 'Music Library', free: 'Free full listening', preview: 'VIP · Preview available', vip: 'VIP · No preview', scan: 'Scan to open song' },
  ja: { station: '音楽ライブラリ', free: 'フル再生無料', preview: 'VIP・試聴あり', vip: 'VIP・試聴なし', scan: 'スキャンして曲を開く' }
}[locale] || musicShareCopy('zh-Hant'));
// SVG text renders Unicode line/paragraph separators as missing glyphs. Flatten
// whitespace before removing controls so pasted paragraphs keep word boundaries.
const clean = (value, limit) => Array.from(String(value ?? '').replace(/[\s\u0085]+/gu, ' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, limit).join('');

export function musicShareCardPath(id, version, locale, format = 'poster') {
  if (!validMusicId(id) || !Number.isSafeInteger(version) || version < 1 || !MUSIC_LOCALES.includes(locale) || !Object.hasOwn(MUSIC_SHARE_FORMATS, format)) throw new Error('INVALID_SHARE_TARGET');
  return `/api/music/tracks/${id.toLowerCase()}/share.png?${new URLSearchParams({ locale, v: String(version), format })}`;
}
export function musicShareCardData(track, origin, locale) {
  musicShareCardPath(track.id, track.audioVersion, locale);
  if (!['free', 'vip'].includes(track.effectiveAccess) || typeof track.previewAvailable !== 'boolean') throw new Error('INVALID_SHARE_TRACK');
  const copy = musicShareCopy(locale), title = clean(track.title, 200), creator = clean(track.creatorName, 120);
  if (!title || !creator) throw new Error('INVALID_SHARE_TRACK');
  // Only public identity and current publication policy. No caller capabilities or media URLs.
  return { title, creator, station: copy.station,
    access: track.effectiveAccess === 'free' ? copy.free : track.previewAvailable ? copy.preview : copy.vip,
    scan: copy.scan, url: musicShareUrl(origin, locale, { track: track.id }), host: new URL(origin).host };
}
export function musicAlbumShareCardPath(slug, version, locale, format = 'poster') {
  if (typeof slug !== 'string' || slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !Number.isSafeInteger(version) || version < 1 || !MUSIC_LOCALES.includes(locale) || !Object.hasOwn(MUSIC_SHARE_FORMATS, format)) throw new Error('INVALID_SHARE_TARGET');
  return `/api/music/collections/${slug}/share.png?${new URLSearchParams({ locale, v: String(version), format })}`;
}
export function musicAlbumShareCardData(album, origin, locale) {
  musicAlbumShareCardPath(album.slug, album.version, locale);
  if (album.type !== 'album' || !Array.isArray(album.trackIds) || album.trackIds.length > 500 ||
    album.trackIds.some(id => !validMusicId(id)) || new Set(album.trackIds).size !== album.trackIds.length) throw new Error('INVALID_SHARE_ALBUM');
  const title = clean(album.title, 200);
  if (!title) throw new Error('INVALID_SHARE_ALBUM');
  const count = album.trackIds.length;
  const copy = {
    'zh-Hans': { count: `${count} 首作品`, scan: '扫码收听专辑' },
    'zh-Hant': { count: `${count} 首作品`, scan: '掃碼收聽專輯' },
    en: { count: `${count} ${count === 1 ? 'track' : 'tracks'}`, scan: 'Scan to listen' },
    ja: { count: `${count} 曲`, scan: 'スキャンしてアルバムを聴く' }
  }[locale];
  return { kind: 'album', title, creator: 'Station Cat', station: musicShareCopy(locale).station,
    description: clean(album.description, 500), count: copy.count, scan: copy.scan,
    url: musicShareUrl(origin, locale, { collection: album.slug }), host: new URL(origin).host };
}
export function musicXShareHref(title, url) {
  const site = new URL(url);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password) throw new Error('INVALID_SHARE_URL');
  return `https://x.com/intent/tweet?${new URLSearchParams({ text: clean(title, 200), url })}`;
}
export const escapeMusicShare = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Conservative em-width layout: bounded lines, with an explicit ellipsis for long metadata.
export function musicShareLines(value, width, maxLines) {
  const chars = Array.from(value), lines = []; let line = '', used = 0;
  const units = c => /[\u0020-\u007e]/.test(c) ? /[MW@]/.test(c) ? 1 : .65 : 1;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const word = /[A-Za-z0-9]/.test(c) && (i === 0 || !/[A-Za-z0-9]/.test(chars[i - 1]))
      ? chars.slice(i).join('').match(/^[A-Za-z0-9]+[,.!?]?/)?.[0] : null;
    const wordWidth = word ? Array.from(word).reduce((sum, char) => sum + units(char), 0) : 0;
    // Keep ordinary Latin words whole when they fit a line; only oversized tokens split.
    if ((used + units(c) > width || (wordWidth <= width && used + wordWidth > width)) && line.trim()) {
      lines.push(line.trim()); line = ''; used = 0;
      if (lines.length === maxLines) {
        lines[maxLines - 1] = Array.from(lines[maxLines - 1]).slice(0, -1).join('') + '…';
        return lines;
      }
    }
    line += c; used += units(c);
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

export function musicShareMetadata(track, origin, locale) {
  const album = track.type === 'album';
  const data = album ? musicAlbumShareCardData(track, origin, locale) : musicShareCardData(track, origin, locale), e = escapeMusicShare;
  const image = new URL(album ? musicAlbumShareCardPath(track.slug, track.version, locale, 'card') : musicShareCardPath(track.id, track.audioVersion, locale, 'card'), origin).href;
  const title = `${data.title} · ${data.creator} | ${data.station}`;
  const description = album ? `${data.count} · ${data.description || data.station}` : `${data.creator} · ${data.access} · ${data.station}`;
  return `<title>${e(title)}</title><link rel="canonical" href="${e(data.url)}"><meta name="description" content="${e(description)}">` +
    Object.entries({ 'og:type': 'website', 'og:site_name': 'Station Cat', 'og:title': title, 'og:description': description,
      'og:url': data.url, 'og:image': image, 'og:image:type': 'image/png', 'og:image:width': '1200', 'og:image:height': '630', 'og:image:alt': title })
      .map(([key, value]) => `<meta property="${key}" content="${e(value)}">`).join('') +
    Object.entries({ 'twitter:card': 'summary_large_image', 'twitter:title': title, 'twitter:description': description, 'twitter:image': image, 'twitter:image:alt': title })
      .map(([key, value]) => `<meta name="${key}" content="${e(value)}">`).join('');
}
