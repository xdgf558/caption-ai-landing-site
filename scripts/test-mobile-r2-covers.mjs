import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {loadPublicMusicCollectionSnapshot} from '../src/music/publicStore.js';
import {buildPublicCatalog} from '../src/music/catalog.js';
import {checkAssetIdentity} from '../src/music/resources.js';

const origin='https://station-cat-music-r2.yehao1105.workers.dev';
const config=JSON.parse(readFileSync('wrangler.mobile-r2.jsonc','utf8'));
const profiles=new Map();
// A tiny synthetic PNG; no production or user artwork is read.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE0cAAAAASUVORK5CYII=','base64');
async function migrate(db){
  const parser=new DatabaseSync(':memory:');
  try{for(const file of readdirSync('migrations-music').filter(x=>x.endsWith('.sql')).sort()){
    let sql=readFileSync('migrations-music/'+file,'utf8');
    while(sql.trim()){const statement=parser.prepare(sql);statement.run();await db.prepare(statement.sourceSQL).run();sql=sql.slice(statement.sourceSQL.length);}
  }}finally{parser.close();}
}
before(async()=>{
  const bundle=await build({entryPoints:['src/mobile/isolatedWorker.js'],bundle:true,format:'esm',platform:'browser',write:false,loader:{'.wasm':'binary'}});
  for(const withSecret of [false,true]){
    const key=withSecret?'configured':'missing';
    const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,
      host:'127.0.0.1',port:0,d1Databases:{WAITLIST_DB:'cover-reader-'+key,MUSIC_DB:'cover-catalog-'+key},r2Buckets:{MUSIC_BUCKET:'cover-artwork-'+key},
      bindings:{...config.vars,MOBILE_RESULT_KEYS_JSON:JSON.stringify({'r2-v1':randomBytes(32).toString('base64url')}),
        ...(withSecret?{MUSIC_RATE_LIMIT_SECRET:randomBytes(32).toString('base64url')}:{})},
      outboundService:()=>new Response('Denied',{status:503})});
    const item={mf};profiles.set(key,item);
    const db=await mf.getD1Database('MUSIC_DB'),bucket=await mf.getR2Bucket('MUSIC_BUCKET');
    await migrate(db);
    const owner=randomUUID(),asset=randomUUID(),track=randomUUID(),slug='r2-test-album-'+key,now=Date.now();
    const objectKey=`music/album-covers/${owner}/${asset}.png`;
    const object=await bucket.put(objectKey,png,{httpMetadata:{contentType:'image/png'}});
    // Published album metadata/cover remain readable while its member is a draft.
    await db.prepare("INSERT INTO music_tracks(id,slug,created_at,updated_at) VALUES(?,?,?,?)").bind(track,'draft-'+track,now,now).run();
    await db.prepare("INSERT INTO music_collections(id,slug,original_locale,title_json,description_json,status,created_at,updated_at,collection_type,listening_mode) VALUES(?,?,'en',?,?,'draft',?,?,'album','mixed')")
      .bind(owner,slug,JSON.stringify({en:'Synthetic cover fixture'}),JSON.stringify({en:''}),now,now).run();
    await db.prepare("INSERT INTO music_collection_assets(id,owner_collection_id,kind,object_key,state,content_type,format,byte_size,sha256,etag,created_at) VALUES(?,?,'cover',?,'validated','image/png','png',?,?,?,?)")
      .bind(asset,owner,objectKey,png.length,createHash('sha256').update(png).digest('hex'),object.etag,now).run();
    await db.prepare('INSERT INTO music_collection_tracks(collection_id,track_id,position) VALUES(?,?,0)').bind(owner,track).run();
    await db.prepare("UPDATE music_collections SET cover_asset_id=?,status='published',version=2 WHERE id=?").bind(asset,owner).run();
    const snapshot=await loadPublicMusicCollectionSnapshot(db,slug,Date.now());
    checkAssetIdentity(snapshot.collections[0].coverAsset);
    const projected=await buildPublicCatalog({...snapshot,locale:'zh-Hant',now:Date.now()});
    assert.equal(projected.body.collections.length,1);
    Object.assign(item,{db,bucket,objectKey,path:'/api/music/collections/'+slug+'/cover?v=2'});
  }
});
after(async()=>{await Promise.all([...profiles.values()].map(x=>x.mf.dispose()));});
const call=(item,method)=>item.mf.dispatchFetch(origin+item.path,{method,headers:{'CF-Connecting-IP':'192.0.2.15'}});

test('R2 album cover GET/HEAD fail closed when the independent limiter secret is missing',async()=>{
  const item=profiles.get('missing');
  const get=await call(item,'GET');assert.equal(get.status,503);
  assert.equal((await get.json()).error.code,'MUSIC_RATE_LIMIT_UNAVAILABLE');
  const head=await call(item,'HEAD');assert.equal(head.status,503);assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal((await item.db.prepare('SELECT count(*) n FROM music_rate_sources').first()).n,0);
});
test('R2 album cover GET/HEAD return exact PNG bytes and consume artwork admission with a dedicated secret',async()=>{
  const item=profiles.get('configured'),get=await call(item,'GET');assert.equal(get.status,200);
  const bytes=Buffer.from(await get.arrayBuffer());assert.deepEqual(bytes,png);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),createHash('sha256').update(png).digest('hex'));
  const head=await call(item,'HEAD');assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  for(const response of [get,head]){
    assert.equal(response.headers.get('content-type'),'image/png');assert.equal(Number(response.headers.get('content-length')),png.length);
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);
  }
  assert.equal((await item.db.prepare("SELECT sum(hits) n FROM music_rate_windows WHERE category='artwork'").first()).n,2);
});
test('R2 album cover refuses changed R2 object identity after successful delivery',async()=>{
  const item=profiles.get('configured');
  await item.bucket.put(item.objectKey,Buffer.concat([png,Buffer.from('changed')]),{httpMetadata:{contentType:'image/png'}});
  const response=await call(item,'GET');assert.equal(response.status,503);
  assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
  await response.body.cancel();
});
