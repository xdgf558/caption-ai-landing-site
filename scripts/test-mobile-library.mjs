import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {personalMusic} from '../src/mobile/library.js';
import {principal} from '../src/mobile/sessions.js';
import {setup,close,call,account,seed,db,music} from './helpers/mobile-music-fixture.mjs';
before(()=>setup({personalSync:true}),{timeout:60000});after(close);
async function request(a,path,body,method){const r=await call('/me/music/'+path,{headers:a?.headers,body,method:method||(body?'PUT':'GET')});return {status:r.status,...await r.json()};}
const put=(a,t,b={})=>request(a,'favorites/'+t.id,{favorite:true,mutationId:randomUUID(),expectedVersion:0,...b});
const listen=(t,epoch=0)=>({trackId:t.id,audioVersion:1,variant:'full',eventId:randomUUID(),historyEpoch:epoch,audibleSeconds:5,positionSeconds:5,occurredAt:new Date().toISOString()});
test('sync gated, bearer required, no cookie fallback',async()=>{const a=await account();assert.equal((await request(null,'favorites')).status,401);const r=await call('/me/music/favorites',{headers:{...a.headers,'x-fixture-disabled':'MOBILE_PERSONAL_SYNC_ENABLED'}});assert.equal(r.status,503);assert.equal((await (await call('/config')).json()).data.capabilities.personalSync,true);});
test('favorite persistence, tombstones, conflict and isolated owners',async()=>{const a=await account(),b=await account(),t=await seed('free');assert.equal((await put(a,t)).status,200);assert.equal((await request(b,'favorites')).data.items.length,0);const conflict=await put(a,t);assert.equal(conflict.status,409);assert.equal(conflict.error.code,'VERSION_CONFLICT');const removed=await put(a,t,{favorite:false,expectedVersion:1});assert.equal(removed.data.version,2);assert.equal((await request(a,'favorites')).data.items[0].favorite,false);});
test('idempotent replay and payload mismatch, concurrent duplicate executes once',async()=>{const a=await account(),t=await seed('free'),mutationId=randomUUID();const replies=await Promise.all([put(a,t,{mutationId}),put(a,t,{mutationId})]);assert.deepEqual(replies.map(x=>x.status),[200,200]);assert.equal((await put(a,t,{mutationId,favorite:false})).status,409);assert.equal((await request(a,'favorites')).data.items[0].version,1);assert.equal((await db.prepare('SELECT count(*) n FROM mobile_music_operations WHERE account_id=?').bind(a.id).first()).n,1);});
test('stable pagination invalidates concurrent snapshots',async()=>{const a=await account(),t=await seed('free'),u=await seed('free');await put(a,t);await put(a,u);const first=await request(a,'favorites?limit=1');assert.ok(first.data.nextCursor);const second=await request(a,'favorites?limit=1&cursor='+first.data.nextCursor);assert.notEqual(first.data.items[0].trackId,second.data.items[0].trackId);await put(a,t,{favorite:false,expectedVersion:1});assert.equal((await request(a,'favorites?cursor='+first.data.nextCursor)).status,409);});
test('listens only after threshold, dedup, clear invalidates offline event',async()=>{const a=await account(),t=await seed('free'),event=listen(t);assert.equal((await request(a,'listens',{...event,audibleSeconds:4.9},'POST')).status,400);assert.equal((await request(a,'listens',event,'POST')).status,200);assert.equal((await request(a,'listens',event,'POST')).status,200);assert.equal((await request(a,'recent')).data.items.length,1);const mutationId=randomUUID(),body={confirmed:true,historyEpoch:0,mutationId};assert.equal((await request(a,'recent',body,'DELETE')).data.historyEpoch,1);assert.equal((await request(a,'recent',body,'DELETE')).data.historyEpoch,1);assert.equal((await request(a,'listens',event,'POST')).error.code,'HISTORY_EPOCH_STALE');assert.equal((await request(a,'recent')).data.items.length,0);});
test('account history disabled at server; enabling cannot resurrect old epoch',async()=>{const a=await account(),t=await seed('free');let p=await request(a,'preferences',{historyEnabled:false,expectedVersion:0,mutationId:randomUUID()},'PATCH');assert.equal(p.data.historyEpoch,1);assert.equal((await request(a,'listens',listen(t,1),'POST')).error.code,'HISTORY_DISABLED');p=await request(a,'preferences',{historyEnabled:true,expectedVersion:1,mutationId:randomUUID()},'PATCH');assert.equal(p.data.historyEpoch,2);assert.equal((await request(a,'listens',listen(t,1),'POST')).status,409);assert.equal((await request(a,'listens',listen(t,2),'POST')).status,200);});
test('history 90 day retention, account/session revocation, invalid payload',async()=>{const a=await account(),t=await seed('free');await request(a,'listens',listen(t),'POST');await db.prepare('UPDATE mobile_music_recent SET played_at=0 WHERE account_id=?').bind(a.id).run();assert.equal((await request(a,'recent')).data.items.length,0);assert.equal((await put(a,t,{accountId:'2'})).status,400);await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE id=?').bind(a.sid).run();assert.equal((await put(a,t)).status,401);});
test('active favorite limit rejects overflow but allows removal',async()=>{const a=await account(),t=await seed('free');await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5000) INSERT INTO mobile_music_favorites SELECT ?,printf('00000000-0000-4000-8000-%012d',x),1,1,? FROM n`).bind(a.id,Date.now()).run();assert.equal((await put(a,t)).error.code,'LIBRARY_LIMIT');assert.equal((await request(a,'favorites/00000000-0000-4000-8000-000000000001',{favorite:false,expectedVersion:1,mutationId:randomUUID()})).status,200);assert.equal((await put(a,t)).status,200);});
test('recent cap physically trims to 1000 and expired rows',async()=>{const a=await account(),t=await seed('free');await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1001) INSERT INTO mobile_music_recent(account_id,track_id,played_at,position) SELECT ?,printf('00000000-0000-4000-8000-%012d',x),?,5 FROM n`).bind(a.id,Date.now()-1000).run();await request(a,'listens',listen(t),'POST');assert.equal((await db.prepare('SELECT count(*) n FROM mobile_music_recent WHERE account_id=?').bind(a.id).first()).n,1000);});

