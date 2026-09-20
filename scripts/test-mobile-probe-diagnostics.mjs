import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classify,createDiagnostics} from './helpers/mobile-probe-diagnostics.mjs';
test('durable operation markers survive an incomplete step and redact arbitrary errors',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'probe-diagnostics-'));const path=join(dir,'diagnostics.jsonl');
 const d=createDiagnostics(path),secret='private-body-cookie-token-url';
 try {
  let resolve;const waiting=d.step('evidence_session',()=>new Promise(r=>resolve=r));
  assert.equal(JSON.parse(readFileSync(path,'utf8').trim()).event,'start');
  resolve();await waiting;
  await assert.rejects(d.step('refresh',()=>{throw new Error('fetch failed '+secret,{cause:{code:'ECONNRESET',message:secret}});}));
  const contents=readFileSync(path,'utf8');assert.ok(!contents.includes(secret));
  const rows=contents.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(x=>x.event),['start','done','start','failed']);
  assert.equal(rows[3].category,'transport');assert.equal(rows[3].code,'ECONNRESET');
  assert.throws(()=>d.record(secret,'marker'));
 } finally {d.close();rmSync(dir,{recursive:true,force:true});}
});
test('error fields are allowlisted and diagnostics have a fixed file budget',()=>{
 assert.equal(classify({code:'SECRET',message:'arbitrary-secret'}).code,'OTHER');
 assert.equal(classify(new Error('D1_ERROR: database is locked')).category,'database_busy');
 const dir=mkdtempSync(join(tmpdir(),'probe-diagnostics-')),path=join(dir,'diagnostics.jsonl'),d=createDiagnostics(path);
 try{for(let n=0;n<5000;n++)d.record('held','marker');assert.ok(readFileSync(path).length<=262144);}finally{d.close();rmSync(dir,{recursive:true,force:true});}
});
