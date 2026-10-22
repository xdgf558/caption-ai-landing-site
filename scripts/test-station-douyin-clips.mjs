import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { douyinIDFromURL, douyinShortURL } from '../src/redesign/douyinClip.js';
import { publicationFormReady, listAssetState } from '../src/scripts/stationWorkbenchState.js';
import { draftData, viewData } from '../src/redesign/contentAdminModel.js';
import { createContentAdminRuntime } from './helpers/station-content-admin-runtime.mjs';

const id = '7000000000000000001'; // Synthetic identifier; no request is made to Douyin.
const metadata = { originalLocale: 'zh-Hans', title: { 'zh-Hans': '隔离短片夹具' } };
const data = { metadata, douyinURL: `https://www.douyin.com/video/${id}?region=CN`, douyinEmbeddingConfirmed: true };
test('only strict Douyin video identities are stored and short/share URLs never persist', () => {
  for (const value of [`https://www.douyin.com/video/${id}`, `https://www.iesdouyin.com/share/video/${id}/?region=CN`]) assert.equal(douyinIDFromURL(value), id);
  for (const value of [`http://www.douyin.com/video/${id}`, `https://www.douyin.com.evil.test/video/${id}`, `https://www.douyin.com@evil.test/video/${id}`, `https://www.douyin.com:443/video/${id}`, `https://www.douyin.com/video/%37${id.slice(1)}`, `https://www.douyin.com/a/../video/${id}`, `https://www.douyin.com/video/${id}#x`, `https://www.douyin.com/video/${id}?redirect=https://evil.test`, `https://www.douyin.com/video/${id}?region=CN&region=US`, 'https://v.douyin.com/ABC123/', 'https://www.douyin.com/user/7000000000000000001']) assert.equal(douyinIDFromURL(value), null, value);
  const saved = draftData('clips', data);
  assert.deepEqual(JSON.parse(saved.metadata_json).douyin, { videoId: id, embeddingConfirmed: true });
  assert(!saved.metadata_json.includes('region'));
  assert.equal(viewData('clips',saved).douyinURL, `https://www.douyin.com/video/${id}`);
  for (const patch of [{ douyinEmbeddingConfirmed: false }, { mediaAssetId: randomUUID() }, { youtubeURL:'https://youtu.be/abcdefghijk',youtubeEmbeddingConfirmed:true }, { durationMs: 30 }, {subtitles: []}, {subtitles: 'text'}, { metadata: { ...metadata, douyin: { videoId: id } } }]) assert.throws(() => draftData('clips', { ...data, ...patch }));
});

test('admin enables a confirmed Douyin draft without requiring local media and labels its source honestly', () => {
  const options = { identity: {role:'publisher'}, busy:false, pending:false, dirty:false, type:'clips', assets:[], current:{draft:{data}} };
  assert.equal(publicationFormReady(options),true);
  for(const patch of [{dirty:true},{busy:true},{pending:true},{identity:{role:'editor'}},{current:{draft:{data:{...data,douyinEmbeddingConfirmed:false}}}}]) assert.equal(publicationFormReady({...options,...patch}),false);
  assert.equal(listAssetState({type:'clips',clipProvider:'douyin',expectedAssetCount:0,assetDetails:[]}), 'external');
  assert.equal(listAssetState({type:'clips',clipProvider:'file',expectedAssetCount:2,assetDetails:[]}), 'missing');
});

