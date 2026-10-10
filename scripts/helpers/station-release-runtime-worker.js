import worker from '../../src/worker.js';
import { closedStationVariables } from './station-release-flags.mjs';
import { migrationFlags } from '../../src/redesign/routeMigrationPaths.js';

// Test entrypoint only; production src/worker.js never imports this file. The
// fixture header is stripped and cannot become an application rollout feature.
export default {
  fetch(request, env, ctx) {
    const local = { ...env }, headers = new Headers(request.headers), mode = headers.get('x-sc-t22-fixture');
    headers.delete('x-sc-t22-fixture');
    if (mode === 'rollback') Object.assign(local, closedStationVariables);
    else if (mode === 'statistics-off') local.STATION_EVENTS_ENABLED = 'false';
    else if (migrationFlags.includes(mode)) local[mode] = 'false';
    return worker.fetch(new Request(request, { headers }), local, ctx);
  }
};
