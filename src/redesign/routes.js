import { isMusicPagePath, musicPageHref, musicSelection } from '../music/pagePaths.js';

// Public pages are served in Traditional Chinese and English only (2026-11-15).
export const stationLocales = Object.freeze(['zh-Hant', 'en']);
// Stored content may still carry other locale keys from earlier revisions; validation keeps accepting them.
export const stationContentLocales = Object.freeze(['zh-Hant', 'zh-Hans', 'en', 'ja']);
export const stationSections = Object.freeze(['home', 'music', 'games', 'member', 'about']);
const localePrefixes = { 'zh-Hant': '', en: '/en' };
const explicitPrefixes = { 'zh-Hant': '/zh-hant', en: '/en' };

export const stationCopy = Object.freeze({
  'zh-Hant': { home: '首頁', music: '音樂', games: '遊戲', member: '會員', about: '關於', my: '我的', subtitle: '一座深夜還亮著的小站。', enter: '進入小站', navigation: '小站導覽', language: '選擇語言', skip: '跳至主要內容', privacy: '隱私政策', terms: '服務條款', support: '聯絡我們' },
  en: { home: 'Home', music: 'Music', games: 'Games', member: 'Member', about: 'About', my: 'My station', subtitle: 'A little station, still lit at night.', enter: 'Enter the station', navigation: 'Station navigation', language: 'Choose language', skip: 'Skip to main content', privacy: 'Privacy', terms: 'Terms', support: 'Contact' },
});
export const stationLanguageNames = Object.freeze({ 'zh-Hant': '繁中', en: 'EN' });
export const stationLanguageAccessibleNames = Object.freeze({ 'zh-Hant': '繁體中文', en: 'English' });

function validLocale(locale) { return stationLocales.includes(locale) ? locale : 'zh-Hant'; }

// The new game directory is an opt-in destination for T12. No live route is replaced here.
// User's 2026-10-06 design replaces the four-entry proposal with five entries.
// Member retains the existing account/library; About uses its one existing URL.
export function stationHref(locale, section, search = '', { brandRoutes = false } = {}) {
  locale = validLocale(locale);
  if (section === 'music') return musicPageHref(locale, search);
  if (section === 'member' || section === 'my') return `${explicitPrefixes[locale]}/library/`;
  if (section === 'about') return brandRoutes ? `${localePrefixes[locale]}/about/` : '/about/';
  if (section === 'games') return `${localePrefixes[locale]}/games/`;
  return `${localePrefixes[locale]}/`;
}

function logicalPath(pathname) {
  return pathname.replace(/^\/(?:en|zh-hant)(?=\/|$)/, '') || '/';
}

export function stationSection(pathname) {
  if (isMusicPagePath(pathname)) return 'music';
  const path = logicalPath(pathname);
  if (/^\/games(?:\/|$)/.test(path) || /^\/apps\/cat-life-game(?:\/|$)/.test(path)) return 'games';
  if (/^\/(?:library|account)(?:\/|$)/.test(path)) return 'member';
  if (/^\/about\/?$/.test(path)) return 'about';
  if (path === '/') return 'home';
  return null;
}

export function stationLanguageHref(locale, pathname, search = '', context = {}) {
  locale = validLocale(locale);
  const path = logicalPath(pathname);
  // The game's own controls manage its language. Never invent another runtime URL.
  if (/^\/games\/cat-life\/?$/.test(path)) return '/games/cat-life/';
  if (/^\/music\/iphone\/?$/.test(path)) return `${localePrefixes[locale]}/music/iphone/`;
  // Preserve a future public track slug rather than treating the whole music namespace
  // as a root page. Entity mapping and legacy redirects remain T08/T20 responsibilities.
  if (/^\/music\/tracks\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(path)) {
    const query = musicSelection(search).toString();
    return `${localePrefixes[locale]}${path.replace(/\/?$/, '/')}${query ? `?${query}` : ''}`;
  }
  if (isMusicPagePath(pathname)) return musicPageHref(locale, search);
  if (/^\/games(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/.test(path)) {
    return `${localePrefixes[locale]}${path.replace(/\/?$/, '/')}`;
  }
  if (/^\/(?:library|account)\/?$/.test(path)) return stationHref(locale, 'member');
  if (/^\/about\/?$/.test(path)) return stationHref(locale, 'about', '', context);
  if (/^\/(?:privacy|terms)\/?$/.test(path)) return `${explicitPrefixes[locale]}${path.replace(/\/?$/, '/')}`;
  return stationHref(locale, 'home');
}

export function stationPolicyHref(locale, policy) {
  if (!['privacy', 'terms'].includes(policy)) throw new TypeError('Unknown station policy');
  return `${explicitPrefixes[validLocale(locale)]}/${policy}/`;
}
