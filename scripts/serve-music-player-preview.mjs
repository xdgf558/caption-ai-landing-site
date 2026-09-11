// LOCAL ONLY. Loopback host, no credentials, no proxy and no external bindings. NEVER DEPLOY.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracks, demoWav } from './fixtures/music-player/data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.generated/music-player-preview');
const port = Number(process.env.MUSIC_PLAYER_PREVIEW_PORT || 4198);
const origin = `http://127.0.0.1:${port}`;
const wavs = new Map();
const counters = { catalog: 0, capabilities: 0, audio: 0 };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  if (req.headers.host !== `127.0.0.1:${port}` || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403); res.end(); return; }
  const url = new URL(req.url, origin);
  const send = (status, data, type = 'application/json', headers = {}) => {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(type === 'application/json' ? JSON.stringify(data) : data);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Length': body.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  try {
    if (url.pathname === '/__local/requests') { send(200, counters); return; }
    if (url.pathname === '/api/music/catalog') {
      counters.catalog++;
      const scenario = process.env.MUSIC_PLAYER_PREVIEW_SCENARIO;
      if (scenario === 'catalog-error') { send(503, { error: { code: 'MUSIC_PUBLIC_DISABLED' } }); return; }
      send(200, { schemaVersion: 2, catalogVersion: 1, locale: 'zh-Hans', collections: [],
        tracks: scenario === 'empty' ? [] : tracks.map(({ art, ...track }) => track) }); return;
    }
    if (url.pathname === '/api/music/me/capabilities') {
      counters.capabilities++;
      send(200, { canPlayVipFull: false, membershipStatus: 'none', musicVipDeliveryEnabled: false }); return;
    }
    const match = /^\/api\/music\/tracks\/([a-f0-9-]+)\/(cover|audio)$/.exec(url.pathname);
    if (match) {
      const track = tracks.find(item => item.id === match[1]);
      if (!track || url.searchParams.get('v') !== '1') { send(404, { error: { code: 'NOT_FOUND' } }); return; }
      if (match[2] === 'cover') { send(200, await readFile(resolve(root, 'scripts/fixtures/music-player/artwork', `${track.art}.webp`)), 'image/webp'); return; }
      counters.audio++;
      if (url.searchParams.get('variant') !== 'full') { send(404, { error: { code: 'PREVIEW_UNAVAILABLE' } }); return; }
      if (!wavs.has(track.id)) wavs.set(track.id, demoWav(track));
      const bytes = wavs.get(track.id), range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if (start >= bytes.length || start > end) { send(416, '', 'audio/wav', { 'Content-Range': `bytes */${bytes.length}` }); return; }
        send(206, bytes.subarray(start, end + 1), 'audio/wav', { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }); return;
      }
      send(200, bytes, 'audio/wav', { 'Accept-Ranges': 'bytes' }); return;
    }
    if (url.pathname === '/brand.webp') {
      send(200, await readFile(resolve(root, 'public/images/optimized/station-cat-logo-1668c2e5-160.webp')), 'image/webp'); return;
    }
    const file = resolve(output, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(output + sep)) { send(404, 'Not found', 'text/plain'); return; }
    send(200, await readFile(file), mime[extname(file)] || 'application/octet-stream');
  } catch { send(404, 'Local preview unavailable', 'text/plain'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local music player: ${origin}/`));
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
