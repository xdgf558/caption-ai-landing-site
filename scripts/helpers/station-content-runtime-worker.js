// LOCAL TEST ENTRY ONLY. Production imports only src/worker.js; never deploy
// these fixture prefixes, synthetic flags, static binding or sample content.
import websiteWorker from '../../src/worker.js';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    for (const [prefix, overrides] of [
      ['/fixture-enabled', { STATION_CONTENT_PUBLIC_ENABLED: 'true' }],
      ['/fixture-wrong', { STATION_CONTENT_PUBLIC_ENABLED: 'true', MUSIC_DB: env.WAITLIST_DB }],
      ['/fixture-missing-schema', { STATION_CONTENT_PUBLIC_ENABLED: 'true', MUSIC_DB: env.EMPTY_DB }]
    ]) if (url.pathname.startsWith(prefix + '/')) {
      url.pathname = url.pathname.slice(prefix.length);
      return websiteWorker.fetch(new Request(url, request), { ...env, ...overrides }, ctx);
    }
    return websiteWorker.fetch(request, env, ctx);
  }
};
