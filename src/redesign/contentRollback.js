import { migrationPath, routeParts, migrationFlags, brandRoute, publicSearchRoute, legacyFamily } from './routeMigrationPaths.js';
import { closedLegacyApi, closedLegacyExtraPage, closedLegacyCheckout, legacyContentGone } from './legacyClosure.js';
import { closedStationVariables } from '../../scripts/helpers/station-release-flags.mjs';
import { readMusicResponse } from './musicResponse.js';
import { stationMemberRoute, handleStationMemberPage } from './memberPages.js';

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff', 'Retry-After': '300' };
export const contentRollbackEnvironment = env => ({ ...env, ...closedStationVariables, STATION_LEGACY_CONTENT_CLOSED: 'true' });
const checkoutEnvironment = env => ({ ...env, ...Object.fromEntries(migrationFlags.map(key => [key, 'true'])) });
function failure(request, status, code, extra = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: false, code }),
    { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra } });
}
async function maintenancePage(request, env, locale) {
  if (!['GET','HEAD'].includes(request.method)) return failure(request, 405, 'METHOD_NOT_ALLOWED', { Allow: 'GET, HEAD' });
  const responseHeaders = { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': locale };
  if (request.method === 'HEAD') return new Response(null, { status: 503, headers: responseHeaders });
  try {
    const source = await env.ASSETS.fetch(new Request(new URL('/music/site-shell/brand-maintenance/' + locale + '/', request.url)));
    if (source.status !== 200 || !source.headers.get('Content-Type')?.includes('text/html')) {
      await source.body?.cancel(); return failure(request, 503, 'STATION_MAINTENANCE');
    }
    const html = await readMusicResponse(source, 128 * 1024);
    if (!html.includes('data-station-maintenance')) return failure(request, 503, 'STATION_MAINTENANCE');
    return new Response(html, { status: 503, headers: responseHeaders });
  } catch { return failure(request, 503, 'STATION_MAINTENANCE'); }
}
// Dedicated alternative entry point. This profile cannot be disabled by a
// page flag and never reads station_* tables to decide whether old content is
// closed. Production's regular worker.js does not import or activate it.
export function createContentRollbackWorker(existingWorker) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url), path = migrationPath(url.pathname), local = contentRollbackEnvironment(env);
      if (!path) return failure(request, 400, 'INVALID_PATH');
      const { locale, segments } = routeParts(path), family = legacyFamily(path);
      // Actual runtime and all its files keep the existing handler and policy.
      if (/^\/games\/cat-life(?:\/|$)/.test(path)) return existingWorker.fetch(request, local, ctx);
      if (/^(?:\/(?:en|ja|zh-hans|zh-hant))?\/(?:music|games|member)\/site-shell(?:\/|$)/.test(path)) return failure(request, 404, 'NOT_FOUND');
      if (closedLegacyApi(path) || closedLegacyExtraPage(path) || (family && !family.game)) return legacyContentGone(request);
      if (path === '/robots.txt') return new Response(request.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n',
        { headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
      if (/^\/(?:sitemap[^/]*\.xml|sitemaps(?:\/|$))/.test(path)) return failure(request, 404, 'NOT_FOUND');
      if (path.startsWith('/api/station/')) return failure(request, 503, 'STATION_MAINTENANCE');
      // T14's account shell uses only existing reader services and does not
      // query MUSIC_DB. Preserve login/orders and its direct game link even
      // when the public-content schema is unavailable during rollback.
      if (stationMemberRoute(path)) return handleStationMemberPage(request, { ...local, STATION_MEMBER_PAGES_ENABLED: 'true' });
      if (segments[0] === 'music' && (url.searchParams.has('collection') || (!publicSearchRoute(path) && segments.length > 1))) return legacyContentGone(request);
      if (brandRoute(path) || publicSearchRoute(path) || family?.game) return maintenancePage(request, local, locale);
      if (path === '/api/novels/payments/checkout' && request.method === 'POST') {
        let payload; try { payload = await request.clone().json(); } catch { return failure(request, 400, 'INVALID_REQUEST_BODY'); }
        if (closedLegacyCheckout(checkoutEnvironment(local), payload)) return legacyContentGone(request);
      }
      // Classification is never a credential or method grant. Existing
      // handlers still check sessions, Access, payments and media rights.
      return existingWorker.fetch(request, local, ctx);
    },
    scheduled(controller, env, ctx) {
      // Closure's existing scheduled predicate requires the five composition
      // flags; no HTTP request receives these enabled flags. All independent
      // station schedule/analytics/report flags remain closed.
      return existingWorker.scheduled(controller, checkoutEnvironment(contentRollbackEnvironment(env)), ctx);
    },
    queue(batch, env, ctx) { return existingWorker.queue(batch, contentRollbackEnvironment(env), ctx); },
  };
}
