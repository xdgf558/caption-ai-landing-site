import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { handleMusicAdmin } from '../src/music/adminHttp.js';
import { createFeaturedJournal, reorderFeatured } from '../src/scripts/musicFeaturedClient.js';
import { musicTestDatabase } from './helpers/music-test-database.mjs';

const origin='https://music.example.test',actor='featured@example.test',instances=[];
afterEach(()=>instances.splice(0).forEach(f=>f.sql.close()));
function fixture(){const f=musicTestDatabase();instances.push(f);f.env={MUSIC_DB:f.db,MUSIC_BUCKET:{get(){assert.fail('Featured management must not read R2');}},WAITLIST_DB:{withSession(){assert.fail('Featured management must not read identity DB');}}};return f;}
function insert(sql,table,data){const keys=Object.keys(data);sql.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(data));}
function published(f,{mode='free',title='Published'}={}){
  const id=randomUUID(),revision=randomUUID(),audio=randomUUID(),now=Date.now()-1000;
  insert(f.sql,'music_tracks',{id,slug:'track-'+id,lifecycle:'draft',created_at:now-1000,updated_at:now});
  insert(f.sql,'music_assets',{id:audio,owner_track_id:id,kind:'audio',object_key:`music/audio/${id}/${audio}.mp3`,state:'validated',content_type:'audio/mpeg',format:'mp3',byte_size:1000,duration_ms:120000,sha256:'a'.repeat(64),etag:'fixture',created_at:now});
  insert(f.sql,'music_track_revisions',{id:revision,track_id:id,revision_no:1,state:'sealed',metadata_json:JSON.stringify({originalLocale:'en',title:{en:title},summary:{en:''},creatorName:'Fixture',instrumental:true,language:'instrumental',genres:[],moods:[]}),audio_asset_id:audio,access_mode:mode,policy_version:1,technical_reviewed_at:now,created_at:now-1});
  f.sql.prepare("UPDATE music_tracks SET lifecycle='published',published_revision_id=?,first_published_at=?,published_at=? WHERE id=?").run(revision,now,now,id);
  return id;
}
function collection(f,title='Collection'){
  const id=randomUUID(),now=Date.now()-1000;insert(f.sql,'music_collections',{id,slug:'collection-'+id,original_locale:'en',title_json:JSON.stringify({en:title}),description_json:'{}',status:'published',version:1,created_at:now,updated_at:now,collection_type:'playlist',listening_mode:'mixed'});return id;
}
async function call(f,path,method='GET',body,headers={}){const response=await handleMusicAdmin(new Request(origin+'/admin/api/music'+path,{method,headers:{Origin:origin,'Content-Type':'application/json','X-Requested-With':'StationCatMusicAdmin',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env,async()=>actor);return {status:response.status,body:await response.json()};}
const headers=(version,key=randomUUID())=>({'If-Match':`"edit-${version}"`,'Idempotency-Key':key});

test('0008 bounds slots and rejects targets that were never published',()=>{
  const f=fixture(),draft=randomUUID(),now=Date.now();insert(f.sql,'music_tracks',{id:draft,slug:'draft-'+draft,lifecycle:'draft',created_at:now,updated_at:now});
  assert.throws(()=>insert(f.sql,'music_featured_items',{slot_kind:'secondary',position:0,track_id:draft}),/MUSIC_FEATURED_TRACK_UNAVAILABLE/);
  assert.throws(()=>insert(f.sql,'music_featured_items',{slot_kind:'primary',position:1,track_id:null}),/CHECK/);
  assert.throws(()=>insert(f.sql,'music_featured_items',{slot_kind:'collection',position:6,collection_id:randomUUID()}),/CHECK|FOREIGN KEY|MUSIC_FEATURED_COLLECTION_UNAVAILABLE/);
  assert.deepEqual({...f.sql.prepare('SELECT id,version,updated_at FROM music_featured_home').get()},{id:1,version:1,updated_at:0});
});

test('one CAS mutation saves all slots, bumps catalog, audits once and replays exactly',async()=>{
  const f=fixture(),free=published(f,{title:'Free'}),vip=published(f,{mode:'vip',title:'VIP'}),group=collection(f),key=randomUUID();
  const candidates=await call(f,'/tracks?status=published');assert.equal(candidates.status,200);
  assert.deepEqual(Object.fromEntries(candidates.body.items.map(row=>[row.id,row.effectiveAccess])),{[free]:'free',[vip]:'vip'});
  const body={primaryTrackId:free,secondaryTrackIds:[vip],collectionIds:[group],reason:'Homepage curation'};
  let result=await call(f,'/featured','PUT',body,headers(1,key));assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.editVersion,2);
  assert.equal(f.sql.prepare("SELECT value_json FROM music_settings WHERE key='catalogVersion'").get().value_json,'1');
  assert.deepEqual(f.sql.prepare('SELECT slot_kind,position,track_id,collection_id FROM music_featured_items ORDER BY slot_kind').all().map(row=>({...row})),[
    {slot_kind:'collection',position:0,track_id:null,collection_id:group},{slot_kind:'primary',position:0,track_id:free,collection_id:null},{slot_kind:'secondary',position:0,track_id:vip,collection_id:null}]);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='music.featured.update'").get().n,1);
  result=await call(f,'/featured','PUT',body,headers(1,key));assert.equal(result.status,200);assert.equal(result.body.replayed,true);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='music.featured.update'").get().n,1);
  const view=await call(f,'/featured');assert.equal(view.status,200);assert.equal(view.body.primaryTrackId,free);assert.deepEqual(view.body.secondaryTrackIds,[vip]);
});

test('VIP primary and stale targets fail without partial placement, catalog or audit writes',async()=>{
  const f=fixture(),free=published(f),vip=published(f,{mode:'vip'}),group=collection(f),before=f.dump();
  let result=await call(f,'/featured','PUT',{primaryTrackId:vip,secondaryTrackIds:[],collectionIds:[],reason:'Invalid'},headers(1));assert.equal(result.body.code,'MUSIC_FEATURED_PRIMARY_NOT_FREE');assert.deepEqual(f.dump(),before);
  f.sql.prepare("UPDATE music_tracks SET lifecycle='unpublished' WHERE id=?").run(free);const afterDownlist=f.dump();
  result=await call(f,'/featured','PUT',{primaryTrackId:null,secondaryTrackIds:[free],collectionIds:[group],reason:'Stale'},headers(1));assert.equal(result.body.code,'MUSIC_FEATURED_TRACK_UNAVAILABLE');assert.deepEqual(f.dump(),afterDownlist);
});

test('bounded input rejects duplicates, overlap and a seventh placement before writes',async()=>{
  const f=fixture(),free=published(f),before=f.dump(),values=Array.from({length:7},()=>randomUUID());
  for(const body of [
    {primaryTrackId:free,secondaryTrackIds:[free],collectionIds:[],reason:'Overlap'},
    {primaryTrackId:null,secondaryTrackIds:[free,free],collectionIds:[],reason:'Duplicate'},
    {primaryTrackId:null,secondaryTrackIds:values,collectionIds:[],reason:'Too many'}
  ]) { const result=await call(f,'/featured','PUT',body,headers(1));assert.equal(result.status,422);assert.equal(result.body.code,'MUSIC_INVALID_FEATURED'); }
  assert.deepEqual(f.dump(),before);
});

test('competing saves cannot overwrite the winning featured version',async()=>{
  const f=fixture(),first=published(f,{title:'First'}),second=published(f,{title:'Second'});
  const results=await Promise.all([
    call(f,'/featured','PUT',{primaryTrackId:first,secondaryTrackIds:[],collectionIds:[],reason:'First'},headers(1)),
    call(f,'/featured','PUT',{primaryTrackId:second,secondaryTrackIds:[],collectionIds:[],reason:'Second'},headers(1))
  ]);
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM music_admin_audit_logs WHERE action='music.featured.update'").get().n,1);
  assert.equal(f.sql.prepare('SELECT version FROM music_featured_home WHERE id=1').get().version,2);
  assert.ok([first,second].includes(f.sql.prepare("SELECT track_id FROM music_featured_items WHERE slot_kind='primary'").get().track_id));
});

test('featured journal is actor scoped and reorder is bounded',()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
  const journal=createFeaturedJournal(storage,actor),a={id:randomUUID(),label:'A',status:'published',effectiveAccess:'free'},b={id:randomUUID(),label:'B',status:'published',effectiveAccess:'vip'};
  journal.update({workspace:{editVersion:1,primary:a,secondary:[b],collections:[],reason:'Local',dirty:true}});
  assert.equal(createFeaturedJournal(storage,actor).get().workspace.primary.label,'A');assert.equal(createFeaturedJournal(storage,'other@example.test').get().workspace,null);
  assert.deepEqual(reorderFeatured([a,b],0,1).map(row=>row.label),['B','A']);assert.deepEqual(reorderFeatured([a,b],0,3),[a,b]);
});
