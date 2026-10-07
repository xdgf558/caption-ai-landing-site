import { handleStationContent } from './publicHttp.js';
import { checkedContentRuntime, contentTrack, requestDeadline } from './publicStore.js';
import { checkMusicRateLimit } from '../music/rateLimits.js';
import { musicSelection } from '../music/pagePaths.js';
import { stationHref, stationLocales, stationLanguageHref } from './routes.js';
import { contentBase, plain, slug, localizedPath } from './publicValidation.js';
import { musicCopy } from './musicCopy.js';
import { renderMusicPage, escapeMusicHtml as e, musicBootstrap, musicCatalogHref } from './musicRender.js';
import { readMusicResponse } from './musicResponse.js';

const origin = 'https://wwwstationcat.org';
const locales = { en: 'en', ja: 'ja', 'zh-hans': 'zh-Hans', 'zh-hant': 'zh-Hant' };
const enabled = value => value === true || value === 'true';
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', Vary: 'CF-IPCountry' };
function normalizedPath(pathname) {
  try { return decodeURIComponent(pathname).replace(/\\/g, '/').replace(/\/{2,}/g, '/'); } catch { return ''; }
}
export function isStationMusicTemplate(pathname) {
  return /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music\/site-shell(?:\/|$)/.test(normalizedPath(pathname));
}
export function stationMusicRoute(pathname) {
  const match = /^\/(?:((?:en|ja|zh-hans|zh-hant))\/)?music(?:\/(tracks\/)?([a-z0-9]+(?:-[a-z0-9]+)*))?\/?$/.exec(normalizedPath(pathname));
  if (!match || (match[3] && !slug(match[3]))) return null;
  return { locale: locales[match[1]] || 'zh-Hant', kind: match[2] ? 'detail' : match[3] ? 'legacy' : 'catalog', slug: match[3] || null };
}
function tracking(url) {
  const query = new URLSearchParams();
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
    const values = url.searchParams.getAll(key);
    if (values.length === 1 && plain(values[0], 160) && values[0]) query.set(key, values[0]);
  }
  return query;
}
function catalogInput(url) {
  for (const name of ['q', 'sort', 'cursor']) if (url.searchParams.getAll(name).length > 1) throw Object.assign(new Error(), { status: 400 });
  const q = (url.searchParams.get('q') || '').trim(), sort = url.searchParams.get('sort') || 'default', cursor = url.searchParams.get('cursor');
  if (!plain(q, 100) || !['default', 'release'].includes(sort) || (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor))) throw Object.assign(new Error(), { status: 400 });
  return { q, sort, cursor };
}
function redirect(request, target) {
  return new Response(null, { status: 302, headers: { ...headers, Location: target } });
}
function failurePage(request, route, status = 503) {
  const copy = musicCopy[route.locale], href = route.kind === 'detail' ? localizedPath(route.locale, 'music/tracks', route.slug) : stationHref(route.locale, 'music');
  return new Response(request.method === 'HEAD' ? null : `<!doctype html><html lang="${route.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>${e(copy.failed)} | Station Cat</title></head><body><main><h1>${e(status === 404 ? copy.notFound : copy.failed)}</h1><a href="${e(href)}">${e(copy.retry)}</a> · <a href="${stationHref(route.locale, 'music')}">${copy.back}</a></main></body></html>`,
    { status, headers: { ...headers, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) } });
}
function pageMetadata(model) {
  const copy = musicCopy[model.locale], track = model.track;
  const title = track ? track.title + ' · ' + track.artist + ' | Station Cat' : copy.title + ' | Station Cat';
  const description = track ? track.summary || track.artist : copy.intro;
  const canonicalPath = track?.href || (model.mode === 'detail' ? localizedPath(model.locale, 'music/tracks', model.detailSlug) : stationHref(model.locale, 'music'));
  const canonical = origin + canonicalPath;
  const image = track?.coverUrl ? origin + track.coverUrl : null;
  return `<title>${e(title)}</title><meta name="description" content="${e(description)}"><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${e(canonical)}">` +
    Object.entries({ 'og:type': 'website', 'og:site_name': 'Station Cat', 'og:title': title, 'og:description': description,
      'og:url': canonical, ...(image ? { 'og:image': image, 'og:image:alt': track.title } : {}) })
      .map(([key, value]) => `<meta property="${key}" content="${e(value)}">`).join('') +
    stationLocales.map(locale => `<link rel="alternate" hreflang="${locale}" href="${origin}${model.mode === 'detail' ? localizedPath(locale, 'music/tracks', track?.slug || model.detailSlug) : stationHref(locale, 'music')}">`).join('');
}
async function template(request, env, model, status) {
  if (typeof env.ASSETS?.fetch !== 'function') return failurePage(request, { locale: model.locale, kind: model.mode === 'detail' ? 'detail' : 'catalog', slug: model.detailSlug }, 503);
  const asset = await env.ASSETS.fetch(new Request(new URL('/music/site-shell/' + model.locale + '/', request.url), { headers: { Accept: 'text/html' } }));
  if (asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) { await asset.body?.cancel(); throw new Error('MISSING_SHELL'); }
  // One known static shell, bounded before passing it to the streaming rewriter.
  const html = await readMusicResponse(asset, 128 * 1024);
  if (!html.includes('data-sc-music-page') || !html.includes('data-sc-music-audio')) throw new Error('MISSING_SHELL');
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const rewriter = new HTMLRewriter()
    .on('title, meta[name="description"], meta[name="robots"], link[rel="canonical"], link[rel="alternate"], meta[property^="og:"], meta[name^="twitter:"]', { element(node) { node.remove(); } })
    .on('head', { element(node) { node.append(pageMetadata(model), { html: true }); } })
    .on('[data-sc-language]', { element(node) {
      node.setAttribute('href', stationLanguageHref(node.getAttribute('data-sc-language'), new URL(request.url).pathname));
    } })
    .on('[data-sc-music-page]', { element(node) { node.setInnerContent(renderMusicPage(model), { html: true }); } })
    .on('body', { element(node) { node.append('<script id="sc-music-bootstrap" type="application/json">' + musicBootstrap(model) + '</script>', { html: true }); } });
  return rewriter.transform(new Response(html, { status, headers }));
}

