import { checkedContentRuntime, sitemapBoundaries, sitemapRecords, requestDeadline } from './publicStore.js';
import { projectTrack, projectGame } from './publicContent.js';
import { stationLocales } from './routes.js';
import { brandHref } from './routeMigrationPaths.js';
import { searchOrigin, searchIndexing } from './searchMetadata.js';
import { checkMusicRateLimit } from '../music/rateLimits.js';
import { escapeMusicHtml as e } from './musicRender.js';
import { localizedPath, uuid } from './publicValidation.js';
const pageSize = 10;
const namespace = 'http://www.sitemaps.org/schemas/sitemap/0.9';
export const isStationSearchPath = path => path === '/robots.txt' || path === '/sitemap.xml' || /^\/sitemaps\//.test(path);
const xml = body => '<?xml version="1.0" encoding="UTF-8"?>\n' + body;
function reply(request, body, type, indexing) {
  return new Response(request.method === 'HEAD' ? null : body, { headers: {
    'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    ...(indexing ? {} : { 'X-Robots-Tag': 'noindex, nofollow' }) } });
}
function urls(paths, origin) {
  return xml(`<urlset xmlns="${namespace}" xmlns:xhtml="http://www.w3.org/1999/xhtml">` + paths.map(group =>
    group.map(([lang, href]) => `<url><loc>${e(origin + href)}</loc>` + group.map(([alternate, target]) =>
      `<xhtml:link rel="alternate" hreflang="${alternate}" href="${e(origin + target)}"/>`).join('') + '</url>').join('')).join('') + '</urlset>');
}
export async function handleStationSearch(request, env, { clock = Date.now, deadlineMs = 10000 } = {}) {
  const url = new URL(request.url), origin = searchOrigin(url), indexing = searchIndexing(url, env);
  if (url.pathname === '/robots.txt') {
    // Production retirees remain crawlable so their actual 404/410 can be seen.
    return reply(request, indexing ? `User-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /admin-v2/\nDisallow: /music/site-shell/\nSitemap: ${origin}/sitemap.xml\n` : 'User-agent: *\nDisallow: /\n', 'text/plain', indexing);
  }
  const shard = /^\/sitemaps\/(base|tracks-[1-9]\d{0,3}|games-[1-9]\d{0,3})\.xml$/.exec(url.pathname);
  if (url.pathname !== '/sitemap.xml' && !shard) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if ([...url.searchParams.keys()].some(key => !['at','from','until'].includes(key)) || ['at','from','until'].some(key => url.searchParams.getAll(key).length > 1)) throw Object.assign(new Error(), { status: 400 });
  const now = clock(), raw = url.searchParams.get('at'), at = raw === null ? now : Number(raw);
  if ((raw !== null && !/^\d{1,16}$/.test(raw)) || !Number.isSafeInteger(at) || at < 0 || at > now) throw Object.assign(new Error(), { status: 400 });
  const run = requestDeadline(deadlineMs), runtime = await run(() => checkedContentRuntime(env));
  const limited = await run(() => checkMusicRateLimit(request, env, 'catalog', { clock, timeoutMs: 1500 }));
  if (limited) throw Object.assign(new Error('CATALOG_ADMISSION_FAILED'), { status: limited.status });
  if (url.pathname === '/sitemap.xml') {
    const shards = ['/sitemaps/base.xml?at=' + at];
    if (url.searchParams.has('from') || url.searchParams.has('until')) throw Object.assign(new Error(), { status: 400 });
    const boundaries = await run(() => sitemapBoundaries(runtime.session, at));
    for (const [index, kind] of ['tracks','games'].entries()) {
      const rows = boundaries[index];
      if (rows.some(row => !uuid(row.id))) throw new Error('INVALID_SITEMAP_BOUNDARY');
      for (let start = 0; start < rows.length; start += pageSize) {
        const query = new URLSearchParams({ at: String(at), from: rows[start].id });
        if (rows[start + pageSize]) query.set('until', rows[start + pageSize].id);
        shards.push(`/sitemaps/${kind}-${start / pageSize + 1}.xml?${query}`);
      }
    }
    return reply(request, xml(`<sitemapindex xmlns="${namespace}">` + shards.map(path => `<sitemap><loc>${e(origin + path)}</loc></sitemap>`).join('') + '</sitemapindex>'), 'application/xml', indexing);
  }
  if (shard[1] === 'base' && (url.searchParams.has('from') || url.searchParams.has('until'))) throw Object.assign(new Error(), { status: 400 });
  if (shard[1] === 'base') return reply(request, urls(['home','music','games','about'].map(section => stationLocales.map(lang => [lang, brandHref(lang, section)])), origin), 'application/xml', indexing);
  const [kind, page] = shard[1].split('-'), from = url.searchParams.get('from'), until = url.searchParams.get('until');
  if (Number(page) > 1000) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (!uuid(from) || (until !== null && (!uuid(until) || from >= until))) throw Object.assign(new Error(), { status: 400 });
  const rows = await run(() => sitemapRecords(runtime.session, { kind, now, at, from, until, limit: pageSize + 1 })), paths = [];
  // Stable ID intervals prevent a withdrawal in one shard from skipping a
  // different song in the next. A changed/overfull interval fails, not truncates.
  if (rows.length > pageSize) throw new Error('SITEMAP_RANGE_CHANGED');
  const options = { locale: 'zh-Hant', now, run, country: '' };
  for (const row of rows) {
    const value = await (kind === 'tracks' ? projectTrack(runtime, row, options) : projectGame(runtime, row, options));
    if (value) paths.push(stationLocales.map(lang => [lang, localizedPath(lang, kind === 'tracks' ? 'music/tracks' : 'games', value.dto.slug)]));
  }
  return reply(request, urls(paths, origin), 'application/xml', indexing);
}
