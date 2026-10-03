import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,stat,rm,chmod,symlink,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {startProductionBridge} from './helpers/mobile-production-service.mjs';

const origin = 'https://wwwstationcat.org';
const payload = (path='/api/mobile/v1/config',method='GET',headers={}) => ({url:origin+path,method,headers});
const json = value => ({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
async function directory() {return mkdtemp(join(await realpath(tmpdir()),'production-bridge-test-'));}
function stub() {
  const calls = [], state = {closed:0};
  return {calls,state,bootstrap:{schemaVersion:1,origin,account:{id:'1',identifier:'synthetic',password:'synthetic-password'}},
    async dispatch(request) {calls.push(request);return new Response('fixture body',{status:200,headers:{'X-Fixture':'synthetic'}});},
    async evidence() {return {schemaVersion:1,requests:calls.length};},
    async close() {state.closed++;}};
}
async function harness(t,fixture=stub()) {
  const dir = await directory(), bridge = await startProductionBridge(fixture,{directory:dir});
  t.after(async() => {await bridge.close();await rm(dir,{recursive:true,force:true});});
  const call = (path,init={}) => fetch(`http://127.0.0.1:${bridge.port}${path}`,{...init,
    headers:{'X-Production-Probe-Key':bridge.key,...init.headers}});
  return {dir,bridge,fixture,call};
}
async function errorCode(response,status,code) {
  assert.equal(response.status,status);
  assert.deepEqual(await response.json(),{error:{code}});
  assert.equal(response.headers.get('cache-control'),'no-store');
}
function rawCall(bridge,path,headers={}) {
  return new Promise((resolve,reject) => {
    const request = httpRequest({host:'127.0.0.1',port:bridge.port,path,headers},response => {
      const chunks=[];response.on('data',chunk => chunks.push(chunk));
      response.on('end',() => resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));
    });
    request.once('error',reject);request.end();
  });
}

test('private readiness is complete, owner-only, loopback-scoped and removed on idempotent close',async t => {
  const {dir,bridge,fixture,call} = await harness(t);
  const ready = JSON.parse(await readFile(join(dir,'ready.json'),'utf8'));
  assert.deepEqual(ready,{schemaVersion:1,port:bridge.port,key:bridge.key});
  assert.match(bridge.key,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await stat(join(dir,'ready.json'))).mode & 0o777,0o600);
  assert.deepEqual(await (await call('/fixture/bootstrap')).json(),fixture.bootstrap);
  assert.deepEqual(await (await call('/fixture/evidence')).json(),{schemaVersion:1,requests:0});
  await errorCode(await rawCall(bridge,'/fixture/bootstrap',{'X-Production-Probe-Key':bridge.key,host:'localhost:'+bridge.port}),403,'LOOPBACK_REQUIRED');
  await bridge.close();await bridge.close();
  assert.equal(fixture.state.closed,1);
  await assert.rejects(lstat(join(dir,'ready.json')),{code:'ENOENT'});
});

test('invalid output directories and preexisting readiness cannot be adopted or overwritten',async t => {
  const dir = await directory();t.after(() => rm(dir,{recursive:true,force:true}));
  await assert.rejects(startProductionBridge(stub(),{directory:'relative'}));
  await assert.rejects(startProductionBridge(stub(),{directory:join(dir,'missing')}));
  await chmod(dir,0o755);
  await assert.rejects(startProductionBridge(stub(),{directory:dir}));
  await chmod(dir,0o700);
  const alias = dir+'-alias';await symlink(dir,alias);t.after(() => rm(alias,{force:true}));
  await assert.rejects(startProductionBridge(stub(),{directory:alias}));
  await symlink(dir,join(dir,'child-alias'));
  await assert.rejects(startProductionBridge(stub(),{directory:join(dir,'child-alias')}));
  await writeFile(join(dir,'ready.json'),'preserve',{mode:0o600});
  const fixture = stub();await assert.rejects(startProductionBridge(fixture,{directory:dir}));
  assert.equal(await readFile(join(dir,'ready.json'),'utf8'),'preserve');
  assert.equal(fixture.state.closed,1);
});

