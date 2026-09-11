import { musicPageHref, musicPageLocale } from './pagePaths.js';

// Gate the HTML before ASSETS: disabled pages never read D1/R2 or even static assets.
export async function handleMusicPage(request, env) {
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
    const response = await env.ASSETS.fetch(request);
    const out = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) out.set(key, value);
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: out });
  } catch { return error(503, 'MUSIC_PAGE_UNAVAILABLE'); }
}
