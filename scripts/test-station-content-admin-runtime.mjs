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
  assert.equal((await send('/fixture-editor'+base+'/tracks/'+track.id+'/publish',{method:'POST',body:{revision:1}})).r.status,403);
 });
 await t.test('title and artist create a server-generated address once through the real guarded Worker',async()=>{
  const body={data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'只填歌名与艺名'},creatorName:'站猫'}}},command={method:'POST',key:randomUUID(),body};
  assert.equal((await send('/fixture-off'+base+'/tracks',command)).body.code,'STATION_CONTENT_ADMIN_DISABLED');
  assert.equal((await send(base+'/tracks',{...command,origin:'https://wrong.test'})).r.status,403);
  const saved=await send(base+'/tracks',command);assert.equal(saved.r.status,200,JSON.stringify(saved.body));
  const replay=await send(base+'/tracks',command);assert.equal(replay.body.replayed,true);assert.equal(replay.body.id,saved.body.id);
  const id=saved.body.id,slug='track-'+id,stored=await f.db.prepare('SELECT slug FROM music_tracks WHERE id=?').bind(id).first();
  assert.equal(stored.slug,slug);
  const canonical=await f.db.prepare("SELECT slug FROM station_track_routes WHERE track_id=? AND role='canonical'").bind(id).first();assert.equal(canonical.slug,slug);
  const detail=(await send(base+'/tracks/'+id)).body;assert.equal(detail.status,'draft');assert.equal(detail.published,null);assert.equal(detail.draft.data.siteAudioMode,'none');
  assert.equal((await send('/api/station/content/tracks/'+slug)).r.status,404);
  const renamed={metadata:{...body.data.metadata,title:{'zh-Hans':'改名后地址保持稳定'}}};
  assert.equal((await send(base+'/tracks/'+id,{method:'PATCH',body:{revision:1,data:renamed}})).r.status,200);
  assert.equal((await f.db.prepare('SELECT slug FROM station_track_routes WHERE track_id=?').bind(id).first()).slug,slug);
  assert.equal((await send(base+'/tracks/'+id+'/publish',{method:'POST',version:2,body:{revision:2}})).r.status,422);
 });
 let created;
 await t.test('register, approve and publish without manual notes, replaying the original receipt',async()=>{
  created=await send(base+'/tracks',{method:'POST',body:{trackId:track.id,data}});assert.equal(created.r.status,200);
  const blocked=await send(base+'/tracks/'+track.id+'/publish',{method:'POST',body:{revision:1}});assert.equal(blocked.r.status,422);assert.equal(blocked.body.field,'track.coverAssetId');
  assert.equal((await send(base+'/assets/'+track.cover+'/rights',{method:'PUT',body:{scope:'cover',status:'approved',basis:'合成测试授权，不代表真实权利'}})).r.status,200);
  const key=randomUUID(),command={method:'POST',key,body:{revision:1}};const published=await send(base+'/tracks/'+track.id+'/publish',command);assert.equal(published.r.status,200);const replay=await send(base+'/tracks/'+track.id+'/publish',command);assert.equal(replay.body.replayed,true);assert.equal(replay.body.editVersion,2);
  const publicTrack=await send('/api/station/content/tracks/'+track.slug);assert.equal(publicTrack.r.status,200);assert.equal(publicTrack.body.track.preview,null);assert.doesNotMatch(JSON.stringify(publicTrack.body),/object_key|sha256|rights_basis/);
 });
 await t.test('NetEase pasted hash links save canonically through Access and D1, retaining verification and replay guards',async()=>{
  const canonical='https://music.163.com/song?id=3438977672',body={trackId:track.id,provider:'netease',status:'live',url:'https://music.163.com/#/song?id=3438977672',verifiedAt:Date.now()-1000};
  assert.equal((await send(base+'/platforms',{method:'POST',body:{...body,verifiedAt:null}})).body.code,'STATION_PLATFORM_VERIFICATION_REQUIRED');
  assert.equal((await send('/fixture-editor'+base+'/platforms',{method:'POST',body})).r.status,403);
  const command={method:'POST',key:randomUUID(),body},saved=await send(base+'/platforms',command);
  assert.equal(saved.r.status,200,JSON.stringify(saved.body));
  const replay=await send(base+'/platforms',command);assert.equal(replay.body.id,saved.body.id);assert.equal(replay.body.replayed,true);
  const entries=(await send(base+'/platforms?trackId='+track.id)).body.items;
  assert.equal(entries.length,1);assert.equal(entries[0].url,canonical);assert.equal(entries[0].verifiedAt,body.verifiedAt);
  assert.equal((await send('/api/station/content/tracks/'+track.slug)).body.track.platforms[0].href,canonical);
  const invalid=await send(base+'/platforms/'+saved.body.id,{method:'PATCH',body:{...body,url:body.url+'&redirect=https://evil.test'}});
  assert.equal(invalid.r.status,422);assert.equal(invalid.body.code,'STATION_PLATFORM_URL_INVALID');
  assert.equal((await send(base+'/platforms?trackId='+track.id)).body.items[0].url,canonical);
  assert.equal((await send(base+'/platforms/'+saved.body.id,{method:'PATCH',body:{...body,status:'removed'}})).r.status,200);
  assert.deepEqual((await send('/api/station/content/tracks/'+track.slug)).body.track.platforms,[]);
 });
 await t.test('album hash links preserve resource type and drive the list status through native D1',async()=>{
  const body={trackId:track.id,provider:'netease',status:'live',url:'https://music.163.com/#/album?id=398968221',verifiedAt:Date.now()-1000};
  const old=(await send(base+'/platforms?trackId='+track.id)).body.items[0];
  const saved=await send(base+'/platforms/'+old.id,{method:'PATCH',version:old.editVersion,body});assert.equal(saved.r.status,200,JSON.stringify(saved.body));
  const records=(await send(base+'/platforms?trackId='+track.id)).body;assert.equal(records.platformStatus,'live');
  assert.equal(records.items.find(row=>row.id===saved.body.id).url,'https://music.163.com/album?id=398968221');
  assert.equal((await send('/api/station/content/tracks/'+track.slug)).body.track.platforms[0].href,'https://music.163.com/album?id=398968221');
  let row=(await send(base+'/tracks')).body.items.find(row=>row.id===track.id);assert.equal(row.platformStatus,'live');assert.equal(row.status,'published');
  assert.equal((await send(base+'/platforms/'+saved.body.id,{method:'PATCH',version:saved.body.editVersion,body:{...body,status:'removed'}})).r.status,200);
  row=(await send(base+'/tracks')).body.items.find(row=>row.id===track.id);assert.equal(row.platformStatus,'removed');assert.equal(row.status,'published');
 });
 await t.test('one concurrent save wins; stale mutation and publication never change current pointer',async()=>{
  const command={method:'PATCH',version:2,body:{revision:1,data}};const race=await Promise.all([send(base+'/tracks/'+track.id,command),send(base+'/tracks/'+track.id,command)]);assert.deepEqual(race.map(r=>r.r.status).sort(),[200,409]);
  const current=await send(base+'/tracks/'+track.id);assert.equal(current.body.draft.revision,2);assert.equal(current.body.published.revision,1);
  assert.equal((await send(base+'/tracks/'+track.id+'/publish',{method:'POST',version:2,body:{revision:2}})).r.status,409);
 });
 await t.test('promotion and homepage are separate; stop updates fresh public no-store response',async()=>{
  const p=await send(base+'/promotions',{method:'POST',body:{trackId:track.id,data:{enabled:true,previewEnabled:false}}});assert.equal(p.r.status,200);
  assert.equal((await send(base+'/promotions/'+track.id+'/publish',{method:'POST',body:{revision:1}})).r.status,200);
  assert.equal((await send(base+'/home/'+homeId,{method:'PATCH',body:{revision:1,data:{featuredTrackId:track.id}}})).r.status,200);
  assert.equal((await send(base+'/home/'+homeId+'/publish',{method:'POST',version:2,body:{revision:2}})).r.status,200);
  const home=await send('/api/station/content/home');assert.equal(home.body.home.music.id,track.id);assert.equal(home.r.headers.get('cache-control'),'no-store');
  await send(base+'/promotions/'+track.id+'/unpublish',{method:'POST',version:2,body:{revision:1}});assert.equal((await send('/api/station/content/home')).body.home.music,null);
 });
 await t.test('one guarded homepage update saves selection and publishes its basic promotion in native D1',async()=>{
  const path=base+'/home/'+homeId+'/apply',home=(await send(base+'/home/'+homeId)).body;
  const command={method:'POST',version:home.editVersion,key:randomUUID(),body:{revision:(home.draft??home.published).revision,data:{featuredTrackId:track.id}}};
  assert.equal((await send('/fixture-off'+path,command)).body.code,'STATION_CONTENT_ADMIN_DISABLED');
  assert.equal((await send('/fixture-editor'+path,command)).r.status,403);
  assert.equal((await send(path,{...command,origin:'https://wrong.test'})).r.status,403);
  assert.equal((await send(path)).r.status,405);
  assert.equal((await send(base+'/tracks/'+track.id+'/apply',command)).r.status,404);
  const saved=await send(path,command);assert.equal(saved.r.status,200,JSON.stringify(saved.body));
  assert.equal((await send(path,command)).body.replayed,true);
  const current=(await send(base+'/home/'+homeId)).body;assert.equal(current.draft,null);assert.equal(current.published.data.featuredTrackId,track.id);
  assert.equal((await send('/api/station/content/home')).body.home.music.id,track.id);
  assert.equal((await send(base+'/promotions/'+track.id)).body.published.data.previewEnabled,false);
  assert((await send(base+'/home-tracks')).body.items.some(item=>item.id===track.id));
  assert.equal((await send(base+'/home-tracks',{method:'POST',body:{}})).r.status,405);
  assert.equal((await send(path,{...command,key:randomUUID()})).r.status,409);
 });
 await t.test('real fixture MP4 and image uploads become controlled clip/game publications, with current rights rechecked',async()=>{
  const metadata={originalLocale:'zh-Hans',title:{'zh-Hans':'本机合成发布测试'},summary:{'zh-Hans':'仅供验收'},story:''};
  const clip=(await send(base+'/clips',{method:'POST',body:{trackId:track.id,clipType:'short_video',data:{metadata}}})).body;
  const game=(await send(base+'/games',{method:'POST',body:{slug:'fixture-game-intro',data:{metadata,launchUrl:'/games/cat-life/',supportedDevices:['desktop']}}})).body;
  const upload=async(ownerId,kind,format,bytes)=>{
   const root='/admin/api/music/site-uploads',reserved=await send(root,{method:'POST',body:{ownerId,kind,format,byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});assert.equal(reserved.r.status,200,JSON.stringify(reserved.body));
   const body=await f.mf.dispatchFetch('http://content.local.test'+root+'/'+reserved.body.uploadId+'/body',{method:'PUT',headers:{'Cf-Access-Jwt-Assertion':f.actorToken,Origin:'http://content.local.test','X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':randomUUID(),'Content-Type':format==='mp4'?'video/mp4':'image/png'},body:bytes});assert.equal(body.status,200,await body.text());
   const ready=await send(root+'/'+reserved.body.uploadId+'/complete',{method:'POST',body:{}});assert.equal(ready.r.status,200,JSON.stringify(ready.body));
   const approved=await send(base+'/assets/'+reserved.body.assetId+'/rights',{method:'PUT',body:{scope:kind,status:'approved',basis:'合成夹具，无真实素材授权结论'}});assert.equal(approved.r.status,200);return reserved.body.assetId;
  };
  const png=await sharp({create:{width:320,height:180,channels:3,background:'#426553'}}).png().toBuffer();
  const video=await upload(clip.id,'short_video','mp4',stationVideoBytes().bytes),poster=await upload(clip.id,'poster','png',png),screen=await upload(game.id,'game_screenshot','png',png);
  const clipData={metadata,mediaAssetId:video,posterAssetId:poster,durationMs:30000,subtitles:{'zh-Hans':'本机字幕','en':'Local fixture'}};
  assert.equal((await send(base+'/clips/'+clip.id,{method:'PATCH',body:{revision:1,data:clipData}})).r.status,200);
  assert.equal((await send(base+'/clips/'+clip.id+'/publish',{method:'POST',version:2,body:{revision:2}})).r.status,200);
  const publicClip=await send('/api/station/content/tracks/'+track.slug+'/clips');assert.equal(publicClip.r.status,200);assert(publicClip.body.items.some(c=>c.id===clip.id));assert.doesNotMatch(JSON.stringify(publicClip.body),/station\/media|sha256|object_key/);
  assert.equal((await send(base+'/games/'+game.id,{method:'PATCH',body:{revision:1,data:{metadata,launchUrl:'/games/cat-life/',supportedDevices:['desktop'],screenshotIds:[screen]}}})).r.status,200);
  assert.equal((await send(base+'/games/'+game.id+'/publish',{method:'POST',version:2,body:{revision:2}})).r.status,200);
  const publicGame=await send('/api/station/content/games/fixture-game-intro');assert.equal(publicGame.r.status,200);assert.equal(publicGame.body.game.launchPath,'/games/cat-life/');
  const history=await send(base+'/clips/'+clip.id+'/revisions?before=3');assert.deepEqual(history.body.items.map(r=>r.revision),[2,1]);
  assert.equal((await send(base+'/clips/'+clip.id+'/publications',{method:'POST',version:3,body:{channel:'youtube',postId:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk',publishedAt:Date.now()-1000}})).r.status,200);
  await send(base+'/assets/'+video+'/rights',{method:'PUT',body:{scope:'short_video',status:'blocked',basis:'本机撤销'}});
  assert(!(await send('/api/station/content/tracks/'+track.slug+'/clips')).body.items.some(c=>c.id===clip.id));
  assert.equal((await send(base+'/clips/'+clip.id+'/rollback',{method:'POST',version:4,body:{revision:2}})).r.status,422);
 });
 await t.test('bounded schedule run disabled by either flag and never falls back to a production binding',async()=>{
  assert.equal((await send('/fixture-admin-only'+base+'/jobs/run',{method:'POST',body:{}})).body.reason,'SCHEDULE_DISABLED');assert.equal((await send('/fixture-scheduler-only'+base+'/jobs/run',{method:'POST',body:{}})).body.code,'STATION_CONTENT_ADMIN_DISABLED');
 });
 await t.test('note-free changes still record actor, time, target and action in the audit log',async()=>{
  const actor=(await send(base+'/status')).body.actorId,entries=[];let before;
  do{const page=(await send(base+'/audit'+(before?'?before='+before:''))).body;entries.push(...page.items);before=page.nextBefore;}while(before);
  for(const action of ['station.content.create','station.content.save','station.content.publish','station.content.unpublish','station.rights.review','station.clip.publication'])assert(entries.some(row=>row.action===action),action);
  for(const row of entries){assert.equal(row.actorId,actor);assert(row.targetId);assert(Number.isSafeInteger(row.createdAt)&&row.createdAt>0);assert.equal(Object.hasOwn(row.summary,'reason'),false);}
 });
 await t.test('HEAD and admin recovery responses are private and cannot leak raw auth or media identities',async()=>{const head=await send(base+'/status',{method:'HEAD'});assert.equal(head.r.status,200);assert.equal(head.r.headers.get('cache-control'),'private, no-store');const view=await send(base+'/tracks/'+track.id);assert.equal(view.r.headers.get('cache-control'),'private, no-store');assert.doesNotMatch(JSON.stringify(view.body),/object_key|sha256|Cf-Access|eyJ/);});
});
