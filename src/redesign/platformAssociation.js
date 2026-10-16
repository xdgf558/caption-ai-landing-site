// Public catalog navigation is independent of native auth, media, sync and
// webcredentials. Enabling it requires a separate reviewed deployment.
export const platformAppLinkProfile = 'station-cat-music-platform-links-v1';
export const platformAppID = '2AM5S7BM2N.org.stationcat.music';
const origin = 'https://wwwstationcat.org';
const prefixes = ['', '/zh-hant', '/zh-hans', '/en', '/ja'];
export function platformAssociation(request, env) {
  const url = new URL(request.url);
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (url.origin !== origin || url.pathname !== '/.well-known/apple-app-site-association' || url.search) {
    return new Response('Not found', { status: 404, headers });
  }
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  if (env.STATION_PUBLIC_APP_LINKS_ENABLED !== 'true' || env.STATION_PUBLIC_APP_LINKS_PROFILE !== platformAppLinkProfile ||
      ![true, 'true'].includes(env.STATION_CONTENT_PUBLIC_ENABLED)) return new Response('Links unavailable', { status: 503, headers });
  const components = [
    { '#': '?*', exclude: true },
    { '/': '*%*', exclude: true },
    ...prefixes.flatMap(prefix => {
      const base = prefix + '/music/tracks/';
      return [
        { '/': base + '*/?*', exclude: true }, // No nested song descendants.
        { '/': base + '/', exclude: true },
        { '/': base + '?*' }, // One nonempty song path, optional terminal slash.
        ...['/music', '/music/'].map(path => ({ '/': prefix + path, '?': { track: '????????-????-????-????-????????????' } }))
      ];
    })
  ];
  // AASA handles delivery only; the app additionally validates slug, UUID,
  // exact origin, duplicate/unknown queries, UTM lengths and encoded aliases.
  const body = JSON.stringify({ applinks: { details: [{ appIDs: [platformAppID], components }] } });
  return new Response(request.method === 'HEAD' ? null : body, { headers: { ...headers, 'Content-Type': 'application/json' } });
}
