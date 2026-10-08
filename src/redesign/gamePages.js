import { handleStationContent } from './publicHttp.js';
import { requestDeadline } from './publicStore.js';
import { stationHref, stationLanguageHref } from './routes.js';
import { contentBase, slug } from './publicValidation.js';
import { readMusicResponse } from './musicResponse.js';
import { escapeMusicHtml as e } from './musicRender.js';
import { gameCopy } from './gameCopy.js';
import { renderGamePage } from './gameRender.js';
const locales = { en: 'en', ja: 'ja', 'zh-hans': 'zh-Hans', 'zh-hant': 'zh-Hant' };
const enabled = value => value === true || value === 'true';
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
function normalized(pathname) { try { return decodeURIComponent(pathname).replace(/\\/g, '/').replace(/\/{2,}/g, '/'); } catch { return ''; } }
export function stationGameRoute(pathname) {
  const match = /^\/(?:((?:en|ja|zh-hans|zh-hant))\/)?games(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?\/?$/.exec(normalized(pathname));
  if (!match || match[2] === 'cat-life' || (match[2] && !slug(match[2]))) return null;
  return { locale: locales[match[1]] || 'zh-Hant', kind: match[2] ? 'detail' : 'catalog', slug: match[2] || null };
}
export function isStationGameTemplate(pathname) { return /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?games\/site-shell(?:\/|$)/.test(normalized(pathname)); }
function failure(request, route, status) {
  const copy = gameCopy[route.locale];
  return new Response(request.method === 'HEAD' ? null : `<!doctype html><html lang="${route.locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>${e(copy.failed)}</title><main><h1>${e(copy.failed)}</h1><a href="${stationHref(route.locale, 'games')}">${copy.retry}</a></main></html>`, { status, headers: { ...headers, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) } });
}
async function template(request, env, model, status) {
  const asset = await env.ASSETS?.fetch(new Request(new URL('/games/site-shell/' + model.locale + '/', request.url)));
  if (!asset || asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) { await asset?.body?.cancel(); throw new Error('MISSING_SHELL'); }
  const html = await readMusicResponse(asset, 128 * 1024);
  if (!html.includes('data-sc-game-page')) throw new Error('MISSING_SHELL');
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const url = new URL(request.url), origin = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? url.origin : 'https://wwwstationcat.org';
  const copy = gameCopy[model.locale], title = model.game?.title || copy.title, description = model.game?.summary || copy.intro;
  const path = model.game?.href || stationHref(model.locale, 'games');
  const metadata = `<title>${e(title)} | Station Cat</title><meta name="description" content="${e(description)}"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${e(origin + path)}">`;
  return new HTMLRewriter()
    .on('title, meta[name="description"], meta[name="robots"], link[rel="canonical"]', { element(node) { node.remove(); } })
    .on('head', { element(node) { node.append(metadata, { html: true }); } })
    .on('[data-sc-language]', { element(node) { node.setAttribute('href', stationLanguageHref(node.getAttribute('data-sc-language'), url.pathname)); } })
    .on('[data-sc-game-page]', { element(node) { node.setInnerContent(renderGamePage(model), { html: true }); } })
    .transform(new Response(html, { status, headers }));
}
export async function handleStationGamePage(request, env, { clock = Date.now, deadlineMs = 10000 } = {}) {
  const url = new URL(request.url), route = stationGameRoute(url.pathname);
  if (isStationGameTemplate(url.pathname)) return new Response(null, { status: 404, headers });
  if (!route) return null;
  // Neither a half-enabled rollout nor an unavailable binding owns old routes.
  if (!enabled(env.STATION_GAME_PAGES_ENABLED) || !enabled(env.STATION_CONTENT_PUBLIC_ENABLED)) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return failure(request, route, 405);
  const run = requestDeadline(deadlineMs), end = Date.now() + deadlineMs;
  const get = async path => {
    const response = await handleStationContent(new Request(new URL(contentBase + path, request.url), { headers: request.headers, cf: request.cf }), env,
      { clock, deadlineMs: Math.max(1, Math.min(10000, end - Date.now())) });
    const body = JSON.parse(await readMusicResponse(response));
    if (!response.ok) throw Object.assign(new Error('CONTENT_QUERY_FAILED'), { status: response.status });
    return body;
  };
  try {
    if (url.searchParams.getAll('cursor').length > 1) return failure(request, route, 400);
    const cursor = url.searchParams.get('cursor');
    if (cursor !== null && (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor) || route.kind === 'detail')) return failure(request, route, 400);
    const model = { mode: route.kind, locale: route.locale, items: [], game: null, error: null, nextCursor: null };
    let status = 200, target;
    try {
      if (route.kind === 'detail') { model.game = (await run(() => get('/games/' + route.slug + '?locale=' + route.locale))).game; target = model.game.href; }
      else { const body = await run(() => get('/games?locale=' + route.locale + '&limit=20' + (cursor ? '&cursor=' + cursor : ''))); model.items = body.items; model.nextCursor = body.nextCursor; target = stationHref(route.locale, 'games') + (cursor ? '?cursor=' + cursor : ''); }
    } catch (error) { if (route.kind === 'detail' && error.status === 404) return null; model.error = { status: error.status || 503 }; status = model.error.status; }
    if (target && url.pathname + url.search !== target) return new Response(null, { status: 302, headers: { ...headers, Location: target } });
    return await run(() => template(request, env, model, status));
  } catch (error) { return failure(request, route, [400, 405, 429].includes(error.status) ? error.status : 503); }
}
