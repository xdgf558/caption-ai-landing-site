import { routeMigrationEnabled, migrationPath, migrationServicePath, publicSearchRoute, brandHref, routeParts, flagOn, legacyFamily, chapterRoute } from './routeMigrationPaths.js';
import { stationCopy, stationSections, stationLanguageHref, stationHref } from './routes.js';
import { escapeMusicHtml as e } from './musicRender.js';
import { legacyContentClosed, closedLegacyExtraPage } from './legacyClosure.js';

export const searchOrigin = url => ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ? url.origin : 'https://wwwstationcat.org';
// The real production host and a separately reviewed switch are both required.
export const searchIndexing = (url, env) => url.origin === 'https://wwwstationcat.org' && flagOn(env.STATION_SEARCH_INDEXING_ENABLED);
const selectors = 'meta[name="robots"], link[rel="canonical"], link[rel="alternate"][hreflang]';
export function applyMigrationMetadata(request, env, response) {
  if (!routeMigrationEnabled(env) || !['GET','HEAD'].includes(request.method)) return response;
  const url = new URL(request.url), path = migrationPath(url.pathname);
  if (!path || /^\/(?:api|admin|admin-v2|auth|downloads|music\/site-shell|games\/cat-life)(?:\/|$)/.test(path) ||
    !response.headers.get('content-type')?.includes('text/html') || response.status !== 200) return response;
  const route = publicSearchRoute(path), collection = url.searchParams.has('collection');
  const indexable = route && !collection && !['q','sort','cursor'].some(key => url.searchParams.has(key)) && searchIndexing(url, env);
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store'); headers.set('X-Content-Type-Options', 'nosniff');
  headers.delete('Content-Length'); headers.delete('ETag');
  if (indexable) headers.delete('X-Robots-Tag'); else headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (request.method === 'HEAD') return new Response(null, { status: response.status, statusText: response.statusText, headers });
  const locale = route?.locale || routeParts(path).locale, copy = stationCopy[locale], origin = searchOrigin(url);
  const links = stationSections.map(section => `<a href="${brandHref(locale, section)}">${e(copy[section])}</a>`).join('');
  const metadata = `<meta name="robots" content="${indexable ? 'index,follow' : 'noindex,nofollow'}">` +
    (route && !collection ? `<link rel="canonical" href="${e(origin + route.href)}">` + route.alternates.map(([lang, href]) =>
      `<link rel="alternate" hreflang="${lang}" href="${e(origin + href)}">`).join('') : '');
  const rewrite = new HTMLRewriter()
    .on(selectors, { element(node) { node.remove(); } })
    .on('head', { element(node) { node.append(metadata, { html: true }); } })
    .on('html', { element(node) { node.setAttribute('data-sc-route-profile', 'brand'); } })
    .on('[data-sc-language]', { element(node) { const lang = node.getAttribute('data-sc-language'); node.setAttribute('href', stationLanguageHref(lang, path, url.search, { brandRoutes: true })); } })
    .on('.night-desktop-nav, .night-mobile-menu > nav, .site-header .nav-links', { element(node) { node.setInnerContent(links, { html: true }); } })
    .on('.night-footer nav, .site-footer .footer-links', { element(node) {
      node.setInnerContent(links +
        `<a href="/${locale === 'zh-Hans' ? 'zh-hans' : locale === 'zh-Hant' ? 'zh-hant' : locale}/privacy/">${e(copy.privacy)}</a>` +
        `<a href="/${locale === 'zh-Hans' ? 'zh-hans' : locale === 'zh-Hant' ? 'zh-hant' : locale}/terms/">${e(copy.terms)}</a>`, { html: true });
    } })
    .on('a[href]', { element(node) {
      if (node.getAttribute('data-sc-language') !== null) return;
      const raw = node.getAttribute('href');
      if (!raw?.startsWith('/') || raw.startsWith('//')) return;
      let target; try { target = new URL(raw, origin); } catch { return; }
      const targetPath = migrationPath(target.pathname);
      if (!targetPath) return;
      const parts = routeParts(targetPath);
      if (parts.segments.length === 1 && parts.segments[0] === 'about') node.setAttribute('href', brandHref(locale, 'about'));
      const family = legacyFamily(targetPath);
      if (legacyContentClosed(env) && (chapterRoute(targetPath) || closedLegacyExtraPage(targetPath))) {
        node.removeAndKeepContent(); return;
      }
      if (family && !migrationServicePath(targetPath) && !chapterRoute(targetPath)) {
        if (family.game) node.setAttribute('href', brandHref(family.explicit ? family.locale : 'en', 'games') + 'cat-life-game/');
        else node.removeAndKeepContent();
      }
    } });
  return rewrite.transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}
