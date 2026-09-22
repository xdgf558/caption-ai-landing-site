#!/usr/bin/env node
// Offline-only synthetic album supplement. Does not modify the existing track seed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {inspectSmallAsset} from '../src/music/assetFormats.js';
import {checkAssetIdentity} from '../src/music/resources.js';
import {buildPublicCatalog} from '../src/music/catalog.js';

async function prepare(){
const root=new URL('../',import.meta.url),dir=new URL('.generated/r2/private/',root);
const file=name=>new URL(name,dir);
const outputs=['album.sql','album.json','album-cover.png'];
assert.ok(statSync(dir).isDirectory(),'Prepare the isolated track seed first.');
assert.ok(outputs.every(name=>!existsSync(file(name))),'Existing album seed retained; do not regenerate or overwrite initialized data.');
const tracks=JSON.parse(readFileSync(file('tracks.json'),'utf8'));
assert.deepEqual(Object.keys(tracks).sort(),['free','vip']);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
assert.ok(uuid.test(tracks.free)&&uuid.test(tracks.vip)&&tracks.free!==tracks.vip,'Invalid isolated track seed.');

// A deliberately plain test image, generated locally; no user artwork or external assets.
const width=256,height=256,stride=width*3+1,pixels=Buffer.alloc(stride*height);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const at=y*stride+1+x*3;
 // Dark teal with a gold inset square so iOS image decoding is easy to recognize.
 const inset=x>=64&&x<192&&y>=64&&y<192;
 pixels[at]=inset?245:21;pixels[at+1]=inset?201:39;pixels[at+2]=inset?121:47;
}
function crc32(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^(0xedb88320&-(value&1));}return (value^0xffffffff)>>>0;}
function chunk(kind,data){const type=Buffer.from(kind),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([length,type,data,crc]);}
const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
const compressed=deflateSync(pixels);assert.deepEqual(inflateSync(compressed),pixels);
const cover=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',Buffer.alloc(0))]);
const id=randomUUID(),assetID=randomUUID(),slug='r2-synthetic-album',now=Date.now();
const coverObjectKey=`music/album-covers/${id}/${assetID}.png`;
const sha256=createHash('sha256').update(cover).digest('hex'),etag=createHash('md5').update(cover).digest('hex');
const asset={id:assetID,owner_collection_id:id,kind:'cover',object_key:coverObjectKey,state:'validated',content_type:'image/png',format:'png',byte_size:cover.length,sha256,etag,created_at:now};
checkAssetIdentity(asset);
assert.deepEqual(inspectSmallAsset(asset,cover),{width,height,animated:false});
const title={en:'R2 Synthetic Test Album','zh-Hans':'R2 合成测试专辑','zh-Hant':'R2 合成測試專輯',ja:'R2 合成テストアルバム'};
const description={en:'Synthetic audio and generated artwork for isolated HTTPS integration only. Not a commercial release.'};
const quote=value=>typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const values=row=>Object.values(row).map(quote).join(',');
const statements=[
 `INSERT INTO music_collections(id,slug,original_locale,title_json,description_json,status,version,created_at,updated_at,collection_type,listening_mode) VALUES(${[id,slug,'en',JSON.stringify(title),JSON.stringify(description),'draft',1,now,now,'album','mixed'].map(quote).join(',')});`,
 `INSERT INTO music_collection_assets(${Object.keys(asset).join(',')}) VALUES(${values(asset)});`,
 ...[tracks.free,tracks.vip].map((track,index)=>`INSERT INTO music_collection_tracks(collection_id,track_id,position) VALUES(${quote(id)},${quote(track)},${index});`),
 `UPDATE music_collections SET cover_asset_id=${quote(assetID)},status='published',version=2,updated_at=${now} WHERE id=${quote(id)} AND status='draft';`,
 `INSERT INTO music_featured_items(slot_kind,position,collection_id) VALUES('collection',0,${quote(id)});`,
 `UPDATE music_featured_home SET version=version+1,updated_at=${now} WHERE id=1;`,
 `UPDATE music_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=${now} WHERE key='catalogVersion';`
];
const sql=statements.join('\n')+'\n';

// Validate against every real schema/trigger and the original catalog import in memory.
// No remote access and no fixture, migration, or existing seed files are rewritten.
const db=new DatabaseSync(':memory:');
try{
 db.exec('PRAGMA foreign_keys=ON;');
 for(const migration of readdirSync(new URL('migrations-music/',root)).filter(name=>name.endsWith('.sql')).sort())db.exec(readFileSync(new URL('migrations-music/'+migration,root),'utf8'));
 db.exec('BEGIN;');db.exec(readFileSync(file('catalog.sql'),'utf8'));db.exec('COMMIT;');
 assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const baseline=Object.fromEntries(['music_tracks','music_track_revisions','music_assets','music_rights_reviews','music_rights_evidence'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
 for(const track of [tracks.free,tracks.vip])assert.equal(db.prepare('SELECT lifecycle FROM music_tracks WHERE id=?').get(track)?.lifecycle,'published');
 assert.equal(db.prepare("SELECT count(*) AS n FROM music_featured_items WHERE slot_kind='collection'").get().n,0,'Existing collection configuration must not be overwritten.');
 db.exec('BEGIN;');db.exec(sql);db.exec('COMMIT;');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const [table,rows] of Object.entries(baseline))assert.deepEqual(db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),rows,'Album supplement must not modify tracks or publication records.');
 const collection=db.prepare('SELECT * FROM music_collections WHERE id=?').get(id);
 const items=db.prepare('SELECT * FROM music_collection_tracks WHERE collection_id=? ORDER BY position').all(id);
 const records=baseline.music_tracks.map(track=>({track,revision:baseline.music_track_revisions.find(row=>row.id===track.published_revision_id),assets:baseline.music_assets.filter(row=>row.owner_track_id===track.id)}));
 const catalogVersion=JSON.parse(db.prepare("SELECT value_json FROM music_settings WHERE key='catalogVersion'").get().value_json);
 const {body}=await buildPublicCatalog({records,collections:[{collection,items,coverAsset:asset}],catalogVersion,locale:'en',now});
 const projected=body.collections.find(row=>row.id===id);assert.ok(projected,'Synthetic album must survive the real public projection.');
 assert.deepEqual(projected.trackIds,[tracks.free,tracks.vip]);assert.equal(projected.coverUrl,`/api/music/collections/${slug}/cover?v=2`);
 assert.equal(db.prepare("SELECT collection_id FROM music_featured_items WHERE slot_kind='collection' AND position=0").get().collection_id,id);
}finally{db.close();}

const metadata={schema:1,id,slug,title:title.en,version:2,trackIds:[tracks.free,tracks.vip],coverAssetID:assetID,coverObjectKey,coverFile:'album-cover.png',coverContentType:'image/png',coverBytes:cover.length,coverSHA256:sha256,coverETag:etag,width,height,coverPath:`/api/music/collections/${slug}/cover?v=2`,deepLinkPath:`/music/?collection=${slug}`};
for(const [name,data] of [['album.sql',sql],['album.json',JSON.stringify(metadata,null,2)+'\n'],['album-cover.png',cover]])writeFileSync(file(name),data,{mode:0o600,flag:'wx'});
console.log('Prepared and validated one synthetic two-track album and generated PNG cover. No remote access; existing track seed unchanged.');
}
prepare().catch(()=>{
 // Assertion/SQLite diagnostics can include row contents: keep private IDs out of logs.
 console.error('Album preparation failed; no remote operation was attempted and existing seed files were not overwritten.');
 process.exitCode=1;
});
