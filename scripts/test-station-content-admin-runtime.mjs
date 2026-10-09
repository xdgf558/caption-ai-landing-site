import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID,createHash} from 'node:crypto';import sharp from 'sharp';
import {stationVideoBytes} from './helpers/station-video-fixture.mjs';
import {createContentAdminRuntime} from './helpers/station-content-admin-runtime.mjs';
import {homeId} from './helpers/station-redesign-database.mjs';
const base='/admin/api/music/site-content';
test('actual Worker Access, native D1/R2, flags and guarded publication workflow',async t=>{
 const f=await createContentAdminRuntime();t.after(()=>f.close());
 const send=async(path,{method='GET',body,version=1,key=randomUUID(),token=f.actorToken,origin='http://content.local.test'}={})=>{
  const r=await f.mf.dispatchFetch('http://content.local.test'+path,{method,headers:{'Cf-Access-Jwt-Assertion':token,'CF-Connecting-IP':'192.0.2.55',Origin:origin,'X-Requested-With':'StationCatMusicAdmin','Content-Type':'application/json','If-Match':`"edit-${version}"`,'Idempotency-Key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {r,body:method==='HEAD'?null:await r.json()};
 };
 await t.test('forged and expired identities never reach the content binding',async()=>{assert.equal((await send(base+'/status',{token:'forged'})).r.status,401);assert.equal((await send(base+'/status',{token:await f.token({exp:1})})).r.status,401);assert.equal((await send(base+'/status',{token:await f.token({email:'outsider@example.test'})})).r.status,403);});
 await t.test('admin flag must be explicit; wrong or unmigrated MUSIC_DB closes without writes',async()=>{for(const mode of ['off','scheduler-only'])assert.equal((await send('/fixture-'+mode+base+'/status')).body.code,'STATION_CONTENT_ADMIN_DISABLED');for(const mode of ['empty','wrong'])assert.equal((await send('/fixture-'+mode+base+'/status')).body.code,'STATION_CONTENT_SCHEMA_UNAVAILABLE');assert.equal((await send(base+'/status')).body.role,'publisher');});
 const track=f.content.tracks[0],data={metadata:track.metadata,coverAssetId:track.cover,siteAudioMode:'none'};
 await t.test('CSRF, methods, query ambiguity and editor publish restrictions remain server side',async()=>{
  assert.equal((await send(base+'/tracks',{method:'POST',origin:'https://wrong.test',body:{}})).r.status,403);
  assert.equal((await send(base+'/tracks',{method:'DELETE'})).r.status,405);assert.equal((await send(base+'/status?a=1&a=2')).r.status,400);
  assert.equal((await send('/fixture-editor'+base+'/tracks/'+track.id+'/publish',{method:'POST',body:{revision:1,reason:'测试'}})).r.status,403);
 });
 let created;
 await t.test('register, approve and publish through actual native transactions, replaying the original receipt',async()=>{
  created=await send(base+'/tracks',{method:'POST',body:{trackId:track.id,data,reason:'本机登记'}});assert.equal(created.r.status,200);
  const blocked=await send(base+'/tracks/'+track.id+'/publish',{method:'POST',body:{revision:1,reason:'测试'}});assert.equal(blocked.r.status,422);assert.equal(blocked.body.field,'track.coverAssetId');
  assert.equal((await send(base+'/assets/'+track.cover+'/rights',{method:'PUT',body:{scope:'cover',status:'approved',basis:'合成测试授权，不代表真实权利',reason:'本机测试'}})).r.status,200);
  const key=randomUUID(),command={method:'POST',key,body:{revision:1,reason:'本机公开'}};const published=await send(base+'/tracks/'+track.id+'/publish',command);assert.equal(published.r.status,200);const replay=await send(base+'/tracks/'+track.id+'/publish',command);assert.equal(replay.body.replayed,true);assert.equal(replay.body.editVersion,2);
  const publicTrack=await send('/api/station/content/tracks/'+track.slug);assert.equal(publicTrack.r.status,200);assert.equal(publicTrack.body.track.preview,null);assert.doesNotMatch(JSON.stringify(publicTrack.body),/object_key|sha256|rights_basis/);
 });
 await t.test('one concurrent save wins; stale mutation and publication never change current pointer',async()=>{
  const command={method:'PATCH',version:2,body:{revision:1,data,reason:'本机编辑'}};const race=await Promise.all([send(base+'/tracks/'+track.id,command),send(base+'/tracks/'+track.id,command)]);assert.deepEqual(race.map(r=>r.r.status).sort(),[200,409]);
  const current=await send(base+'/tracks/'+track.id);assert.equal(current.body.draft.revision,2);assert.equal(current.body.published.revision,1);
  assert.equal((await send(base+'/tracks/'+track.id+'/publish',{method:'POST',version:2,body:{revision:2,reason:'测试'}})).r.status,409);
 });
 await t.test('promotion and homepage are separate; stop updates fresh public no-store response',async()=>{
  const p=await send(base+'/promotions',{method:'POST',body:{trackId:track.id,data:{enabled:true,previewEnabled:false},reason:'本机推广'}});assert.equal(p.r.status,200);
  assert.equal((await send(base+'/promotions/'+track.id+'/publish',{method:'POST',body:{revision:1,reason:'本机公开推广'}})).r.status,200);
  assert.equal((await send(base+'/home/'+homeId,{method:'PATCH',body:{revision:1,data:{featuredTrackId:track.id},reason:'本机主推'}})).r.status,200);
  assert.equal((await send(base+'/home/'+homeId+'/publish',{method:'POST',version:2,body:{revision:2,reason:'本机公开首页'}})).r.status,200);
  const home=await send('/api/station/content/home');assert.equal(home.body.home.music.id,track.id);assert.equal(home.r.headers.get('cache-control'),'no-store');
  await send(base+'/promotions/'+track.id+'/unpublish',{method:'POST',version:2,body:{revision:1,reason:'本机停止推广'}});assert.equal((await send('/api/station/content/home')).body.home.music,null);
 });
 await t.test('real fixture MP4 and image uploads become controlled clip/game publications, with current rights rechecked',async()=>{
  const metadata={originalLocale:'zh-Hans',title:{'zh-Hans':'本机合成发布测试'},summary:{'zh-Hans':'仅供验收'},story:''};
  const clip=(await send(base+'/clips',{method:'POST',body:{trackId:track.id,clipType:'short_video',data:{metadata},reason:'本机视频草稿'}})).body;
  const game=(await send(base+'/games',{method:'POST',body:{slug:'fixture-game-intro',data:{metadata,launchUrl:'/games/cat-life/',supportedDevices:['desktop']},reason:'本机介绍草稿'}})).body;
  const upload=async(ownerId,kind,format,bytes)=>{
   const root='/admin/api/music/site-uploads',reserved=await send(root,{method:'POST',body:{ownerId,kind,format,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});assert.equal(reserved.r.status,200,JSON.stringify(reserved.body));
   const body=await f.mf.dispatchFetch('http://content.local.test'+root+'/'+reserved.body.uploadId+'/body',{method:'PUT',headers:{'Cf-Access-Jwt-Assertion':f.actorToken,Origin:'http://content.local.test','X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':randomUUID(),'Content-Type':format==='mp4'?'video/mp4':'image/png'},body:bytes});assert.equal(body.status,200,await body.text());
   const ready=await send(root+'/'+reserved.body.uploadId+'/complete',{method:'POST',body:{}});assert.equal(ready.r.status,200,JSON.stringify(ready.body));
   const approved=await send(base+'/assets/'+reserved.body.assetId+'/rights',{method:'PUT',body:{scope:kind,status:'approved',basis:'合成夹具，无真实素材授权结论',reason:'本机验收'}});assert.equal(approved.r.status,200);return reserved.body.assetId;
  };
  const png=await sharp({create:{width:320,height:180,channels:3,background:'#426553'}}).png().toBuffer();
  const video=await upload(clip.id,'short_video','mp4',stationVideoBytes().bytes),poster=await upload(clip.id,'poster','png',png),screen=await upload(game.id,'game_screenshot','png',png);
  const clipData={metadata,mediaAssetId:video,posterAssetId:poster,durationMs:30000,subtitles:{'zh-Hans':'本机字幕','en':'Local fixture'}};
  assert.equal((await send(base+'/clips/'+clip.id,{method:'PATCH',body:{revision:1,data:clipData,reason:'素材就绪'}})).r.status,200);
  assert.equal((await send(base+'/clips/'+clip.id+'/publish',{method:'POST',version:2,body:{revision:2,reason:'公开测试'}})).r.status,200);
  const publicClip=await send('/api/station/content/tracks/'+track.slug+'/clips');assert.equal(publicClip.r.status,200);assert(publicClip.body.items.some(c=>c.id===clip.id));assert.doesNotMatch(JSON.stringify(publicClip.body),/station\/media|sha256|object_key/);
  assert.equal((await send(base+'/games/'+game.id,{method:'PATCH',body:{revision:1,data:{metadata,launchUrl:'/games/cat-life/',supportedDevices:['desktop'],screenshotIds:[screen]},reason:'截图就绪'}})).r.status,200);
  assert.equal((await send(base+'/games/'+game.id+'/publish',{method:'POST',version:2,body:{revision:2,reason:'公开介绍'}})).r.status,200);
  const publicGame=await send('/api/station/content/games/fixture-game-intro');assert.equal(publicGame.r.status,200);assert.equal(publicGame.body.game.launchPath,'/games/cat-life/');
  const history=await send(base+'/clips/'+clip.id+'/revisions?before=3');assert.deepEqual(history.body.items.map(r=>r.revision),[2,1]);
  await send(base+'/assets/'+video+'/rights',{method:'PUT',body:{scope:'short_video',status:'blocked',basis:'本机撤销',reason:'本机撤销'}});
  assert(!(await send('/api/station/content/tracks/'+track.slug+'/clips')).body.items.some(c=>c.id===clip.id));
  assert.equal((await send(base+'/clips/'+clip.id+'/rollback',{method:'POST',version:3,body:{revision:2,reason:'撤销后禁止回退'}})).r.status,422);
 });
 await t.test('bounded schedule run disabled by either flag and never falls back to a production binding',async()=>{
  assert.equal((await send('/fixture-admin-only'+base+'/jobs/run',{method:'POST',body:{}})).body.reason,'SCHEDULE_DISABLED');assert.equal((await send('/fixture-scheduler-only'+base+'/jobs/run',{method:'POST',body:{}})).body.code,'STATION_CONTENT_ADMIN_DISABLED');
 });
 await t.test('HEAD and admin recovery responses are private and cannot leak raw auth or media identities',async()=>{const head=await send(base+'/status',{method:'HEAD'});assert.equal(head.r.status,200);assert.equal(head.r.headers.get('cache-control'),'private, no-store');const view=await send(base+'/tracks/'+track.id);assert.equal(view.r.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(JSON.stringify(view.body),/object_key|sha256|Cf-Access|eyJ/);});
});
