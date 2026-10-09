import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createEventRuntime,seedEventObjects} from './helpers/station-event-fixture.mjs';
import {seedLegacyFixture} from './helpers/station-redesign-database.mjs';
import {seedCampaignObjects} from './helpers/station-campaign-fixture.mjs';
import {contentAdminActor} from './helpers/station-content-admin-runtime.mjs';
import {stationGameAssets} from './helpers/station-game-assets.mjs';
import {stationVideoBytes} from './helpers/station-video-fixture.mjs';

// Isolated loopback tooling. No deployment, credentials, remote database,
// general proxy, admin mutations or production flag changes.
const port=4218,origin=`http://127.0.0.1:${port}`;
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
const musicPage=p=>/^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?music(?:\/tracks\/[a-z0-9-]+)?\/?$/.test(p);
const gamePage=p=>/^\/(?:en\/|ja\/|zh-hans\/|zh-hant\/)?games(?:\/[a-z0-9-]+)?\/?$/.test(p);
const allowed=p=>p==='/'||musicPage(p)||gamePage(p)||p.startsWith('/games/cat-life/')||/^\/_astro\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(p)||/^\/(?:music|games)\/site-shell\/(?:zh-Hant|zh-Hans|en|ja)\/$/.test(p)||p==='/images/station-gentle/cat-mark.webp'||p.startsWith('/api/station/content/')||['/api/station/events','/api/station/events/config'].includes(p)||p.startsWith('/api/music/v1/');
let networkFailure=false;
const runtime=await createEventRuntime({assets:async request=>{
 const response=await stationGameAssets(request);
 if(!response.headers.get('Content-Type')?.startsWith('text/html'))return response;
 const html=(await response.text()).replace(/(<body[^>]*>)/,'$1<aside style="padding:10px 28px;background:#f1f0fa;color:#555d83;font:12px/1.6 system-ui">T18 本机隔离预览 · 歌曲、短片与权利均为合成夹具 · 统计只写临时 D1 · 不代表真实作品、发行或生产验收</aside>');
 return new Response(html,{status:response.status,headers:response.headers});
},seed:async(db,bucket)=>{
 const cover=await sharp(fileURLToPath(new URL('./fixtures/station-redesign/assets/gentle-station/music-cover.webp',import.meta.url))).resize(400,400,{fit:'cover'}).png().toBuffer();
 const poster=await sharp(fileURLToPath(new URL('./fixtures/station-redesign/assets/gentle-station/hero.webp',import.meta.url))).resize(640,360,{fit:'cover'}).png().toBuffer();
 const base=new URL('../tests/fixtures/music-mp3/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
 const material=async file=>{const item=manifest.files.find(x=>x.file===file),bytes=await readFile(new URL(file,base));if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Fixture identity');return {bytes,duration:item.packetDurationMs};};
 const full=await material('cbr-stereo.mp3'),preview=await material('preview.mp3');
 const legacy=await seedLegacyFixture(db,{materializeAsset:async a=>{
  const bytes=a.kind==='cover'?cover:a.kind==='audio'?full.bytes:a.kind==='preview'?preview.bytes:new TextEncoder().encode('[00:00.00]本机合成试听夹具');
  const object=await bucket.put(a.object_key,bytes,{httpMetadata:{contentType:a.content_type}});
  return {byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),etag:object.etag,...(a.kind==='audio'?{duration_ms:full.duration}:a.kind==='preview'?{duration_ms:preview.duration,source_end_ms:preview.duration}:{})};
 }});
 const local={db,bucket},media=async kind=>['poster','game_screenshot'].includes(kind)?{bytes:poster,width:640,height:360}:stationVideoBytes();
 const clips=await seedCampaignObjects(local,legacy.tracks,contentAdminActor,media),extra=await seedEventObjects(local,legacy.tracks,clips,media);
 return {...legacy,...clips,...extra,mediaProof:{previewMs:preview.duration,fullMs:full.duration,synthetic:true}};
}});
const server=createServer(async(incoming,outgoing)=>{
 try{
  const url=new URL(incoming.url,origin),write=incoming.method==='POST';
  if(incoming.headers.host!==`127.0.0.1:${port}`||url.origin!==origin||!['GET','HEAD','POST'].includes(incoming.method))throw new Error('local origin');
  // A fixed guest fixture lets the unchanged game startup probe finish. This
  // server accepts no account credentials or cloud-save mutations.
  if(!write&&['/api/readers/session','/api/readers/game-saves/cat-life'].includes(url.pathname)){
   const value=url.pathname.endsWith('/session')?{ok:true,authenticated:false}:{ok:true,save:null};
   outgoing.writeHead(200,{...headers,'Content-Type':'application/json'});outgoing.end(incoming.method==='HEAD'?'':JSON.stringify(value));return;
  }
  // Read-only diagnostics and bounded fault injection exist only on this server.
  if(url.pathname==='/__fixture/events'&&!write){
   const counts=(await runtime.db.prepare('SELECT event_name AS name,COUNT(*) AS count FROM station_analytics_events GROUP BY event_name ORDER BY event_name').all()).results;
   outgoing.writeHead(200,{...headers,'Content-Type':'application/json'});outgoing.end(JSON.stringify({counts,media:runtime.content.mediaProof,networkFailure}));return;
  }
  if(url.pathname==='/__fixture/statistics-failure'&&!write){networkFailure=url.searchParams.get('enabled')==='1';outgoing.writeHead(200,headers);outgoing.end('Local statistics failure: '+networkFailure);return;}
  if(!allowed(url.pathname)||(write&&(url.pathname!=='/api/station/events'||incoming.headers.origin!==origin||incoming.headers['x-requested-with']!=='StationCatEvents')))throw new Error('local route');
  if(url.pathname==='/'){outgoing.writeHead(302,{...headers,Location:'/music/tracks/permanent-free/'});outgoing.end();return;}
  if(networkFailure&&url.pathname==='/api/station/events'){outgoing.writeHead(503,headers);outgoing.end('Synthetic statistics failure');return;}
  const requestHeaders=new Headers(incoming.headers);requestHeaders.delete('Cf-Access-Jwt-Assertion');requestHeaders.delete('Cookie');requestHeaders.set('CF-Connecting-IP','127.0.0.1');
  const response=await runtime.mf.dispatchFetch(url.href,{method:incoming.method,headers:requestHeaders,cf:{country:'SG'},redirect:'manual',...(write?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
  outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...headers});
  if(incoming.method==='HEAD'||!response.body){await response.body?.cancel();outgoing.end();}else Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);
 }catch{if(!outgoing.headersSent){outgoing.writeHead(403,headers);outgoing.end('This route is outside the isolated T18 preview.');}else outgoing.destroy();}
});
server.listen(port,'127.0.0.1',()=>console.log('Station Cat T18 isolated preview: '+origin+'/music/tracks/permanent-free/'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{void runtime.close().finally(()=>process.exit());}));
