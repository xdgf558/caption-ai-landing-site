import { memberCopy } from './memberCopy.js';
import { readMusicResponse } from './musicResponse.js';
import { escapeMusicHtml as e } from './musicRender.js';
import { requestDeadline } from './publicStore.js';
import { stationHref } from './routes.js';
import { eventPageConfiguration } from './analyticsModel.js';

const locales = { en: 'en', ja: 'ja', 'zh-hans': 'zh-Hans', 'zh-hant': 'zh-Hant' };
const headers = Object.freeze({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
function normalized(path) { try { return decodeURIComponent(path).replace(/\\/g, '/').replace(/\/{2,}/g, '/'); } catch { return ''; } }
export function stationMemberRoute(path) {
  const match = /^\/(?:((?:en|ja|zh-hans|zh-hant))\/)?library\/?$/.exec(normalized(path));
  return match ? { locale: locales[match[1]] || 'zh-Hant' } : null;
}
export const isStationMemberTemplate = path => /^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?member\/site-shell(?:\/|$)/.test(normalized(path));
function failure(request, locale, status) {
  const copy = memberCopy[locale];
  return new Response(request.method === 'HEAD' ? null : `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>${e(copy.title)}</title></head><body><main><h1>${e(copy.title)}</h1><p>${e(copy.identityError)}</p><a href="${stationHref(locale, 'member')}">${e(copy.retry)}</a></main></body></html>`,
    { status, headers: { ...headers, ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) } });
}
export async function handleStationMemberPage(request, env, { deadlineMs = 10000 } = {}) {
  const url = new URL(request.url);
  if (isStationMemberTemplate(url.pathname)) return new Response(null, { status: 404, headers });
  const route = stationMemberRoute(url.pathname);
  if (!route) return null;
  // This is a shell for the existing reader services, independent of MUSIC_DB
  // and the public content flag. A disabled rollout never reads any binding.
  if (env?.STATION_MEMBER_PAGES_ENABLED !== true && env?.STATION_MEMBER_PAGES_ENABLED !== 'true') return null;
  if (!['GET', 'HEAD'].includes(request.method)) return failure(request, route.locale, 405);
  const canonical = stationHref(route.locale, 'member');
  if (url.pathname !== canonical) return new Response(null, { status: 301, headers: { ...headers, Location: canonical + url.search } });
  const run = requestDeadline(deadlineMs);
  try {
    const asset = await run(() => env.ASSETS?.fetch(new Request(new URL('/member/site-shell/' + route.locale + '/', request.url))));
    if (!asset || asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) {
      await asset?.body?.cancel(); throw new Error('MISSING_MEMBER_SHELL');
    }
    const html = await run(() => readMusicResponse(asset, 256 * 1024));
    if (!html.includes('data-sc-member-services') || !html.includes('id="reader-login-form"')) throw new Error('MISSING_MEMBER_SHELL');
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    const origin = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? url.origin : 'https://wwwstationcat.org';
    // Query strings may contain old order/reset tokens. They are never embedded
    // in metadata or shared across languages by this shell.
    return new HTMLRewriter()
      .on('link[rel="canonical"]', { element(node) { node.remove(); } })
      .on('head', { element(node) { node.append(`<link rel="canonical" href="${e(origin + canonical)}">`, { html: true }); } })
      .on('body', { element(node) { node.append('<script id="sc-event-bootstrap" type="application/json">'+JSON.stringify(eventPageConfiguration(env))+'</script>',{html:true}); } })
      .transform(new Response(html, { headers }));
  } catch { return failure(request, route.locale, 503); }
}
