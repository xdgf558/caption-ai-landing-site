#!/usr/bin/env node
// Offline-only preparation of the user-approved published album copy. No remote
// calls; raw source metadata/audio and generated SQL stay in ignored private files.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {checkAssetIdentity,verifyStoredMusicAsset} from '../src/music/resources.js';
import {publicationFingerprint,checkPublicationRights} from '../src/music/publicationValidation.js';
import {projectPublicTrack} from '../src/music/catalog.js';
const base=new URL('../.generated/r3-real/private/',import.meta.url);
const read=n=>JSON.parse(readFileSync(new URL(n,base)));
const source=read('snapshot.json'), copies=read('objects.json');
assert.equal(source.music_collections.length,1);
assert.equal(source.music_collections[0].id,'88038d45-c77f-4414-b3b5-15f8111f924b');
assert.equal(source.music_collections[0].slug,'wydgb');
assert.equal(source.music_collections[0].status,'published');
assert.equal(source.music_tracks.length,7);
assert.equal(source.music_track_revisions.length,7);
assert.equal(copies.length,22);
assert.equal(source.music_rights_reviews.length,0);
assert.equal(source.music_rights_evidence.length,0);
assert.ok(!existsSync(new URL('import.sql',base)),'Retain prepared imports; no overwrite');
const config=JSON.parse(readFileSync(new URL('../wrangler.mobile-r2.jsonc',import.meta.url)));
assert.equal(config.d1_databases.find(d=>d.binding==='MUSIC_DB').database_id,'19595ea0-7359-4ab3-b168-d82247edefa5');
assert.equal(config.r2_buckets[0].bucket_name,'station-cat-music-r2-audio');
assert.equal(config.vars.MOBILE_ENVIRONMENT,'isolated');
const originalAssets=[...source.music_assets,...source.music_collection_assets];
const bySource=new Map(copies.map(x=>[x.sourceAssetId,x.asset]));
assert.equal(bySource.size,originalAssets.length);
for(const row of copies){
 const a=row.asset,old=originalAssets.find(o=>o.id===row.sourceAssetId);assert.ok(old);
 assert.equal(row.sourceSHA256,old.sha256);checkAssetIdentity(a);
 assert.equal(a.kind,old.kind);assert.equal(a.owner_track_id,old.owner_track_id);assert.equal(a.owner_collection_id,old.owner_collection_id);
 assert.match(row.file,/^objects\/[a-f0-9-]+\.(mp3|lrc|jpeg)$/);
 const bytes=readFileSync(new URL(row.file,base));
 assert.equal(bytes.length,a.byte_size);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.sha256);
 assert.equal(createHash('md5').update(bytes).digest('hex'),a.etag);
 if(a.kind==='cover'){assert.equal(a.format,'jpeg');assert.ok(a.byte_size<2097152);}
 else {assert.equal(a.sha256,old.sha256);assert.equal(a.id,old.id);assert.equal(a.object_key,old.object_key);assert.equal(a.duration_ms,old.duration_ms);}
 const bucket={async get(key){
   assert.equal(key,a.object_key);let pos=0;
   return {key,etag:a.etag,size:bytes.length,httpMetadata:{contentType:a.content_type},body:new ReadableStream({type:'bytes',pull(c){if(pos===bytes.length){c.close();c.byobRequest?.respond(0);return;}const n=Math.min(16384,bytes.length-pos);c.enqueue(new Uint8Array(bytes.subarray(pos,pos+n)));pos+=n;}})};
 }};
 await verifyStoredMusicAsset(bucket,a);
}
const assets=source.music_assets.map(a=>bySource.get(a.id));
const tracks=source.music_tracks.map(t=>({...t,draft_revision_id:null}));
const revisions=structuredClone(source.music_track_revisions);
const now=Date.now();
for(const revision of revisions){
 const track=tracks.find(t=>t.id===revision.track_id);
 assert.equal(track.lifecycle,'published');assert.equal(track.published_revision_id,revision.id);assert.equal(revision.state,'sealed');assert.equal(revision.access_mode,'free');
 // The copied revision is verified and published in the test environment now.
 track.published_at=now;track.updated_at=now;
 revision.cover_asset_id=bySource.get(revision.cover_asset_id).id;
 const snapshot={track,revision,assets:assets.filter(a=>a.owner_track_id===track.id),rights:null,evidence:[]};
 checkPublicationRights(snapshot,now);
 revision.technical_fingerprint=await publicationFingerprint(snapshot);
 revision.technical_reviewed_at=now;
 assert.ok(projectPublicTrack(snapshot,{locale:'zh-Hans',now}));
}
const collection={...source.music_collections[0],cover_asset_id:bySource.get(source.music_collections[0].cover_asset_id).id};
const collectionAssets=source.music_collection_assets.map(a=>bySource.get(a.id));
const q=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=OFF;');db.exec(readFileSync(new URL('test-catalog-before.sql',base),'utf8'));db.exec('PRAGMA foreign_keys=ON;');
const before=Object.fromEntries(['music_tracks','music_assets','music_track_revisions','music_collections','music_collection_tracks','music_collection_assets'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));
const cv=db.prepare("SELECT value_json FROM music_settings WHERE key='catalogVersion'").get().value_json;
const fv=db.prepare('SELECT version FROM music_featured_home WHERE id=1').get().version;
const token='r3-real-album-20260924';
let sql='PRAGMA defer_foreign_keys=ON;\n';
sql+=`INSERT INTO music_publication_guards(operation_token,passed) VALUES(${q(token)},CASE WHEN (SELECT value_json FROM music_settings WHERE key='catalogVersion')=${q(cv)} AND (SELECT version FROM music_featured_home WHERE id=1)=${fv} THEN 1 ELSE 0 END);\n`;
function insert(table,row){const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));assert.ok(Object.keys(row).every(k=>columns.has(k)));sql+=`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.values(row).map(q).join(',')});\n`;}
for(const t of tracks)insert('music_tracks',{...t,lifecycle:'draft',published_revision_id:null,first_published_at:null,published_at:null});
for(const a of [...assets].sort((a,b)=>Number(!!a.derived_from_asset_id)-Number(!!b.derived_from_asset_id)))insert('music_assets',a);
for(const r of revisions)insert('music_track_revisions',{...r,state:'draft'});
for(const r of revisions)sql+=`UPDATE music_track_revisions SET state='sealed' WHERE id=${q(r.id)};\n`;
for(const t of tracks)sql+=`UPDATE music_tracks SET lifecycle='published',published_revision_id=${q(t.published_revision_id)},first_published_at=${q(t.first_published_at)},published_at=${q(t.published_at)} WHERE id=${q(t.id)};\n`;
insert('music_collections',{...collection,status:'draft',cover_asset_id:null});
for(const a of collectionAssets)insert('music_collection_assets',a);
for(const row of source.music_collection_tracks)insert('music_collection_tracks',row);
sql+=`UPDATE music_collections SET status='published',cover_asset_id=${q(collection.cover_asset_id)} WHERE id=${q(collection.id)};\n`;
const oldFeatured=db.prepare('SELECT * FROM music_featured_items ORDER BY slot_kind,position').all();
assert.equal(oldFeatured.length,2);assert.ok(oldFeatured.some(x=>x.track_id==='a3d01b06-8c4c-4a8a-9d66-25429d2ad843'));
sql+='DELETE FROM music_featured_items;\n';
const primary='cae8ef9b-a808-4669-b907-c07cdbeec1c0';
insert('music_featured_items',{slot_kind:'primary',position:0,track_id:primary,collection_id:null});
const secondary=source.music_collection_tracks.map(x=>x.track_id).filter(id=>id!==primary).slice(0,5);
secondary.push('a3d01b06-8c4c-4a8a-9d66-25429d2ad843');
secondary.forEach((id,i)=>insert('music_featured_items',{slot_kind:'secondary',position:i,track_id:id,collection_id:null}));
insert('music_featured_items',{slot_kind:'collection',position:0,collection_id:collection.id,track_id:null});
insert('music_featured_items',{...oldFeatured.find(x=>x.slot_kind==='collection'),position:1});
sql+=`UPDATE music_featured_home SET version=version+1,updated_at=${now} WHERE id=1;\nUPDATE music_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=${now} WHERE key='catalogVersion';\nDELETE FROM music_publication_guards WHERE operation_token=${q(token)};\n`;
db.exec('BEGIN;');db.exec(sql);db.exec('COMMIT;');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
for(const [table,rows] of Object.entries(before))for(const row of rows){const actual=db.prepare(`SELECT * FROM ${table} WHERE ${table==='music_collection_tracks'?'collection_id=? AND track_id=?':'id=?'}`).get(...(table==='music_collection_tracks'?[row.collection_id,row.track_id]:[row.id]));assert.deepEqual(actual,row);}
assert.equal(db.prepare("SELECT count(*) AS n FROM music_tracks WHERE lifecycle='published'").get().n,9);
assert.deepEqual(db.prepare('SELECT track_id FROM music_collection_tracks WHERE collection_id=? ORDER BY position').all(collection.id).map(x=>x.track_id),source.music_collection_tracks.map(x=>x.track_id));
assert.throws(()=>{db.exec('BEGIN;');try{db.exec(sql);}finally{db.exec('ROLLBACK;');}},'Reimport must fail without overwriting records');
const manifest={schema:1,origin:config.vars.MOBILE_AUTH_ORIGIN,database:'station-cat-music-r2-catalog',bucket:'station-cat-music-r2-audio',collection:{id:collection.id,slug:collection.slug,version:collection.version,coverSHA256:collectionAssets[0].sha256},primary,tracks:source.music_collection_tracks.map(x=>{const t=tracks.find(t=>t.id===x.track_id),r=revisions.find(r=>r.track_id===t.id),m=JSON.parse(r.metadata_json);return{id:t.id,title:m.title['zh-Hans'],audioVersion:r.revision_no,access:r.access_mode,coverSHA256:assets.find(a=>a.id===r.cover_asset_id).sha256,audioBytes:assets.find(a=>a.id===r.audio_asset_id).byte_size};}),objects:copies.map(x=>({file:x.file,key:x.asset.object_key,bytes:x.asset.byte_size,contentType:x.asset.content_type,sha256:x.asset.sha256})),sourceSnapshotSHA256:createHash('sha256').update(readFileSync(new URL('snapshot.json',base))).digest('hex')};
writeFileSync(new URL('import.sql',base),sql,{mode:0o600,flag:'wx'});
writeFileSync(new URL('manifest.json',base),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
writeFileSync(new URL('featured-before.json',base),JSON.stringify(oldFeatured,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('Prepared 7 published free tracks, 1 album, 22 verified assets; local schema/FK/reimport and synthetic-row preservation passed. No remote writes.');
