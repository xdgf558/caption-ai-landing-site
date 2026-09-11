import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicReturnPath, musicMembershipHref, readMusicMembershipEntry, musicShareUrl, shareMusicLink, MUSIC_RETURN_HASH } from '../src/music/navigation.js';
import { musicPagePaths } from '../src/music/pagePaths.js';
import { readMusicSelectionCatalog, readMusicLookup } from '../src/scripts/musicCatalogSelection.js';
import { createMusicReturnSync, musicReturnStatus } from '../src/scripts/musicReturnSync.js';
import { mountMusicMemberReturn } from '../src/scripts/musicMemberReturn.js';
import { createMusicAccessLifecycle } from '../src/scripts/musicAccessLifecycle.js';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicQueue } from '../src/scripts/musicPlayerQueue.js';
import { browseMusic } from '../src/scripts/musicLibrary.js';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { tracks as fixtures } from './fixtures/music-player/data.mjs';

const A=fixtures[0], B=fixtures[1], C=fixtures[2];
const catalog = (tracks, collections=[]) => ({ schemaVersion:2, tracks, collections });
const group = (tracks, slug='quiet') => ({ id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug, title:'Quiet', description:'Original test playlist', trackIds:tracks.map(t=>t.id) });
const response = (body,status=200) => ({ status, body });
const flush = async () => { for (let i=0;i<15;i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
function clock() {
  let time=0,id=0; const timers=new Map();
  return { now:()=>time, setTimer(fn,ms) {const n=++id;timers.set(n,{fn,at:time+ms});return n;}, clearTimer:n=>timers.delete(n),
    async advance(ms) {const end=time+ms;for(let n=0;n<200;n++){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();await flush();assert.ok(n<199,'bounded timers');}time=end;await flush();}, timers };
}

test('share links use canonical locale routes and public IDs only, with one target per link', () => {
  for(const [locale,path] of Object.entries(musicPagePaths)) {
    const url=musicShareUrl('https://station.test',locale,{track:A.id,collection:'quiet',token:'secret',isVip:true});
    assert.equal(url,`https://station.test${path}?track=${A.id}`);
    assert.equal(musicShareUrl('https://station.test',locale,{collection:'quiet'}),`https://station.test${path}?collection=quiet`);
  }
  assert.throws(()=>musicShareUrl('https://user:secret@station.test','en',{track:A.id}));
  assert.throws(()=>musicShareUrl('https://station.test/path','en',{track:A.id}));
  assert.throws(()=>musicShareUrl('https://station.test','en',{track:'x&token=secret'}));
});
test('music return allowlist rejects external, encoded, malformed and non-music paths; strips unrelated queries', () => {
  for(const value of ['https://evil.test/music/','//evil.test/music/','/\\evil.test/music/','/%255cevil.test/music/','/x/..//evil.test','/en/library/','/music/tracks/abc','/%6dusic/','/music/%','/music/\n','/music/?x=%','/music/?x=%255c']) assert.equal(musicReturnPath(value),null,value);
  assert.equal(musicReturnPath(`/zh-hant/music/?track=${A.id}&collection=quiet&token=secret&payment=success#vip`),`/music/?track=${A.id}&collection=quiet`);
  assert.equal(musicReturnPath(`/en/music?track=${A.id}&track=${B.id}`),'/en/music/');
});
test('membership paths round-trip four locales without identity, and reject duplicate navigation parameters', () => {
  for(const locale of Object.keys(musicPagePaths)) {
    const href=musicMembershipHref(locale,`track=${A.id}&collection=quiet&token=secret`),url=new URL(href,'https://station.test');
    assert.equal(url.pathname,`/${locale==='zh-Hant'?'zh-hant':locale==='zh-Hans'?'zh-hans':locale}/library/`);
    assert.equal(readMusicMembershipEntry(url.search),`${musicPagePaths[locale]}?track=${A.id}&collection=quiet`);
    assert.doesNotMatch(href,/secret|token|payment|isVip/);
    assert.equal(readMusicMembershipEntry(url.search+'&source=music'),null);
    assert.equal(readMusicMembershipEntry(url.search+'&returnTo=/music/'),null);
  }
});
test('native share is invoked in the gesture; cancellation never copies; unsupported/failed clipboard exposes manual fallback', async () => {
  const link={url:musicShareUrl('https://station.test','en',{track:A.id}),title:A.title}; let shared=0,copied=0;
  const pending=shareMusicLink(link,{navigator:{share:()=>{shared++;return Promise.resolve();}}});assert.equal(shared,1);assert.equal((await pending).status,'shared');
  const cancel=await shareMusicLink(link,{navigator:{share:()=>Promise.reject({name:'AbortError'}),clipboard:{writeText:()=>{copied++;}}}});
  assert.equal(cancel.status,'cancelled');assert.equal(copied,0);
  const fallback=await shareMusicLink(link,{navigator:{share:()=>Promise.reject(new Error('unsupported')),clipboard:{writeText:async url=>{assert.equal(url,link.url);copied++;}}}});
  assert.equal(fallback.status,'copied');assert.equal(copied,1);
  const direct=shareMusicLink(link,{copyOnly:true,navigator:{share:()=>assert.fail('native share'),clipboard:{writeText:()=>{copied++;return Promise.resolve();}}}});
  assert.equal(copied,2);assert.equal((await direct).status,'copied');
  assert.equal((await shareMusicLink(link,{navigator:{}})).status,'manual');
  assert.equal((await shareMusicLink(link,{navigator:{clipboard:{writeText:()=>Promise.reject(new Error('denied'))}}})).status,'manual');
});
test('member return banner only offers a validated explicit link; checkout retains the same public navigation context', () => {
  const a={},p={},root={hidden:true,querySelector:s=>s==='a'?a:p};
  const entry=mountMusicMemberReturn(root,{locale:'en',search:new URL(musicMembershipHref('en',`track=${A.id}`),'https://station.test').search});
  assert.equal(root.hidden,false);assert.equal(a.href,`/en/music/?track=${A.id}${MUSIC_RETURN_HASH}`);assert.equal(a.textContent,'Return to music');
  assert.equal(entry.checkoutReturnPath,musicMembershipHref('en',`track=${A.id}`));
  const untouched={hidden:true,querySelector:()=>assert.fail()};
  assert.equal(mountMusicMemberReturn(untouched,{locale:'en',search:'?source=music&returnTo=https://evil.test'}),null);
});
test('the member page preserves existing redemption safeguards and only changes navigation around login/checkout', async () => {
  const source=await readFile(new URL('../src/components/ReaderLibraryPage.astro',import.meta.url),'utf8');
  assert.match(source,/query\.get\('source'\) === 'music' \? readerLibraryPath : safeReturnPath/);
  assert.match(source,/returnPath: musicEntry\?\.checkoutReturnPath \|\| readerLibraryPath/);
  for(const text of ["navigator.locks.request", "pendingMembershipKey(window.localStorage, accountId)", "'Idempotency-Key': pending.key", "'X-Reader-Account': String(accountId)"]) assert.ok(source.includes(text));
});

test('a track beyond the catalog window is resolved from its own endpoint without replacing the base list', async () => {
  const calls=[],result=await readMusicSelectionCatalog(catalog([A]),{locale:'en',selection:{track:B.id},read:async path=>{calls.push(path);return response({schemaVersion:2,track:{...B,token:'secret'}});}});
  assert.deepEqual(calls,[`/api/music/tracks/${B.id}?locale=en`]);assert.deepEqual(result.view.catalogTracks.map(t=>t.id),[A.id]);
  assert.deepEqual(result.tracks.map(t=>t.id),[A.id,B.id]);assert.equal(result.tracks[1].token,undefined);
});
test('a shared collection reads its complete public order, including songs outside the current catalog', async () => {
  const collection=group([C,B,A]);
  const result=await readMusicSelectionCatalog(catalog([A],[group([A])]),{locale:'en',selection:{collection:'quiet',track:B.id},read:async path=>{assert.match(path,/collections\/quiet/);return response({...catalog([A,B,C]),collection});}});
  assert.deepEqual(browseMusic(result.view.selectedCollection.tracks,result.collections,{collection:'quiet'}).map(t=>t.id),[C.id,B.id,A.id]);
  assert.equal(result.view.catalogTracks.length,1);assert.equal(result.tracks.length,3);
});
test('retained queue metadata does not stand in for the current active or requested track read', async () => {
  const calls=[],result=await readMusicSelectionCatalog(catalog([A]),{locale:'en',selection:{track:C.id},activeId:B.id,retained:[B,C],read:async path=>{calls.push(path);return response({},410);}});
  assert.equal(calls.length,2);assert.deepEqual(result.tracks.map(t=>t.id),[A.id]);assert.equal(result.view.issues.track,'missing');
});
test('wrong identities, schema, collection membership and network failures never become valid shared targets', async () => {
  for(const result of [response({schemaVersion:2,track:A}),response({schemaVersion:3,track:B}),response({},503)]) {
    const value=await readMusicSelectionCatalog(catalog([A]),{locale:'en',selection:{track:B.id},read:async()=>result});
    assert.equal(value.view.issues.track,'unavailable');assert.equal(value.tracks.some(t=>t.id===B.id),false);
  }
  const bad=await readMusicSelectionCatalog(catalog([A]),{locale:'en',selection:{collection:'quiet'},read:async()=>response({...catalog([B]),collection:group([A])})});
  assert.equal(bad.view.issues.collection,'unavailable');assert.equal(bad.collections.length,0);
});
test('separate 500-row responses can form a bounded lookup while the queue still caps at 500', async () => {
  const rows=Array.from({length:1503},(_,i)=>({...A,id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`}));
  assert.equal(readMusicLookup(rows.slice(0,1502)).length,1502);assert.throws(()=>readMusicLookup(rows));assert.throws(()=>readMusicLookup([...rows.slice(0,500),rows[0]]));
  const audio=new Audio(),player=createMusicPlayer(audio,{origin:'https://station.test'}),queue=createMusicQueue(player);
  queue.updateCatalog(rows.slice(0,1000));queue.append(rows.slice(500,1000));assert.equal(queue.snapshot().items.length,500);
  queue.append([rows[0]]);assert.equal(queue.snapshot().items.length,500);assert.equal(audio.src,'');queue.destroy();player.destroy();
});

const anonymous={authenticated:false,membershipStatus:'none',canPlayVipFull:false,musicVipDeliveryEnabled:true,serverNow:'2026-09-11T00:00:00Z',validUntil:null};
const vip={...anonymous,authenticated:true,membershipStatus:'active',canPlayVipFull:true,validUntil:'2026-09-11T01:00:00Z'};
test('browsing B outside the catalog keeps playing A and its queue; fresh metadata still uses the original playback guard', async t => {
  const audio=new Audio(),player=createMusicPlayer(audio,{origin:'https://station.test'}),queue=createMusicQueue(player),host=new EventTarget(),doc=new EventTarget();
  let selection={},capsReads=0;const changes=[];
  const access=createMusicAccessLifecycle(player,queue,{host,document:doc,getSelection:()=>selection,onCatalog:(tracks,groups,view)=>changes.push(view),fetcher:async path=>({status:200,json:async()=>path.includes('capabilities')?(capsReads++,vip):path.includes('/catalog')?catalog([A]):{schemaVersion:2,track:B}})});
  t.after(()=>{access.destroy();queue.destroy();player.destroy();});
  await access.refresh('initial');queue.playAll([A]);audio.metadata();audio.playing();const src=audio.src,generation=player.snapshot().sourceGeneration;
  selection={track:B.id};await access.browse();assert.equal(audio.src,src);assert.equal(player.snapshot().sourceGeneration,generation);assert.equal(player.snapshot().status,'playing');
  assert.equal(capsReads,1);assert.deepEqual(queue.snapshot().items.map(t=>t.id),[A.id]);assert.equal(changes.at(-1).selection.track,B.id);
  queue.playFromList(B.id,[B]);assert.match(audio.src,new RegExp(B.id));
});
test('aborted return refresh rejects late VIP/cross-account responses without cancelling a newer refresh', async t => {
  const audio=new Audio(),player=createMusicPlayer(audio,{origin:'https://station.test'}),queue=createMusicQueue(player),host=new EventTarget(),doc=new EventTarget();
  let delayed=deferred(),first=true;
  const access=createMusicAccessLifecycle(player,queue,{host,document:doc,fetcher:async path=>({status:200,json:()=>path.includes('/catalog')?catalog([A]):first?(first=false,delayed.promise):anonymous})});
  t.after(()=>{access.destroy();queue.destroy();player.destroy();});
  const controller=new AbortController(),old=access.refresh('music-return',{signal:controller.signal});await flush();controller.abort();
  await access.refresh('manual');delayed.resolve(vip);await old;
  assert.equal(access.snapshot().capabilities.membershipStatus,'none');assert.equal(audio.src,'');assert.equal(audio.plays.length,0);
  first=true;delayed=deferred();const nextController=new AbortController();
  const next=access.refresh('music-return',{signal:nextController.signal});await flush();
  await access.refresh('manual');nextController.abort();
  delayed.resolve(vip);await next;
  assert.equal(access.snapshot().capabilities.membershipStatus,'none');
});

test('a late B detail read cannot evict C after the user starts a new queue', async t => {
  const audio=new Audio(),player=createMusicPlayer(audio,{origin:'https://station.test'}),queue=createMusicQueue(player),host=new EventTarget(),doc=new EventTarget();
  const delayed=deferred();let selection={};
  const access=createMusicAccessLifecycle(player,queue,{host,document:doc,getSelection:()=>selection,fetcher:async path=>({status:200,json:()=>path.includes('capabilities')?vip:path.includes('/catalog')?catalog([A,C]):delayed.promise})});
  t.after(()=>{access.destroy();queue.destroy();player.destroy();});
  await access.refresh('initial');queue.playAll([A]);audio.metadata();audio.playing();
  selection={track:B.id};const reading=access.browse();await flush();
  queue.playFromList(C.id,[C]);audio.metadata();audio.playing();const src=audio.src,generation=player.snapshot().sourceGeneration;
  delayed.resolve({schemaVersion:2,track:B});await reading;
  assert.equal(audio.src,src);assert.equal(player.snapshot().sourceGeneration,generation);assert.equal(player.snapshot().status,'playing');
  assert.deepEqual(queue.snapshot().items.map(t=>t.id),[C.id]);
});

test('browsing does not reset a media version rejected by access; explicit refresh can retry it', async t => {
  const audio=new Audio(),player=createMusicPlayer(audio,{origin:'https://station.test'}),queue=createMusicQueue(player),host=new EventTarget(),doc=new EventTarget();
  let selection={};
  const access=createMusicAccessLifecycle(player,queue,{host,document:doc,getSelection:()=>selection,fetcher:async path=>({status:path.includes('/access?')?410:200,json:async()=>path.includes('capabilities')?vip:path.includes('/catalog')?catalog([A]):path.includes('/access?')?{}:{schemaVersion:2,track:B}})});
  t.after(()=>{access.destroy();queue.destroy();player.destroy();});
  await access.refresh('initial');queue.playAll([A]);audio.metadata();audio.playing();audio.error={code:2};audio.emit('error');await flush();
  assert.equal(player.snapshot().lastError.code,'CONTENT_UNAVAILABLE');
  const count=audio.plays.length;selection={track:B.id};await access.browse();queue.playCurrent([A]);
  assert.equal(audio.plays.length,count);assert.equal(queue.snapshot().items[0].available,false);
  await access.refresh('manual');queue.playCurrent([A]);assert.equal(audio.plays.length,count+1);
});

test('return sync has increasing delays, stops at sixty seconds and never starts a second automatic visit', async () => {
  const time=clock(),calls=[],statuses=[];
  const access={snapshot:()=>({capabilities:{...anonymous,authenticated:true}}),refresh:async reason=>{calls.push([time.now(),reason]);}};
  const sync=createMusicReturnSync(access,{...time,document:{hidden:false},onChange:s=>statuses.push(s)});sync.start();await flush();await time.advance(61000);
  assert.deepEqual(calls.map(x=>x[0]),[0,2000,6000,14000,24000,34000,44000,54000]);assert.equal(statuses.at(-1),'timeout');
  sync.start();await time.advance(120000);assert.equal(calls.length,8);sync.destroy();
});
test('manual verification after polling ends updates stale return notices without restarting automatic polling', () => {
  assert.equal(musicReturnStatus('timeout',{checking:true}),'refreshing');
  assert.equal(musicReturnStatus('timeout',{capabilities:vip}),'ready');
  assert.equal(musicReturnStatus('ready',{checking:true}),'refreshing');
  assert.equal(musicReturnStatus('ready',{capabilities:anonymous}),'login');
  assert.equal(musicReturnStatus('ready',{capabilities:null}),'timeout');
});
test('return sync aborts an outstanding read at the deadline, ignores late completion and suspends hidden-page requests', async () => {
  const time=clock(),wait=deferred(),statuses=[];let signal,calls=0;
  const sync=createMusicReturnSync({snapshot:()=>({}),refresh:async(reason,options)=>{calls++;signal=options.signal;await wait.promise;}},{...time,document:{hidden:false},onChange:s=>statuses.push(s)});
  sync.start();await time.advance(60000);assert.equal(signal.aborted,true);assert.equal(statuses.at(-1),'timeout');wait.resolve();await flush();assert.equal(calls,1);sync.destroy();
  const hiddenClock=clock();let hiddenCalls=0;
  const hidden=createMusicReturnSync({snapshot:()=>({}),refresh:async()=>hiddenCalls++},{...hiddenClock,document:{hidden:true}});
  hidden.start();await hiddenClock.advance(60000);assert.equal(hiddenCalls,0);hidden.destroy();
});
test('valid membership ends syncing even when delivery is closed; anonymous visitors get login, with no repeated purchase or playback', async () => {
  for(const [caps,status] of [[vip,'ready'],[{...vip,canPlayVipFull:false,musicVipDeliveryEnabled:false},'ready'],[anonymous,'login']]) {
    const time=clock(),statuses=[];let calls=0;
    const sync=createMusicReturnSync({snapshot:()=>({capabilities:caps}),refresh:async()=>calls++},{...time,document:{hidden:false},onChange:s=>statuses.push(s)});
    sync.start();await flush();await time.advance(61000);assert.equal(statuses.at(-1),status);assert.ok(calls<=1);sync.destroy();
  }
});
