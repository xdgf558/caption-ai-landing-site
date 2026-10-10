import { routeMigrationEnabled, migrationPath, routeParts, migrationServicePath, chapterRoute, legacyFamily,
  brandRoute, brandHref, cleanMigrationQuery } from './routeMigrationPaths.js';
import { legacyContentExists, legacyChapterExists, legacyTrackExists } from './legacyRouteStore.js';
import { handleStationMusicPage, stationMusicRoute, isStationMusicTemplate } from './musicPages.js';
import { handleStationGamePage, isStationGameTemplate } from './gamePages.js';
import { isStationMemberTemplate } from './memberPages.js';
import { renderBrandPage } from './brandPages.js';
import { isStationSearchPath, handleStationSearch } from './searchIndex.js';
import { handleStationContent } from './publicHttp.js';
import { requestDeadline } from './publicStore.js';
import { readMusicResponse } from './musicResponse.js';
import { musicSelection } from '../music/pagePaths.js';
import { escapeMusicHtml as e } from './musicRender.js';
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
const messages = {
  400: ['地址參數不正確', '請從小站的作品目錄重新開啟。'],
  404: ['沒有找到這個頁面', '這個地址沒有對應的公開內容。'],
  405: ['此頁面不接受這個請求', '請使用頁面連結開啟。'],
  410: ['這個舊頁面已經告一段落', '你可以繼續探索小站的音樂與遊戲。'],
  503: ['小站正在準備這個入口', '內容或服務暫時無法確認，請稍後再試。'],
};
export function migrationFailure(request, status = 503) {
  const [title, text] = messages[status] || messages[503];
  return new Response(request.method === 'HEAD' ? null : `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>${e(title)} | Station Cat</title></head><body><main><h1>${e(title)}</h1><p>${e(text)}</p><a href="/">Station Cat</a></main></body></html>`,
    { status, headers: { ...headers, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) } });
}
const redirect = (target, status = 301) => new Response(null, { status, headers: { ...headers, Location: target } });

// Before old namespace/asset redirects. No production config, migration, write,
// destructive action or arbitrary proposal row can activate this profile.
export async function handleStationRouteMigration(request, env, { readerIdentity, clock = Date.now, deadlineMs = 10000 } = {}) {
  if (!routeMigrationEnabled(env)) return null;
  const url = new URL(request.url), path = migrationPath(url.pathname);
  if (!path) return migrationFailure(request, 400);
  if (migrationServicePath(path) || isStationMusicTemplate(path) || isStationGameTemplate(path) || isStationMemberTemplate(path)) return null;
  const chapter = chapterRoute(path), family = legacyFamily(path), brand = brandRoute(path), parts = routeParts(path);
  const music = parts.segments[0] === 'music', games = parts.segments[0] === 'games', search = isStationSearchPath(path);
  if (!chapter && !family && !brand && !music && !games && !search) return null;
  if (!['GET','HEAD'].includes(request.method)) return migrationFailure(request, 405);
  const run = requestDeadline(deadlineMs);
  try {
    if (chapter) {
      const exists = await run(() => legacyChapterExists(request, env, chapter));
      if (!exists) return migrationFailure(request, 404);
      if (typeof env.WAITLIST_DB?.prepare !== 'function') return migrationFailure(request, 503);
      // Novel member means signed in, not music VIP. The existing chapter
      // renderer and protected-content API retain their actual purchase checks.
      const identity = await run(() => readerIdentity?.(request, env));
      if (!identity) return redirect(stationMemberHref(chapter.locale) + '?returnTo=' + encodeURIComponent(chapter.href), 303);
      if (url.pathname !== chapter.href) return redirect(chapter.href);
      return null;
    }
    if (brand) {
      if (url.pathname !== brand.href || url.search) return redirect(brand.href);
      return await run(() => renderBrandPage(request, env, brand, { clock, deadlineMs }));
    }
    if (search) {
      if (url.pathname !== path) return redirect(path);
      return await run(() => handleStationSearch(request, env, { clock, deadlineMs }));
    }
    if (family?.game) {
      // The unprefixed legacy apps directory was English, unlike the new home.
      const locale = family.explicit ? family.locale : 'en';
      const response = await run(() => handleStationContent(new Request(new URL('/api/station/content/games/cat-life-game?locale=' + locale, request.url),
        { headers: request.headers, cf: request.cf }), env, { clock, deadlineMs }));
      const payload = JSON.parse(await readMusicResponse(response));
      if (!response.ok) return migrationFailure(request, response.status === 404 ? 503 : response.status);
      const target = brandHref(locale, 'games') + 'cat-life-game/';
      if (payload.game?.slug !== 'cat-life-game' || payload.game.href !== target) return migrationFailure(request, 503);
      const query = cleanMigrationQuery(url.search);
      return redirect(target + (query ? '?' + query : ''));
    }
    if (family) {
      const exists = family.known || await run(() => legacyContentExists(env.WAITLIST_DB, family));
      return migrationFailure(request, exists ? 410 : 404);
    }
    // Normalize encoded/index aliases before invoking the existing new pages.
    const canonicalRequest = path === url.pathname ? request : new Request(new URL(path + url.search, url.origin), request);
    if (music) {
      const route = stationMusicRoute(path), selection = musicSelection(url.search);
      if (route?.kind === 'catalog' && url.searchParams.has('collection')) {
        if (!selection.has('collection') || url.searchParams.has('track')) return migrationFailure(request, 400);
        const target = brandHref(route.locale, 'music') + '?collection=' + selection.get('collection');
        const query = cleanMigrationQuery(url.search);
        if (url.pathname + url.search !== target + (query ? '&' + query : '')) return redirect(target + (query ? '&' + query : ''));
        return null; // Existing album system; do not invent a new collection page.
      }
      if (route?.kind === 'catalog' && url.searchParams.has('track') && !selection.has('track')) return migrationFailure(request, 400);
      const response = await run(() => handleStationMusicPage(canonicalRequest, env, { clock, deadlineMs }));
      if (response) {
        if (response.status === 200 && url.pathname !== path) { await response.body?.cancel(); return redirect(path); }
        return response;
      }
      if (route?.kind === 'catalog' && selection.has('track')) {
        // Published in the old system but lacking a published new entity is an
        // unavailable migration target, never proof that the song disappeared.
        return migrationFailure(request, await run(() => legacyTrackExists(env, selection.get('track'))) ? 503 : 404);
      }
      if (route?.kind === 'legacy') {
        const row = await run(() => env.MUSIC_DB.prepare("SELECT id FROM music_tracks WHERE slug=? AND lifecycle='published' LIMIT 1").bind(route.slug).first());
        if (row) return migrationFailure(request, 503);
      }
      return migrationFailure(request, 404);
    }
    if (games) {
      const response = await run(() => handleStationGamePage(canonicalRequest, env, { clock, deadlineMs }));
      if (response) {
        if (response.status === 200 && url.pathname !== path) { await response.body?.cancel(); return redirect(path); }
        return response;
      }
      return migrationFailure(request, 404);
    }
    return null;
  } catch (error) { return migrationFailure(request, [400,405,429].includes(error.status) ? error.status : 503); }
}
function stationMemberHref(locale) { return '/' + (locale === 'zh-Hant' ? 'zh-hant' : locale === 'zh-Hans' ? 'zh-hans' : locale) + '/library/'; }
