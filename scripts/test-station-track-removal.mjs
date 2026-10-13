import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {contentAdminFixture} from './helpers/station-content-admin-fixture.mjs';
import {removeArchivedTrack,restoreArchivedTrack} from './helpers/station-track-removal.mjs';
import {createContentObject,saveContentPlatform,saveContentObject} from '../src/redesign/contentAdmin.js';
import {listContentObjects,readContentObject,contentAssets} from '../src/redesign/contentAdminStore.js';
import {listAdminMusicTracks,readAdminMusicTrack} from '../src/music/admin.js';
import {removedTrackKey} from '../src/music/adminStore.js';

const all=[];afterEach(()=>all.splice(0).forEach(f=>f.sql.close()));
const ctx=()=>({actorId:'maintenance:local-test',key:randomUUID()});
async function fixture(){
  const f=await contentAdminFixture();all.push(f);const t=f.tracks.at(-1);
  await createContentObject(f.runtime,'tracks',{trackId:t.id,data:{metadata:t.metadata,siteAudioMode:'none'}},ctx());
  f.sql.prepare("UPDATE music_tracks SET lifecycle='archived',draft_revision_id=NULL,published_revision_id=NULL WHERE id=?").run(t.id);
  return {...f,t,expected:{legacyVersion:1,websiteVersion:1}};
}
test('removal excludes only the selected work from both catalogs, search and direct editors, preserving history and objects',async()=>{
  const f=await fixture(),before=f.dump(),objects=[...f.objects],schema=f.sql.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  const c=ctx(),result=await removeArchivedTrack(f.db,f.t.id,f.expected,c);
  assert.equal(result.removed,true);
  for(const list of [await listContentObjects(f.db,'tracks'),await listAdminMusicTracks(f.db)])assert.deepEqual(list.items.map(t=>t.id).sort(),before.music_tracks.filter(t=>t.id!==f.t.id).map(t=>t.id).sort());
  assert.equal((await listContentObjects(f.db,'tracks',{q:f.t.slug})).items.length,0);
  for(const read of [()=>readContentObject(f.db,'tracks',f.t.id),()=>readAdminMusicTrack(f.db,f.t.id),()=>contentAssets(f.db,{ownerId:f.t.id})])await assert.rejects(read,{code:'NOT_FOUND'});
  const after=f.dump();for(const table of Object.keys(before).filter(n=>!['music_tracks','station_track_publications','music_settings','music_mutations','music_admin_audit_logs'].includes(n)))assert.deepEqual(after[table],before[table],table);
  for(const table of ['music_tracks','station_track_publications'])assert.deepEqual(after[table].filter(r=>(r.id??r.track_id)!==f.t.id),before[table].filter(r=>(r.id??r.track_id)!==f.t.id));
  assert.deepEqual([...f.objects],objects);assert.deepEqual(f.sql.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),schema);
  assert.equal((await removeArchivedTrack(f.db,f.t.id,f.expected,c)).replayed,true);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='station.content.remove'").get().n,1);
});
test('restore makes the same archived record visible without republishing it',async()=>{
  const f=await fixture();await removeArchivedTrack(f.db,f.t.id,f.expected,ctx());
  const c=ctx();await restoreArchivedTrack(f.db,f.t.id,c);assert.equal((await restoreArchivedTrack(f.db,f.t.id,c)).replayed,true);
  assert((await listContentObjects(f.db,'tracks')).items.some(t=>t.id===f.t.id));
  assert.equal((await readContentObject(f.db,'tracks',f.t.id)).status,'draft');
  const t=f.sql.prepare('SELECT * FROM music_tracks WHERE id=?').get(f.t.id);assert.equal(t.lifecycle,'archived');assert.equal(t.published_revision_id,null);
});
test('active or stale records cannot be removed and leave no partial marker or audit',async()=>{
  const f=await fixture(),active=f.tracks[0];await createContentObject(f.runtime,'tracks',{trackId:active.id,data:{metadata:active.metadata,siteAudioMode:'none'}},ctx());
  for(const [id,expected,code] of [[active.id,f.expected,'TRACK_REMOVAL_REQUIRES_ARCHIVED'],[f.t.id,{...f.expected,legacyVersion:99},'MUSIC_EDIT_CONFLICT']]){
    const before=f.dump();await assert.rejects(removeArchivedTrack(f.db,id,expected,ctx()),{code});assert.deepEqual(f.dump(),before);
  }
});
test('referenced tracks are refused, including a platform inserted during removal preparation',async()=>{
  for(const concurrent of [false,true]){
    const f=await fixture();const add=()=>f.sql.prepare("INSERT INTO station_platform_links(id,track_id,provider,created_at,updated_at) VALUES(?,?,'netease',?,?)").run(randomUUID(),f.t.id,Date.now(),Date.now());
    if(concurrent)f.sqlState.beforeWrite=add;else add();
    await assert.rejects(removeArchivedTrack(f.db,f.t.id,f.expected,ctx()),{code:concurrent?'MUSIC_EDIT_CONFLICT':'TRACK_REMOVAL_REFERENCED'});
    assert.equal(f.sql.prepare('SELECT key FROM music_settings WHERE key=?').get(removedTrackKey(f.t.id)),undefined);
    assert.equal((await readContentObject(f.db,'tracks',f.t.id)).status,'draft');
  }
});
test('unknown commit acknowledgement replays the original successful removal',async()=>{
  const f=await fixture();f.sqlState.lose=true;const c=ctx();await removeArchivedTrack(f.db,f.t.id,f.expected,c);
  assert.equal((await removeArchivedTrack(f.db,f.t.id,f.expected,c)).replayed,true);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='station.content.remove'").get().n,1);
});
test('removed works cannot acquire platform records, promotions, clips or editor revisions',async()=>{
  const f=await fixture();await removeArchivedTrack(f.db,f.t.id,f.expected,ctx());const before=f.dump();
  await assert.rejects(saveContentPlatform(f.runtime,null,{trackId:f.t.id,provider:'netease',status:'planned',territories:['*'],sortOrder:0,url:null,verifiedAt:null,releasedAt:null},ctx()),{code:'NOT_FOUND'});
  await assert.rejects(createContentObject(f.runtime,'promotions',{trackId:f.t.id,data:{enabled:false,previewEnabled:false}},ctx()),{code:'NOT_FOUND'});
  await assert.rejects(createContentObject(f.runtime,'clips',{trackId:f.t.id,clipType:'mv',data:{metadata:f.t.metadata}},ctx()),{code:'NOT_FOUND'});
  await assert.rejects(saveContentObject(f.runtime,'tracks',f.t.id,{revision:1,data:{metadata:f.t.metadata,siteAudioMode:'none'}},{...ctx(),ifMatch:'"edit-2"'}),{code:'NOT_FOUND'});
  assert.deepEqual(f.dump(),before);
});
test('a platform write racing a removal marker is rejected in its final transaction',async()=>{
  const f=await fixture();f.sqlState.beforeWrite=()=>f.sql.prepare('INSERT INTO music_settings(key,value_json,updated_at) VALUES(?,?,?)').run(removedTrackKey(f.t.id),'{}',Date.now());
  await assert.rejects(saveContentPlatform(f.runtime,null,{trackId:f.t.id,provider:'netease',status:'planned',territories:['*'],sortOrder:0,url:null,verifiedAt:null,releasedAt:null},ctx()),{code:'STATION_EDIT_CONFLICT'});
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM station_platform_links').get().n,0);
});
test('removed rows are excluded before pagination, with no missing or duplicate remaining works',async()=>{
  const f=await fixture();await removeArchivedTrack(f.db,f.t.id,f.expected,ctx());
  const removed=new Set([f.t.id]);
  for(let i=0;i<30;i++){
    const id=randomUUID();f.sql.prepare("INSERT INTO music_tracks(id,slug,lifecycle,created_at,updated_at) VALUES(?,?,'archived',0,0)").run(id,'pagination-'+i);
    if(i%2===0){removed.add(id);f.sql.prepare('INSERT INTO music_settings(key,value_json,updated_at) VALUES(?,?,0)').run(removedTrackKey(id),'{}');}
  }
  const actual=[];let before;do{const page=await listContentObjects(f.db,'tracks',before?{before}:{});actual.push(...page.items.map(x=>x.id));before=page.nextBefore;}while(before);
  assert.deepEqual(actual.sort(),f.sql.prepare('SELECT id FROM music_tracks').all().map(x=>x.id).filter(id=>!removed.has(id)).sort());
  assert.equal(actual.length,new Set(actual).size);
});
test('failure writing the audit rolls back marker and both version changes',async()=>{
  const f=await fixture(),before=f.dump();f.sqlState.fail=/INSERT INTO music_admin_audit_logs/;
  await assert.rejects(removeArchivedTrack(f.db,f.t.id,f.expected,ctx()),{code:'MUSIC_DATABASE_UNAVAILABLE'});assert.deepEqual(f.dump(),before);
});
