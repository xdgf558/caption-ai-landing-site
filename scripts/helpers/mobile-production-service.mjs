// Local test transport only. Never imported by a product entry or deployed.
import {createServer} from 'node:http';
import {constants} from 'node:fs';
import {lstat,open,unlink,link} from 'node:fs/promises';
import {resolve,parse,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';

const ORIGIN = 'https://wwwstationcat.org';
const REQUEST_LIMIT = 512, INPUT_LIMIT = 64 * 1024, OUTPUT_LIMIT = 1024 * 1024, DEADLINE_MS = 5000;
const methods = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE']);
const allowedHeaders = new Set(['authorization','cookie','origin','content-type','range','if-range','idempotency-key','accept']);
class BridgeError extends Error {
  constructor(code,status=400) {super(code);this.code=code;this.status=status;}
}
const requireValue = (ok,code='INVALID_REQUEST',status=400) => {if(!ok)throw new BridgeError(code,status);};
const digest = value => createHash('sha256').update(value).digest();
const object = value => value && typeof value === 'object' && !Array.isArray(value);

async function privateDirectory(value) {
  requireValue(typeof value === 'string' && isAbsolute(value),'PRIVATE_DIRECTORY_REQUIRED');
  const directory = resolve(value), root = parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split('/').filter(Boolean)) {
    current = join(current,part);
    const info = await lstat(current);
    requireValue(info.isDirectory() && !info.isSymbolicLink(),'PRIVATE_DIRECTORY_REQUIRED');
  }
  const info = await lstat(directory);
  requireValue(info.uid === process.getuid() && (info.mode & 0o777) === 0o700,'PRIVATE_DIRECTORY_REQUIRED');
  return directory;
}

function rawRequest(value,signal) {
  requireValue(object(value) && Object.keys(value).every(key => ['url','method','headers','bodyBase64'].includes(key)));
  requireValue(typeof value.url === 'string' && Buffer.byteLength(value.url) <= 8192 &&
    value.url.startsWith(ORIGIN + '/') && !value.url.includes('#'),'URL_REJECTED');
  let url;
  try {url = new URL(value.url);} catch {throw new BridgeError('URL_REJECTED');}
  requireValue(url.origin === ORIGIN && !url.username && !url.password && url.href === value.url,'URL_REJECTED');
  requireValue(/^\/api\/mobile\/v1\/[A-Za-z0-9_/-]+$/.test(url.pathname) ||
    /^\/auth\/mobile\/(authorize|callback)$/.test(url.pathname) ||
    url.pathname === '/.well-known/apple-app-site-association','ROUTE_REJECTED');
  requireValue(methods.has(value.method),'METHOD_REJECTED');
  requireValue(object(value.headers),'HEADERS_REJECTED');
  const headers = new Headers();
  for (const [key,entry] of Object.entries(value.headers)) {
    requireValue(allowedHeaders.has(key) && typeof entry === 'string' && Buffer.byteLength(entry) <= 8192 &&
      !/[\0\r\n]/.test(entry),'HEADERS_REJECTED');
    try {headers.set(key,entry);} catch {throw new BridgeError('HEADERS_REJECTED');}
  }
  let body;
  if (Object.hasOwn(value,'bodyBase64')) {
    requireValue(typeof value.bodyBase64 === 'string' &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bodyBase64),'BODY_REJECTED');
    body = Buffer.from(value.bodyBase64,'base64');
    requireValue(body.toString('base64') === value.bodyBase64 && !['GET','HEAD'].includes(value.method),'BODY_REJECTED');
  }
  try {return new Request(value.url,{method:value.method,headers,body,redirect:'manual',signal});}
  catch {throw new BridgeError('INVALID_REQUEST');}
}

function raceAbort(work,signal) {
  if(signal.aborted)return Promise.reject(signal.reason);
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve(work).then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}

function readInput(request,signal) {
  return new Promise((resolve,reject) => {
    const chunks = [];let size = 0;
    const cleanup = () => {
      request.removeListener('data',data);request.removeListener('end',end);
      request.removeListener('error',failed);request.removeListener('aborted',failed);
      signal.removeEventListener('abort',aborted);
    };
    const fail = error => {cleanup();request.pause();reject(error);};
    const failed = () => fail(new BridgeError('BODY_REJECTED'));
    const aborted = () => fail(signal.reason);
    const data = chunk => {
      size += chunk.length;
      if(size > INPUT_LIMIT)return fail(new BridgeError('REQUEST_TOO_LARGE',413));
      chunks.push(chunk);
    };
    const end = () => {cleanup();resolve(Buffer.concat(chunks,size));};
    request.on('data',data);request.once('end',end);request.once('error',failed);request.once('aborted',failed);
    signal.addEventListener('abort',aborted,{once:true});
    if(signal.aborted)aborted();
  });
}

