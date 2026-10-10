import http from 'node:http';
import { Readable } from 'node:stream';
import { createStationRouteRuntime } from './helpers/station-route-runtime.mjs';
const port = Number(process.env.STATION_ROUTE_PREVIEW_PORT || 4220);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
const runtime = await createStationRouteRuntime(), records = [];
// Default shows the user's pending-material state, not synthetic featured work.
await runtime.db.prepare("UPDATE station_home_configs SET status='draft'").run();
const previewHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const server = http.createServer(async (incoming, outgoing) => {
  if (!['GET','HEAD'].includes(incoming.method) || !['127.0.0.1:'+port,'localhost:'+port].includes(incoming.headers.host) ||
    !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
    outgoing.writeHead(405,{...previewHeaders,Allow:'GET, HEAD'});outgoing.end();return;
  }
  try {
    const url = new URL(incoming.url,'http://127.0.0.1:'+port);
    // Never forward a user's real cookies, credentials or arbitrary host.
    const headers = { 'CF-Connecting-IP':'192.0.2.120' };
    for (const name of ['accept','range','if-none-match']) if (incoming.headers[name]) headers[name]=incoming.headers[name];
    const response = url.pathname === '/__preview/requests' ? Response.json({ production:false, defaultHome:'draft', records },{headers:previewHeaders}) :
      await runtime.mf.dispatchFetch(url,{method:incoming.method,headers,redirect:'manual'});
    records.push({method:incoming.method,pathname:url.pathname,status:response.status});if(records.length>1000)records.shift();
    outgoing.writeHead(response.status,{...Object.fromEntries(response.headers),...previewHeaders});
    if (incoming.method==='HEAD'||!response.body) {await response.body?.cancel();outgoing.end();}
    else Readable.fromWeb(response.body).on('error',()=>outgoing.destroy()).pipe(outgoing);
  } catch {outgoing.writeHead(503,previewHeaders);outgoing.end('Local preview unavailable');}
});
server.listen(port,'127.0.0.1',()=>console.log('T20 isolated preview: http://127.0.0.1:'+port+'/ (pending home; synthetic catalogs; no outbound network)'));
let closing = false;
async function close(){if(closing)return;closing=true;server.close();await runtime.close();process.exit(0);}
process.once('SIGINT',close);process.once('SIGTERM',close);
