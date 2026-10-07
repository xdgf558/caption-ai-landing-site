import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
export async function stationGameAssets(request) {
  const pathname = new URL(request.url).pathname;
  const allowed = /^\/games\/site-shell\/(?:zh-Hant|zh-Hans|en|ja)\/$/.test(pathname) || /^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(pathname) ||
    pathname === '/images/station-gentle/cat-mark.webp' || pathname.startsWith('/games/cat-life/');
  if (!allowed) return new Response(null, { status: 404 });
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return new Response(null, { status: 404 }); }
  const file = resolve(dist, '.' + decoded, pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(resolve(dist) + sep)) return new Response(null, { status: 404 });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  try { const bytes = await readFile(file); return new Response(bytes, { headers: { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } }); }
  catch { return new Response(null, { status: 404 }); }
}
