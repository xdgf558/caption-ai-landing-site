import http from 'node:http';
import { Readable } from 'node:stream';
import { createStationMusicRuntime } from './helpers/station-music-runtime.mjs';
import { readMusicResponse } from '../src/redesign/musicResponse.js';

const port = Number(process.env.STATION_MUSIC_PREVIEW_PORT || 4208);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local preview port');
const runtime = await createStationMusicRuntime(), records = [];
const banner = '<aside class="sc-container" style="padding:10px 14px;background:var(--sc-promo-surface);border-radius:8px;font-size:12px;color:var(--sc-muted);margin-top:14px" data-preview-only>本地預覽 · 示例作品與合成測試音，不代表真實發行或推廣配置。平台素材仍待確認。</aside>';
const server = http.createServer(async (incoming, outgoing) => {
  if (!['GET', 'HEAD'].includes(incoming.method) || !['127.0.0.1:' + port, 'localhost:' + port].includes(incoming.headers.host) || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
    outgoing.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }); outgoing.end(); return;
  }
  const url = new URL(incoming.url, 'http://127.0.0.1:' + port);
  if (url.pathname === '/__preview/requests') {
    outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    outgoing.end(incoming.method === 'HEAD' ? undefined : JSON.stringify(records)); return;
  }
  const errorScenario = url.pathname.startsWith('/__preview/error/');
  if (errorScenario) url.pathname = url.pathname.slice('/__preview/error'.length);
  const publicPath = url.pathname;
  url.pathname = (errorScenario ? '/fixture-pages-no-db' : '/fixture-pages-on') + url.pathname;
  const forwarded = new Headers({ 'CF-Connecting-IP': '192.0.2.80' });
  // Preview is anonymous. Never forward a browser's cookies or auth headers.
  for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since', 'accept', 'user-agent']) if (incoming.headers[name]) forwarded.set(name, incoming.headers[name]);
  try {
    let response = await runtime.mf.dispatchFetch(url, { method: incoming.method, headers: forwarded, redirect: 'manual' });
    records.push({ method: incoming.method, pathname: publicPath, variant: url.searchParams.get('variant'), status: response.status });
    if (records.length > 1000) records.shift();
    if (incoming.method === 'GET' && response.headers.get('content-type')?.includes('text/html') && response.status !== 302) {
      const text = await readMusicResponse(response, 1024 * 1024), output = new Headers(response.headers);
      output.delete('Content-Length'); output.delete('ETag');
      response = new Response(text.replace(/(<main\b[^>]*>)/, '$1' + banner), { status: response.status, headers: output });
    }
    const output = Object.fromEntries(response.headers); output['x-robots-tag'] = 'noindex, nofollow'; output['cache-control'] = 'private, no-store';
    outgoing.writeHead(response.status, output);
    if (incoming.method === 'HEAD' || !response.body) { await response.body?.cancel(); outgoing.end(); }
    else Readable.fromWeb(response.body).on('error', () => outgoing.destroy()).pipe(outgoing);
  } catch { outgoing.writeHead(503, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }); outgoing.end('Local preview unavailable'); }
});
server.listen(port, '127.0.0.1', () => console.log('Station Cat T08 isolated preview: http://127.0.0.1:' + port + '/music/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { void runtime.close().finally(() => process.exit()); }));
