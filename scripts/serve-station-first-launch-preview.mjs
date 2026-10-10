import http from 'node:http';
import { Readable } from 'node:stream';
import { createStationRouteRuntime } from './helpers/station-route-runtime.mjs';
import { homeFixture } from './helpers/station-content-fixture.mjs';
import { firstLaunchAssets } from './build-station-first-launch.mjs';

// GET/HEAD-only, loopback and disposable D1/R2. Production never imports this.
const port = 4224, origin = 'http://127.0.0.1:' + port;
const runtime = await createStationRouteRuntime({ assetsDirectory: firstLaunchAssets,
  bindings: { STATION_LEGACY_CONTENT_CLOSED: 'true' } });
await runtime.db.batch([
  runtime.db.prepare("UPDATE station_track_publications SET status='draft'"),
  runtime.db.prepare("UPDATE station_promotions SET status='draft'"),
  runtime.db.prepare("UPDATE station_clips SET status='draft'"),
]);
await homeFixture(runtime.db, { game: runtime.content.game.id });
let ip = 1;
const server = http.createServer(async (incoming, outgoing) => {
  try {
    if (!['GET', 'HEAD'].includes(incoming.method) || incoming.headers.host !== '127.0.0.1:' + port ||
      !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
      outgoing.writeHead(405, { Allow: 'GET, HEAD' }); outgoing.end(); return;
    }
    const url = new URL(incoming.url, origin);
    if (url.origin !== origin || /^\/(?:admin|admin-v2|auth)(?:\/|$)/.test(url.pathname)) {
      outgoing.writeHead(404); outgoing.end(); return;
    }
    const response = await runtime.mf.dispatchFetch(url.href, { method: incoming.method, redirect: 'manual',
      headers: { 'CF-Connecting-IP': '192.0.2.' + (ip++ % 250 + 1) } });
    const headers = Object.fromEntries(response.headers);
    headers['x-robots-tag'] = 'noindex, nofollow, noarchive'; headers['cache-control'] = 'private, no-store';
    delete headers['content-length']; delete headers['etag']; delete headers['set-cookie'];
    if (response.headers.get('content-type')?.includes('text/html') && incoming.method !== 'HEAD') {
      const html = (await response.text()).replace(/<body([^>]*)>/i,
        '<body$1><aside style="padding:8px 18px;font:12px/1.5 system-ui;background:#f1f0fa;color:#465271">首发范围本机预览 · 临时 D1/R2 · 音乐为空，试听与视频关闭 · 不是生产验收</aside>');
      outgoing.writeHead(response.status, headers); outgoing.end(html); return;
    }
    outgoing.writeHead(response.status, headers);
    if (response.body && incoming.method !== 'HEAD') Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch { if (!outgoing.headersSent) outgoing.writeHead(503); outgoing.end('Local preview unavailable'); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
console.log('First-launch local preview: ' + origin + '/ (GET/HEAD only; no production data)');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { void runtime.close().finally(() => process.exit(0)); }));