async function responseEnvelope(response,signal) {
  // Miniflare returns its own Response class, outside Node's global realm.
  requireValue(response && Number.isInteger(response.status) && response.status >= 200 && response.status <= 599 &&
    typeof response.headers?.keys === 'function' && typeof response.headers?.get === 'function' &&
    (!response.body || typeof response.body.getReader === 'function'),'FIXTURE_FAILED',502);
  const headers = {};
  // get() retains all combined header values, including multiple Set-Cookie
  // values, instead of silently dropping duplicates with Object.fromEntries().
  for(const key of response.headers.keys())headers[key.toLowerCase()] = response.headers.get(key);
  let size = 0;const chunks = [], reader = response.body?.getReader();
  if(reader)try {
    requireValue(!(Number(response.headers.get('content-length')) > OUTPUT_LIMIT),'RESPONSE_TOO_LARGE',502);
    while(true) {
      const {done,value} = await raceAbort(reader.read(),signal);
      if(done)break;
      size += value.byteLength;
      requireValue(size <= OUTPUT_LIMIT,'RESPONSE_TOO_LARGE',502);
      chunks.push(Buffer.from(value));
    }
  } finally {void reader.cancel().catch(() => {});}
  return {status:response.status,headers,bodyBase64:Buffer.concat(chunks,size).toString('base64')};
}

function send(response,status,value) {
  if(response.destroyed || response.writableEnded)return;
  const body = Buffer.from(JSON.stringify(value));
  requireValue(body.length <= OUTPUT_LIMIT,'RESPONSE_TOO_LARGE',502);
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Content-Length':body.length,...(status === 200 ? {} : {Connection:'close'})});
  response.end(body);
}