// Called before the old namespace matcher. Returning null preserves the old
// handler for collections, unmapped UUID shares and unknown descendants.
export async function handleStationMusicPage(request, env, { clock = Date.now, deadlineMs = 10000 } = {}) {
  const url = new URL(request.url), route = stationMusicRoute(url.pathname);
  if (isStationMusicTemplate(url.pathname)) return new Response(null, { status: 404, headers });
  if (!route) return null;
  if (!enabled(env.STATION_MUSIC_PAGES_ENABLED)) return route.kind === 'detail' ? failurePage(request, route) : null;
  if (!['GET', 'HEAD'].includes(request.method)) return failurePage(request, route, 405);
  if (!enabled(env.STATION_CONTENT_PUBLIC_ENABLED)) return failurePage(request, route);
  const end = Date.now() + deadlineMs, run = requestDeadline(deadlineMs);
  const get = async path => {
    const response = await handleStationContent(new Request(new URL(contentBase + path, request.url),
      { method: 'GET', headers: request.headers, cf: request.cf }), env,
      { clock, deadlineMs: Math.max(1, Math.min(10000, end - Date.now())) });
    const body = JSON.parse(await readMusicResponse(response));
    if (!response.ok) throw Object.assign(new Error('CONTENT_QUERY_FAILED'), { status: response.status, code: body.code });
    return body;
  };
  try {
    const legacy = musicSelection(url.search);
    if (route.kind === 'catalog' && (url.searchParams.has('track') || url.searchParams.has('collection'))) {
      if (legacy.has('collection') || !legacy.has('track')) return null;
      const runtime = await run(() => checkedContentRuntime(env));
      const limited = await run(() => checkMusicRateLimit(request, env, 'catalog', { clock, timeoutMs: 1500 }));
      if (limited) return failurePage(request, route, limited.status);
      const row = await run(() => contentTrack(runtime.session, clock(), { id: legacy.get('track') }));
      if (!row) return null;
      let detail;
      try { detail = await run(() => get('/tracks/' + row.slug + '?locale=' + route.locale)); }
      catch (error) { if (error.status === 404) return null; throw error; }
      const campaign = tracking(url).toString();
      return redirect(request, detail.track.href + (campaign ? '?' + campaign : ''));
    }
    if (route.kind === 'legacy') {
      let detail;
      try { detail = await run(() => get('/tracks/' + route.slug + '?locale=' + route.locale)); }
      catch (error) { if (error.status === 404) return null; throw error; }
      const campaign = tracking(url).toString();
      return redirect(request, detail.track.href + (campaign ? '?' + campaign : ''));
    }
    let model, status = 200;
    if (route.kind === 'catalog') {
      const query = catalogInput(url), target = new URL(musicCatalogHref(route.locale, query), url.origin);
      for (const [key, value] of tracking(url)) target.searchParams.set(key, value);
      if (url.pathname + url.search !== target.pathname + target.search) return redirect(request, target.pathname + target.search);
      const params = new URLSearchParams({ locale: route.locale, limit: '20', sort: query.sort });
      if (query.q) params.set('q', query.q); if (query.cursor) params.set('cursor', query.cursor);
      model = { mode: 'catalog', locale: route.locale, query, items: [], nextCursor: null, featured: null, selected: [], error: null };
      try {
        const body = await run(() => get('/tracks?' + params)); model.items = body.items; model.nextCursor = body.nextCursor;
      } catch (error) { model.error = { status: error.status || 503 }; status = model.error.status; }
      if (!model.error && !query.q && !query.cursor) {
        try {
          const { home } = await run(() => get('/home?locale=' + route.locale));
          if (home.music) {
            const name = home.music.href.split('/').at(-2);
            model.featured = (await run(() => get('/tracks/' + name + '?locale=' + route.locale))).track;
          }
          model.selected = home.selectedTracks;
        } catch { /* No latest-free substitute for unready/unpublished curation. */ }
      }
    } else {
      model = { mode: 'detail', locale: route.locale, detailSlug: route.slug, track: null, related: [], clips: [], error: null };
      try {
        const detail = await run(() => get('/tracks/' + route.slug + '?locale=' + route.locale)); model.track = detail.track; model.related = detail.related.slice(0, 3);
        const campaign = tracking(url).toString(), target = detail.track.href + (campaign ? '?' + campaign : '');
        if (url.pathname + url.search !== target) return redirect(request, target);
        try { model.clips = (await run(() => get('/tracks/' + model.track.slug + '/clips?locale=' + route.locale + '&limit=4'))).items; }
        catch { model.clipsError = true; }
      } catch (error) { model.error = { status: error.status || 503 }; status = model.error.status; }
    }
    return await run(() => template(request, env, model, status));
  } catch (error) { return failurePage(request, route, [400, 404, 405, 429].includes(error.status) ? error.status : 503); }
}
