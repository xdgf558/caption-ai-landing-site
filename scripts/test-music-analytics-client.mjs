import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Audio} from './fixtures/music-player/fake-audio.mjs';
import {createMusicPlayer} from '../src/scripts/musicPlayerCore.js';
import {createMusicQueue} from '../src/scripts/musicPlayerQueue.js';
import {createMusicAnalytics,MUSIC_ANALYTICS_SESSION_KEY,MUSIC_ANALYTICS_CONSENT_VERSION} from '../src/scripts/musicAnalytics.js';

const track=(n=1)=>({id:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,audioVersion:1,policyVersion:1,
  title:`Test ${n}`,creatorName:'Test',coverUrl:null,durationSec:120,effectiveAccess:'free',previewAvailable:true,previewDurationSec:30,previewSourceStartSec:12});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(t,opts={}) {
  const audio=new Audio(), player=createMusicPlayer(audio,{origin:'https://music.example.test'}), posts=[], data=new Map(), timers=new Map();
  let time=0,nextTimer=0,ids=0;
  const state={available:true,gpc:false,fail:false,delay:null,...opts};
  const storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const analytics=createMusicAnalytics(player,{
    fetcher:async(path,options)=>{
      if(path.endsWith('/config')) return Response.json({available:state.available,consentVersion:MUSIC_ANALYTICS_CONSENT_VERSION});
      posts.push({body:JSON.parse(options.body),options});
      if(state.delay) return state.delay;
      return new Response(null,{status:state.fail ? 503 : 200});
    },storage:()=>{if(state.storageBlocked) throw new Error('blocked');return storage;},
    randomId:()=>{ids++;return randomUUID();},clock:()=>1700000000000+time,monotonic:()=>time,privacySignal:()=>state.gpc,
    schedule:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,time:time+delay});return id;},cancel:id=>timers.delete(id)
  });
  const queue=createMusicQueue(player); queue.updateCatalog([track(),track(2)]);
  await analytics.refresh();
  const play=(variant='full',which=track())=>{player.select(which,variant);player.play({userInitiated:true});audio.metadata(variant==='preview' ? 30 : 120);audio.playing();};
  const advance=(seconds=1,media=seconds)=>{time+=seconds*1000;audio.currentTime+=media;audio.emit('timeupdate');};
  const hear=seconds=>{for(let i=0;i<seconds;i++) advance();};
  const end=()=>{audio.currentTime=audio.duration;audio.ended=true;audio.paused=true;audio.emit('ended');};
  const runNext=async()=>{
    const next=[...timers].sort((a,b)=>a[1].time-b[1].time)[0];if(!next) return false;
    timers.delete(next[0]);time=Math.max(time,next[1].time);next[1].fn();await settle();return true;
  };
  const drain=async()=>{for(let i=0;i<30 && timers.size;i++) await runNext();};
  const events=()=>posts.flatMap(p=>p.body.events);
  t.after(()=>{analytics.destroy();queue.destroy();player.destroy();});
  return {audio,player,analytics,queue,posts,data,timers,state,play,hear,advance,end,runNext,drain,events,ids:()=>ids};
}
test('default opt-out creates no identifier/events, never sets initial source or conditions playback',async t=>{
  const f=await setup(t); assert.equal(f.ids(),0); assert.equal(f.data.size,0); assert.equal(f.audio.src,'');
  f.play();f.hear(120);f.end();await f.drain();
  assert.equal(f.posts.length,0);assert.equal(f.ids(),0);assert.equal(f.audio.plays.length,1);
  f.analytics.cta(track(),'full');assert.equal(f.ids(),0);
});
test('operator-off, storage failure and GPC keep collection off without affecting the player',async t=>{
  for(const patch of [{available:false},{storageBlocked:true},{gpc:true}]) {
    const f=await setup(t,patch);assert.equal(f.analytics.accept(),false);f.play();f.hear(35);await f.drain();
    assert.equal(f.posts.length,0);assert.equal(f.player.snapshot().status,'playing');
  }
});
test('playing milestones use actual accumulated time; pause/resume and refresh keep one play session',async t=>{
  const f=await setup(t);assert.equal(f.analytics.accept(),true);
  assert.equal(f.data.size,1);assert.ok(f.data.has(MUSIC_ANALYTICS_SESSION_KEY));
  f.play();f.hear(10);f.player.pause();f.advance(40,0);await f.analytics.refresh();
  f.player.play({userInitiated:true});f.audio.playing();f.hear(20);await f.drain();
  const events=f.events();assert.deepEqual(events.map(e=>e.eventType),['play_start','qualified_play']);
  assert.equal(events[0].playSessionId,events[1].playSessionId);assert.equal(events[1].listenedMs,30000);
  assert.ok(f.posts.every(p=>p.options.credentials==='omit' && !p.options.headers.Cookie));
});
test('click/loading, seeks, stalls, buffering, paused late playing and long gaps do not qualify',async t=>{
  const f=await setup(t);f.analytics.accept();
  f.player.select(track());f.player.play({userInitiated:true});f.audio.metadata(120);await f.drain();assert.equal(f.posts.length,0);
  f.audio.playing();f.hear(5);
  f.audio.seeking=true;f.audio.currentTime=100;f.audio.emit('seeking');f.audio.seeking=false;f.audio.emit('seeked');
  f.advance(20,0); f.advance(10,10);
  f.audio.readyState=2;f.audio.emit('waiting');f.advance(20,20);f.audio.playing();
  f.player.pause();f.audio.playing();f.advance(20,20);await f.drain();
  assert.deepEqual(f.events().map(e=>e.eventType),['play_start']);assert.equal(f.player.snapshot().status,'paused');
});
test('natural preview completion stays preview and paused queued ended cannot complete',async t=>{
  const f=await setup(t);f.analytics.accept();f.play('preview');f.hear(30);f.end();await f.drain();
  assert.deepEqual(f.events().map(e=>e.eventType),['play_start','qualified_play','play_complete','preview_end']);
  assert.ok(f.events().every(e=>e.variant==='preview'));
  f.play('full',track(2));f.hear(110);f.player.pause();f.end();await f.drain();
  assert.equal(f.events().filter(e=>e.eventType==='play_complete').length,1);
});
test('reentrant queue advance and single repeat each create a new play session after measuring ended',async t=>{
  const f=await setup(t);f.analytics.accept();f.queue.setRepeat('one');f.queue.playAll([track()]);
  f.audio.metadata(120);f.audio.playing();f.hear(120);f.end();
  f.audio.ended=false;f.audio.metadata(120);f.audio.playing();f.hear(35);await f.drain();
  assert.equal(f.events().filter(e=>e.eventType==='play_complete').length,1);
  const starts=f.events().filter(e=>e.eventType==='play_start');assert.equal(starts.length,2);
  assert.notEqual(starts[0].playSessionId,starts[1].playSessionId);
});
test('withdraw clears session and queued/in-flight retries, retaining unrelated local preferences',async t=>{
  const f=await setup(t);f.data.set('stationcat.music.v2','favorite-only');f.analytics.accept();f.play();f.hear(35);
  let finish;f.state.delay=new Promise(resolve=>{finish=resolve;});await f.runNext();assert.equal(f.posts.length,1);
  const signal=f.posts[0].options.signal;f.analytics.withdraw();assert.equal(signal.aborted,true);
  assert.equal(f.analytics.snapshot().queued,0);assert.equal(f.data.get('stationcat.music.v2'),'favorite-only');
  assert.equal(f.data.has(MUSIC_ANALYTICS_SESSION_KEY),false);
  finish(new Response(null,{status:503}));await settle();f.hear(35);await f.drain();assert.equal(f.posts.length,1);
});
test('100-event memory cap, 20-event batches and at most two retries are finite',async t=>{
  const f=await setup(t,{fail:true});f.analytics.accept();
  for(let i=0;i<120;i++) f.analytics.cta(track(),'full');
  assert.equal(f.analytics.snapshot().queued,100);await f.drain();
  assert.equal(f.posts.length,18);assert.equal(f.analytics.snapshot().queued,0);
  assert.ok(f.posts.every(p=>p.body.events.length<=20 && Buffer.byteLength(JSON.stringify(p.body))<=16384));
  for(let i=0;i<18;i+=3) assert.deepEqual(f.posts[i].body,f.posts[i+2].body);
  assert.equal(f.timers.size,0);
});
test('consent during existing playback fabricates no start; session expires and GPC withdrawal is immediate',async t=>{
  const f=await setup(t);f.play();f.analytics.accept();f.hear(40);await f.drain();assert.equal(f.posts.length,0);
  f.player.pause();f.player.play({userInitiated:true});f.audio.playing();f.hear(1);await f.drain();assert.equal(f.events()[0].eventType,'play_start');
  f.state.gpc=true;f.advance();assert.equal(f.data.has(MUSIC_ANALYTICS_SESSION_KEY),false);
  f.state.gpc=false;await f.analytics.refresh();f.analytics.accept();f.advance(86401,0);
  assert.equal(f.analytics.snapshot().enabled,false);
});
test('integration stays outside audio authorization, local preference schema and member transactions',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const client=read('src/scripts/musicPlayerClient.js');
  assert.ok(client.indexOf('const analytics =')<client.indexOf('const queue ='));
  const collector=read('src/scripts/musicAnalytics.js');
  assert.doesNotMatch(collector,/localStorage|sendBeacon|BroadcastChannel|player\.(play|pause|unload|seek)\(/);
  const messages=read('src/scripts/musicMessages.js');
  for(const key of ['收听统计与隐私','同意此标签页的统计','撤回统计同意','音乐隐私说明']) assert.match(messages,new RegExp(key+'\\|[^\\n]+\\|[^\\n]+\\|[^\\n]+'));
  assert.match(read('src/components/GeneralLegalIndex.astro'),/kind === 'privacy' && <MusicPrivacyNotice/);
});

test('CTA starts a bounded keepalive request before navigation; page teardown never schedules a retry',async t=>{
  const f=await setup(t);f.analytics.accept();let finish;
  f.state.delay=new Promise(resolve=>{finish=resolve;});f.analytics.cta(track(),'full');
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].body.events[0].eventType,'vip_cta_click');
  assert.equal(f.posts[0].options.keepalive,true);
  f.analytics.destroy();assert.equal(f.posts[0].options.signal.aborted,false);
  finish(new Response(null,{status:503}));await settle();await f.drain();assert.equal(f.posts.length,1);
});

test('explicit play-all restart on the same loaded source differs from pause/resume',async t=>{
  const f=await setup(t);f.analytics.accept();f.queue.playAll([track()]);f.audio.metadata(120);f.audio.playing();f.hear(5);
  const source=f.audio.src, generation=f.player.snapshot().sourceGeneration;
  f.queue.playAll([track()]);f.audio.playing();f.hear(1);await f.drain();
  assert.equal(f.audio.src,source);assert.equal(f.player.snapshot().sourceGeneration,generation);
  const starts=f.events().filter(e=>e.eventType==='play_start');assert.equal(starts.length,2);
  assert.notEqual(starts[0].playSessionId,starts[1].playSessionId);
});
