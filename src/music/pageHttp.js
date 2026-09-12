import { musicPageHref, musicPageLocale } from './pagePaths.js';
import { handleMusicPublic } from './publicHttp.js';
import { musicShareMetadata } from './shareCard.js';

export function rewriteMusicShareMetadata(response, metadata) {
  return new HTMLRewriter().on('title, link[rel="canonical"], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"]', {
    element(element) { element.remove(); }
  }).on('head', { element(element) { element.append(metadata, { html: true }); } }).transform(response);
}

// Gate the HTML before ASSETS: disabled pages never read D1/R2 or even static assets.
export async function handleMusicPage(request, env, { clock = Date.now } = {}) {
  const url = new URL(request.url), headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
  const error = (status, code) => new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: { code } }), {
    status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) }
  });
  if (!['GET', 'HEAD'].includes(request.method)) return error(405, 'METHOD_NOT_ALLOWED');
  if (env.MUSIC_PUBLIC_ENABLED !== 'true') return error(503, 'MUSIC_PUBLIC_DISABLED');
  if (!/^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music\/?$/.test(url.pathname)) return error(404, 'NOT_FOUND');
  const target = musicPageHref(musicPageLocale(url.pathname), url.search);
  if (url.pathname + url.search !== target) return new Response(null, { status: 302, headers: { ...headers, Location: target } });
  if (!env.ASSETS?.fetch) return error(503, 'MUSIC_PAGE_UNAVAILABLE');
  try {
    let metadata = null;
    if (env.MUSIC_SHARE_CARDS_ENABLED === 'true' && url.searchParams.has('track')) {
      const locale = musicPageLocale(url.pathname);
      const publicUrl = new URL(`/api/music/tracks/${url.searchParams.get('track')}?locale=${locale}`, url.origin);
      const forwarded = new Headers();
      if (request.headers.has('CF-Connecting-IP')) forwarded.set('CF-Connecting-IP', request.headers.get('CF-Connecting-IP'));
      const detail = await handleMusicPublic(new Request(publicUrl, { headers: forwarded }), env, { clock });
      if (!detail.ok) {
        // No stale or generic song card on unpublished/missing/limited publication reads.
        return new Response(request.method === 'HEAD' ? null : detail.body, { status: detail.status, headers: { ...Object.fromEntries(detail.headers), ...headers } });
      }
      metadata = musicShareMetadata((await detail.json()).track, url.origin, locale);
    }
    // Dynamic metadata cannot use an ASSETS 304 or ranged body.
    const assetHeaders = new Headers(request.headers);
    for (const key of ['If-None-Match', 'If-Modified-Since', 'Range', 'If-Range']) assetHeaders.delete(key);
    let response = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: assetHeaders }));
    if (metadata && response.status === 200 && response.headers.get('content-type')?.includes('text/html')) response = rewriteMusicShareMetadata(response, metadata);
    const out = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) out.set(key, value);
    if (metadata) for (const key of ['Content-Length', 'ETag', 'Last-Modified']) out.delete(key);
    if (request.method === 'HEAD') { try { response.body?.cancel()?.catch(() => {}); } catch {} }
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: out });
  } catch { return error(503, 'MUSIC_PAGE_UNAVAILABLE'); }
}
