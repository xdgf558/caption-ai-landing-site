import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createContentAdminRuntime, contentAdminActor } from './helpers/station-content-admin-runtime.mjs';
import { seedWorkbenchFixture } from './helpers/station-admin-workbench-fixture.mjs';


const port=4224,origin=`http://127.0.0.1:${port}`,dist=fileURLToPath(new URL('../.generated/station-first-launch-assets/',import.meta.url));
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
const allowedAsset=path=>['/admin-v2/','/admin-v2/services/','/styles/station-admin.css','/images/station-gentle/cat-mark.webp','/admin/music/','/admin/music/content/','/admin/music/media/','/styles/admin-music.css','/styles/admin-station-content.css','/styles/admin-station-media.css','/images/optimized/station-cat-logo-1668c2e5-160.webp','/favicon.ico','/vendor/music-mp3/lamejs-1.2.7.js','/vendor/music-mp3/NOTICE.txt'].includes(path)||/^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path);
async function assets(request){
 const path=new URL(request.url).pathname;if(!allowedAsset(path))return new Response(null,{status:404});
 const file=resolve(dist,'.'+path,path.endsWith('/')?'index.html':'');if(!file.startsWith(resolve(dist)+sep))return new Response(null,{status:404});
 try{let data=await readFile(file),type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.ico')?'image/x-icon':file.endsWith('.txt')?'text/plain':'text/html';
  if(type==='text/html'){const note='<aside data-preview-notice style="position:fixed;bottom:0;left:220px;right:0;z-index:8;padding:5px 14px;background:#ece9f9;color:#666c91;font:11px/1.5 system-ui">本机隔离预览 · 合成夹具 · 写入仅在临时 D1/R2 · 重启后重置</aside>';data=Buffer.from(data.toString('utf8').replace('</head>','<style>@media(max-width:760px){[data-preview-notice]{left:0!important;font-size:10px!important}}body:has([data-preview-notice]){padding-bottom:25px}</style></head>').replace(/(<body[^>]*>)/,'$1'+note));}
  return new Response(data,{headers:{...headers,'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':'')}});
 }catch{return new Response(null,{status:404});}
}
const runtime=await createContentAdminRuntime({assets,seed:seedWorkbenchFixture,bindings:{STATION_CONTENT_SCHEDULES_ENABLED:'false',STATION_CAMPAIGNS_ENABLED:'false'}});
const server=createServer(async(incoming,outgoing)=>{
 try{const url=new URL(incoming.url,origin),write=!['GET','HEAD'].includes(incoming.method);
  if(incoming.headers.host!==`127.0.0.1:${port}`||url.origin!==origin||(write&&(!url.pathname.startsWith('/admin/api/music/')||!['POST','PATCH','PUT'].includes(incoming.method)||incoming.headers.origin!==origin||incoming.headers['x-requested-with']!=='StationCatMusicAdmin'))||(!url.pathname.startsWith('/admin/api/music/')&&!allowedAsset(url.pathname))){outgoing.writeHead(403,headers);outgoing.end();return;}
  const requestHeaders=new Headers(incoming.headers);requestHeaders.set('Host','content.local.test');if(requestHeaders.has('Origin'))requestHeaders.set('Origin','http://content.local.test');requestHeaders.set('Cf-Access-Jwt-Assertion',await runtime.token());requestHeaders.set('CF-Connecting-IP','127.0.0.1');
  // The only JWT is ephemeral, synthetic and never returned to the browser.
  const response=await runtime.mf.dispatchFetch('http://content.local.test'+url.pathname+url.search,{method:incoming.method,headers:requestHeaders,redirect:'manual',...(write?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
  outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...headers});
  if(incoming.method==='HEAD'||!response.body){await response.body?.cancel();outgoing.end();}else Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);
 }catch{if(!outgoing.headersSent){outgoing.writeHead(503,headers);outgoing.end('Local admin preview unavailable');}else outgoing.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log('Station Cat unified admin local preview: '+origin+'/admin-v2/'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{void runtime.close().finally(()=>process.exit());}));