test('every control and forwarding route requires exactly one correct proof',async t => {
  const {bridge,fixture,call} = await harness(t);
  for(const path of ['/fixture/bootstrap','/fixture/evidence','/request']) {
    for(const key of ['',bridge.key.slice(1),bridge.key+'x','x'.repeat(43)]) {
      await errorCode(await call(path,{...(path === '/request' ? json(payload()) : {}),
        headers:{'content-type':'application/json','X-Production-Probe-Key':key}}),403,'PROBE_KEY_REQUIRED');
    }
  }
  assert.equal(fixture.calls.length,0);
  await errorCode(await rawCall(bridge,'/fixture/bootstrap',{'X-Production-Probe-Key':[bridge.key,bridge.key]}),403,'PROBE_KEY_REQUIRED');
  await errorCode(await call('/fixture/bootstrap?key='+bridge.key),404,'ROUTE_REJECTED');
  await errorCode(await call('/fixture/unknown'),404,'ROUTE_REJECTED');
  await errorCode(await call('/fixture/bootstrap',{method:'POST'}),405,'METHOD_REJECTED');
  await errorCode(await call('/request'),405,'METHOD_REJECTED');
});

test('forwarding never redirects and preserves raw body, status, Cookie and Location',async t => {
  const fixture = stub();
  fixture.dispatch = async request => {
    fixture.calls.push(request);
    assert.equal(request.url,origin+'/auth/mobile/authorize?locale=en');
    assert.equal(request.redirect,'manual');
    assert.equal(request.headers.get('cookie'),'synthetic-flow=1');
    assert.equal(request.headers.get('origin'),origin);
    assert.equal(request.headers.has('x-production-probe-key'),false);
    assert.equal(request.headers.has('x-production-internal-proof'),false);
    assert.equal(await request.text(),'identifier=synthetic&password=synthetic');
    return new Response(null,{status:302,headers:{'Set-Cookie':'synthetic-flow=; Secure; HttpOnly; Path=/',
      Location:origin+'/auth/mobile/callback?code=synthetic','X-Fixture':'yes'}});
  };
  const {call} = await harness(t,fixture);
  const response = await call('/request',json({...payload('/auth/mobile/authorize?locale=en','POST',
    {cookie:'synthetic-flow=1',origin,'content-type':'application/x-www-form-urlencoded'}),
    bodyBase64:Buffer.from('identifier=synthetic&password=synthetic').toString('base64')}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:302,headers:{'location':origin+'/auth/mobile/callback?code=synthetic',
    'set-cookie':'synthetic-flow=; Secure; HttpOnly; Path=/','x-fixture':'yes'},bodyBase64:''});
  assert.equal(fixture.calls.length,1);
});

test('only canonical production native URLs and supported methods enter the fixture',async t => {
  const {call,fixture} = await harness(t);
  for(const url of ['http://wwwstationcat.org/api/mobile/v1/config','https://stationcat.org/api/mobile/v1/config',
    'https://WWWSTATIONCAT.ORG/api/mobile/v1/config','https://wwwstationcat.org./api/mobile/v1/config',
    'https://wwwstationcat.org:443/api/mobile/v1/config','https://wwwstationcat.org:8443/api/mobile/v1/config',
    'https://user@wwwstationcat.org/api/mobile/v1/config','https://wwwstationcat.org.evil.test/api/mobile/v1/config',
    origin+'/api/mobile/v1/config#',origin+'/api/mobile/v1/config#secret',origin+'/api/mobile/v1/../config',
    origin+'/api/mobile/v1/%2e%2e/config','https://127.0.0.1/api/mobile/v1/config']) {
    await errorCode(await call('/request',json({...payload(),url})),400,'URL_REJECTED');
  }
  for(const path of ['/','/music/','/api/readers/register','/admin/api/music','/fixture/bootstrap',
    '/api/mobile/v2/config','/api/mobile/v1/config%2F','/auth/mobile/unknown','/auth/mobile/register','/auth/mobile/reset',
    '/.well-known/apple-app-site-association/']) {
    await errorCode(await call('/request',json(payload(path))),400,'ROUTE_REJECTED');
  }
  for(const method of ['OPTIONS','TRACE','CONNECT','get']) {
    await errorCode(await call('/request',json({...payload(),method})),400,'METHOD_REJECTED');
  }
  assert.equal(fixture.calls.length,0);
  for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE']) {
    assert.equal((await call('/request',json(payload('/api/mobile/v1/me/music/preferences',method)))).status,200);
  }
  assert.equal((await call('/request',json(payload('/.well-known/apple-app-site-association')))).status,200);
  assert.equal(fixture.calls.length,7);
});

