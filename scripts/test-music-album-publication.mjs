import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID as id} from 'node:crypto';
import {createAlbumPublisher} from '../src/scripts/musicAlbumPublication.js';
const actor='publisher@example.test',copy=structuredClone;
function fixture(){
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},rows=Array.from({length:2},(_,i)=>{const audio=id();return {id:id(),lifecycle:'draft',editVersion:1,serverNow:new Date().toISOString(),rights:null,assets:[{id:audio,kind:'audio',state:'validated'}],draft:{id:id(),state:'draft',technicalReviewedAt:null,metadata:{originalLocale:'en',title:{en:'Song '+i}},policy:{accessMode:'free',policyVersion:1,earlyAccessUntil:null,postEarlyAccessMode:null},assets:{audio,preview:null,cover:null}}};});
 const album={id:id(),type:'album',status:'published',editVersion:3,listeningMode:'free',tracks:rows.map(r=>({id:r.id}))};
 const calls=[],receipts=new Map();let failure=null,currentActor=actor;
 const api=async(path,o={})=>{calls.push({path,...copy(o)});if(path==='/status')return {actorId:currentActor};if(path==='/collections/'+album.id)return copy(album);
  if(!o.method)return copy(rows.find(r=>path==='/tracks/'+r.id));
  if(receipts.has(o.key))return copy(receipts.get(o.key));
  const row=rows.find(r=>path.includes(r.id)||path.includes(r.draft?.id));assert.ok(row);
  if(failure?.before?.(path))throw Object.assign(new Error('Changed'),{status:409,uncertain:false});
  assert.equal(o.etag,`"edit-${row.editVersion}"`);const revisionId=row.draft.id;row.editVersion++;
  let result={trackId:row.id,revisionId,editVersion:row.editVersion};
  if(path.endsWith('/technical-review')){assert.equal(o.body.audioListened,true);row.draft.technicalReviewedAt=Date.now();result.technicalReviewedAt=row.draft.technicalReviewedAt;}
  else {assert.equal(o.body.revisionId,revisionId);row.lifecycle='published';row.published={...row.draft,state:'sealed'};row.draft=null;result.action='publish';}
  receipts.set(o.key,copy(result));if(failure?.after?.(path)){failure=null;throw Object.assign(new Error('Lost receipt'),{uncertain:true});}return result;
 };
 const make=()=>createAlbumPublisher({storage,actor,api});return {album,rows,calls,storage,data,make,setFailure:f=>failure=f,setActor:a=>currentActor=a};
}
const writes=f=>f.calls.filter(c=>c.method);
test('one confirmation reviews and publishes songs serially, retaining policies and existing published revisions',async()=>{
 const f=fixture(),before=f.rows.map(r=>copy(r.draft.policy)),p=f.make();assert.deepEqual(await p.publish(f.album,{listeningConfirmed:true}),{published:2});
 assert.deepEqual(writes(f).map(c=>c.method),['PUT','POST','PUT','POST']);assert.ok(f.rows.every(r=>r.lifecycle==='published'));assert.deepEqual(f.rows.map(r=>r.published.policy),before);
 f.rows[0].draft={id:id(),state:'draft'};assert.equal((await p.publish(f.album)).published,0);assert.equal(writes(f).length,4);
});
test('missing listening confirmation, later missing audio, blocked review or policy mismatch prevent all writes',async()=>{
 for(const kind of ['listening','audio','blocked','policy']){const f=fixture();if(kind==='audio')f.rows[1].assets=[];if(kind==='blocked')f.rows[1].rights={status:'blocked'};if(kind==='policy')f.album.listeningMode='vip';
  await assert.rejects(f.make().publish(f.album,{listeningConfirmed:kind!=='listening'}));assert.equal(writes(f).length,0);}
});
for(const kind of ['technical-review','publish'])test('lost '+kind+' receipt survives reload and only replays original command',async()=>{
 const f=fixture(),p=f.make();f.setFailure({after:path=>path.endsWith('/'+kind)});await assert.rejects(p.publish(f.album,{listeningConfirmed:true}),/Lost receipt/);
 const original=p.pending(),count=writes(f).length,q=f.make();assert.deepEqual(q.pending(),original);await assert.rejects(q.publish(f.album,{listeningConfirmed:true}),/待确认/);assert.equal(writes(f).length,count);
 await q.recover();assert.equal(q.pending(),null);assert.deepEqual(writes(f).at(-1),writes(f)[count-1]);assert.equal(f.rows[1].lifecycle,'draft');
 await q.publish(f.album,{listeningConfirmed:true});assert.ok(f.rows.every(r=>r.lifecycle==='published'));assert.equal(writes(f).filter(c=>c.path.endsWith('/publish')&&c.path.includes(f.rows[0].id)).length,kind==='publish'?2:1);
});
test('known member failure stops at that song and preserves earlier success',async()=>{
 const f=fixture();f.setFailure({before:path=>path.includes(f.rows[1].draft.id)});const p=f.make();await assert.rejects(p.publish(f.album,{listeningConfirmed:true}),/Song 1/);
 assert.equal(f.rows[0].lifecycle,'published');assert.equal(f.rows[1].lifecycle,'draft');assert.equal(p.pending(),null);
});
test('changed identity, album version or unavailable storage cannot silently continue writes',async()=>{
 const f=fixture();f.setActor('other');await assert.rejects(f.make().publish(f.album,{listeningConfirmed:true}),/账号已变化/);assert.equal(writes(f).length,0);
 const g=fixture(),old=copy(g.album);g.album.editVersion++;await assert.rejects(g.make().publish(old,{listeningConfirmed:true}),/曲序已变化/);assert.equal(writes(g).length,0);
 const h=fixture();h.storage.setItem=()=>{throw Error('storage');};await assert.rejects(h.make().publish(h.album,{listeningConfirmed:true}),/storage/);assert.equal(writes(h).length,0);
});
test('recovery schema rejects foreign paths, unknown fields and malformed policy IDs',async()=>{
 const f=fixture();f.setFailure({after:path=>path.endsWith('/publish')});const p=f.make();await assert.rejects(p.publish(f.album,{listeningConfirmed:true}));const raw=p.pending();
 for(const patch of [{path:'/readers/membership'},{cookie:'secret'},{policyVersion:0},{albumId:'bad'}]){f.storage.setItem('station-music-album-publication:v1:'+actor,JSON.stringify({...raw,...patch}));assert.throws(()=>f.make(),/不可读/);}
 assert.equal(createAlbumPublisher({storage:f.storage,actor:'other',api:()=>assert.fail()}).pending(),null);
});
