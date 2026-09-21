// Actual Worker + temporary D1 authorization; no production configuration.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

test('prepare once before host launch; seed reads never create or replace sessions', {timeout:120000}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),'crash-prepare-test-'));
 const child=spawn(process.execPath,['scripts/helpers/mobile-crash-service.mjs',dir],{stdio:'ignore'});
 try{
  const until=Date.now()+60000;
  while(!existsSync(join(dir,'ready.json'))){
   assert.equal(child.exitCode,null,'fixture must remain alive');assert.ok(Date.now()<until,'fixture startup timeout');await delay(100);
  }
  const {port,key}=JSON.parse(readFileSync(join(dir,'ready.json'),'utf8'));
  const request=(path,body,proof=key)=>fetch(`http://127.0.0.1:${port}${path}`,{method:body===undefined?'GET':'POST',headers:{'X-Probe-Key':proof,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
  assert.equal((await request('/fixture/prepare',{stage:'A11'},'wrong-proof')).status,403);
  assert.equal((await request('/fixture/seed?stage=A11')).status,409);
  assert.equal((await request('/fixture/seed',{stage:'A11'})).status,404);
  assert.equal((await request('/fixture/prepare',{stage:'OTHER'})).status,400);
  const preparing=request('/fixture/prepare',{stage:'A11'});
  // Attempt the same setup after its durable start. It must be rejected even
  // if a loaded CI runner pauses this test until the first setup has finished.
  while(!readFileSync(join(dir,'diagnostics.jsonl'),'utf8').includes('seed_account'))await delay(5);
  assert.equal((await request('/fixture/prepare',{stage:'A11'})).status,409);
  const ready=await preparing;assert.equal(ready.status,200);assert.deepEqual(await ready.json(),{stage:'A11',ready:true});
  const first=await request('/fixture/seed?stage=A11');assert.equal(first.status,200);const envelope=await first.json();
  assert.ok(envelope.data.tokenFamilyId);assert.equal(envelope.data.generation,0);
  assert.deepEqual(await (await request('/fixture/seed?stage=A11')).json(),envelope);
  assert.equal((await request('/fixture/prepare',{stage:'A11'})).status,409);
  assert.equal((await request('/fixture/seed?stage=A12')).status,409);
  const evidence=await (await request('/fixture/evidence')).json();
  assert.equal(evidence.stage,'A11');assert.equal(evidence.session.generation,0);assert.deepEqual(evidence.requests,[]);assert.deepEqual(evidence.operations,[]);
  const rows=readFileSync(join(dir,'diagnostics.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  for(const phase of ['seed_account','seed_password_hash','seed_password_write','authorize_get','authorize_post','token_exchange'])
   assert.deepEqual(rows.filter(r=>r.phase===phase).map(r=>r.event),['start','done']);
  assert.ok(!JSON.stringify(rows).includes(envelope.data.tokenFamilyId));
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'evidence.json'),'utf8')),evidence);
  // A12 returns a real refresh response. Read the published snapshot repeatedly:
  // the D1 diagnostic count cannot increase merely because readers poll.
  assert.equal((await request('/fixture/prepare',{stage:'A12'})).status,200);
  assert.equal((await request('/fixture/seed?stage=A11')).status,409);
  const second=await (await request('/fixture/seed?stage=A12')).json();
  const mutation={clientId:'station-cat-ios',refreshToken:second.data.refreshToken,refreshRequestId:randomUUID(),generation:0};
  assert.equal((await request('/api/mobile/v1/auth/refresh',mutation)).status,200);
  const beforePoll=readFileSync(join(dir,'diagnostics.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.phase==='evidence_snapshot');
  for(let n=0;n<10;n++){
   const committed=await (await request('/fixture/evidence')).json();
   assert.equal(committed.stage,'A12');assert.equal(committed.session.generation,1);assert.equal(committed.session.revoked,0);
   assert.deepEqual(committed.operations,[{request_id:mutation.refreshRequestId,old_generation:0}]);
   assert.equal(committed.requests.length,1);assert.equal(committed.requests[0].status,200);
   assert.deepEqual(JSON.parse(readFileSync(join(dir,'evidence.json'),'utf8')),committed);
  }
  const afterPoll=readFileSync(join(dir,'diagnostics.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.phase==='evidence_snapshot');
  assert.deepEqual(afterPoll,beforePoll);assert.equal(afterPoll.length,6); // two seeds and one refresh, start+done

 }finally{
  if(child.exitCode===null&&child.signalCode===null){
   const exited=new Promise(resolve=>child.once('exit',resolve));
   const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
   child.kill('SIGTERM');await exited;clearTimeout(timer);
  }
  rmSync(dir,{recursive:true,force:true});
 }
});