test('header allowlist blocks proof, host, forwarding metadata, aliases and injection',async t => {
  const {call,fixture} = await harness(t);
  for(const headers of [{'x-production-internal-proof':'fake'},{'x-production-probe-key':'fake'},
    {host:'evil.test'},{'cf-connecting-ip':'127.0.0.1'},{'x-forwarded-host':'evil.test'},{'forwarded':'host=evil.test'},
    {Authorization:'Bearer synthetic'},{accept:['text/html']},{accept:'a\r\nHost: evil.test'},{accept:'a\0b'}]) {
    await errorCode(await call('/request',json({...payload(),headers})),400,'HEADERS_REJECTED');
  }
  assert.equal(fixture.calls.length,0);
  const headers = {authorization:'Bearer synthetic',cookie:'synthetic=1',origin,'content-type':'application/json',
    range:'bytes=0-5','if-range':'"synthetic"','idempotency-key':'synthetic-key',accept:'application/json'};
  assert.equal((await call('/request',json(payload('/api/mobile/v1/config','GET',headers)))).status,200);
  assert.deepEqual(Object.fromEntries(fixture.calls[0].headers),headers);
});

test('JSON/base64 shape and input byte budget are enforced before dispatch',async t => {
  const {call,fixture} = await harness(t);
  await errorCode(await call('/request',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'}),415,'CONTENT_TYPE_REJECTED');
  await errorCode(await call('/request',{method:'POST',headers:{'content-type':'application/json'},body:'{"secret":'}),400,'INVALID_JSON');
  await errorCode(await call('/request',json({...payload(),unexpected:'synthetic'})),400,'INVALID_REQUEST');
  for(const bodyBase64 of ['?','AAA','AB==',3]) {
    await errorCode(await call('/request',json({...payload('/api/mobile/v1/auth/token','POST'),bodyBase64})),400,'BODY_REJECTED');
  }
  await errorCode(await call('/request',json({...payload(),bodyBase64:''})),400,'BODY_REJECTED');
  await errorCode(await call('/request',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(65537)}),413,'REQUEST_TOO_LARGE');
  assert.equal(fixture.calls.length,0);
});

test('response and evidence budgets fail with categories, never input or exception text',async t => {
  const fixture = stub(), {call} = await harness(t,fixture);
  fixture.dispatch = async() => new Response('x'.repeat(1024*1024));
  await errorCode(await call('/request',json(payload())),502,'RESPONSE_TOO_LARGE');
  fixture.dispatch = async() => new Response(new Uint8Array(1024*1024+1));
  await errorCode(await call('/request',json(payload())),502,'RESPONSE_TOO_LARGE');
  fixture.evidence = async() => ({rows:'x'.repeat(1024*1024)});
  await errorCode(await call('/fixture/evidence'),502,'RESPONSE_TOO_LARGE');
  fixture.dispatch = async() => {throw Error('secret password and media token must never appear');};
  await errorCode(await call('/request',json(payload())),502,'FIXTURE_FAILED');
});

test('unfinished request bodies and stalled fixture responses have an absolute deadline',async t => {
  const {bridge,call,fixture} = await harness(t);
  const slowInput = new Promise((resolve,reject) => {
    const request = httpRequest({host:'127.0.0.1',port:bridge.port,path:'/request',method:'POST',
      headers:{'X-Production-Probe-Key':bridge.key,'Content-Type':'application/json','Content-Length':'100'}},response => {
      let body='';response.on('data',chunk => body+=chunk);response.on('end',() => resolve({status:response.statusCode,body}));
    });
    request.on('error',reject);request.flushHeaders();request.write('{');
  });
  fixture.dispatch = async request => {fixture.calls.push(request);return new Response(new ReadableStream({start(){}}));};
  const stalledResponse = call('/request',json(payload()));
  const [slow,result] = await Promise.all([slowInput,stalledResponse]);
  assert.equal(slow.status,408);assert.deepEqual(JSON.parse(slow.body),{error:{code:'REQUEST_TIMEOUT'}});
  await errorCode(result,408,'REQUEST_TIMEOUT');
  assert.equal(fixture.calls[0].signal.aborted,true);
});

test('the lifetime request budget bounds evidence and blocks additional dispatches',async t => {
  const {call,fixture} = await harness(t);
  for(let i=0;i<512;i++) {const response=await call('/fixture/evidence');assert.equal(response.status,200);await response.json();}
  await errorCode(await call('/request',json(payload())),429,'REQUEST_LIMIT');
  assert.equal(fixture.calls.length,0);
});

test('CLI starts the real production fixture without outbound requests and shuts down cleanly',async t => {
  const dir = await directory();t.after(() => rm(dir,{recursive:true,force:true}));
  const child = spawn(process.execPath,[resolve('scripts/helpers/mobile-production-service.mjs'),dir],
    {cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk => output+=chunk);child.stderr.on('data',chunk => output+=chunk);
  const exited = new Promise(resolve => child.once('exit',(code,signal) => resolve({code,signal})));
  t.after(async() => {if(child.exitCode === null && child.signalCode === null)child.kill('SIGTERM');await exited;});
  let ready;
  for(let i=0;i<600;i++) {
    assert.equal(child.exitCode,null,'Production fixture process stopped before readiness');
    try {ready=JSON.parse(await readFile(join(dir,'ready.json'),'utf8'));break;}
    catch(error) {if(error.code !== 'ENOENT')throw error;}
    await sleep(100);
  }
  assert.ok(ready,'Production fixture readiness timeout');
  const call = (path,init={}) => fetch(`http://127.0.0.1:${ready.port}${path}`,{...init,headers:{'X-Production-Probe-Key':ready.key,...init.headers}});
  const bootstrap = await (await call('/fixture/bootstrap')).json();
  assert.equal(bootstrap.origin,origin);assert.equal(bootstrap.schemaVersion,1);
  const response = await call('/request',json(payload()));
  assert.equal(response.status,200);
  const envelope = await response.json();assert.equal(envelope.status,200);
  const config = JSON.parse(Buffer.from(envelope.bodyBase64,'base64').toString());
  assert.equal(config.data.capabilities.nativeAuthentication,true);
  assert.equal(config.data.capabilities.accountDeletion,false);
  const evidence = await call('/fixture/evidence');assert.equal(evidence.status,200);
  const report = await evidence.json();assert.equal(report.outboundRequests,0);assert.equal(report.hasProductionSideEffects,false);
  child.kill('SIGTERM');assert.deepEqual(await exited,{code:0,signal:null});
  for(const secret of [ready.key,bootstrap.account.password,bootstrap.vipAccount.password])assert.ok(!output.includes(secret));
  assert.doesNotMatch(output,/https:\/\/|stack|Error:/);
  await assert.rejects(lstat(join(dir,'ready.json')),{code:'ENOENT'});
});
