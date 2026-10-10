import { flagOn, routeMigrationEnabled, routeParts } from './routeMigrationPaths.js';

// The first public launch closes the old website content. Existing account,
// payment settlement, mobile clients and game save handlers remain separate.
// This extra switch alone must never retire a page before its replacements.
export const legacyContentClosed = env => routeMigrationEnabled(env) && flagOn(env.STATION_LEGACY_CONTENT_CLOSED);

const closedApis = new Set([
  '/api/content/entries', '/api/content/body', '/api/content/media',
  '/api/novels/access', '/api/novels/chapters/protected-content',
  '/api/novels/pricing', '/api/novels/comments', '/api/novels/credits/unlock',
  '/api/novels/reading-events', '/api/readers/comments',
]);
export const closedLegacyApi = path => closedApis.has(path.replace(/\/$/, ''));

// Product download/help/legal pages belonged to the retired product website.
// General site privacy/terms/support and account services remain separate.
export function closedLegacyExtraPage(path) {
  const { segments: s } = routeParts(path);
  return /^\/downloads(?:\/|$)/.test(path) ||
    ['android', 'download'].includes(s[0]) ||
    (s[0] === 'apps' && s.length >= 3 && ['download', 'android', 'privacy', 'terms', 'support'].includes(s[2]));
}

export function legacyContentGone(request) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({
    ok: false, code: 'LEGACY_CONTENT_CLOSED', message: 'This website content has been retired.',
  }), { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff' } });
}

// The old checkout URL also sells Station Points used by the game. Preserve
// that existing product rather than blocking the entire shared endpoint.
export function closedLegacyCheckout(env, payload) {
  if (!legacyContentClosed(env)) return false;
  const type = typeof payload?.orderType === 'string' ? payload.orderType.trim().toLowerCase() : '';
  return !['credit-pack', 'credits'].includes(type) || Boolean(payload?.seriesSlug);
}
