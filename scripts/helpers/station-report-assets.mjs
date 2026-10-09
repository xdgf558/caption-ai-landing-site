import { readFile } from 'node:fs/promises';import { fileURLToPath } from 'node:url';import { resolve,sep } from 'node:path';
const dist=fileURLToPath(new URL('../../dist/',import.meta.url));
export const reportAssetAllowed=path=>['/admin/music/','/admin/music/content/','/admin/music/reports/','/styles/admin-music.css','/styles/admin-station-content.css','/styles/admin-station-reports.css','/favicon.ico'].includes(path)||/^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path);
export async function reportAssets(request,{banner=false}={}){const path=new URL(request.url).pathname;if(!reportAssetAllowed(path))return new Response(null,{status:404});const file=resolve(dist,'.'+path,path.endsWith('/')?'index.html':'');if(!file.startsWith(resolve(dist)+sep))return new Response(null,{status:404});
 try{let bytes=await readFile(file),type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ico')?'image/x-icon':'text/html';
  if(banner&&type==='text/html')bytes=Buffer.from(bytes.toString().replace(/(<body[^>]*>)/,'$1<aside style="padding:10px 28px;background:#eef4f0;color:#426553;font:12px/1.8 system-ui">T19 本机隔离预览 · 全部访问、歌曲、平台与账号均为合成夹具 · 写入仅进入临时 D1 · 不代表真实推广或生产数据</aside>'));
  return new Response(bytes,{headers:{'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':''),'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response(null,{status:404});}}
