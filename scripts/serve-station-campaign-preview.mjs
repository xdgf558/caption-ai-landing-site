import {createServer} from 'node:http';import {Readable} from 'node:stream';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {resolve,sep} from 'node:path';import {createHash} from 'node:crypto';import sharp from 'sharp';
import {createCampaignRuntime,seedCampaignObjects} from './helpers/station-campaign-fixture.mjs';
import {seedLegacyFixture} from './helpers/station-redesign-database.mjs';
import {createCampaign} from '../src/redesign/campaignStore.js';
import {contentAdminActor} from './helpers/station-content-admin-runtime.mjs';

const port=4217,origin=`http://127.0.0.1:${port}`,dist=fileURLToPath(new URL('../dist/',import.meta.url));
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
const allowedAsset=path=>['/admin/music/','/admin/music/content/','/admin/music/media/','/styles/admin-music.css','/styles/admin-station-content.css','/styles/admin-station-media.css','/favicon.ico','/images/station-gentle/cat-mark.webp','/images/optimized/station-cat-logo-1668c2e5-160.webp'].includes(path)||/^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(path)||/^\/music\/site-shell\/(?:zh-Hant|zh-Hans|en|ja)\/$/.test(path);
const musicPage=path=>/^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music(?:\/tracks\/[a-z0-9-]+)?\/?$/.test(path);
async function assets(request){
  const path=new URL(request.url).pathname;if(!allowedAsset(path))return new Response(null,{status:404});
  const file=resolve(dist,'.'+path,path.endsWith('/')?'index.html':'');if(!file.startsWith(resolve(dist)+sep))return new Response(null,{status:404});
  try{let bytes=await readFile(file),type=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.webp')?'image/webp':file.endsWith('.ico')?'image/x-icon':'text/html';
    if(type==='text/html')bytes=Buffer.from(bytes.toString().replace(/(<body[^>]*>)/,'$1<aside style="padding:10px 28px;background:#eef4f0;color:#426553;font:12px/1.6 system-ui">T17 本机隔离预览 · 作品、Campaign 与权利均为测试夹具 · 写入仅保存在临时 D1/R2 · 二维码编码生产域名提案地址，不代表已上线</aside>'));
    return new Response(bytes,{headers:{...headers,'Content-Type':type+(type.startsWith('text/')?'; charset=utf-8':'')}});
  }catch{return new Response(null,{status:404});}
}
const runtime=await createCampaignRuntime({assets,seed:async(db,bucket)=>{
  const cover=await sharp(fileURLToPath(new URL('../public/images/station-gentle/member-hero.webp',import.meta.url))).resize(400,400,{fit:'cover'}).png().toBuffer();
  const legacy=await seedLegacyFixture(db,{materializeAsset:async a=>{const bytes=a.kind==='cover'?cover:new Uint8Array(100),object=await bucket.put(a.object_key,bytes,{httpMetadata:{contentType:a.content_type}});return {byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),etag:object.etag};}});
  const local={db,bucket},clips=await seedCampaignObjects(local,legacy.tracks);
  for(const [id,source]of [['local-douyin','douyin'],['local-youtube','youtube']])await createCampaign(local,legacy.tracks[0].id,{id,source,medium:'short_video',clipId:clips.clip,locale:'zh-Hant',legacySources:[id+'-old'],status:'active',reason:'本机测试渠道，不是运营设置'},{actorId:contentAdminActor,key:crypto.randomUUID()});
  return {...legacy,...clips};
}});
const server=createServer(async(incoming,outgoing)=>{
  try{const url=new URL(incoming.url,origin),write=!['GET','HEAD'].includes(incoming.method);
    const admin=url.pathname.startsWith('/admin/api/music/site-content'),content=url.pathname.startsWith('/api/station/content/');
    if(incoming.headers.host!==`127.0.0.1:${port}`||url.origin!==origin||
      (write&&(!admin||!['POST','PATCH','PUT'].includes(incoming.method)||incoming.headers.origin!==origin||incoming.headers['x-requested-with']!=='StationCatMusicAdmin'))||
      (!admin&&!content&&!allowedAsset(url.pathname)&&!musicPage(url.pathname))){outgoing.writeHead(403,headers);outgoing.end();return;}
    const requestHeaders=new Headers(incoming.headers);requestHeaders.set('Cf-Access-Jwt-Assertion',await runtime.token());requestHeaders.set('CF-Connecting-IP','127.0.0.1');
    const response=await runtime.mf.dispatchFetch(url.href,{method:incoming.method,headers:requestHeaders,redirect:'manual',...(write?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
    outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...headers});
    if(incoming.method==='HEAD'||!response.body){await response.body?.cancel();outgoing.end();}else Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);
  }catch{if(!outgoing.headersSent){outgoing.writeHead(503,headers);outgoing.end('Local Campaign preview unavailable');}else outgoing.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log('Station Cat T17 isolated preview: '+origin+'/admin/music/content/'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{void runtime.close().finally(()=>process.exit());}));
