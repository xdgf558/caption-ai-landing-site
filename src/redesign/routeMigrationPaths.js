import { stationLocales, stationHref } from './routes.js';
import { stationLegacyInventory } from '../generated/stationLegacyRouteInventory.js';

export const migrationFlags = Object.freeze(['STATION_ROUTE_MIGRATIONS_ENABLED',
  'STATION_CONTENT_PUBLIC_ENABLED', 'STATION_MUSIC_PAGES_ENABLED',
  'STATION_GAME_PAGES_ENABLED', 'STATION_MEMBER_PAGES_ENABLED']);
export const flagOn = value => value === true || value === 'true';
// A partial activation never retires an entry before its replacement pages exist.
export const routeMigrationEnabled = env => migrationFlags.every(key => flagOn(env[key]));
export const localeSegments = Object.freeze({ en: 'en', ja: 'ja', 'zh-hans': 'zh-Hans', 'zh-hant': 'zh-Hant' });
const retired = new Set(stationLegacyInventory.retiredStaticPaths);
export function migrationPath(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const decoded = decodeURIComponent(value);
    if (/[\u0000-\u0020\u007f?#%]/.test(decoded)) return null;
    const path = decoded.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    return path.startsWith('/') ? path.replace(/\/index\.html$/, '/') : null;
  } catch { return null; }
}
export function routeParts(path) {
  const segments = path.split('/').filter(Boolean), prefix = localeSegments[segments[0]];
  return { locale: prefix || 'zh-Hant', explicit: Boolean(prefix), segments: prefix ? segments.slice(1) : segments };
}
export function brandHref(locale, section) {
  if (!stationLocales.includes(locale)) locale = 'zh-Hant';
  return section === 'about' ? (locale === 'zh-Hant' ? '' : locale === 'zh-Hans' ? '/zh-hans' : '/' + locale) + '/about/' : stationHref(locale, section);
}
const chapterSlug = value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '') && value.length <= 160;
export function chapterRoute(path) {
  const { segments: s, locale, explicit } = routeParts(path);
  if (s[0] === 'works' && s.length === 3 && chapterSlug(s[1]) && chapterSlug(s[2])) {
    const language = locale === 'en' ? 'en' : 'zh-Hant';
    return { locale: language, series: s[1], chapter: s[2], alias: true,
      href: (language === 'en' ? '/en' : '') + '/novel/' + s[1] + '/chapter/' + s[2] + '/' };
  }
  if (s[0] === 'novel' && (!explicit || locale === 'en') && s.length === 4 && s[2] === 'chapter' && chapterSlug(s[1]) && chapterSlug(s[3])) {
    return { locale, series: s[1], chapter: s[3], alias: false,
      href: (locale === 'en' ? '/en' : '') + '/novel/' + s[1] + '/chapter/' + s[3] + '/' };
  }
  return null;
}
export function migrationServicePath(path) {
  // These are namespaces, not a method/permission grant. Their actual handlers
  // continue to decide status, credentials and supported operations.
  if (/^\/(?:api|admin|admin-v2|auth|downloads|_astro|images|assets|fonts)(?:\/|$)/.test(path) || path === '/.well-known/apple-app-site-association') return true;
  if (/^\/games\/cat-life(?:\/|$)/.test(path)) return true;
  const { segments: s } = routeParts(path);
  if (['library', 'account', 'points', 'privacy', 'terms', 'support', 'android', 'download'].includes(s[0])) return true;
  if (s[0] === 'apps' && s.length >= 3 && ['download', 'privacy', 'terms', 'support', 'android'].includes(s[2])) return true;
  return false;
}
export function legacyFamily(path) {
  const { segments, locale, explicit } = routeParts(path);
  if (!['apps', 'signal', 'devlog', 'novel', 'works'].includes(segments[0])) return null;
  return { section: segments[0], segments, locale, explicit,
    known: retired.has(path.replace(/\/?$/, '/')) || segments.length === 1,
    game: segments[0] === 'apps' && segments.length === 2 && segments[1] === 'cat-life-game' };
}
export function brandRoute(path) {
  const { segments: s, locale } = routeParts(path);
  if (!s.length) return { section: 'home', locale, href: brandHref(locale, 'home') };
  if (s.length === 1 && s[0] === 'about') return { section: 'about', locale, href: brandHref(locale, 'about') };
  return null;
}
export function publicSearchRoute(path) {
  const brand = brandRoute(path);
  if (brand) return { ...brand, alternates: stationLocales.map(lang => [lang, brandHref(lang, brand.section)]) };
  const { segments: s, locale } = routeParts(path);
  if ((s[0] === 'music' && (s.length === 1 || (s.length === 3 && s[1] === 'tracks' && chapterSlug(s[2])))) ||
      (s[0] === 'games' && (s.length === 1 || (s.length === 2 && chapterSlug(s[1]) && s[1] !== 'cat-life')))) {
    const tail = '/' + s.join('/') + '/';
    const href = lang => (lang === 'zh-Hant' ? '' : lang === 'zh-Hans' ? '/zh-hans' : '/' + lang) + tail;
    return { locale, href: href(locale), section: s[0], alternates: stationLocales.map(lang => [lang, href(lang)]) };
  }
  return null;
}
export function cleanMigrationQuery(search) {
  const input = new URLSearchParams(search), out = new URLSearchParams();
  for (const key of ['campaign', 'src', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const values = input.getAll(key);
    if (values.length === 1 && /^[a-zA-Z0-9_.-]{1,100}$/.test(values[0])) out.set(key, values[0]);
  }
  return out.toString();
}
