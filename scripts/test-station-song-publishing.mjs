import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import vm from 'node:vm';
import { createSongUploader } from '../src/scripts/stationSongUploader.js';
import { publishWebsiteSong, savedSongCover } from '../src/scripts/stationSongPublishing.js';
import { adminScriptFixture } from './helpers/station-admin-dom.mjs';
import { createContentAdminRuntime } from './helpers/station-content-admin-runtime.mjs';
import { fixtureId } from './helpers/station-redesign-database.mjs';

const owner=fixtureId(801),other=fixtureId(802),asset=fixtureId(803),upload=fixtureId(804);
const memory=()=>{const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const png=await sharp({create:{width:177,height:177,channels:3,background:'#7465ac'}}).png().toBuffer();
const file=new File([png],'cover.jpg',{type:'image/jpeg'}); // Real PNG, deliberately wrong name/MIME.
function uploadFixture(){
 const storage=memory(),calls=[];let actor='original',state='reserved',lost=null,reads=0,identity=null;
 const requester=async(path,options={})=>{
  calls.push({path,...options});
  if(path==='/uploads'){assert.equal(options.body.format,'png');assert.equal(options.body.trackId,owner);if(lost==='reserve'){lost=null;throw {uncertain:true};}return {uploadId:upload,assetId:asset};}
  if(path.endsWith('/body')){assert.equal(options.type,'image/png');state='uploading';if(lost==='body'){lost=null;throw {uncertain:true};}return {};}
  if(path.endsWith('/complete')){state='completed';if(lost==='complete'){lost=null;throw {uncertain:true};}return {uploadId:upload,assetId:asset,status:state};}
  reads++;return {uploadId:upload,assetId:asset,trackId:owner,status:state,declaredBytes:file.size,contentType:identity??'image/png'};
 };
 const make=()=>createSongUploader({actorId:'original',storage,requester,verifyActor:async()=>({actorId:actor})});
 return {storage,calls,make,get reads(){return reads;},lose:value=>{lost=value;},actor:value=>{actor=value;},state:value=>{state=value;},identity:value=>{identity=value;}};
}
for(const phase of ['reserve','body','complete'])test('song upload survives a lost '+phase+' receipt using original keys and no duplicate bytes',async()=>{
 const f=uploadFixture(),u=f.make();f.lose(phase);await assert.rejects(u.start(owner,'cover',file));
 const original=u.pending();assert(original);const restored=f.make();const result=await restored.recover(file);
 assert.equal(result.assetId,asset);assert.equal(result.stage,'completed');assert.equal(restored.pending().ownerId,owner);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/body')).length,1);
 for(const [path,key]of [['/uploads','reserveKey'],['/uploads/'+upload+'/complete','completeKey']])assert(f.calls.filter(c=>c.path===path).every(c=>c.key===original[key]));
 await assert.rejects(restored.start(other,'cover',file),/先核对/);
 await assert.rejects(restored.acknowledge(other,asset),/引用尚未确认/);
 await restored.acknowledge(owner,asset);assert.equal(restored.pending(),null);
});
test('actor changes, wrong objects and an in-progress body never cause an automatic replacement upload',async()=>{
 const f=uploadFixture(),u=f.make();f.lose('reserve');await assert.rejects(u.start(owner,'cover',file));
 f.actor('different');const count=f.calls.length;await assert.rejects(u.recover(file),/管理员已变化/);assert.equal(f.calls.length,count);
 f.actor('original');f.lose('body');await assert.rejects(u.recover(file));f.state('reserved');await assert.rejects(u.recover(file),/发送结果尚未确认/);
 assert.equal(f.calls.filter(c=>c.path.endsWith('/body')).length,1);
 f.state('uploading');f.identity('image/jpeg');await assert.rejects(u.recover(),/不一致/);assert.equal(f.calls.filter(c=>c.path.endsWith('/complete')).length,0);
});
test('invalid files and an unwritable recovery journal fail before reserving quota',async()=>{
 const f=uploadFixture(),u=f.make();await assert.rejects(u.start(owner,'cover',new File(['invalid'],'cover.jpg')));assert.equal(f.calls.length,0);
 const broken=createSongUploader({actorId:'original',storage:{getItem:()=>null,setItem:()=>{throw new Error('storage full');}},verifyActor:async()=>({actorId:'original'}),requester:async()=>{assert.fail('must not reserve');}});
 await assert.rejects(broken.start(owner,'cover',file),/storage full/);
 for(const raw of ['false','0','""','[]'])assert.throws(()=>createSongUploader({actorId:'original',storage:{getItem:()=>raw},verifyActor:async()=>({actorId:'original'})}),/恢复记录不可读/);
});
test('only an explicitly saved cover may be suggested, without replacing a website choice or published version',()=>{
 const current={id:owner,savedMusicAssets:{cover:asset}},assets=[{id:asset,kind:'cover',state:'validated'},{id:other,kind:'cover',state:'validated'}];
 assert.equal(savedSongCover({},current,assets),asset);assert.equal(savedSongCover({},current,assets.slice(1)),null);
 assert.equal(savedSongCover({coverAssetId:other},current,assets),other);assert.equal(savedSongCover({}, {...current,published:{}},assets),null);
});
test('song publication requires actual rights confirmation and stops on blocked assets or failed saves',async()=>{
 const calls=[],controller={verifyActor:async()=>calls.push('identity'),mutate:async()=>calls.push('write')};
 const options={controller,current:{id:owner},data:{coverAssetId:asset},assets:[{id:asset,kind:'cover',state:'validated',rightsStatus:'pending'}],saveDraft:async()=>{calls.push('save');throw new Error('conflict');},reload:async()=>calls.push('reload')};
 await assert.rejects(publishWebsiteSong(options),/确认封面/);assert.deepEqual(calls,[]);
 await assert.rejects(publishWebsiteSong({...options,confirmRights:true,assets:[{...options.assets[0],rightsStatus:'blocked'}]}),/禁止公开/);assert.deepEqual(calls,[]);
 await assert.rejects(publishWebsiteSong({...options,confirmRights:true}),/conflict/);assert.deepEqual(calls,['identity','save']);
});

test('the actual editor publishes cover-only website songs through Access and native D1/R2',async t=>{
 const f=await createContentAdminRuntime({seed:async()=>({})});t.after(()=>f.close());const calls=[];
 const send=async(path,options={},base='/admin/api/music/site-content')=>{
  calls.push({base,path,...options});const method=options.method??'GET';
  const headers={'Cf-Access-Jwt-Assertion':f.actorToken,'CF-Connecting-IP':'192.0.2.98',Origin:'http://content.local.test','X-Requested-With':'StationCatMusicAdmin'};
  if(options.key)headers['Idempotency-Key']=options.key;if(options.etag)headers['If-Match']=options.etag;
  if(method!=='GET')headers['Content-Type']=options.raw?options.type:'application/json';
  const response=await f.mf.dispatchFetch('http://content.local.test'+base+path,{method,headers,...(options.body===undefined?{}:{body:options.raw?options.body:JSON.stringify(options.body)})});
  const data=await response.json();if(!response.ok||data.ok===false)throw Object.assign(new Error(data.code),{status:response.status,code:data.code,field:data.field,uncertain:response.status>=500});return data;
 };
 const metadata={originalLocale:'zh-Hans',title:{'zh-Hans':'只上传封面的新歌曲'},creatorName:'Station Cat'};
 const create=await send('/tracks',{method:'POST',key:crypto.randomUUID(),body:{data:{metadata}}});
 const musicRequest=(path,options)=>send(path,options,'/admin/api/music');
 const uploader=createSongUploader({actorId:(await send('/status')).actorId,storage:memory(),requester:musicRequest,verifyActor:()=>send('/status')});
 const job=await uploader.start(create.id,'cover',file);
 // Reproduce the user: cover saved in legacy draft, VIP default, no audio,
 // while the website draft still has no cover selected.
 const legacy=await f.db.prepare('SELECT draft_revision_id,lifecycle FROM music_tracks WHERE id=?').bind(create.id).first();
 await f.db.prepare('UPDATE music_track_revisions SET cover_asset_id=? WHERE id=?').bind(job.assetId,legacy.draft_revision_id).run();
 const ui=await adminScriptFixture('adminStationContent.js',{search:'?view=tracks&owner='+create.id,request:send,songRequest:musicRequest});
 assert.equal(ui.node('content-cover').value,job.assetId);assert.equal(ui.node('song-rights-label').hidden,false);assert.equal(ui.node('song-rights-confirm').checked,false);
 assert.equal(ui.node('content-preflight').hidden,true);assert.equal(ui.node('content-publish').textContent,'发布歌曲');assert.equal(ui.node('content-publish').disabled,false);
 const writes=calls.filter(c=>c.method).length;await ui.node('content-publish').click();await ui.idle();
 assert.match(ui.node('song-publish-feedback').textContent,/确认封面/);assert.equal(calls.filter(c=>c.method).length,writes);
 ui.node('song-rights-confirm').checked=true;await ui.node('content-publish').click();await ui.idle();
 assert.equal(ui.node('song-publish-feedback').textContent,'歌曲已发布。',ui.node('content-status').textContent);
 const detail=await send('/tracks/'+create.id);assert.equal(detail.status,'published');assert.equal(detail.draft,null);assert.equal(detail.published.data.siteAudioMode,'none');assert.equal(detail.published.data.coverAssetId,job.assetId);
 const publicTrack=await send('/tracks/'+detail.slug,{},'/api/station/content');assert.equal(publicTrack.track.title,metadata.title['zh-Hans']);assert.equal(publicTrack.track.preview,null);
 assert.equal(ui.node('song-public-link').href,'/music/tracks/'+detail.slug+'/');
 ui.node('song-cover-preview').onerror();await ui.node('content-reload').click();await ui.idle();assert.equal(ui.node('song-cover-preview').hidden,true);assert.match(ui.node('song-cover-empty').textContent,/可查看原图/);
 assert.equal((await f.db.prepare('SELECT lifecycle FROM music_tracks WHERE id=?').bind(create.id).first()).lifecycle,'draft');
 assert.equal((await f.db.prepare('SELECT audio_asset_id FROM music_track_revisions WHERE id=?').bind(legacy.draft_revision_id).first()).audio_asset_id,null);
 assert(!calls.some(c=>c.base==='/admin/api/music'&&/review|publish/.test(c.path)));
 for(const failure of ['lost body receipt','draft conflict'])await t.test('actual upload entry recovers '+failure+' after reload without losing newer metadata',async()=>{
  const song=await send('/tracks',{method:'POST',key:crypto.randomUUID(),body:{data:{metadata}}}),sharedStorage=new Map(),start=calls.length;let fail=true;
  const interruptedMusic=async(path,options)=>{const result=await musicRequest(path,options);if(failure==='lost body receipt'&&fail&&path.endsWith('/body')){fail=false;throw Object.assign(new Error('receipt lost'),{uncertain:true});}return result;};
  const interruptedContent=async(path,options={})=>{if(failure==='draft conflict'&&fail&&options.method==='PATCH'&&path==='/tracks/'+song.id){fail=false;throw Object.assign(new Error('conflict'),{status:409,code:'STATION_EDIT_CONFLICT'});}return send(path,options);};
  const page=await adminScriptFixture('adminStationContent.js',{search:'?view=tracks&owner='+song.id,request:interruptedContent,songRequest:interruptedMusic,sharedStorage});
  page.node('song-cover-file').files=[file];await page.node('song-cover-upload').click();await page.idle();
  assert.equal(page.node('song-upload-recovery').hidden,false,page.node('content-status').textContent);assert.equal(page.node('content-fields').disabled,true);assert.equal(page.state().pending,null);
  const fresh=await send('/tracks/'+song.id);await send('/tracks/'+song.id,{method:'PATCH',key:crypto.randomUUID(),etag:'"edit-'+fresh.editVersion+'"',body:{revision:fresh.draft.revision,data:{...fresh.draft.data,metadata:{...metadata,title:{'zh-Hans':'恢复时保留的新标题'}}}}});
  const recovered=await adminScriptFixture('adminStationContent.js',{search:'?view=tracks',request:send,songRequest:musicRequest,sharedStorage});
  assert.equal(recovered.state().current.id,song.id);recovered.node('song-recovery-file').files=[];
  await recovered.node('song-upload-resume').click();await recovered.idle();
  assert.equal(recovered.node('song-upload-recovery').hidden,true,recovered.node('content-status').textContent);assert.equal(recovered.node('content-fields').disabled,false);
  const saved=await send('/tracks/'+song.id);assert(saved.draft.data.coverAssetId);assert.equal(saved.draft.data.metadata.title['zh-Hans'],'恢复时保留的新标题');assert.equal(saved.status,'draft');
  assert.equal(calls.slice(start).filter(c=>c.path.endsWith('/body')).length,1);
 });
 await t.test('optional preview link creates an editor for the exact song outside the first page, without writing',async()=>{
  const start=calls.length,request=(path,options)=>path==='/tracks'?Promise.resolve({items:[],nextBefore:123}):send(path,options);
  const page=await adminScriptFixture('adminStationContent.js',{search:'?view=promotions&owner='+create.id,request});
  assert.equal(page.state().newObject,true,page.node('content-status').textContent);assert.equal(page.node('content-parent').value,create.id);assert.equal(page.node('content-form').hidden,false);
  assert(!calls.slice(start).some(c=>c.method));assert(!calls.slice(start).some(c=>c.path.startsWith('/assets?')&&!c.path.includes(create.id)));
 });
 await t.test('a concurrent save after the acknowledged save cannot be published by this click',async()=>{
  let race=true;const start=calls.length;
  const request=async(path,options={})=>{const result=await send(path,options);if(race&&options.method==='PATCH'&&path==='/tracks/'+create.id){race=false;await send(path,{method:'PATCH',key:crypto.randomUUID(),etag:'"edit-'+result.editVersion+'"',body:{revision:result.revision,data:{...options.body.data,metadata:{...metadata,title:{'zh-Hans':'其他管理员的修改'}}}}});}return result;};
  const raced=await adminScriptFixture('adminStationContent.js',{search:'?view=tracks&owner='+create.id,request});
  raced.node('content-title').value='本机修改';await raced.node('content-form').fire('input',{target:raced.node('content-title')});
  await raced.node('content-publish').click();await raced.idle();assert.match(raced.node('song-publish-feedback').textContent,/版本已变化/);
  assert(!calls.slice(start).some(c=>c.path.endsWith('/publish')));assert.equal((await send('/tracks/'+create.id)).published.data.metadata.title['zh-Hans'],metadata.title['zh-Hans']);
 });
 await t.test('editor cannot approve rights or publish a website song',async()=>{
  for(const [path,method,body]of [['/assets/'+job.assetId+'/rights','PUT',{scope:'cover',status:'approved',basis:'test'}],['/tracks/'+create.id+'/publish','POST',{revision:3}]])await assert.rejects(send(path,{method,key:crypto.randomUUID(),etag:'"edit-1"',body},'/fixture-editor/admin/api/music/site-content'),{status:403});
 });
});
test('the default material screen cannot send visitors through full audio review and the main song form omits irrelevant fields',async()=>{
 const [markup,client,css,workbench]=await Promise.all(['src/pages/admin/music.astro','src/scripts/adminMusic.js','public/styles/admin-station-content.css','src/components/redesign/StationAdminWorkbench.astro'].map(path=>readFile(new URL('../'+path,import.meta.url),'utf8')));
 assert.match(markup,/id="website-song-editor"/);assert.match(client,/if\(!audioMode\)index=1/);assert.match(client,/'\/admin-v2\/\?view=tracks'/);assert.match(css,/data-mode=website.*#panel-2/);
 assert.doesNotMatch(workbench,/id="content-audio-mode"|id="content-legacy"|网站展示与完整播放|完整资源/);
 for(const id of ['song-cover-upload','song-lyrics-upload','song-rights-confirm','song-upload-resume'])assert.match(workbench,new RegExp('id="'+id+'"'));
});

test('old material-page handoff preserves hidden edits until identity and discard are confirmed',async()=>{
 const source=await readFile(new URL('../src/scripts/adminMusic.js',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf("$('website-song-editor').addEventListener('click'"),source.indexOf("$('music-reload').onclick"));
 for(const mode of ['cancel','changed actor','pending write','continue']){
  const calls=[],journalState={workspace:{inputs:{title:'本机未保存标题'}},pending:mode==='pending write'?{key:'original'}:null};let click;
  const context=vm.createContext({dirty:true,assetsDirty:false,reviewDirty:true,busy:false,
   $:()=>({href:'/admin-v2/?view=tracks&owner='+owner,addEventListener:(_,fn)=>{click=fn;}}),journal:{get:()=>journalState,update:patch=>{calls.push('clear');Object.assign(journalState,patch);}},
   run:async task=>{try{await task();}catch{calls.push('blocked');}},status:()=>calls.push('status'),checkActor:async()=>{calls.push('identity');if(mode==='changed actor')throw new Error('changed');},
   canLeave:async()=>{calls.push('confirm');return mode==='continue';},location:{assign:path=>{calls.push(path);}}
  });
  vm.runInContext(handler,context);await click({preventDefault:()=>{}});
  if(mode==='continue'){assert.equal(journalState.workspace,null);assert.equal(context.dirty,false);assert.equal(context.reviewDirty,false);assert.deepEqual(calls,['identity','confirm','clear','/admin-v2/?view=tracks&owner='+owner]);}
  else{assert(journalState.workspace);assert.equal(context.dirty,true);assert.equal(context.reviewDirty,true);assert(!calls.includes('clear'));if(mode==='changed actor')assert(!calls.includes('confirm'));}
 }
});
