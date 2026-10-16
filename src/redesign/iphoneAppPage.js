import { iphoneAppHref } from './iphoneApp.js';
import { stationLanguageHref } from './routes.js';
import { readMusicResponse } from './musicResponse.js';

// A static introduction remains available even when the music database is down.
// It never grants playback access or reads account/content data.
export async function renderIphoneAppPage(request, env, route) {
  const url = new URL(request.url), href = iphoneAppHref(route.locale);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
  if (url.pathname !== href || url.search) return new Response(null, { status: 302, headers: { ...headers, Location: href } });
  if (typeof env.ASSETS?.fetch !== 'function') throw new Error('MISSING_IPHONE_SHELL');
  const source = await env.ASSETS.fetch(new Request(new URL('/music/site-shell/iphone/' + route.locale + '/', url)));
  if (source.status !== 200 || !source.headers.get('content-type')?.includes('text/html')) {
    await source.body?.cancel(); throw new Error('MISSING_IPHONE_SHELL');
  }
  const html = await readMusicResponse(source, 128 * 1024);
  if (!html.includes('data-sc-iphone-page')) throw new Error('MISSING_IPHONE_SHELL');
  if (request.method === 'HEAD') return new Response(null, { headers });
  return new HTMLRewriter().on('[data-sc-language]', { element(node) {
    node.setAttribute('href', stationLanguageHref(node.getAttribute('data-sc-language'), href));
  } }).transform(new Response(html, { headers }));
}
