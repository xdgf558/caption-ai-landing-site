import worker from '../../src/worker.js';

// Local test/preview entry only. Authentication is the real Worker Access-JWT
// verifier; the harness supplies its own synthetic signing key and certificate.
export default { async fetch(request, env, ctx) {
  const url = new URL(request.url), match = /^\/fixture-(off|music-only|media-only|empty|wrong)(?=\/)/.exec(url.pathname);
  let local = env;
  if (match) {
    url.pathname = url.pathname.slice(match[0].length);
    local = { ...env, MUSIC_UPLOADS_ENABLED: match[1] === 'media-only' || match[1] === 'off' ? 'false' : 'true',
      STATION_MEDIA_UPLOADS_ENABLED: match[1] === 'music-only' || match[1] === 'off' ? 'false' : 'true',
      ...(match[1] === 'empty' ? { MUSIC_DB: env.EMPTY_DB } : {}),
      ...(match[1] === 'wrong' ? { MUSIC_DB: env.WAITLIST_DB } : {}) };
    request = new Request(url, request);
  }
  return worker.fetch(request, local, ctx);
} };
