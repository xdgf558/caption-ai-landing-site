import worker from '../../src/worker.js';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = /^\/fixture-(pages-on|pages-only|content-only|pages-no-db|pages-no-assets)(?=\/)/.exec(url.pathname);
    if (!match) return worker.fetch(request, env, ctx);
    url.pathname = url.pathname.slice(match[0].length);
    const local = { ...env, STATION_CONTENT_PUBLIC_ENABLED: match[1] === 'pages-only' ? 'false' : 'true',
      STATION_GAME_PAGES_ENABLED: match[1] === 'content-only' ? 'false' : 'true',
      STATION_MUSIC_PAGES_ENABLED: match[1] === 'content-only' ? 'false' : 'true',
      ...(match[1] === 'pages-no-db' ? { MUSIC_DB: env.EMPTY_DB } : {}),
      ...(match[1] === 'pages-no-assets' ? { ASSETS: null } : {}) };
    return worker.fetch(new Request(url, request), local, ctx);
  }
};
