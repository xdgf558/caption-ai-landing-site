import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createAlbumCoverUploader} from '../src/scripts/musicAlbumCoverClient.js';
import {createCollectionJournal} from '../src/scripts/musicCollectionClient.js';
const album='11111111-1111-4111-8111-111111111111',asset='22222222-2222-4222-8222-222222222222',upload='33333333-3333-4333-8333-333333333333';
function setup(){const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},journal=createCollectionJournal(storage,'a@test');return {data,storage,journal};}
test('lost PUT receipt recovers without another PUT, keeps metadata only and does not attach itself',async()=>{
 const {data,journal}=setup();let status='reserved',puts=0;const calls=[];
 const api=async(path,op={})=>{calls.push([path,op.method]);
  if(path==='/collection-uploads')return {uploadId:upload,assetId:asset};
  if(path.endsWith('/body')){puts++;assert.equal(journal.get().coverJobs[0].stage,'writing');status='uploading';throw Object.assign(new Error('lost'),{uncertain:true});}
  if(path.endsWith('/complete')){status='completed';return {status,assetId:asset};}
  return {collectionId:album,assetId:asset,status};
 };
 const file=new File(['image bytes'],'cover.png',{type:'image/png'}),client=createAlbumCoverUploader({journal,checkActor:async()=>{},api});
 await assert.rejects(client.upload(album,file),/lost/);assert.equal(puts,1);
 const result=await client.resume(client.pending(album));assert.equal(result.assetId,asset);assert.equal(puts,1);
 assert.equal(client.pending(album),undefined);assert.doesNotMatch([...data.values()].join(''),/image bytes|Cookie|base64/);
 assert(!calls.some(([path])=>path.startsWith('/collections/')));
});
test('actor change or failed journal storage prevents new writes',async()=>{
 const {journal}=setup();let calls=0;const file=new File(['abc'],'cover.png');
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
 await assert.rejects(client.upload(album,new File(['abc'],'cover.png')),/lost reserve/);
 await assert.rejects(client.resume(client.pending(album),new File(['def'],'cover.png')),/同一个封面/);
 assert.equal(client.pending(album).stage,'reserved');
 owner=asset;
 await assert.rejects(client.resume(client.pending(album),new File(['abc'],'cover.png')),/不匹配/);
});
