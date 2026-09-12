import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAlbumBatch, createBatchJournal, createBatchPlan, BATCH_LIMIT } from '../src/scripts/musicAlbumBatch.js';
import { WAV_PROFILE } from '../src/scripts/musicWav.js';
const clone=v=>structuredClone(v),actor='batch@example.test';
const config={locale:'zh-Hans',creator:'测试创作者',language:'无人声',instrumental:true};
const file=(name='a.mp3',content='synthetic MP3 contract bytes')=>new File([content],name,{lastModified:0});
const error=(message,uncertain=false,status=409)=>Object.assign(new Error(message),{uncertain,status});
function fixture(selected=[file(),file('b.mp3')]){
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const album={id:randomUUID(),type:'album',status:'draft',title:{en:'Album'},slug:'album',listeningMode:'vip',editVersion:1,tracks:[]};
  const state={calls:[],tracks:new Map(),uploads:new Map(),receipts:new Map(),actor,fail:null,gate:null,active:0,maxActive:0};
  const api=async(path,opts={})=>{
    const method=opts.method||'GET',call={path,method,...opts};state.calls.push(call);
    if(state.gate)await state.gate(call);
    if(state.fail?.when==='before'&&state.fail.match(call)){const e=state.fail;state.fail=null;throw error(e.message||'network',e.uncertain??true);}
    let result;
    const isPut=path.endsWith('/body');
    if(method!=='GET'&&!isPut&&state.receipts.has(opts.key))result=state.receipts.get(opts.key);
    else if(path==='/status')result={actorId:state.actor,capabilities:{uploads:true,collections:true}};
    else if(method==='GET'&&path==='/collections/'+album.id)result=clone(album);
    else if(path==='/tracks'&&method==='POST'){
      result={trackId:randomUUID(),revisionId:randomUUID(),editVersion:1};state.tracks.set(result.trackId,{...result,...clone(opts.body)});
    }else if(path==='/uploads'&&method==='POST'){
      result={uploadId:randomUUID(),assetId:randomUUID(),status:'reserved'};state.uploads.set(result.uploadId,{...result,trackId:opts.body.trackId,declaredBytes:opts.body.byteSize});
    }else if(path.startsWith('/uploads/')){
      const u=state.uploads.get(path.split('/')[2]);assert.ok(u);
      if(method==='GET')result=clone(u);
      else if(isPut){state.active++;state.maxActive=Math.max(state.maxActive,state.active);assert.equal(u.status,'reserved');u.status='uploading';await Promise.resolve();state.active--;result=clone(u);}
      else {if(u.status!=='uploading')throw error('UPLOAD_NOT_READY');u.status='completed';result={uploadId:u.uploadId,assetId:u.assetId,status:'completed',state:'validated'};}
    }else if(path.startsWith('/tracks/')&&method==='PATCH'){
      const t=state.tracks.get(path.split('/')[2]);if(opts.etag!==`"edit-${t.editVersion}"`||opts.body.revisionId!==t.revisionId)throw error('MUSIC_EDIT_CONFLICT');
      Object.assign(t,clone(opts.body),{editVersion:t.editVersion+1,revisionId:randomUUID()});result={trackId:t.trackId,revisionId:t.revisionId,editVersion:t.editVersion};
    }else if(path==='/collections/'+album.id+'/tracks'&&method==='PUT'){
      if(opts.etag!==`"edit-${album.editVersion}"`)throw error('MUSIC_COLLECTION_CONFLICT');album.tracks=opts.body.trackIds.map(id=>({id}));album.editVersion++;
      result={collectionId:album.id,editVersion:album.editVersion};
    }else assert.fail(path+' '+method);
    if(method!=='GET'&&!isPut)state.receipts.set(opts.key,clone(result));
    if(state.fail?.when==='after'&&state.fail.match(call)){const e=state.fail;state.fail=null;throw error(e.message||'network',e.uncertain??true);}
    return clone(result);
  };
  let converter={convert:async f=>({file:file(f.name.replace(/wav$/,'mp3'),'converted'),profile:WAV_PROFILE}),cancel(){}};
  let journal=createBatchJournal(storage,actor,album.id);
  const make=()=>createAlbumBatch({journal:(journal=createBatchJournal(storage,actor,album.id)),actor,api,converter});
  const core=createAlbumBatch({journal,actor,api,converter});core.select(createBatchPlan(album,selected,config),selected);
  for(const [i,r] of journal.get().batch.rows.entries())core.edit(r.id,{mode:i%2?'vip':'free'});
  return {core,make,get journal(){return journal;},storage,data,state,album,files:selected,converter,api};
}
const writes=f=>f.state.calls.filter(c=>c.method!=='GET');
const puts=f=>writes(f).filter(c=>c.path.endsWith('/body'));

