import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createStationMediaRuntime } from './helpers/station-media-runtime.mjs';

const port = 4215, origin = `http://127.0.0.1:${port}`, dist = fileURLToPath(new URL('../dist/', import.meta.url));
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' };
const allowedAsset = path => ['/admin/music/', '/admin/music/media/', '/styles/admin-music.css', '/styles/admin-station-media.css',
  '/images/optimized/station-cat-logo-1668c2e5-160.webp', '/favicon.ico', '/vendor/music-mp3/lamejs-1.2.7.js',
  '/vendor/music-mp3/NOTICE.txt'].includes(path) || /^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path);
async function assets(request) {
  const path = new URL(request.url).pathname;
  if (!allowedAsset(path)) return new Response(null, { status: 404 });
  const file = resolve(dist, '.' + path, path.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(resolve(dist) + sep)) return new Response(null, { status: 404 });
  try {
    let data = await readFile(file), type = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.ico') ? 'image/x-icon' : file.endsWith('.txt') ? 'text/plain' : 'text/html';
    if (type === 'text/html') {
      const note = '<aside style="padding:10px 28px;background:#eef4f0;color:#426553;font:12px/1.6 system-ui">T15 本机隔离预览 · 测试作品与管理员 · 文件只写入本机临时存储 · 校验不代表真实授权</aside>';
      data = Buffer.from(data.toString('utf8').replace(/(<body[^>]*>)/, '$1' + note));
    }
    return new Response(data, { headers: { ...headers, 'Content-Type': type + (type.startsWith('text/') ? '; charset=utf-8' : '') } });
  } catch { return new Response(null, { status: 404 }); }
}
const runtime = await createStationMediaRuntime({ assets });
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, origin), write = !['GET','HEAD'].includes(incoming.method);
    if (incoming.headers.host !== `127.0.0.1:${port}` || url.origin !== origin ||
      (write && (!url.pathname.startsWith('/admin/api/music/') || !['POST','PATCH','PUT'].includes(incoming.method) || incoming.headers.origin !== origin || incoming.headers['x-requested-with'] !== 'StationCatMusicAdmin')) ||
      (!url.pathname.startsWith('/admin/api/music/') && !allowedAsset(url.pathname))) { outgoing.writeHead(403, headers); outgoing.end(); return; }
    const requestHeaders = new Headers(incoming.headers);
    requestHeaders.set('Host', 'media.local.test'); if (requestHeaders.has('Origin')) requestHeaders.set('Origin', 'http://media.local.test');
    // Synthetic local JWT only, never exposed to the browser or a remote service.
    requestHeaders.set('Cf-Access-Jwt-Assertion', await runtime.token());
    const response = await runtime.mf.dispatchFetch('http://media.local.test' + url.pathname + url.search, { method: incoming.method,
      headers: requestHeaders, redirect: 'manual', ...(write ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...headers });
    if (incoming.method === 'HEAD' || !response.body) { await response.body?.cancel(); outgoing.end(); }
    else Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
  } catch { if (!outgoing.headersSent) { outgoing.writeHead(503, headers); outgoing.end('Local T15 preview unavailable'); } else outgoing.destroy(); }
});
server.listen(port, '127.0.0.1', () => console.log('Station Cat T15 local preview: ' + origin + '/admin/music/media/'));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close(() => { void runtime.close().finally(() => process.exit()); }));
