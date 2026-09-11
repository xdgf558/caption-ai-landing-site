import { safeReturnPath } from '../safeReturnPath.js';
import { readerLibraryPaths } from '../data/reader-library-client.js';
import { musicPageHref, musicPageLocale, musicSelection } from './pagePaths.js';

export const MUSIC_RETURN_HASH = '#membership-return';
const musicPath = /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music\/?$/;

// A navigation hint only. Never carry checkout tokens, identity or access flags.
export function musicReturnPath(value) {
  if (typeof value !== 'string' || !value || safeReturnPath(value, '/') === '/') return null;
  const url = new URL(value, 'https://return.invalid');
  if (!musicPath.test(url.pathname)) return null;
  return musicPageHref(musicPageLocale(url.pathname), url.search);
}
export function musicMembershipHref(locale, selection = '') {
  const returnTo = musicPageHref(locale, selection);
  return `${readerLibraryPaths[locale] || readerLibraryPaths['zh-Hant']}?${new URLSearchParams({ source: 'music', returnTo })}`;
}
export function readMusicMembershipEntry(search) {
  const query = new URLSearchParams(search);
  if (query.getAll('source').length !== 1 || query.get('source') !== 'music' || query.getAll('returnTo').length !== 1) return null;
  return musicReturnPath(query.get('returnTo'));
}
export function musicShareUrl(origin, locale, { track, collection } = {}) {
  const site = new URL(origin);
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.pathname !== '/' || site.search || site.hash) throw new Error('INVALID_ORIGIN');
  const selection = musicSelection(new URLSearchParams(track ? { track } : collection ? { collection } : {}));
  if (!selection.size) throw new Error('INVALID_SELECTION');
  return new URL(musicPageHref(locale, selection), site.origin).href;
}

// Called within the user gesture; share/clipboard invocation precedes any await.
export async function shareMusicLink({ url, title }, { navigator = globalThis.navigator, copyOnly = false } = {}) {
  if (!copyOnly && typeof navigator?.share === 'function') {
    try { await navigator.share({ title, url }); return { status: 'shared', url }; }
    catch (error) { if (error?.name === 'AbortError') return { status: 'cancelled', url }; }
  }
  try {
    if (typeof navigator?.clipboard?.writeText !== 'function') throw new Error('NO_CLIPBOARD');
    await navigator.clipboard.writeText(url); return { status: 'copied', url };
  } catch { return { status: 'manual', url }; }
}
