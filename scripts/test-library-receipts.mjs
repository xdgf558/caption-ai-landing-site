import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeLibraryReceipt,decodeLibraryReceipt} from '../src/mobile/libraryReceipts.js';
const examples=[{accepted:true},{historyEnabled:false,historyEpoch:1234,version:5678},{trackId:'00000000-0000-4000-8000-000000000001',favorite:false,version:9876,updatedAt:'2026-09-20T00:00:00.000Z'}];
test('legacy and compact receipts preserve all values; privacy/favorite storage is smaller',()=>{
 for(const value of examples){assert.deepEqual(decodeLibraryReceipt(JSON.stringify(value)),value);assert.deepEqual(decodeLibraryReceipt(encodeLibraryReceipt(value)),value);}
 for(const value of examples.slice(1))assert.ok(encodeLibraryReceipt(value).length<JSON.stringify(value).length);
});
test('malformed and unknown formats fail closed with retryable error, not a new mutation',()=>{
 for(const raw of ['null','{}','["r2","listen"]','["r1","listen",true]','["r1","privacy",1,2,3]','["r1","privacy",true,-1,3]','["r1","favorite","x",false,1,"invalid"]','{'])assert.throws(()=>decodeLibraryReceipt(raw),e=>e.status===503||e.statusCode===503);
});

test('receipt ID constraint matches the shared writer across the full accepted range',()=>{
 for(const length of [16,36,80,81,128]){
  const value={trackId:'T'.repeat(length),favorite:false,version:1,updatedAt:'2026-09-20T00:00:00.000Z'};
  assert.deepEqual(decodeLibraryReceipt(JSON.stringify(value)),value);
  assert.deepEqual(decodeLibraryReceipt(encodeLibraryReceipt(value)),value);
 }
 for(const trackId of ['T'.repeat(15),'T'.repeat(129),'!'.repeat(36)])assert.throws(()=>encodeLibraryReceipt({trackId,favorite:false,version:1,updatedAt:'2026-09-20T00:00:00.000Z'}));
});
