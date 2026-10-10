import { isMusicPagePath, musicPageHref, musicSelection } from '../music/pagePaths.js';

export const stationLocales = Object.freeze(['zh-Hant', 'zh-Hans', 'en', 'ja']);
export const stationSections = Object.freeze(['home', 'music', 'games', 'member', 'about']);
const localePrefixes = { 'zh-Hant': '', 'zh-Hans': '/zh-hans', en: '/en', ja: '/ja' };
const explicitPrefixes = { 'zh-Hant': '/zh-hant', 'zh-Hans': '/zh-hans', en: '/en', ja: '/ja' };

export const stationCopy = Object.freeze({
  'zh-Hans': { home: '首页', music: '音乐', games: '游戏', member: '会员', about: '关于', my: '我的', subtitle: '一座深夜还亮着的小站。', enter: '进入小站', navigation: '小站导航', language: '选择语言', skip: '跳到主要内容', privacy: '隐私政策', terms: '服务条款', support: '联系我们' },
  'zh-Hant': { home: '首頁', music: '音樂', games: '遊戲', member: '會員', about: '關於', my: '我的', subtitle: '一座深夜還亮著的小站。', enter: '進入小站', navigation: '小站導覽', language: '選擇語言', skip: '跳至主要內容', privacy: '隱私政策', terms: '服務條款', support: '聯絡我們' },
  en: { home: 'Home', music: 'Music', games: 'Games', member: 'Member', about: 'About', my: 'My station', subtitle: 'A little station, still lit at night.', enter: 'Enter the station', navigation: 'Station navigation', language: 'Choose language', skip: 'Skip to main content', privacy: 'Privacy', terms: 'Terms', support: 'Contact' },
  ja: { home: 'ホーム', music: '音楽', games: 'ゲーム', member: '会員', about: '紹介', my: 'マイページ', subtitle: '夜更けにも灯りのともる小さな駅。', enter: '小さな駅へ', navigation: '駅のナビゲーション', language: '言語を選択', skip: '本文へ移動', privacy: 'プライバシー', terms: '利用規約', support: 'お問い合わせ' },
});
export const stationLanguageNames = Object.freeze({ 'zh-Hant': '繁中', 'zh-Hans': '简中', en: 'EN', ja: '日本語' });
export const stationLanguageAccessibleNames = Object.freeze({ 'zh-Hant': '繁體中文', 'zh-Hans': '简体中文', en: 'English', ja: '日本語' });

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
  return pathname.replace(/^\/(?:en|ja|zh-hans|zh-hant)(?=\/|$)/, '') || '/';
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