test('favorite tombstone pagination remains readable beyond ten thousand rows',async()=>{const a=await account();await request(a,'favorites');await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10002) INSERT INTO mobile_music_favorites SELECT ?,printf('00000000-0000-4000-8000-%012d',x),0,1,? FROM n`).bind(a.id,Date.now()).run();const page=await request(a,'favorites?limit=1&cursor=0:10001');assert.equal(page.status,200);assert.equal(page.data.items.length,1);assert.equal(page.data.nextCursor,null);assert.equal((await request(a,'favorites?cursor=0:100001')).status,400);});
test('different songs concurrently favorited both survive account CAS',async()=>{
 const a=await account(),b=await account(false,a.id),t=await seed('free'),u=await seed('free');
 for(let version=0;version<6;version++) {
  const favorite=version%2===0,left={mutationId:randomUUID(),favorite,expectedVersion:version},right={mutationId:randomUUID(),favorite,expectedVersion:version};
  const responses=await Promise.all([put(a,t,left),put(b,u,right)]);
  assert.deepEqual(responses.map(x=>x.status),[200,200]);
  assert.deepEqual((await put(a,t,left)).data,responses[0].data);
 }
 const rows=(await request(a,'favorites')).data.items;assert.equal(rows.length,2);assert.ok(rows.every(x=>x.version===6));
});
test('late offline listen preserves newer occurrence and position plus receipt time',async()=>{
 const a=await account(),t=await seed('free'),u=await seed('free'),now=Date.now();
 const recent={...listen(t),occurredAt:new Date(now-60000).toISOString(),positionSeconds:40};
 assert.equal((await request(a,'listens',recent,'POST')).status,200);
 const accepted=await db.prepare('SELECT * FROM mobile_music_recent WHERE account_id=? AND track_id=?').bind(a.id,t.id).first();
 assert.equal(accepted.played_at,now-60000);assert.ok(accepted.received_at>=now);
 assert.equal((await request(a,'listens',{...listen(u),occurredAt:new Date(now-120000).toISOString()},'POST')).status,200);
 const late={...listen(t),occurredAt:new Date(now-86400000).toISOString(),positionSeconds:5};
 assert.equal((await request(a,'listens',late,'POST')).status,200);
 const rows=(await request(a,'recent')).data.items;assert.deepEqual(rows.map(x=>x.trackId),[t.id,u.id]);assert.equal(rows[0].positionSeconds,40);assert.equal(rows[0].lastPlayedAt,recent.occurredAt);
 const retained=await db.prepare('SELECT * FROM mobile_music_recent WHERE account_id=? AND track_id=?').bind(a.id,t.id).first();assert.deepEqual(retained,accepted);
 assert.equal((await request(a,'listens',{...listen(t),occurredAt:recent.occurredAt,positionSeconds:1},'POST')).status,200);assert.equal((await request(a,'recent')).data.items[0].positionSeconds,40);
 assert.equal((await request(a,'listens',late,'POST')).status,200);
});
test('listen timestamps reject missing old or excessive future values, small skew clamps',async()=>{
 const a=await account(),t=await seed('free'),now=Date.now();
 for(const occurredAt of [undefined,'broken',new Date(now-31*86400000).toISOString(),new Date(now+6*60000).toISOString()])assert.equal((await request(a,'listens',{...listen(t),occurredAt},'POST')).status,400);
 assert.equal((await request(a,'listens',{...listen(t),occurredAt:new Date(now+4*60000).toISOString()},'POST')).status,200);
 const row=await db.prepare('SELECT played_at,received_at FROM mobile_music_recent WHERE account_id=?').bind(a.id).first();assert.equal(row.played_at,row.received_at);assert.ok(row.played_at>=now);
});
test('account contention retries are bounded and exhausted writes remain safely retryable',async()=>{
 const a=await account(),t=await seed('free'),mutationId=randomUUID(),body={favorite:true,expectedVersion:0,mutationId};
 await request(a,'preferences');let attempts=0;
 const env={MOBILE_PERSONAL_SYNC_ENABLED:'true',MOBILE_ENVIRONMENT:'isolated',MOBILE_AUTH_ENABLED:'true',MOBILE_MUSIC_ENABLED:'true',MUSIC_DB:music};
 const req=new Request('https://native.local.test/api/mobile/v1/me/music/favorites/'+t.id,{method:'PUT',headers:{...a.headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const session=await principal(db,req,Date.now());
 // Real D1 batches, with an unrelated account revision committed before each CAS.
 const contested={prepare:sql=>db.prepare(sql),batch:async statements=>{attempts++;await db.prepare('UPDATE mobile_music_state SET revision=revision+1 WHERE account_id=?').bind(a.id).run();return db.batch(statements);}};
 await assert.rejects(personalMusic(req,env,contested,session,Date.now()),e=>e.code==='LIBRARY_BUSY'&&e.status===503);
 assert.equal(attempts,3);assert.equal((await request(a,'favorites')).data.items.length,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM mobile_music_operations WHERE account_id=?').bind(a.id).first()).n,0);
 assert.equal((await put(a,t,body)).status,200);assert.equal((await put(a,t,body)).data.version,1);
});
test('same resource concurrent edit remains a real version conflict',async()=>{
 const a=await account(),t=await seed('free');
 const outcomes=await Promise.all([put(a,t),put(a,t)]);
 assert.deepEqual(outcomes.map(x=>x.status).sort(),[200,409]);assert.equal(outcomes.find(x=>x.status===409).error.code,'VERSION_CONFLICT');
 assert.equal((await request(a,'favorites')).data.items[0].version,1);
});
