import {createServer} from 'node:http';import {Readable} from 'node:stream';
import {createReportRuntime} from './helpers/station-report-fixture.mjs';
import {reportAssets,reportAssetAllowed} from './helpers/station-report-assets.mjs';
const port=4219,origin=`http://127.0.0.1:${port}`,headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
const runtime=await createReportRuntime({assets:request=>reportAssets(request,{banner:true})}),modes=['healthy','off','empty','editor','lost_ack'];const droppedKeys=new Set();
const server=createServer(async(incoming,outgoing)=>{try{
 const url=new URL(incoming.url,origin),write=!['GET','HEAD'].includes(incoming.method),api=url.pathname.startsWith('/admin/api/music/site-content');
 if(incoming.headers.host!==`127.0.0.1:${port}`||url.origin!==origin||(!api&&!reportAssetAllowed(url.pathname))||(!api&&write)||(write&&(!['POST','PATCH','PUT'].includes(incoming.method)||incoming.headers.origin!==origin||incoming.headers['x-requested-with']!=='StationCatMusicAdmin'))){outgoing.writeHead(403,headers);outgoing.end();return;}
 const chosen=url.pathname==='/admin/music/reports/'?url.searchParams.get('fixture'):null;
 if(chosen&&!modes.includes(chosen)){outgoing.writeHead(400,headers);outgoing.end();return;}
 const saved=/station_t19_fixture=(healthy|off|empty|editor|lost_ack)(?:;|$)/.exec(incoming.headers.cookie??'')?.[1];
 // Same-origin page selection also works in preview browsers that isolate cookies.
 let refererMode=null;try{const r=new URL(incoming.headers.referer);if(r.origin===origin&&r.pathname==='/admin/music/reports/'&&modes.includes(r.searchParams.get('fixture')))refererMode=r.searchParams.get('fixture');}catch{}
 const mode=chosen??refererMode??saved??'healthy';
 if(process.env.STATION_REPORT_PREVIEW_DIAGNOSTICS==='true'&&api)console.log(JSON.stringify({method:incoming.method,path:url.pathname,fixture:mode,cookieMode:saved??null,refererMode}));
 if(chosen){outgoing.setHeader('Set-Cookie',`station_t19_fixture=${mode}; Path=/; HttpOnly; SameSite=Strict`);}
 // Never forward real browser Cookies, bearer tokens or Access assertions.
 const requestHeaders=new Headers();for(const key of ['origin','content-type','content-length','x-requested-with','idempotency-key','if-match','sec-fetch-site'])if(incoming.headers[key])requestHeaders.set(key,incoming.headers[key]);
 requestHeaders.set('Cf-Access-Jwt-Assertion',await runtime.token(mode==='editor'?{email:'second-content-fixture@example.test'}:{}));requestHeaders.set('CF-Connecting-IP','127.0.0.1');
 if(api&&['off','empty'].includes(mode))url.pathname='/fixture-report-'+mode+url.pathname;
 const response=await runtime.mf.dispatchFetch(url.href,{method:incoming.method,headers:requestHeaders,redirect:'manual',...(write?{body:Readable.toWeb(incoming),duplex:'half'}:{})});
 const operationKey=incoming.headers['idempotency-key'];
 if(mode==='lost_ack'&&write&&response.ok&&typeof operationKey==='string'&&!droppedKeys.has(operationKey)){droppedKeys.add(operationKey);if(droppedKeys.size>128)droppedKeys.delete(droppedKeys.values().next().value);await response.body?.cancel();outgoing.writeHead(503,{...headers,'Content-Type':'application/json'});outgoing.end(JSON.stringify({ok:false,code:'LOCAL_ACK_LOST'}));return;}
 outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...headers});if(incoming.method==='HEAD'||!response.body){await response.body?.cancel();outgoing.end();}else Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);
 }catch{if(!outgoing.headersSent){outgoing.writeHead(503,{...headers,'Content-Type':'application/json'});outgoing.end(JSON.stringify({ok:false,code:'LOCAL_REPORT_UNAVAILABLE'}));}else outgoing.destroy();}});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({url:origin+'/admin/music/reports/?fixture=healthy',sample:{from:runtime.content.sample.from,to:runtime.content.sample.to,trackA:runtime.content.sample.trackA,clipId:runtime.content.sample.clipId},fixtureModes:modes})));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{void runtime.close().finally(()=>process.exit());}));
