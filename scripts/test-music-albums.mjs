import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleMusicAdmin } from '../src/music/adminHttp.js';
import { executeMusicPublication } from '../src/music/publication.js';
import { publicationFingerprint } from '../src/music/publicationValidation.js';
import { seedMusicRuntimeFixture } from './helpers/music-runtime-fixture.js';
import { musicTestDatabase } from './helpers/music-test-database.mjs';
import { buildPublicCatalog } from '../src/music/catalog.js';
import { loadPublicMusicSnapshot, loadPublicMusicCollectionSnapshot } from '../src/music/publicStore.js';
import { createCollectionJournal, reorderCollection } from '../src/scripts/musicCollectionClient.js';

const instances=[];
afterEach(()=>{for(const f of instances.splice(0))f.sql.close();});
const actor='albums@example.test', origin='https://music.example.test';
function fixture(){const f=musicTestDatabase();instances.push(f);f.env={MUSIC_DB:f.db,
  MUSIC_BUCKET:{get(){assert.fail('Album management must not read R2');}},WAITLIST_DB:{withSession(){assert.fail('Album management must not read identity');}}};return f;}
const match=n=>({'If-Match':`"edit-${n}"`});
async function call(f,path,method='GET',body,headers={}){
  const r=await handleMusicAdmin(new Request(origin+'/admin/api/music'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':randomUUID(),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env,async()=>actor);
  return {status:r.status,body:await r.json()};
}
const input=(extra={})=>({slug:'album-'+randomUUID(),originalLocale:'en',title:{en:'Album fixture'},description:{en:'Synthetic tests only'},type:'album',listeningMode:'mixed',...extra});
const save=(c,extra={})=>({slug:c.slug,originalLocale:c.originalLocale,title:c.title,description:c.description,type:c.type,listeningMode:c.listeningMode,coverTrackId:c.coverTrackId,status:c.status,reason:'Album test',...extra});
async function album(f,extra={}){const r=await call(f,'/collections','POST',input(extra));assert.equal(r.status,200,JSON.stringify(r.body));return (await call(f,'/collections/'+r.body.collectionId)).body;}
async function order(f,c,ids){const r=await call(f,`/collections/${c.id}/tracks`,'PUT',{trackIds:ids,reason:'Album order'},match(c.editVersion));assert.equal(r.status,200,JSON.stringify(r.body));return (await call(f,'/collections/'+c.id)).body;}
async function draft(f){const r=await call(f,'/tracks','POST',{slug:'song-'+randomUUID(),metadata:{originalLocale:'en',title:{en:'Draft'},summary:{en:''},creatorName:'Fixture',instrumental:true,language:'instrumental',genres:[],moods:[]}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.trackId;}
async function published(f,{mode='vip',cover=false,until=null}={}){
  const id=randomUUID(),aid=randomUUID(),pid=randomUUID(),base={owner_track_id:id,state:'validated',format:'mp3',content_type:'audio/mpeg',byte_size:1000,sha256:'b'.repeat(64),etag:'synthetic'};
  const command=await seedMusicRuntimeFixture(f.db,{audio:{...base,id:aid,kind:'audio',object_key:`music/audio/${id}/${aid}.mp3`,duration_ms:120000},preview:{...base,id:pid,kind:'preview',object_key:`music/previews/${id}/${pid}.mp3`,duration_ms:30000,derived_from_asset_id:aid,source_start_ms:0,source_end_ms:30000}});
  let coverId=null;
  if(cover){coverId=randomUUID();f.sql.prepare("INSERT INTO music_assets(id,owner_track_id,kind,state,object_key,format,content_type,byte_size,sha256,etag,created_at) VALUES(?,?,'cover','validated',?,'png','image/png',1000,?,'synthetic',?)").run(coverId,id,`music/covers/${id}/${coverId}.png`,'b'.repeat(64),Date.now()-1000);}
  f.sql.prepare('UPDATE music_track_revisions SET access_mode=?,early_access_until=?,post_early_access_mode=?,cover_asset_id=? WHERE id=?').run(mode,until,until?'free':null,coverId,command.revisionId);
  const track=f.sql.prepare('SELECT * FROM music_tracks WHERE id=?').get(id),revision=f.sql.prepare('SELECT * FROM music_track_revisions WHERE id=?').get(command.revisionId),rights=f.sql.prepare('SELECT * FROM music_rights_reviews WHERE revision_id=?').get(command.revisionId),assets=f.sql.prepare('SELECT * FROM music_assets WHERE owner_track_id=?').all(id),evidence=f.sql.prepare('SELECT * FROM music_rights_evidence WHERE review_id=?').all(rights.id);
  const fingerprint=await publicationFingerprint({track,revision,rights,assets,evidence});
  f.sql.prepare('UPDATE music_track_revisions SET technical_fingerprint=? WHERE id=?').run(fingerprint,revision.id);f.sql.prepare('UPDATE music_rights_reviews SET revision_fingerprint=? WHERE id=?').run(fingerprint,rights.id);
  await executeMusicPublication(f.db,command,{actorId:actor,verifyResources:async values=>({checkedAt:Date.now(),assets:values.map(a=>({id:a.id,exists:true,etag:a.etag,sha256:a.sha256,byteSize:a.byte_size,contentType:a.content_type,structureValid:true,measurement:'mp3-frames',durationMs:a.duration_ms,width:160,height:160,animated:false}))})});
  return id;
}
async function publish(f,c,extra={}){return call(f,'/collections/'+c.id,'PATCH',save(c,{status:'published',...extra}),match(c.editVersion));}
async function catalog(f,now=Date.now()){return buildPublicCatalog({...await loadPublicMusicSnapshot(f.db,now),locale:'en',now});}

test('0007 preserves existing playlist identity and rejects type changes and invalid album fields',()=>{
  const sql=new DatabaseSync(':memory:');try{
    sql.exec(readFileSync(new URL('../migrations-music/0001_music_foundation.sql',import.meta.url),'utf8'));
    const id=randomUUID();sql.prepare("INSERT INTO music_collections(id,slug,original_locale,title_json,created_at,updated_at) VALUES(?,'old','en','{}',1,1)").run(id);
    sql.exec(readFileSync(new URL('../migrations-music/0007_music_albums.sql',import.meta.url),'utf8'));
    assert.deepEqual({...sql.prepare('SELECT collection_type,listening_mode,cover_track_id FROM music_collections').get()},{collection_type:'playlist',listening_mode:'mixed',cover_track_id:null});
    assert.throws(()=>sql.prepare("UPDATE music_collections SET collection_type='album'").run(),/MUSIC_COLLECTION_IDENTITY/);
    assert.throws(()=>sql.prepare("UPDATE music_collections SET listening_mode='vip'").run(),/CHECK/);
    assert.throws(()=>sql.prepare("INSERT OR REPLACE INTO music_collections(id,slug,original_locale,title_json,collection_type,created_at,updated_at) VALUES(?,'old','en','{}','album',1,1)").run(id),/MUSIC_COLLECTION_IDENTITY/);
  }finally{sql.close();}
});

test('album draft can be incomplete; publication requires every member and matching current policies without rewriting songs',async()=>{
  const f=fixture(),vip=await published(f),free=await published(f,{mode:'free'}),d=await draft(f);
  let c=await album(f,{listeningMode:'vip'});
  assert.equal((await publish(f,c)).body.code,'MUSIC_ALBUM_TRACKS_NOT_PUBLISHED');
  c=await order(f,c,[vip,d]);assert.equal((await publish(f,c)).body.code,'MUSIC_ALBUM_TRACKS_NOT_PUBLISHED');
  c=await order(f,c,[vip,free]);const before=f.dump();
  assert.equal((await publish(f,c)).body.code,'MUSIC_ALBUM_POLICY_MISMATCH');assert.deepEqual(f.dump(),before);
  const result=await publish(f,c,{listeningMode:'mixed'});assert.equal(result.status,200,JSON.stringify(result.body));
  for(const table of ['music_tracks','music_track_revisions','music_assets','music_upload_sessions','music_rights_reviews'])assert.deepEqual(f.dump()[table],before[table],table);
  assert.equal((await call(f,'/collections?type=album')).body.items.length,1);
  assert.equal((await call(f,'/collections?type=playlist')).body.items.length,0);
  c=(await call(f,'/collections/'+c.id)).body;
  const result2=await call(f,`/collections/${c.id}/tracks`,'PUT',{trackIds:[vip,d],reason:'Cannot replace published members with drafts'},match(c.editVersion));
  assert.equal(result2.body.code,'MUSIC_ALBUM_TRACKS_NOT_PUBLISHED');
  assert.equal((await call(f,'/collections/'+c.id,'PATCH',save(c,{type:'playlist'}),match(c.editVersion))).body.code,'MUSIC_COLLECTION_IDENTITY');
});

test('only a member cover may be selected; public cover is canonical and no private fields escape',async()=>{
  const f=fixture(),first=await published(f),cover=await published(f,{cover:true}),outside=await published(f,{cover:true});let c=await album(f);
  c=await order(f,c,[first,cover]);
  assert.equal((await publish(f,c,{coverTrackId:outside})).body.code,'MUSIC_ALBUM_COVER_INVALID');
  assert.equal((await publish(f,c,{coverTrackId:first})).body.code,'MUSIC_ALBUM_COVER_INVALID');
  assert.equal((await publish(f,c,{coverTrackId:cover})).status,200);
  const result=await catalog(f),value=result.body.collections[0];
  assert.equal(value.coverUrl,`/api/music/tracks/${cover}/cover?v=1`);assert.equal(value.coverTrackId,cover);assert.equal(value.type,'album');assert.deepEqual(value.trackIds,[first,cover]);
  assert.doesNotMatch(JSON.stringify(result.body),/object_key|sha256|etag|rights|token|albums@example|canPlayFull/);
  c=(await call(f,'/collections/'+c.id)).body;
  assert.equal((await call(f,`/collections/${c.id}/tracks`,'PUT',{trackIds:[first],reason:'Cannot orphan cover'},match(c.editVersion))).body.code,'MUSIC_ALBUM_COVER_INVALID');
});

test('whole album hides on downlist or natural policy transition; playlist continues filtering unavailable members',async()=>{
  const f=fixture(),until=Date.now()+60000,early=await published(f,{mode:'early_access',until}),second=await published(f);
  let c=await album(f,{listeningMode:'vip'});c=await order(f,c,[second,early]);assert.equal((await publish(f,c)).status,200);
  let p=await album(f,{type:'playlist'});p=await order(f,p,[second,early]);assert.equal((await publish(f,p)).status,200);
  const before=await catalog(f,until-1),after=await catalog(f,until);
  assert.equal(before.body.collections.length,2);assert.equal(after.body.collections.length,1);assert.equal(after.body.collections[0].type,'playlist');assert.notEqual(before.etag,after.etag);
  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(second);
  const down=await catalog(f);assert.equal(down.body.collections.length,1);assert.deepEqual(down.body.collections[0].trackIds,[early]);
  const snapshot=await loadPublicMusicCollectionSnapshot(f.db,c.slug,Date.now());
  assert.deepEqual((await buildPublicCatalog({...snapshot,locale:'en',now:Date.now()})).body.collections,[]);
});

test('album publication guard catches a member downlist even when another published member remains',async()=>{
  const f=fixture(),a=await published(f),b=await published(f);let c=await album(f);c=await order(f,c,[a,b]);
  f.state.beforeWrite=async()=>{f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(b);};
  const result=await publish(f,c);assert.equal(result.status,409,JSON.stringify(result.body));assert.equal((await call(f,'/collections/'+c.id)).body.status,'draft');
});

test('album policy save rolls back zero-write and lost receipt replays without a second edit or audit',async()=>{
  const f=fixture();let c=await album(f);const key=randomUUID(),body=save(c,{listeningMode:'vip'}),headers={...match(1),'Idempotency-Key':key},before=f.dump();
  f.state.skip=/INSERT INTO music_mutations/;
  assert.equal((await call(f,'/collections/'+c.id,'PATCH',body,headers)).status,409);assert.deepEqual(f.dump(),before);
  f.state.skip=null;f.state.lose=true;
  assert.equal((await call(f,'/collections/'+c.id,'PATCH',body,headers)).status,200);const committed=f.dump();
  assert.equal((await call(f,'/collections/'+c.id,'PATCH',body,headers)).body.replayed,true);assert.deepEqual(f.dump(),committed);
  c=(await call(f,'/collections/'+c.id)).body;assert.equal(c.listeningMode,'vip');assert.equal(c.editVersion,2);
});

test('collection recovery is actor scoped, storage failure keeps old receipt and order operations do not mutate input',()=>{
  const map=new Map([['station-music-admin:v1:'+actor,'track upload journal']]);let fail=false;
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(fail)throw new Error('quota');map.set(k,v);}};
  const journal=createCollectionJournal(storage,actor),pending={path:'/collections',method:'POST',body:input(),key:randomUUID()};journal.update({pending});
  assert.deepEqual(createCollectionJournal(storage,actor).get().pending,pending);assert.equal(createCollectionJournal(storage,'other').get().pending,null);
  assert.equal(map.get('station-music-admin:v1:'+actor),'track upload journal');
  assert.throws(()=>journal.update({pending:{...pending,path:'/tracks'}}),/原操作记录不可读/);
  assert.throws(()=>journal.update({pending:{...pending,raw:true}}),/原操作记录不可读/);
  fail=true;assert.throws(()=>journal.update({pending:null}),/quota/);assert.deepEqual(journal.get().pending,pending);
  const rows=[{id:'a'},{id:'b'},{id:'c'}];assert.deepEqual(reorderCollection(rows,0,2).map(r=>r.id),['b','c','a']);assert.deepEqual(rows.map(r=>r.id),['a','b','c']);assert.equal(reorderCollection(rows,-1,0),rows);assert.equal(reorderCollection(rows,0,3),rows);
});
