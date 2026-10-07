import { stationLocales } from './routes.js';

export const contentBase = '/api/station/content';
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const slug = value => typeof value === 'string' && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
export const positive = value => Number.isSafeInteger(value) && value > 0;
export const millis = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
export const plain = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// JSON.parse accepts duplicate (including escaped) keys. Reject that ambiguity
// before using stored metadata, with bounded input, depth, nodes and object keys.
export function strictJson(source, maxLength = 32768) {
  if (typeof source !== 'string' || source.length > maxLength) throw new TypeError('Invalid stored JSON');
  const parsed = JSON.parse(source);
  let at = 0, nodes = 0;
  const space = () => { while (/\s/.test(source[at] || '') && at < source.length) at++; };
  const string = () => {
    const start = at++;
    while (at < source.length) {
      const c = source[at++];
      if (c === '\\') at++;
      else if (c === '"') return JSON.parse(source.slice(start, at));
    }
    throw new TypeError('Invalid stored JSON');
  };
  function value(depth) {
    if (++nodes > 1024 || depth > 12) throw new TypeError('Stored JSON limit');
    space();
    if (source[at] === '{') {
      at++; space(); const keys = new Set();
      if (source[at] === '}') { at++; return; }
      while (at < source.length) {
        const key = string();
        if (keys.has(key) || keys.size >= 64 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Ambiguous stored JSON');
        keys.add(key); space(); at++; value(depth + 1); space();
        if (source[at++] === '}') return;
        space();
      }
    } else if (source[at] === '[') {
      at++; space();
      if (source[at] === ']') { at++; return; }
      while (at < source.length) {
        value(depth + 1); space();
        if (source[at++] === ']') return;
      }
    } else if (source[at] === '"') string();
    else while (at < source.length && !/[\s,\]}]/.test(source[at])) at++;
  }
  value(0); space();
  if (at !== source.length) throw new TypeError('Invalid stored JSON');
  return parsed;
}

export function idList(source, max = 25) {
  const ids = strictJson(source, 4096);
  if (!Array.isArray(ids) || ids.length > max || ids.some(id => !uuid(id)) ||
    new Set(ids.map(id => id.toLowerCase())).size !== ids.length) throw new TypeError('Invalid stored IDs');
  return ids;
}

export function metadata(source, locale, { artist = false } = {}) {
  try {
    const value = strictJson(source);
    if (!object(value) || !stationLocales.includes(value.originalLocale)) return null;
    const localized = (map, max, required = false) => {
      if (map === undefined && !required) return { text: '', map: {} };
      if (!object(map) || Object.keys(map).some(key => !stationLocales.includes(key) || !plain(map[key], max))) return null;
      if (!required && Object.keys(map).length === 0) return { text: '', map: {} };
      const original = map[value.originalLocale];
      if (!plain(original, max) || (required && !original.trim())) return null;
      return { text: map[locale]?.trim() ? map[locale] : original, map };
    };
    const title = localized(value.title, 200, true), summary = localized(value.summary, 500);
    const story = value.story === undefined ? '' : value.story;
    if (!title || !summary || typeof story !== 'string' || story.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(story) ||
      (artist && (!plain(value.creatorName, 120) || !value.creatorName.trim()))) return null;
    return { originalLocale: value.originalLocale, title: title.text, titleMap: title.map,
      summary: summary.text, summaryMap: summary.map, story, artist: artist ? value.creatorName : null,
      relatedTrackIds: value.relatedTrackIds === undefined ? [] : idList(JSON.stringify(value.relatedTrackIds), 6) };
  } catch { return null; }
}

// Exact provider hosts only. No arbitrary target/redirect URL or stored credential
// may be forwarded; verification is an operator record, not an outbound fetch.
const providerHosts = Object.freeze({
  netease: ['music.163.com', 'y.music.163.com'],
  qishui: ['music.douyin.com', 'qishui.douyin.com'],
  apple_music: ['music.apple.com'],
  youtube: ['www.youtube.com', 'music.youtube.com', 'youtu.be'],
  spotify: ['open.spotify.com']
});
export function platformUrl(value, provider) {
  try {
    if (!plain(value, 2048) || /[\s\\]/.test(value)) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !providerHosts[provider]?.includes(url.hostname) || url.pathname === '/' ||
      /^\/(?:redirect|login|oauth|auth)(?:\/|$)/i.test(url.pathname) ||
      [...url.searchParams.keys()].some(key => /token|secret|credential|signature|authorization|x-amz|redirect|target|return|^next$|^url$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

export function platform(row, country, now) {
  try {
    const territories = strictJson(row.territories_json, 1024);
    if (!uuid(row.id) || row.status !== 'live' || !millis(row.verified_at) || row.verified_at > now ||
      !Array.isArray(territories) || !territories.length || territories.length > 250 ||
      territories.some(code => code !== '*' && !/^[A-Z]{2}$/.test(code)) ||
      new Set(territories).size !== territories.length || (territories.includes('*') && territories.length !== 1) ||
      (!territories.includes('*') && !territories.includes(country))) return null;
    const href = platformUrl(row.url, row.provider);
    if (!href || !Number.isSafeInteger(row.sort_order) || row.sort_order < 0) return null;
    return { id: row.id, trackId: row.track_id, provider: row.provider, status: 'live', href,
      verifiedAt: new Date(row.verified_at).toISOString(), sortOrder: row.sort_order,
      releasedAt: millis(row.external_released_at) && row.external_released_at <= now ? new Date(row.external_released_at).toISOString() : null };
  } catch { return null; }
}

export function requestInput(url, allowed) {
  if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1)) throw new TypeError('Invalid query');
  const locale = url.searchParams.get('locale') || 'zh-Hant';
  if (!stationLocales.includes(locale)) throw new TypeError('Invalid locale');
  const rawLimit = url.searchParams.get('limit'), limit = rawLimit === null ? 20 : Number(rawLimit);
  if ((rawLimit !== null && !/^[1-9]\d*$/.test(rawLimit)) || !positive(limit) || limit > 50) throw new TypeError('Invalid limit');
  const q = url.searchParams.get('q') || '';
  if (!plain(q, 100)) throw new TypeError('Invalid search');
  let cursor = null;
  const rawCursor = url.searchParams.get('cursor');
  if (rawCursor !== null) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(rawCursor)) throw new TypeError('Invalid cursor');
    try {
      cursor = strictJson(atob(rawCursor.replace(/-/g, '+').replace(/_/g, '/')), 200);
      if (!object(cursor) || Object.keys(cursor).sort().join(',') !== 'at,id' || !millis(cursor.at) || !uuid(cursor.id)) throw new TypeError('Invalid cursor');
    } catch { throw new TypeError('Invalid cursor'); }
  }
  return { locale, limit, q, cursor };
}
export const cursorFor = row => btoa(JSON.stringify({ at: row.published_at, id: row.id })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
export const localizedPath = (locale, section, name) => (locale === 'zh-Hant' ? '' : locale === 'zh-Hans' ? '/zh-hans' : '/' + locale) + '/' + section + '/' + name + '/';