test('selection is bounded, requires explicit per-track modes and does no IO or album-derived policy updates',async()=>{
  const f=fixture();assert.equal(f.state.calls.length,0);const p=createBatchPlan(f.album,f.files,config);
  assert.ok(p.rows.every(r=>r.mode===''));assert.throws(()=>createBatchPlan({...f.album,status:'published'},f.files,config));
  assert.throws(()=>createBatchPlan(f.album,Array(BATCH_LIMIT+1).fill(file()),config));assert.throws(()=>createBatchPlan(f.album,[f.files[0],f.files[0]],config));
  assert.throws(()=>createBatchPlan(f.album,[file('bad.zip')],config));assert.throws(()=>createBatchPlan(f.album,[{name:'large.wav',size:256*1048576+1}],config));
  f.core.edit(f.journal.get().batch.rows[0].id,{mode:''});await assert.rejects(f.core.continue(),/逐首确认/);assert.equal(writes(f).length,0);
});

test('one file at a time; explicit ordered membership; no publish, rights, preview or policy rewrite',async()=>{
  const f=fixture();const id=f.journal.get().batch.rows[1].id;f.core.move(id,-1);
  await f.core.continue();assert.equal(f.state.maxActive,1);assert.equal(f.album.tracks.length,0);
  const rows=f.journal.get().batch.rows;assert.ok(rows.every(r=>r.stage==='ready'));assert.equal(puts(f).length,2);
  assert.deepEqual([...f.state.tracks.values()].map(t=>t.policy.accessMode),['vip','free']);
  await f.core.addReady();assert.deepEqual(f.album.tracks.map(t=>t.id),rows.map(r=>r.trackId));
  assert.ok(writes(f).every(c=>!/(publish|rights|review|readers)/.test(c.path)));
  assert.ok([...f.state.tracks.values()].every(t=>Object.keys(t.assets).join()==='audio'));
  assert.throws(()=>f.core.edit(id,{mode:'vip'}),/开始后/);f.core.clear();assert.equal(f.journal.get().batch,null);
});

for(const [label,match] of [
  ['create',c=>c.path==='/tracks'],['reserve',c=>c.path==='/uploads'],['complete',c=>c.path.endsWith('/complete')],['save',c=>c.method==='PATCH']
])test(`lost ${label} receipt survives reload, never auto-retries, original key only`,async()=>{
  const f=fixture([file()]);f.state.fail={when:'after',match};await assert.rejects(f.core.continue(),/network/);
  const pending=f.journal.get().pending;assert.ok(pending);const count=writes(f).length;
  const restored=f.make();assert.equal(writes(f).length,count);await assert.rejects(restored.continue(),/原操作/);assert.equal(writes(f).length,count);
  assert.throws(()=>restored.clear(),/结果不明/);await restored.retry();const retried=writes(f).filter(match);assert.equal(retried[0].key,retried[1].key);assert.deepEqual(retried[0].body,retried[1].body);
  const r=f.journal.get().batch.rows[0];if(!['verified','ready'].includes(r.stage))restored.replace(r.id,f.files[0]);
  await restored.continue();assert.equal(f.state.tracks.size,1);assert.equal(f.state.uploads.size,1);assert.equal(puts(f).length,1);assert.equal(f.journal.get().batch.rows[0].stage,'ready');
});

test('unknown PUT is queried/completed after reload, never resends bytes; even reserved does not prove absence',async()=>{
  for(const when of ['before','after']){
    const f=fixture([file()]);f.state.fail={when,match:c=>c.path.endsWith('/body')};await assert.rejects(f.core.continue());
    assert.equal(f.journal.get().batch.rows[0].stage,'writing');const restored=f.make();
    if(when==='after'){await restored.continue();assert.equal(f.journal.get().batch.rows[0].stage,'ready');}
    else{await assert.rejects(restored.continue(),/UPLOAD_NOT_READY/);assert.throws(()=>restored.clear(),/未完成/);await assert.rejects(restored.continue(),/UPLOAD_NOT_READY/);}
    assert.equal(puts(f).length,1);assert.equal(f.state.uploads.size,1);
  }
});

test('reserved recovery requires the same generated MP3 hash and size; never a replacement reservation',async()=>{
  const f=fixture([file('source.wav','RIFF'+'.'.repeat(60))]);f.state.fail={when:'after',match:c=>c.path==='/uploads'};await assert.rejects(f.core.continue());
  const restored=f.make();await restored.retry();const id=f.journal.get().batch.rows[0].id;
  restored.replace(id,file('wrong.mp3','wrong'));await assert.rejects(restored.continue(),/不符/);assert.equal(puts(f).length,0);assert.equal(f.state.uploads.size,1);
  restored.replace(id,f.files[0]);await restored.continue();assert.equal(puts(f).length,1);assert.equal(f.state.uploads.size,1);assert.equal(f.journal.get().batch.rows[0].output.conversion,WAV_PROFILE);
});

test('identity changes during conversion stop all writes; storage failure blocks the next mutation',async()=>{
  const f=fixture([file('source.wav','RIFF'+'.'.repeat(60))]);f.converter.convert=async()=>{f.state.actor='other';return{file:file(),profile:WAV_PROFILE};};
  await assert.rejects(f.core.continue(),/账号已变化/);assert.equal(writes(f).length,0);
  const g=fixture([file()]);g.storage.setItem=()=>{throw new Error('storage unavailable');};await assert.rejects(g.core.continue(),/storage unavailable/);assert.equal(writes(g).length,0);
  assert.equal(createBatchJournal(f.storage,'another',f.album.id).get().batch,null);
});

