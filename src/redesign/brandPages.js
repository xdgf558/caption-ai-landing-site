import { checkedContentRuntime, contentClip, requestDeadline } from './publicStore.js';
import { publicHome, projectClip } from './publicContent.js';
import { renderBrandHomeSlots } from './brandHomeRender.js';
import { readMusicResponse } from './musicResponse.js';
import { checkMusicRateLimit } from '../music/rateLimits.js';
import { stationHref } from './routes.js';
export async function renderBrandPage(request, env, route, { clock = Date.now, deadlineMs = 10000 } = {}) {
  const run = requestDeadline(deadlineMs), now = clock();
  let home, clips = [];
  if (route.section === 'home') {
    const runtime = await run(() => checkedContentRuntime(env));
    const limited = await run(() => checkMusicRateLimit(request, env, 'catalog', { clock, timeoutMs: 1500 }));
    if (limited) throw Object.assign(new Error('CATALOG_ADMISSION_FAILED'), { status: limited.status });
    const options = { locale: route.locale, now, run, country: request.cf?.country || request.headers.get('CF-IPCountry') || '' };
    home = await publicHome(runtime, options);
    for (const card of home.clips) {
      const row = await run(() => contentClip(runtime.session, now, card.id));
      const projected = await projectClip(runtime, row, options);
      if (projected) clips.push(projected.dto);
    }
  }
  if (typeof env.ASSETS?.fetch !== 'function') throw new Error('MISSING_BRAND_SHELL');
  const source = await run(() => env.ASSETS.fetch(new Request(new URL('/music/site-shell/brand-' + route.section + '/' + route.locale + '/', request.url))));
  if (source.status !== 200 || !source.headers.get('content-type')?.includes('text/html')) { await source.body?.cancel(); throw new Error('MISSING_BRAND_SHELL'); }
  const html = await run(() => readMusicResponse(source, 128 * 1024));
  if (!html.includes(route.section === 'home' ? 'data-home-slot=' : 'data-sc-brand-about')) throw new Error('MISSING_BRAND_SHELL');
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'CF-IPCountry' };
  if (request.method === 'HEAD') return new Response(null, { headers });
  if (!home) return new Response(html, { headers });
  const slots = renderBrandHomeSlots(home, clips);
  const rewriter = new HTMLRewriter()
    .on('[data-home-slot]', { element(node) { const name = node.getAttribute('data-home-slot'); if (Object.hasOwn(slots, name)) node.setInnerContent(slots[name], { html: true }); } })
    .on('[data-home-config]', { element(node) { node.setAttribute('data-home-config', home.configId); if (home.publishedRevision) node.setAttribute('data-home-revision', String(home.publishedRevision)); else node.removeAttribute('data-home-revision'); } })
    .on('[data-home-hero-music]', { element(node) { if (home.music) node.setAttribute('href', home.music.href); } })
    .on('[data-home-hero-game]', { element(node) { if (home.game) node.setAttribute('href', home.game.href); } })
    .on('[data-home-pillar]', { element(node) {
      const name = node.getAttribute('data-home-pillar');
      if (name === 'music') node.setAttribute('href', home.music?.href || stationHref(home.locale, 'music'));
      if (name === 'headphones') node.setAttribute('href', home.music ? '#station-platforms' : stationHref(home.locale, 'music'));
      if (name === 'youtube') node.setAttribute('href', home.clips.length ? '#station-clips' : stationHref(home.locale, 'music'));
    } })
    .on('#sc-home-clips-bootstrap', { element(node) { node.setInnerContent(slots.bootstrap, { html: true }); } });
  return rewriter.transform(new Response(html, { headers }));
}
