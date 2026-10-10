import worker from '../../src/worker.js';
import { migrationFlags } from '../../src/redesign/routeMigrationPaths.js';
// Local test entry only: never imported by production. No query-based rollout.
export default {
  async fetch(request, env, ctx) {
    const local = { ...env }, mode = request.headers.get('x-sc-fixture-mode');
    if (mode === 'closed') for (const key of migrationFlags) local[key] = 'false';
    if (migrationFlags.includes(mode)) local[mode] = 'false';
    if (mode === 'missing-music-db') local.MUSIC_DB = env.EMPTY_DB;
    if (mode === 'missing-reader-db') local.WAITLIST_DB = env.EMPTY_DB;
    if (mode === 'missing-assets') local.ASSETS = null;
    if (mode === 'bad-rate-secret') local.MUSIC_RATE_LIMIT_SECRET = 'invalid-short-fixture';
    if (mode === 'indexing') local.STATION_SEARCH_INDEXING_ENABLED = 'true';
    const headers = new Headers(request.headers); headers.delete('x-sc-fixture-mode');
    return worker.fetch(new Request(request, { headers }), local, ctx);
  }
};