test('real Worker/D1 publication, compatibility, replay, revocation and rollback of Douyin clips', async t => {
  const f = await createContentAdminRuntime(); t.after(() => f.close());
  const base = '/admin/api/music/site-content', track = f.content.tracks[0];
  const send = async (path, { method = 'GET', body, version = 1, key = randomUUID() } = {}) => {
    const r = await f.mf.dispatchFetch('http://content.local.test' + path, { method, headers: {
      'Cf-Access-Jwt-Assertion': f.actorToken, 'CF-Connecting-IP': '192.0.2.55', Origin: 'http://content.local.test',
      'X-Requested-With': 'StationCatMusicAdmin', 'Content-Type': 'application/json', 'If-Match': `"edit-${version}"`, 'Idempotency-Key': key
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  for (const [path, body, method] of [
    [base + '/tracks', { trackId: track.id, data: { metadata: track.metadata, coverAssetId: track.cover, siteAudioMode: 'none' } }, 'POST'],
    [base + '/assets/' + track.cover + '/rights', { scope: 'cover', status: 'approved', basis: '隔离合成素材，仅测试' }, 'PUT'],
    [base + '/tracks/' + track.id + '/publish', { revision: 1 }, 'POST']
  ]) { const result = await send(path, { method, body }); assert.equal(result.status, 200, JSON.stringify(result.body)); }
  assert.equal((await send(base+'/clips/resolve-douyin',{method:'POST',body:{url:`https://www.douyin.com/video/${id}`}})).body.playabilityVerified,false);
  assert.equal((await send(base+'/clips/resolve-douyin',{method:'POST',body:{url:'https://127.0.0.1/private'}})).status,422);
  const command = { method: 'POST', key: randomUUID(), body: { trackId: track.id, clipType: 'short_video', data } };
  const created = await send(base + '/clips', command); assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal((await send(base + '/clips', command)).body.id, created.body.id);
  const clip = created.body.id, path = '/api/station/content/tracks/' + track.slug + '/clips';
  assert.deepEqual((await send(path + '?include=douyin')).body.items, []);
  assert.equal((await send(base + '/clips/' + clip + '/publish', { method: 'POST', body: { revision: 1 } })).status, 200);
  assert.deepEqual((await send(path)).body.items, []); // Existing clients/web pages stay file-only.
  assert.deepEqual((await send('/api/station/content/clips')).body.items, []);
  for (const suffix of ['?include=all', '?include=douyin&include=douyin', '?include=', '?include=douyin,douyin', '?include=youtube,douyin,youtube', '?include=douyin,', '?include=douyin,%20youtube', '?include=Douyin']) assert.equal((await send(path + suffix)).status, 400);
  assert.equal((await send('/api/station/content/clips?include=douyin')).status, 400);
  assert.deepEqual((await send(path + '?include=youtube')).body.items, []);
  assert.equal((await send(path + '?include=youtube,douyin')).body.items.length, 1);
  assert.deepEqual((await send(path + '?include=douyin,youtube')).body.items, (await send(path + '?include=youtube,douyin')).body.items);
  const listed=await send(base+'/clips');assert.equal(listed.body.items[0].clipProvider,'douyin');assert.equal(listed.body.items[0].expectedAssetCount,0);
  const live = await send(path + '?include=douyin'); assert.equal(live.status, 200); assert.equal(live.headers.get('cache-control'), 'no-store');
  assert.equal(live.body.items.length, 1); const dto = live.body.items[0];
  assert.equal(dto.provider, 'douyin'); assert.equal(dto.douyinVideoId, id); assert.equal(dto.watchUrl, `https://www.douyin.com/video/${id}`);
  assert.equal(dto.mediaUrl, null); assert.equal(dto.posterUrl, null); assert.equal(dto.durationMs, null); assert.equal(dto.track.id, track.id);
  assert.doesNotMatch(JSON.stringify(dto), /embeddingConfirmed|share-token|object_key/);
  const changed = { ...data, douyinURL: 'https://www.douyin.com/video/7000000000000000002' };
  assert.equal((await send(base + '/clips/' + clip, { method: 'PATCH', version: 2, body: { revision: 1, data: changed } })).status, 200);
  assert.equal((await send(path + '?include=douyin')).body.items[0].douyinVideoId, id); // Unsaved publication pointer.
  assert.equal((await send(base + '/clips/' + clip + '/publish', { method: 'POST', version: 3, body: { revision: 2 } })).status, 200);
  assert.equal((await send(path + '?include=douyin')).body.items[0].douyinVideoId, '7000000000000000002');
  assert.equal((await send(base + '/clips/' + clip + '/unpublish', { method: 'POST', version: 4, body: { revision: 2 } })).status, 200);
  assert.deepEqual((await send(path + '?include=douyin')).body.items, []);
  assert.equal((await send(base + '/clips/' + clip + '/rollback', { method: 'POST', version: 5, body: { revision: 1 } })).status, 200);
  assert.equal((await send(path + '?include=douyin')).body.items[0].douyinVideoId, id);
  assert.equal((await send(base + '/tracks/' + track.id + '/unpublish', { method: 'POST', version: 2, body: { revision: 1 } })).status, 200);
  assert.equal((await send(path + '?include=douyin')).status, 404);
});

// Resolver transport is a test double; no third-party network or media request.
import { resolveDouyinURL } from '../src/redesign/douyinResolve.js';
test('short-link resolver bounds redirects, strips share data and forwards no identity', async () => {
  const seen=[];
  const result=await resolveDouyinURL('https://v.douyin.com/AbCd123/', {transport:async(url,options)=>{
    seen.push(url);assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    assert.deepEqual(options.headers,{Accept:'text/html'});
    return new Response(null,{status:302,headers:{location:`https://www.iesdouyin.com/share/video/${id}/?region=CN`}});
  }});
  assert.equal(seen.length,1);assert.equal(result.url,`https://www.douyin.com/video/${id}`);assert.equal(result.playabilityVerified,false);
  for(const location of ['https://127.0.0.1/private','http://v.douyin.com/ABC123/','https://v.douyin.com.evil.test/ABC123/','/relative','https://www.douyin.com/login','https://v.douyin.com/AbCd123/']) {
    let requests=0;
    await assert.rejects(resolveDouyinURL('https://v.douyin.com/AbCd123/',{transport:async()=>{requests++;return new Response(null,{status:302,headers:{location}});}}));
    assert.equal(requests,1);
  }
  let requests=0;
  await assert.rejects(resolveDouyinURL('https://v.douyin.com/AbCd123/',{transport:async()=>new Response(null,{status:302,headers:{location:`https://v.douyin.com/Next${++requests}/`}})}));
  assert.equal(requests,3);
});
test('resolver failures are bounded and direct identity needs no request', async () => {
  let requests=0;
  const direct=await resolveDouyinURL(`https://www.douyin.com/video/${id}`,{transport:async()=>{requests++;throw Error('unexpected');}});
  assert.equal(direct.videoId,id);assert.equal(requests,0);
  await assert.rejects(resolveDouyinURL('https://v.douyin.com/AbCd123/', {timeoutMs:10,transport:async(_,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))}));
  await assert.rejects(resolveDouyinURL('https://v.douyin.com/AbCd123/', {transport:async()=>new Response('<html>challenge</html>')}));
});

test('short links canonicalize optional trailing slash and bounded share fields without widening hosts or paths', async () => {
  const canonical='https://v.douyin.com/AbCd123/';
  for (const value of ['https://v.douyin.com/AbCd123',canonical,canonical+'?region=CN&share_sign=test-token','https://v.douyin.com/AbCd123?utm_source=app']) {
    assert.equal(douyinShortURL(value),canonical);
    const seen=[];
    const result=await resolveDouyinURL(value,{transport:async(url)=>{seen.push(url);return new Response(null,{status:302,headers:{location:`https://www.douyin.com/video/${id}`}});}});
    assert.deepEqual(seen,[canonical]);assert.equal(result.videoId,id);
  }
  for (const value of [canonical+'?unknown=1',canonical+'?region=CN&region=US',canonical+'?region='+ 'a'.repeat(257),canonical+'?redirect=https%3A%2F%2Fevil.test',canonical+'?share_sign=a%0Ab',canonical+'#x','https://v.douyin.com:443/AbCd123','https://v.douyin.com.evil.test/AbCd123','https://user@v.douyin.com/AbCd123','https://v.douyin.com/AbCd123/extra','https://v.douyin.com/%41bCd123','https://v.douyin.com/a/../AbCd123']) {
    assert.equal(douyinShortURL(value),null,value);
    let calls=0;await assert.rejects(resolveDouyinURL(value,{transport:async()=>{calls++;throw Error('unexpected request');}}));assert.equal(calls,0);
  }
  let calls=0;
  await assert.rejects(resolveDouyinURL(canonical,{transport:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://v.douyin.com/AbCd123?region=CN'}});}}));
  assert.equal(calls,1,'Canonical aliases cannot extend a redirect loop');
});

test('only publishers may resolve canonical or short Douyin URLs', async t => {
  const editor='second-content-fixture@example.test';
  const f=await createContentAdminRuntime({bindings:{STATION_CONTENT_EDITOR_EMAILS:editor}});t.after(()=>f.close());
  const token=await f.token({email:editor});
  const send=(auth,url)=>f.mf.dispatchFetch('http://content.local.test/admin/api/music/site-content/clips/resolve-douyin',{method:'POST',body:JSON.stringify({url}),headers:{'Cf-Access-Jwt-Assertion':auth,'Content-Type':'application/json','X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':randomUUID(),Origin:'http://content.local.test'}});
  for (const url of [`https://www.douyin.com/video/${id}`,'https://v.douyin.com/AbCd123']) {
    const response=await send(token,url);assert.equal(response.status,403);assert.match(await response.text(),/STATION_PUBLISHER_REQUIRED/);
  }
  const response=await send(f.actorToken,`https://www.douyin.com/video/${id}`);assert.equal(response.status,200);assert.equal((await response.json()).videoId,id);
});

import { contentRequest, createContentController } from '../src/scripts/stationContentClient.js';
test('admin resolver uses the same protected request envelope without journaling share URLs', async t => {
  const key=randomUUID();let seen;
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    seen={path,options};return new Response(JSON.stringify({ok:true,url:`https://www.douyin.com/video/${id}`,playabilityVerified:false}),{headers:{'content-type':'application/json'}});
  });
  await contentRequest('/clips/resolve-douyin',{method:'POST',body:{url:'https://v.douyin.com/AbCd123/'},key});
  assert.equal(seen.path,'/admin/api/music/site-content/clips/resolve-douyin');
  assert.equal(seen.options.headers['Idempotency-Key'],key);
  assert.equal(seen.options.headers['X-Requested-With'],'StationCatMusicAdmin');
  assert.equal(seen.options.redirect,'error');
  const values=new Map(),controller=createContentController({storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},request:async()=>({actorId:'fixture',role:'publisher'})});
  await controller.connect();
  await assert.rejects(controller.mutate('/clips/resolve-douyin','POST',{url:'https://v.douyin.com/AbCd123/'}));
  assert(!JSON.stringify([...values]).includes('AbCd123'));
});
test('resolver refuses unauthenticated or cross-origin admin requests before resolution', async t => {
  const f=await createContentAdminRuntime();t.after(()=>f.close());
  const url='http://content.local.test/admin/api/music/site-content/clips/resolve-douyin';
  const input={method:'POST',body:JSON.stringify({url:`https://www.douyin.com/video/${id}`}),headers:{'Content-Type':'application/json','X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':randomUUID(),Origin:'http://content.local.test'}};
  assert.equal((await f.mf.dispatchFetch(url,input)).status,401);
  assert.equal((await f.mf.dispatchFetch(url,{...input,headers:{...input.headers,'Cf-Access-Jwt-Assertion':f.actorToken,Origin:'https://evil.invalid'}})).status,403);
});
