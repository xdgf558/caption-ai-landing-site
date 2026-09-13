import { isMusicPublicPath } from './publicHttp.js';
import { isMusicMediaPath } from './mediaResponse.js';

const staticPaths = new Set([
  '/favicon.ico',
  '/favicon-64.png',
  '/apple-touch-icon.png',
  '/images/optimized/station-cat-logo-1668c2e5-160.webp',
  '/images/music-turntable-silver.webp',
  '/styles/admin-music.css',
  '/styles/admin-music-batch.css',
  '/styles/admin-music-collections.css',
  '/styles/admin-music-featured.css',
  '/images/apps/mindbudget/warm-botanical.png',
  '/images/apps/snapcopy-app-icon.png',
  '/vendor/music-mp3/NOTICE.txt',
  '/vendor/music-mp3/lamejs-1.2.7.js'
]);

const pagePaths = new Set([
  '/admin/music',
  '/admin/music/collections',
  '/admin/music/collections/upload',
  '/admin/music/featured',
  '/music',
  '/en/music',
  '/ja/music',
  '/zh-hans/music'
]);

const astroAssets = [
  /^\/_astro\/(?:music|collections|featured|index)\.astro_astro_type_script_index_0_lang\.[A-Za-z0-9_-]+\.js$/,
  /^\/_astro\/(?:LanguageSwitcher|MusicPlayer)\.astro_astro_type_script_index_0_lang\.[A-Za-z0-9_-]+\.js$/,
  /^\/_astro\/(?:musicAdminClient|musicMessages|musicPlayerCatalog|musicWavClient|navigation|pagePaths)\.[A-Za-z0-9_-]+\.js$/,
  /^\/_astro\/musicWavWorker-[A-Za-z0-9_-]+\.js$/,
  /^\/_astro\/index\.[A-Za-z0-9_-]+\.css$/
];

export function musicStagingCanonicalPath(pathname) {
  const value = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return pagePaths.has(value) ? `${value}/` : null;
}

export function isMusicStagingRequest(request) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (musicStagingCanonicalPath(url.pathname)) {
    return method === 'GET' || method === 'HEAD';
  }

  if (url.pathname === '/admin/api/music' || url.pathname.startsWith('/admin/api/music/')) {
    return ['GET', 'HEAD', 'POST', 'PATCH', 'PUT'].includes(method);
  }

  if (method !== 'GET' && method !== 'HEAD') return false;
  if (isMusicPublicPath(url.pathname) || isMusicMediaPath(url.pathname)) return true;
  if (staticPaths.has(url.pathname)) return true;
  return astroAssets.some((pattern) => pattern.test(url.pathname));
}

// Access is the outer staging gate. The shared music handlers still check a
// separate, opaque reader session against the isolated staging identity DB.
// Never forward the production reader cookie or fall back to WAITLIST_DB.
export function musicStagingReaderRequest(request) {
  const headers = new Headers(request.headers);
  const cookie = (headers.get('Cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith('station_cat_music_staging_session='));
  headers.delete('Cookie');
  if (cookie !== undefined) {
    headers.set('Cookie', `station_cat_reader_session=${cookie.slice('station_cat_music_staging_session='.length)}`);
  }
  return new Request(request, { headers });
}

export function musicStagingResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  const vary = new Set((headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean));
  vary.add('Cookie');
  vary.add('Cf-Access-Jwt-Assertion');
  headers.set('Vary', [...vary].join(', '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
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
