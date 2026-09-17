import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {setup,close,call,account,seed,grant,denied,db,music,bucket,seedFeaturedFixture} from './helpers/mobile-music-fixture.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),secret=()=>randomBytes(32).toString('base64url');
before(setup,{timeout:60000});after(close);
test('isolated gates stay closed unless explicitly enabled; config accurately reports music',async()=>{
 for(const flag of ['MOBILE_AUTH_ENABLED','MOBILE_MUSIC_ENABLED','MUSIC_PUBLIC_ENABLED'])await denied('/music/catalog',{headers:{'x-fixture-disabled':flag}},503);
 assert.equal((await (await call('/config')).json()).data.capabilities.musicPlayback,true);
});
test('free catalog/search/detail project no storage keys or credentials; pagination rejects stale cursor',async()=>{
 const t=await seed('free');const catalog=await (await call('/music/catalog?limit=1&q=Synthetic')).json();assert.equal(catalog.data.items[0].access,'free');
 const d=await (await call('/music/tracks/'+t.id)).json();assert.equal(d.data.lyrics.kind,'none');assert.equal(d.data.track.id,t.id);
 assert.ok(!JSON.stringify(d).includes('object_key'));await denied('/music/catalog?token=secret',{},400);await denied('/music/catalog?cursor=999:1',{},409);
});
test('free grant and separate preview stream GET HEAD Range with object identity checks',async()=>{
 for(const variant of ['full','preview']){const t=await seed('free'),g=await grant(t,null,variant);assert.equal(g.authMode,'public');assert.equal(g.accountId,null);
 const head=await call(g.playbackUrl,{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 const r=await call(g.playbackUrl,{headers:{Range:'bytes=4-15'}});assert.equal(r.status,206);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal((await r.arrayBuffer()).byteLength,12);
 const invalid=await call(g.playbackUrl,{headers:{Range:'bytes=999999-'}});assert.equal(invalid.status,416);
 assert.ok(!JSON.stringify(await db.prepare('SELECT * FROM mobile_playback_grants').all()).includes(new URL(g.playbackUrl).pathname.split('/').at(-2)));}
});
test('VIP grants require same account AND same session on every request, never Cookie fallback',async()=>{
 const t=await seed(),a=await account(),b=await account(),device=await account(true,a.id),g=await grant(t,a);
 for(const method of ['GET','HEAD']){await denied(g.playbackUrl,{method},401);for(const other of [b,device])await denied(g.playbackUrl,{method,headers:{...other.headers,Range:'bytes=0-1'}},403);}
 await denied(g.playbackUrl,{headers:{Cookie:'station_cat_reader_session='+a.token}},401);
 const r=await call(g.playbackUrl,{headers:{...a.headers,Range:'bytes=0-9'}});assert.equal(r.status,206);await r.arrayBuffer();
 await denied(g.playbackUrl+'?token='+a.token,{headers:a.headers},400);
});
test('invalid Bearer does not silently become anonymous, even for free/preview/catalog',async()=>{
 const t=await seed('free'),g=await grant(t);for(const path of ['/music/catalog',g.playbackUrl])await denied(path,{headers:{Authorization:'Bearer '+secret()}},401);
 await denied(`/music/tracks/${t.id}/playback-grants`,{body:{audioVersion:1,variant:'full'},headers:{Authorization:'broken'}},401);
});
test('free and preview remain public; non-VIP cannot mint full VIP grant',async()=>{
 const t=await seed(),a=await account(false);await denied(`/music/tracks/${t.id}/playback-grants`,{body:{audioVersion:1,variant:'full'},headers:a.headers},403);
 assert.equal((await grant(t,null,'preview')).authMode,'public');
});
test('expiry, revocation, blocked account, password changes deny before R2',async()=>{
 for(const action of ['expired','revoked','account','password']){const t=await seed(),a=await account(),g=await grant(t,a);
 if(action==='expired')await db.prepare('UPDATE mobile_playback_grants SET created_at=?,expires_at=? WHERE session_id=?').bind(Date.now()-20000,Date.now()-10000,a.sid).run();
 if(action==='revoked')await db.prepare('UPDATE mobile_sessions SET revoked=1 WHERE id=?').bind(a.sid).run();
 if(action==='account')await db.prepare("UPDATE reader_accounts SET status='disabled' WHERE id=?").bind(a.id).run();
 if(action==='password')await db.prepare("UPDATE reader_password_credentials SET password_hash='changed' WHERE account_id=?").bind(a.id).run();
 await denied(g.playbackUrl,{headers:a.headers},action==='expired'?403:401);}
});
test('membership expiry, VIP delivery off, publication withdrawn are checked every Range',async()=>{
 const t=await seed(),a=await account(),g=await grant(t,a);
 await denied(g.playbackUrl,{headers:{...a.headers,'x-fixture-disabled':'MUSIC_VIP_DELIVERY_ENABLED'}},503);
 await db.prepare('UPDATE reader_memberships SET started_at=?,expires_at=? WHERE account_id=?').bind('2020-01-01T00:00:00Z','2021-01-01T00:00:00Z',a.id).run();await denied(g.playbackUrl,{headers:a.headers},403);
 const free=await seed('free'),fg=await grant(free);await music.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").bind(free.id).run();await denied(fg.playbackUrl,{},404);
});
test('limited free expires at boundary; old grant cannot deliver free bytes afterwards',async()=>{
 const t=await seed('vip',Date.now()+1500),g=await grant(t);assert.ok(Date.parse(g.expiresAt)<=Date.now()+1500);
 await new Promise(r=>setTimeout(r,1600));await denied(g.playbackUrl,{},403);await denied(`/music/tracks/${t.id}/playback-grants`,{body:{audioVersion:1,variant:'full'}},401);
});
test('token rotation in same session retains grant binding; old bearer fails',async()=>{
 const t=await seed(),a=await account(),g=await grant(t,a),next=secret();await db.prepare('UPDATE mobile_sessions SET access_hash=?,generation=1 WHERE id=?').bind(hash(next),a.sid).run();
 await denied(g.playbackUrl,{headers:a.headers},401);const r=await call(g.playbackUrl,{headers:{Authorization:'Bearer '+next,Range:'bytes=0-1'}});assert.equal(r.status,206);await r.arrayBuffer();
});
test('entitlements are music projection only and do not mutate site membership',async()=>{
 const a=await account();const before=await db.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(a.id).first();
 const r=await (await call('/me/entitlements',{headers:a.headers})).json();assert.equal(r.data.music.canPlayVipFull,true);assert.equal(r.data.music.sources[0].kind,'site_vip');
 assert.deepEqual(await db.prepare('SELECT * FROM reader_memberships WHERE account_id=?').bind(a.id).first(),before);
});
test('missing membership DB table fails closed without R2 access',async()=>{
 const t=await seed(),a=await account(),g=await grant(t,a);await db.prepare('ALTER TABLE reader_memberships RENAME TO fixture_offline_membership').run();
 try{await denied(g.playbackUrl,{headers:a.headers},503);}finally{await db.prepare('ALTER TABLE fixture_offline_membership RENAME TO reader_memberships').run();}
});

test('lyrics retain Unicode, offset, multi-timestamps and audio version',async()=>{
 const t=await seed('free',null,'[offset:500]\n[00:01.00][00:03.00]你好，世界\n[00:05.00]Second line');
 const r=await call('/music/tracks/'+t.id),detail=(await r.json()).data;
 assert.equal(r.status,200);assert.equal(detail.lyrics.audioVersion,1);assert.equal(detail.lyrics.kind,'timed');
 assert.deepEqual(detail.lyrics.lines.map(l=>l.startSeconds),[.5,2.5,4.5]);assert.equal(detail.lyrics.lines[0].text,'你好，世界');
});
test('album order and pagination use only visible published members',async()=>{
 const a=await seed('free'),b=await seed('free'),id=randomUUID(),slug='fixture-'+id;
 await music.prepare("INSERT INTO music_collections(id,slug,status,original_locale,title_json,description_json,created_at,updated_at,collection_type,listening_mode) VALUES(?,?,'published','en',?, ?,?,?,'album','free')")
 .bind(id,slug,JSON.stringify({en:'Fixture album'}),JSON.stringify({en:'Synthetic collection'}),Date.now(),Date.now()).run();
 for(const [position,t] of [b,a].entries())await music.prepare('INSERT INTO music_collection_tracks(collection_id,track_id,position) VALUES(?,?,?)').bind(id,t.id,position).run();
 const first=(await (await call('/music/collections/'+slug+'?limit=1')).json()).data;assert.equal(first.tracks[0].id,b.id);assert.ok(first.nextCursor);
 const second=(await (await call('/music/collections/'+slug+'?limit=1&cursor='+first.nextCursor)).json()).data;assert.equal(second.tracks[0].id,a.id);assert.equal(second.nextCursor,null);
});
test('replaced storage object is rejected; malformed mode and version never authorize',async()=>{
 const t=await seed('free'),g=await grant(t);await bucket.put(t.audio.object_key,'not audio',{httpMetadata:{contentType:'audio/mpeg'}});
 const r=await call(g.playbackUrl);assert.equal(r.status,503);assert.equal(r.headers.get('content-type'),'application/json; charset=utf-8');
 await denied(`/music/tracks/${t.id}/playback-grants`,{body:{audioVersion:2,variant:'full'}},409);
 await denied(`/music/tracks/${t.id}/playback-grants`,{body:{audioVersion:1,variant:'full',authMode:'public'}},400);
});

test('featured preserves configured primary/secondary/collection order and never invents empty recommendations',async()=>{
 const fixture=await seedFeaturedFixture();
 const latest=(await (await call('/music/catalog?limit=6')).json()).data.items;
 assert.ok(!latest.some(t=>t.id===fixture.primaryTrackId));
 const featured=(await (await call('/music/featured')).json()).data;
 assert.deepEqual(featured.tracks.map(t=>t.id),fixture.trackIds);
 assert.deepEqual(featured.collections.map(c=>c.id),fixture.collectionIds);
 await music.prepare('DELETE FROM music_featured_items').run();
 assert.deepEqual((await (await call('/music/featured')).json()).data,{tracks:[],collections:[]});
});
