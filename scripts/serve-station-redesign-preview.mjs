// LOCAL ONLY: separate fixture output, loopback GET/HEAD, no APIs or production bindings.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.generated/station-redesign-preview');
const port = Number(process.env.STATION_REDESIGN_PREVIEW_PORT || 4204);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError('Invalid preview port');
const host = `127.0.0.1:${port}`;
const assets = new Map([
  ['/images/home-night/cat-mark.webp', resolve(root, 'public/images/home-night/cat-mark.webp')],
  ['/preview-assets/candidate-cover.png', resolve(root, 'scripts/fixtures/station-redesign/assets/candidate-cover.png')],
  ['/preview-assets/cat-life-desktop.png', resolve(root, 'docs/station-cat-redesign/T03-evidence/cat-life-desktop.png')],
]);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow' };
  const finish = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { ...headers, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  if (req.headers.host !== host || !['GET', 'HEAD'].includes(req.method)) { finish(403, 'Local read-only preview'); return; }
  try {
    const url = new URL(req.url, `http://${host}`);
    if (url.origin !== `http://${host}`) { finish(403, 'Local preview only'); return; }
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) { finish(404, 'Not found'); return; }
    let file = assets.get(pathname);
    if (!file) {
      file = resolve(output, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '');
      if (!file.startsWith(`${output}${sep}`)) { finish(404, 'Not found'); return; }
    }
    const data = await readFile(file);
    finish(200, data, types[extname(file)] || 'application/octet-stream');
  } catch { finish(404, 'Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`T04 local preview: http://${host}/zh-hans/ (never deploy)`));
