import worker from '../../src/worker.js';
export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url), match = /^\/fixture-member-(on|no-assets|no-readers|off)(?=\/)/.exec(url.pathname);
    if (!match) return worker.fetch(request, env, ctx);
    url.pathname = url.pathname.slice(match[0].length);
    return worker.fetch(new Request(url, request), { ...env,
      STATION_MEMBER_PAGES_ENABLED: match[1] === 'off' ? 'false' : 'true',
      ...(match[1] === 'no-assets' ? { ASSETS: null } : {}),
      ...(match[1] === 'no-readers' ? { WAITLIST_DB: env.EMPTY_DB } : {}) }, ctx);
  }
};
