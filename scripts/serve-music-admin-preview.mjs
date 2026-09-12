// LOCAL TEST HARNESS ONLY. Fake actor, ephemeral DB/R2, no production configuration. NEVER DEPLOY.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('../',import.meta.url)), dist = resolve(root,'dist');
const port = Number(process.env.MUSIC_ADMIN_PREVIEW_PORT || 4197), origin = 'http://127.0.0.1:' + port;
const bundle = await build({ entryPoints:[resolve(root,'scripts/helpers/music-runtime-worker.js')],bundle:true,format:'esm',platform:'browser',write:false });
const mf = new Miniflare({ modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-07-30',host:'127.0.0.1',port:0,
  d1Databases:{ MUSIC_DB:'ui-fixture-music',WAITLIST_DB:'ui-fixture-readers' },r2Buckets:{ MUSIC_BUCKET:'ui-fixture-private' },
  outboundService:() => new Response('External network disabled',{status:403}) });
const db = await mf.getD1Database('MUSIC_DB'), parser = new DatabaseSync(':memory:');
for (const name of ['0001_music_foundation.sql','0002_music_publication.sql','0003_music_uploads.sql', '0004_music_cleanup.sql', '0005_music_rate_limits.sql', '0006_music_analytics.sql', '0007_music_albums.sql', '0008_music_featured.sql']) {
  let sql = await readFile(resolve(root,'migrations-music',name),'utf8'); const statements = [];
  while (sql.trim()) { const stmt = parser.prepare(sql), source = stmt.sourceSQL; stmt.run(); statements.push(db.prepare(source)); sql = sql.slice(source.length); }
  await db.batch(statements);
}
parser.close();
await db.prepare("UPDATE music_settings SET value_json='268435456' WHERE key='storageQuotaBytes'").run();
for (const [slug,title,summary] of [
  ['evening-at-the-station','晚风经过车站','本地测试曲目：一段安静的器乐草稿。'],
  ['a-letter-to-tomorrow','写给明天的信','本地测试曲目：等待补充素材与权利材料。'],
  ['rain-on-the-platform','月台上的雨','本地测试曲目：尚未发布。']
]) {
  const r = await mf.dispatchFetch(origin + '/fixture-uploads/admin/api/music/tracks',{ method:'POST',headers:{ Origin:origin,'X-Requested-With':'StationCatMusicAdmin','Content-Type':'application/json','Idempotency-Key':crypto.randomUUID() },
    body:JSON.stringify({slug,metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':title},summary:{'zh-Hans':summary},creatorName:'Station Cat',instrumental:true,language:'无人声',genres:['Ambient'],moods:['安静'],story:''}}) });
  if (!r.ok) throw new Error(await r.text());
}
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.svg':'image/svg+xml'};
const server = createServer(async (req,res) => {
  if (req.headers.host !== '127.0.0.1:' + port) { res.writeHead(403); res.end(); return; }
  try {
    const url = new URL(req.url,origin);
    if (url.pathname.startsWith('/admin/api/music/')) {
      url.pathname = '/fixture-uploads' + url.pathname;
      const init = {method:req.method,headers:req.headers};
      if (!['GET','HEAD'].includes(req.method)) Object.assign(init,{body:Readable.toWeb(req),duplex:'half'});
      const response = await mf.dispatchFetch(url,init);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
      return;
    }
    const path = resolve(dist,'.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!path.startsWith(dist + sep)) { res.writeHead(404); res.end(); return; }
    const body = await readFile(path);
    res.writeHead(200,{'Content-Type':mime[extname(path)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Local fixture unavailable'); }
});
server.listen(port,'127.0.0.1',() => console.log('LOCAL TEST ONLY: ' + origin + '/admin/music/'));
async function close() { server.close(); await mf.dispose(); process.exit(0); }
process.on('SIGTERM',close); process.on('SIGINT',close);
