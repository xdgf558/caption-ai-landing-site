import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createContentAdminRuntime, contentAdminActor } from './helpers/station-content-admin-runtime.mjs';
import { seedContentAdminFixture } from './helpers/station-content-admin-fixture.mjs';
import { createContentObject } from '../src/redesign/contentAdmin.js';

const port=4216,origin=`http://127.0.0.1:${port}`,dist=fileURLToPath(new URL('../dist/',import.meta.url));
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
const allowedAsset=path=>['/admin/music/','/admin/music/content/','/admin/music/media/','/styles/admin-music.css','/styles/admin-station-content.css','/styles/admin-station-media.css','/images/optimized/station-cat-logo-1668c2e5-160.webp','/favicon.ico','/vendor/music-mp3/lamejs-1.2.7.js','/vendor/music-mp3/NOTICE.txt'].includes(path)||/^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path);
async function assets(request){
 const path=new URL(request.url).pathname;if(!allowedAsset(path))return new Response(null,{status:404});
 const file=resolve(dist,'.'+path,path.endsWith('/')?'index.html':'');if(!file.startsWith(resolve(dist)+sep))return new Response(null,{status:404});
 try{let data=await readFile(file),type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.ico')?'image/x-icon':file.endsWith('.txt')?'text/plain':'text/html';
  if(type==='text/html'){const note='<aside style="padding:10px 28px;background:#eef4f0;color:#426553;font:12px/1.6 system-ui">T16 本机隔离预览 · 作品、管理员与权利均为测试夹具 · 写入仅保存在临时 D1/R2 · 重启后重置</aside>';data=Buffer.from(data.toString('utf8').replace(/(<body[^>]*>)/,'$1'+note));}
  return new Response(data,{headers:{...headers,'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':'')}});
 }catch{return new Response(null,{status:404});}
}
const runtime=await createContentAdminRuntime({assets,seed:async(db,bucket)=>{
 const fixture=await seedContentAdminFixture(db,bucket),context=()=>({actorId:contentAdminActor,key:crypto.randomUUID()}),local={db,bucket};
 for(const [index,t]of fixture.tracks.slice(0,2).entries()){
  const metadata={...t.metadata,originalLocale:'zh-Hans',title:{'zh-Hans':index?'本机示例 · 音乐资料 B':'本机示例 · 音乐资料 A'},summary:{'zh-Hans':'只用于后台操作核对，主推歌曲与发行链接仍待确定。'}};
  await createContentObject(local,'tracks',{trackId:t.id,data:{metadata,coverAssetId:t.cover,siteAudioMode:'none'},reason:'隔离预览夹具'},context());
  await createContentObject(local,'promotions',{trackId:t.id,data:{enabled:false,previewEnabled:false},reason:'隔离预览推广草稿'},context());
  await createContentObject(local,'clips',{trackId:t.id,clipType:'short_video',data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'本机示例 · 短视频 '+(index+1)}}},reason:'隔离预览视频草稿'},context());
 }
 await createContentObject(local,'games',{slug:'local-game-intro',data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'本机示例 · 游戏介绍'}},launchUrl:'/games/cat-life/',supportedDevices:['desktop']},reason:'隔离预览介绍草稿'},context());return fixture;
}});
const server=createServer(async(incoming,outgoing)=>{
 try{const url=new URL(incoming.url,origin),write=!['GET','HEAD'].includes(incoming.method);
  if(incoming.headers.host!==`127.0.0.1:${port}`||url.origin!==origin||(write&&(!url.pathname.startsWith('/admin/api/music/')||!['POST','PATCH','PUT'].includes(incoming.method)||incoming.headers.origin!==origin||incoming.headers['x-requested-with']!=='StationCatMusicAdmin'))||(!url.pathname.startsWith('/admin/api/music/')&&!allowedAsset(url.pathname))){outgoing.writeHead(403,headers);outgoing.end();return;}
  const requestHeaders=new Headers(incoming.headers);requestHeaders.set('Host','content.local.test');if(requestHeaders.has('Origin'))requestHeaders.set('Origin','http://content.local.test');requestHeaders.set('Cf-Access-Jwt-Assertion',await runtime.token());requestHeaders.set('CF-Connecting-IP','127.0.0.1');
  // The only JWT is ephemeral, synthetic and never returned to the browser.
  const response=await runtime.mf.dispatchFetch('http://content.local.test'+url.pathname+url.search,{method:incoming.method,headers:requestHeaders,redirect:'manual',...(write?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
  outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...headers});
  if(incoming.method==='HEAD'||!response.body){await response.body?.cancel();outgoing.end();}else Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);
 }catch{if(!outgoing.headersSent){outgoing.writeHead(503,headers);outgoing.end('Local T16 preview unavailable');}else outgoing.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log('Station Cat T16 local preview: '+origin+'/admin/music/content/'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{void runtime.close().finally(()=>process.exit());}));