test('cancel conversion creates no draft; stop during PUT finishes its proof but never starts the next file',async()=>{
  const f=fixture([file('source.wav','RIFF'+'.'.repeat(60))]);let entered;const active=new Promise(r=>entered=r);let rejectConvert;
  f.converter.convert=()=>new Promise((resolve,reject)=>{rejectConvert=reject;entered();});f.converter.cancel=()=>rejectConvert?.(new Error('cancelled'));
  const started=f.core.continue();await active;f.core.stop();await assert.rejects(started,/cancelled/);assert.equal(writes(f).length,0);
  const g=fixture();g.state.gate=async c=>{if(c.path.endsWith('/body'))g.core.stop();};await g.core.continue();
  assert.equal(g.state.tracks.size,1);assert.equal(g.journal.get().batch.rows[0].stage,'ready');assert.equal(g.journal.get().batch.rows[1].stage,'waiting');assert.equal(puts(g).length,1);
});

test('partial success is explicit; remaining retry preserves original batch order and a lost order receipt replays once',async()=>{
  const f=fixture();let creations=0;f.state.gate=async c=>{if(c.path==='/tracks'&&++creations===2)throw error('quota',false);};
  await assert.rejects(f.core.continue(),/quota/);assert.equal(f.journal.get().batch.rows.filter(r=>r.stage==='ready').length,1);
  f.state.fail={when:'after',match:c=>c.path.endsWith('/tracks')&&c.method==='PUT'};await assert.rejects(f.core.addReady());
  const original=f.journal.get().pending;await f.core.retry();assert.equal(f.album.tracks.length,1);assert.equal(writes(f).at(-1).key,original.key);
  await f.core.continue();await f.core.addReady();assert.equal(f.album.tracks.length,2);assert.deepEqual(f.album.tracks.map(t=>t.id),f.journal.get().batch.rows.map(r=>r.trackId));
});

test('concurrent album edits are not overwritten; explicit rebase keeps server order without duplicate tracks',async()=>{
  const f=fixture();await f.core.continue();const outside=randomUUID();f.album.tracks=[{id:outside}];f.album.editVersion++;
  await assert.rejects(f.core.addReady(),/专辑已变化/);assert.deepEqual(f.album.tracks,[{id:outside}]);
  await f.core.refreshAlbum();await f.core.addReady();const first=f.album.tracks[1].id;
  f.album.tracks=[{id:first},{id:outside}];f.album.editVersion++;await f.core.refreshAlbum();await f.core.addReady();
  assert.deepEqual(f.album.tracks.map(t=>t.id),[first,outside,f.journal.get().batch.rows[1].trackId]);
});

test('changed track version is never replaced with a fresh snapshot; unresolved journals cannot be discarded',async()=>{
  const f=fixture([file()]);f.state.gate=async c=>{if(c.method==='PATCH'){f.state.tracks.get(c.path.split('/')[2]).editVersion++;f.state.gate=null;}};
  await assert.rejects(f.core.continue(),/MUSIC_EDIT_CONFLICT/);assert.equal(f.journal.get().batch.rows[0].stage,'verified');
  await assert.rejects(f.core.continue(),/MUSIC_EDIT_CONFLICT/);assert.throws(()=>f.core.clear(),/未完成/);assert.equal(puts(f).length,1);
});

test('journal refuses media, unknown commands, foreign album and unsafe replay paths',async()=>{
  const f=fixture([file()]);const state=f.journal.get();
  assert.throws(()=>f.journal.update({batch:{...state.batch,token:'secret'}}));
  assert.throws(()=>f.journal.update({batch:{...state.batch,album:{...state.batch.album,id:randomUUID()}}}));
  f.state.fail={when:'after',match:c=>c.path==='/tracks'};await assert.rejects(f.core.continue());const op=f.journal.get().pending;
  assert.throws(()=>f.journal.update({pending:{...op,request:{...op.request,path:'/readers/membership'}}}));
  assert.throws(()=>f.journal.update({pending:{...op,kind:'publish'}}));
  const text=JSON.stringify([...f.data.values()]);assert.doesNotMatch(text,/Blob|Cookie|access_token|converted/);
});

test('cancel remaining items never discards created or uncertain work and cannot cancel a pending receipt',async()=>{
  const f=fixture();f.state.gate=async c=>{if(c.path.endsWith('/body'))f.core.stop();};await f.core.continue();f.core.cancelRemaining();
  assert.deepEqual(f.journal.get().batch.rows.map(r=>r.stage),['ready','cancelled']);assert.throws(()=>f.core.clear(),/未完成/);await f.core.addReady();f.core.clear();assert.equal(f.state.tracks.size,1);
  const g=fixture();g.state.fail={when:'after',match:c=>c.path==='/tracks'};await assert.rejects(g.core.continue());assert.throws(()=>g.core.cancelRemaining(),/核对当前/);assert.ok(g.journal.get().pending);
});