export async function startProductionBridge(fixture,{directory}={}) {
  requireValue(object(fixture) && object(fixture.bootstrap) && typeof fixture.dispatch === 'function' &&
    typeof fixture.evidence === 'function' && typeof fixture.close === 'function','FIXTURE_REQUIRED');
  let state;
  try {state = await privateDirectory(directory);} catch(error) {await fixture.close();throw error;}
  const readyPath = join(state,'ready.json');
  const key = randomBytes(32).toString('base64url'), expected = digest(key);
  const sockets = new Set(), controllers = new Set();
  let requests = 0, port, readyIdentity, closing;
  const server = createServer({maxHeaderSize:8192},async(request,response) => {
    const controller = new AbortController();controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new BridgeError('REQUEST_TIMEOUT',408)),DEADLINE_MS);
    const disconnected = () => {if(!response.writableEnded)controller.abort(new BridgeError('CLIENT_CLOSED',400));};
    response.once('close',disconnected);
    try {
      requireValue(++requests <= REQUEST_LIMIT,'REQUEST_LIMIT',429);
      const supplied = typeof request.headers['x-production-probe-key'] === 'string' ? request.headers['x-production-probe-key'] : '';
      const proofCount = request.rawHeaders.filter((_,i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === 'x-production-probe-key').length;
      const proofMatches = timingSafeEqual(digest(supplied),expected);
      requireValue(proofMatches && proofCount === 1,'PROBE_KEY_REQUIRED',403);
      requireValue(request.headers.host === `127.0.0.1:${port}` && request.socket.remoteAddress === '127.0.0.1','LOOPBACK_REQUIRED',403);
      requireValue(['/request','/fixture/bootstrap','/fixture/evidence'].includes(request.url),'ROUTE_REJECTED',404);
      requireValue(request.method === (request.url === '/request' ? 'POST' : 'GET'),'METHOD_REJECTED',405);
      requireValue(!(Number(request.headers['content-length']) > INPUT_LIMIT),'REQUEST_TOO_LARGE',413);
      const input = await readInput(request,controller.signal);
      if(request.url !== '/request') {
        requireValue(input.length === 0,'BODY_REJECTED');
        return send(response,200,request.url === '/fixture/bootstrap' ? fixture.bootstrap :
          await raceAbort(Promise.resolve().then(() => fixture.evidence()),controller.signal));
      }
      requireValue(request.headers['content-type']?.split(';')[0].trim() === 'application/json','CONTENT_TYPE_REJECTED',415);
      let value;
      try {value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input));}
      catch {throw new BridgeError('INVALID_JSON');}
      const dispatched = Promise.resolve().then(() => fixture.dispatch(rawRequest(value,controller.signal)));
      // An aborted/late dispatch can never be delivered or leave an unread body.
      dispatched.then(result => {if(controller.signal.aborted)void result?.body?.cancel().catch(() => {});},() => {});
      const result = await raceAbort(dispatched,controller.signal);
      send(response,200,await responseEnvelope(result,controller.signal));
    } catch(error) {
      const expected = error instanceof BridgeError;
      try {send(response,expected ? error.status : 502,{error:{code:expected ? error.code : 'FIXTURE_FAILED'}});} catch {response.destroy();}
    } finally {
      clearTimeout(timer);controllers.delete(controller);response.removeListener('close',disconnected);
    }
  });
  server.maxConnections = 16;server.maxHeadersCount = 32;
  server.headersTimeout = 5000;server.requestTimeout = 10000;server.keepAliveTimeout = 1000;
  server.on('connection',socket => {sockets.add(socket);socket.once('close',() => sockets.delete(socket));});
  server.on('clientError',(_error,socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  const close = () => closing ||= (async() => {
    for(const controller of controllers)controller.abort(new BridgeError('SERVICE_CLOSED',503));
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve => server.close(resolve));
    try {
      if(readyIdentity)try {
        const now = await lstat(readyPath);
        if(now.dev === readyIdentity.dev && now.ino === readyIdentity.ino)await unlink(readyPath);
      } catch(error) {if(error.code !== 'ENOENT')throw error;}
    } finally {await fixture.close();}
  })();
  try {
    await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    port = server.address().port;
    await privateDirectory(state);
    const pendingPath = join(state,'.production-ready-' + randomBytes(16).toString('hex'));
    const file = await open(pendingPath,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,0o600);
    try {
      readyIdentity = await file.stat();
      await file.writeFile(JSON.stringify({schemaVersion:1,port,key}));
      await file.sync();
      // Publish complete JSON atomically without replacing an existing file.
      await link(pendingPath,readyPath);
    } finally {await file.close();await unlink(pendingPath);}
    return {port,key,close};
  } catch(error) {await close();throw error;}
}

async function main() {
  let fixture,bridge,stopping = false,bridgeOwnsFixture = false;
  const stop = async() => {
    if(stopping)return;stopping = true;
    // During startup, the awaited initializer performs cleanup when it resumes.
    try {if(bridge)await bridge.close();}
    catch {process.stderr.write('Production probe shutdown failed.\n');process.exitCode = 1;}
  };
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,stop);
  try {
    requireValue(process.argv.length === 3,'PRIVATE_DIRECTORY_REQUIRED');
    const directory = await privateDirectory(process.argv[2]);
    const signals = ['SIGINT','SIGTERM'];
    const existing = new Map(signals.map(signal => [signal,new Set(process.rawListeners(signal))]));
    const {createProductionFixture} = await import('./mobile-production-fixture.mjs');
    fixture = await createProductionFixture();
    // The pinned Miniflare installs synchronous signal exits. This standalone
    // CLI owns shutdown so it can await dispose and remove the private ready
    // file. Keep preexisting handlers and Miniflare's process-exit safety hook;
    // importing startProductionBridge never changes process signal listeners.
    for(const signal of signals)for(const listener of process.rawListeners(signal)) {
      if(!existing.get(signal).has(listener))process.removeListener(signal,listener);
    }
    if(stopping){await fixture.close();return;}
    bridgeOwnsFixture = true;
    bridge = await startProductionBridge(fixture,{directory});
    if(stopping){await bridge.close();return;}
    process.stdout.write('Local production probe ready; outbound traffic disabled.\n');
  } catch {
    try {if(bridge)await bridge.close();else if(fixture && !bridgeOwnsFixture)await fixture.close();} catch {}
    process.stderr.write('Production probe startup failed.\n');process.exitCode = 1;
  }
}
if(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)await main();
