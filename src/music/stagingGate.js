const staticPaths = new Set([
  '/favicon.ico',
  '/images/optimized/station-cat-logo-1668c2e5-160.webp',
  '/styles/admin-music.css'
]);

const staticPrefixes = [
  '/_astro/music.astro_astro_type_script_index_0_lang.'
];

export function isMusicStagingRequest(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (url.pathname === '/admin/music' || url.pathname === '/admin/music/') {
    return method === 'GET' || method === 'HEAD';
  }

  if (url.pathname === '/admin/api/music' || url.pathname.startsWith('/admin/api/music/')) {
    return ['GET', 'HEAD', 'POST', 'PATCH', 'PUT'].includes(method);
  }

  if (method !== 'GET' && method !== 'HEAD') return false;
  if (staticPaths.has(url.pathname)) return true;
  return staticPrefixes.some((prefix) => url.pathname.startsWith(prefix) && url.pathname.endsWith('.js'));
}

export function musicStagingHost(env) {
  return String(env?.MUSIC_STAGING_EXPECTED_HOST || '').trim().toLowerCase();
}

export function musicStagingUnavailable(message = 'Music staging is not available.') {
  return new Response(message, {
    status: 503,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    }
  });
}

export function musicStagingNotFound() {
  return new Response('Not found.', {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    }
  });
}
