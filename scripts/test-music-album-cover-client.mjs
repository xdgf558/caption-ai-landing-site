import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createAlbumCoverUploader} from '../src/scripts/musicAlbumCoverClient.js';
import {createCollectionJournal} from '../src/scripts/musicCollectionClient.js';
const album='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222',upload='33333333-3333-4333-8333-333333333333';
const png=await sharp({create:{width:177,height:177,channels:4,background:'#729284'}}).png().toBuffer();
const cover=()=>new File([png],'cover.png',{type:'image/png'});
function setup(){const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},journal=createCollectionJournal(storage,'a@test');return {data,storage,journal};}
test('misnamed album cover reserves its real format and uploads unchanged bytes with matching MIME',async()=>{
 const {journal}=setup();const calls=[],file=new File([png],'download.jpg',{type:'image/jpeg'});
 const client=createAlbumCoverUploader({journal,checkActor:async()=>{},api:async(path,op={})=>{
  calls.push([path,op]);
  if(path==='/collection-uploads'){
   assert.deepEqual(op.body,{collectionId:album,format:'png',byteSize:png.length,sha256:createHash('sha256').update(png).digest('hex')});
   return {uploadId:upload,assetId:asset};
  }
  if(path.endsWith('/body')){assert.equal(op.type,'image/png');assert.equal(op.body,file);assert.deepEqual(Buffer.from(await op.body.arrayBuffer()),png);return {};}
  if(path.endsWith('/complete'))return {status:'completed',assetId:asset};
  return {collectionId:album,assetId:asset,status:'reserved'};
 }});
 assert.equal((await client.upload(album,file)).stage,'completed');
 assert.equal(calls.filter(([,op])=>op.method==='PUT').length,1);
 assert.equal(journal.get().coverJobs[0].type,'image/png');
});
test('invalid album covers do not reserve quota or leave recovery jobs',async()=>{
 const {journal}=setup();const before=JSON.stringify(journal.get());let calls=0;
 const client=createAlbumCoverUploader({journal,checkActor:async()=>{},api:async()=>{calls++;}});
 for(const bytes of [Buffer.from('<svg></svg>'),png.subarray(0,30)])await assert.rejects(client.upload(album,new File([bytes],'cover.jpg',{type:'image/jpeg'})),/封面/);
 assert.equal(calls,0);assert.equal(JSON.stringify(journal.get()),before);
});
test('lost PUT receipt recovers without another PUT, keeps metadata only and does not attach itself',async()=>{
 const {data,journal}=setup();let status='reserved',puts=0;const calls=[];
 const api=async(path,op={})=>{calls.push([path,op.method]);
  if(path==='/collection-uploads')return {uploadId:upload,assetId:asset};
  if(path.endsWith('/body')){puts++;assert.equal(journal.get().coverJobs[0].stage,'writing');status='uploading';throw Object.assign(new Error('lost'),{uncertain:true});}
  if(path.endsWith('/complete')){status='completed';return {status,assetId:asset};}
  return {collectionId:album,assetId:asset,status};
 };
 const file=new File([png],'cover.jpg',{type:'image/jpeg'}),client=createAlbumCoverUploader({journal,checkActor:async()=>{},api});
 await assert.rejects(client.upload(album,file),/lost/);assert.equal(puts,1);
 const result=await client.resume(client.pending(album));assert.equal(result.assetId,asset);assert.equal(puts,1);
 assert.equal(client.pending(album),undefined);assert.doesNotMatch([...data.values()].join(''),/Cookie|base64/);
 assert(![...data.values()].join('').includes(png.toString('base64')));
 assert(!calls.some(([path])=>path.startsWith('/collections/')));
});
test('actor change or failed journal storage prevents new writes',async()=>{
 const {journal}=setup();let calls=0;const file=cover();
 const client=createAlbumCoverUploader({journal,checkActor:async()=>{throw Error('actor changed');},api:async()=>{calls++;}});
 await assert.rejects(client.upload(album,file),/actor changed/);assert.equal(calls,0);
 const failed=createAlbumCoverUploader({journal:{get:()=>({}),update:()=>{throw Error('storage failed');}},checkActor:async()=>{},api:async()=>{calls++;}});
 await assert.rejects(failed.upload(album,file),/storage failed/);assert.equal(calls,0);
});
test('reserved recovery needs the same file and cannot cross album ownership',async()=>{
 const {journal}=setup();let lost=true,owner=album;
 const client=createAlbumCoverUploader({journal,checkActor:async()=>{},api:async(path)=>{
  if(path==='/collection-uploads'){if(lost){lost=false;throw Error('lost reserve');}return {uploadId:upload,assetId:asset};}
  return {collectionId:owner,assetId:asset,status:'reserved'};
 }});
 await assert.rejects(client.upload(album,cover()),/lost reserve/);
 await assert.rejects(client.resume(client.pending(album),new File(['def'],'cover.png')),/同一个封面/);
 assert.equal(client.pending(album).stage,'reserved');
 owner=asset;
 await assert.rejects(client.resume(client.pending(album),cover()),/不匹配/);
});
