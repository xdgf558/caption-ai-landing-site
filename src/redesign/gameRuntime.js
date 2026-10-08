import { embeddedGameRequest } from './gameProtocol.js';
const enabled = value => value === true || value === 'true';
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://blockstream.info https://mempool.space; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
// Only the existing, exact runtime gains same-origin framing, after both gates.
// No assets, account services or standalone responses change their policy.
export async function handleStationGameRuntime(request, env) {
  if (!enabled(env.STATION_GAME_PAGES_ENABLED) || !enabled(env.STATION_CONTENT_PUBLIC_ENABLED)) return null;
  if (!['GET', 'HEAD'].includes(request.method) || !embeddedGameRequest(new URL(request.url))) return null;
  const response = await env.ASSETS?.fetch(request);
  if (!response) return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  if (response.status !== 200 || !response.headers.get('Content-Type')?.startsWith('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', policy); headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Cache-Control', 'private, no-store'); headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (request.method === 'HEAD') await response.body?.cancel();
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}
