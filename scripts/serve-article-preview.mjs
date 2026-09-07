import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';
import { createArticleFixture } from './helpers/article-fixture.mjs';

const { env, sqlite } = createArticleFixture();
const root = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.env.ARTICLE_PREVIEW_PORT || 4179);
const base = `http://127.0.0.1:${port}`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.xml': 'application/xml' };
env.ASSETS.fetch = async request => {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const path = resolve(root, `.${pathname}${pathname.endsWith('/') ? 'index.html' : ''}`);
  if (!path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  try { return new Response(await readFile(path), { headers: { 'content-type': types[extname(path)] || 'application/octet-stream' } }); }
  catch { return new Response('Not found', { status: 404 }); }
};
for (const [id, title, description, markdown, locale] of [
  ['1001', '本地示例：把一个想法慢慢做成游戏', '从第一张草图到一个可以散步的小家，记录创作过程中的选择与取舍。', '## 从一个小想法开始\n\n这是本地预览内容，不会发布到线上。\n\n## 留出日常的空间\n\n把复杂的操作藏在简单的界面后面，让玩家把注意力留给生活。', 'zh-Hans'],
  ['1002', 'Local preview: a quieter place to write', 'A small collection of thoughts about independent making, useful tools, and everyday life.', '', 'en']
]) {
  const result = await hooks.handleAdminArticles(new Request(base + '/admin/api/articles', { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ sourceUrl: `https://x.com/i/article/${id}`, title, description, markdown, locale, status: 'published' }) }), env);
  if (!result.ok) throw new Error(await result.text());
}
sqlite.prepare("INSERT INTO content_entries(entry_type,locale,slug,title,status,source_kind) VALUES('signal_brief','zh-Hant','local-archive','本地示例：历史简报','published','signal_brief')").run();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, base);
    if (url.pathname === '/admin/api/articles/metadata') {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, available: false })); return;
    }
    const init = { method: req.method, headers: req.headers };
    if (!['GET', 'HEAD'].includes(req.method)) { init.body = req; init.duplex = 'half'; }
    const response = await worker.fetch(new Request(url, init), env, { waitUntil(promise) { promise.catch(console.error); } });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) { console.error(error); res.writeHead(500); res.end('Local preview failed'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local-only article preview: ${base}/signal/ | ${base}/admin/articles/`));
