// Shared route contract. Only public identifiers survive redirects/language changes.
export const musicPagePaths = Object.freeze({ 'zh-Hant': '/music/', 'zh-Hans': '/zh-hans/music/', en: '/en/music/', ja: '/ja/music/' });
export function isMusicPagePath(path) {
  try { path = decodeURIComponent(path); } catch { /* malformed paths cannot resolve an asset */ }
  path = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  return /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music(?:\/|$)/.test(path);
}
export const musicPageLocale = path => path.startsWith('/en/') ? 'en' : path.startsWith('/ja/') ? 'ja' : path.startsWith('/zh-hans/') ? 'zh-Hans' : 'zh-Hant';
export function musicSelection(search) {
  const params = new URLSearchParams(search), result = new URLSearchParams();
  for (const [key, pattern] of [['track', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i], ['collection', /^[a-z0-9]+(?:-[a-z0-9]+)*$/]]) {
    const value = params.get(key);
    if (params.getAll(key).length === 1 && value?.length <= 100 && pattern.test(value)) result.set(key, key === 'track' ? value.toLowerCase() : value);
  }
  return result;
}
export function musicPageHref(locale, search = '') {
  const query = musicSelection(search).toString();
  return (musicPagePaths[locale] || musicPagePaths['zh-Hant']) + (query ? `?${query}` : '');
}
