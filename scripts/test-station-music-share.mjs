import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, test } from 'node:test';
import { handleStationMusicShare, isStationMusicSharePath, musicShareHtml, loadShareTarget, stationMusicShareLabels } from '../src/redesign/musicSharePage.js';
import { stationMusicShareAssetPath, isStationMusicShareAssetPath } from '../src/redesign/musicShareAssets.js';
import { normalizeMusicCardCover } from '../src/music/shareCardRender.js';
import { stationMusicShareSvg, renderStationMusicShareCard } from '../src/redesign/musicShareRender.js';
import { contentFixture, now, publishTrack } from './helpers/station-content-fixture.mjs';
import { fixtureId, insertFixture } from './helpers/station-redesign-database.mjs';

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.close()));
const request = (path, method='GET') => new Request('https://wwwstationcat.org'+path, { method, headers:{'CF-Connecting-IP':'192.0.2.90'} });
async function fixture() { const f = await contentFixture(); fixtures.push(f); f.env.STATION_MUSIC_SHARE_ENABLED='true'; f.env.STATION_CONTENT_PUBLIC_ENABLED='true'; return f; }
const call = (f, path, method='GET') => handleStationMusicShare(request(path, method), f.env, { clock:() => now });
const icon = readFileSync(new URL('../public/images/station-music-app/icon.webp',import.meta.url));
const font = readFileSync(new URL('../public/fonts/music/NotoSerifSC-Bold.otf',import.meta.url));
async function prepareCard(f, kind, slug, locale='en', render=renderStationMusicShareCard) {
  const target = await loadShareTarget(request(`/music/share/${kind}/${slug}/`), f.env, kind, slug, locale, now, task=>task());
  const bytes = target.cover ? f.r2.objects.get(target.cover.object_key).bytes : null;
  const cover = bytes ? normalizeMusicCardCover(bytes,target.cover.content_type) : null;
  const image = await render(target,stationMusicShareLabels[locale],cover,font,icon);
  const path = await stationMusicShareAssetPath(target,kind,slug,locale);
  f.env.ASSETS = {async fetch(req) {return new URL(req.url).pathname === path ?
    new Response(image,{headers:{'Content-Type':'image/png','Content-Length':String(image.length)}}) : new Response(null,{status:404});}};
  return {image,path};
}

test('fingerprints bind every visible field and raw asset aliases are denied', async () => {
  const target={kind:'track',title:'Song',artist:'Artist',description:'Published introduction',cover:{sha256:'a'.repeat(64)}};
  const path=await stationMusicShareAssetPath(target,'tracks','song','en');
  assert.equal(path,await stationMusicShareAssetPath({...target,bucket:{}},'tracks','song','en'));
  for(const change of [{title:'New title'},{artist:'Other artist'},{description:'Revised introduction'},{cover:{sha256:'b'.repeat(64)}},{cover:null}])
    assert.notEqual(path,await stationMusicShareAssetPath({...target,...change},'tracks','song','en'));
  assert.notEqual(path,await stationMusicShareAssetPath(target,'tracks','song','ja'));
  for(const value of [path,path.replace('__','%5f%5f'),path.replace('__','%255f%255f'),path.replaceAll('/','\\')])
    assert(isStationMusicShareAssetPath(value),value);
  assert(!isStationMusicShareAssetPath('/music/share/tracks/song/card.png'));
});

test('card metadata remains readable to crawlers and browsers redirect only to the fixed App Store URL', async () => {
  const f=await fixture(), r=await call(f,'/music/share/tracks/permanent-free/?locale=en');
  assert.equal(r.status,200); const html=await r.text();
  const script=html.match(/<script>([^<]+)<\/script>/)[1], opened=[];
  new Function('location',script)({replace:url=>opened.push(url)});
  assert.deepEqual(opened,['https://apps.apple.com/app/id6822797145']);
  const digest=createHash('sha256').update(script).digest('base64');
  assert(r.headers.get('content-security-policy').includes(`script-src 'sha256-${digest}'`));
  assert(!r.headers.get('content-security-policy').includes("script-src 'unsafe-inline'"));
  assert.match(html,/<noscript>[\s\S]*https:\/\/apps\.apple\.com\/app\/id6822797145/);
  assert.match(html,/name="twitter:card" content="summary_large_image"/);
  assert.match(html,/property="og:image"/);
});

test('offline generator retains template 3 and verifies cover source bytes', async () => {
  const {generateStationMusicShareCards}=await import('./generate-station-music-share-cards.mjs');
  const root=await mkdtemp(resolve(tmpdir(),'station-share-generation-'));
  const entry={kind:'tracks',slug:'local-song',locale:'en',title:'Local song',artist:'Artist',description:'The published introduction.',cover:null};
  try {
    const [item]=await generateStationMusicShareCards([entry],root);
    const bytes=readFileSync(resolve(root,'public'+item.path));
    const image=await sharp(bytes).metadata();assert.equal(image.width,1200);assert.equal(image.height,1500);
    assert.equal(item.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(item.path,await stationMusicShareAssetPath({...entry,kind:'track'},'tracks','local-song','en'));
    await assert.rejects(generateStationMusicShareCards([{...entry,cover:{path:resolve(root,'public'+item.path),sha256:'0'.repeat(64),contentType:'image/png'}}],root),/Cover source differs/);
  } finally {await rm(root,{recursive:true,force:true});}
});


test('strict routes and disabled gate require no DB, rejects unknown and duplicate queries', async () => {
  for (const path of ['/music/share/tracks/abc/', '/music/share/albums/xyz/card.png']) assert(isStationMusicSharePath(path));
  for (const path of ['/music/share/tracks/%61bc/', '/music/share/tracks/abc/a/', '/music/share/tracks/abc.jpg']) assert(!isStationMusicSharePath(path));
  const env = { get MUSIC_DB() { throw Error('access'); } };
  assert.equal((await handleStationMusicShare(request('/music/share/tracks/a/'),env)).status,503);
  assert.equal((await handleStationMusicShare(request('/music/share/tracks/a/?locale=en&locale=ja'),env)).status,400);
  assert.equal((await handleStationMusicShare(request('/music/share/tracks/a/?token=private'),env)).status,400);
  assert.equal((await handleStationMusicShare(request('/music/share/tracks/a/','POST'),env)).status,405);
});
test('real published song provides metadata and a private no-store social image, revoked song returns 404', async () => {
  const f = await fixture(), path='/music/share/tracks/permanent-free/';
  let response=await call(f,path+'?locale=en'); assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store'); const html=await response.text();
  assert.match(html,/og:image/); assert.match(html,/twitter:card/); assert.match(html,/apps\.apple\.com\/app\/id6822797145/);
  assert.match(html,/music\/share\/tracks\/permanent-free\/card\.png\?locale=en/);
  response=await call(f,path+'card.png?locale=en','HEAD'); assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'image/png');
  f.music.sql.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").run(f.content.tracks[0].id);
  assert.equal((await call(f,path)).status,404); assert.equal((await call(f,path+'card.png')).status,404);
});
test('published song uses its summary or story consistently in HTML, metadata and PNG', async () => {
  const f=await fixture(), track=f.content.tracks[0], path='/music/share/tracks/permanent-free/';
  f.env.ASSETS={async fetch(req){return new Response(readFileSync(new URL('../public'+new URL(req.url).pathname,import.meta.url)));}};
  const publish = async (summary,story) => publishTrack(f.music.db,track,{
    cover_asset_id:null,
    metadata_json:JSON.stringify({originalLocale:'en',title:{en:'Fixture song'},summary:{en:summary},creatorName:'Fixture',story})
  });
  let svg='';
  const render=async (target,copy,cover,font,icon)=>{
    svg=stationMusicShareSvg(target,copy,cover,null);
    return renderStationMusicShareCard(target,copy,cover,font,icon);
  };
  const image = async () => {
    await prepareCard(f,'tracks','permanent-free','en',render);
    const r=await handleStationMusicShare(request(path+'card.png?locale=en'),f.env,{clock:()=>now});
    assert.equal(r.status,200); return Buffer.from(await r.arrayBuffer());
  };
  const story='Story about <care> & return';
  await publish('   ',story);
  let r=await call(f,path+'?locale=en'); assert.equal(r.status,200); let html=await r.text();
  assert.match(html,/property="og:description" content="Story about &lt;care&gt; &amp; return"/);
  assert.match(html,/<p style="white-space:pre-wrap">Story about &lt;care&gt; &amp; return<\/p>/);
  for (const locale of ['zh-Hans','zh-Hant','en','ja']) {
    const localized=await call(f,path+'?locale='+locale); assert.equal(localized.status,200);
    assert.match(await localized.text(),/property="og:description" content="Story about &lt;care&gt; &amp; return"/);
  }
  const withStory=await image(); assert.match(svg,/Story about &lt;care&gt; &amp; return/);
  await publish('Actual summary','Other published story');
  r=await call(f,path+'?locale=en'); assert.equal(r.status,200); html=await r.text();
  assert.match(html,/property="og:description" content="Actual summary"/); assert.doesNotMatch(html,/Other published story/);
  await image(); assert.match(svg,/Actual summary/); assert.doesNotMatch(svg,/Other published story/);
  await publish('','');
  r=await call(f,path+'?locale=en'); assert.equal(r.status,200); html=await r.text();
  assert.doesNotMatch(html,/og:description|twitter:description|white-space:pre-wrap/);
  const empty=await image(); assert.doesNotMatch(svg,/Story about|Actual summary/);
  // The same real coverless PNG template is rasterised with and without the
  // story. Pixels in the introduction region must change when text exists.
  const region={left:75,top:1120,width:850,height:160};
  const [withPixels,emptyPixels]=await Promise.all([withStory,empty].map(bytes=>sharp(bytes).extract(region).raw().toBuffer()));
  assert.notDeepEqual(withPixels,emptyPixels);
  await publish('  ',' \n ');
  r=await call(f,path+'?locale=en'); assert.equal(r.status,200);
  assert.doesNotMatch(await r.text(),/og:description|twitter:description|white-space:pre-wrap/);
  f.music.sql.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").run(track.id);
  assert.equal((await call(f,path)).status,404); assert.equal((await call(f,path+'card.png')).status,404);
});
test('album share uses its published title and description, refuses drafts and playlists', async () => {
  const f=await fixture(), id=fixtureId(9901), track=f.content.tracks[0];
  await insertFixture(f.music.db,'music_collections',{id,slug:'fixture-album',original_locale:'en',title_json:JSON.stringify({en:'Album title'}),description_json:JSON.stringify({en:'The real album description.'}),status:'published',collection_type:'album',created_at:now-1000,updated_at:now-500});
  await insertFixture(f.music.db,'music_collection_tracks',{collection_id:id,track_id:track.id,position:0});
  const path='/music/share/albums/fixture-album/'; let response=await call(f,path+'?locale=en'); assert.equal(response.status,200); const html=await response.text();
  assert.match(html,/Album title/); assert.match(html,/The real album description\./); assert.doesNotMatch(html,/free full listening|VIP/);
  f.music.sql.prepare("UPDATE music_collections SET status='archived' WHERE id=?").run(id);
  assert.equal((await call(f,path)).status,404); assert.equal((await call(f,path+'card.png')).status,404);
});
test('HTML and image layout escape text, show only real descriptions and use a 1200×1500 card', async () => {
  const target={title:'<script>alert(1)</script>',artist:'A & B',description:'实际的作品介绍',kind:'track'};
  const html=musicShareHtml(target,'tracks','example','zh-Hans');
  assert.doesNotMatch(html,/<script>alert/); assert.match(html,/&lt;script&gt;/); assert.match(html,/实际的作品介绍/);
  const svg=stationMusicShareSvg(target,{track:'单曲',download:'下载'},null,null); assert.match(svg,/width="1200" height="1500"/); assert.doesNotMatch(svg,/<script>/); assert.match(svg,/实际的作品介绍/);
  const font=readFileSync(new URL('../public/fonts/music/NotoSerifSC-Bold.otf',import.meta.url));
  const icon=readFileSync(new URL('../public/images/station-music-app/icon.webp',import.meta.url));
  const png=await renderStationMusicShareCard(target,{track:'单曲',download:'下载'},null,font,icon);
  assert.equal(new DataView(png.buffer,png.byteOffset,png.byteLength).getUint32(16),1200);
  assert.equal(new DataView(png.buffer,png.byteOffset,png.byteLength).getUint32(20),1500);
});

test('real PNG renders the published song cover and avoids a different song or private resources', async () => {
  const art = await sharp({create:{width:240,height:240,channels:3,background:'#cc2255'}}).png().toBuffer();
  const f=await contentFixture({materializeAsset:async (asset,bucket)=>{
    const bytes=asset.kind==='cover'?art:new Uint8Array(100).fill(37);
    const object=await bucket.put(asset.object_key,bytes,{httpMetadata:{contentType:asset.content_type}});
    return { byte_size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'),etag:object.etag };
  }}); fixtures.push(f); f.env.STATION_MUSIC_SHARE_ENABLED='true';
  const get = f.r2.bucket.get; f.r2.bucket.get = async (...args) => { const object = await get(...args);
    if (object) object.body = new Response(f.r2.objects.get(args[0]).bytes).body; return object; };
  f.env.ASSETS={async fetch(req){const path=new URL(req.url).pathname;
    return new Response(readFileSync(new URL('../public'+path,import.meta.url)));}};
  await prepareCard(f,'tracks','permanent-free');
  const response=await call(f,'/music/share/tracks/permanent-free/card.png?locale=en');
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'private, no-store');
  const png=Buffer.from(await response.arrayBuffer()); const decoded=await sharp(png).raw().toBuffer({resolveWithObject:true});
  assert.equal(decoded.info.width,1200); assert.equal(decoded.info.height,1500);
  const offset=(200*decoded.info.width+200)*decoded.info.channels;
  assert.ok(decoded.data[offset]>170 && decoded.data[offset+1]<80, 'cover shows the current red fixture');
  const gets=f.r2.state.reads.filter(item=>item.method==='get'); assert.equal(gets.length,0, 'precomputed card does not decode the R2 cover');
});
test('all four locales render, the supplied intro remains intact in metadata, and long card text ends in ellipsis', async()=>{
  const f=await fixture();
  for(const locale of ['zh-Hans','zh-Hant','en','ja']) {
    const r=await call(f,'/music/share/tracks/permanent-free/?locale='+locale); assert.equal(r.status,200);
    const html=await r.text(); assert.match(html,/Isolated fixture\./); assert.match(html,new RegExp('lang="'+locale+'"'));
  }
  const target={title:'Title',artist:'Artist',description:'字'.repeat(220),kind:'track'};
  const svg=stationMusicShareSvg(target,{track:'单曲',download:'下载'},null,null);
  assert.match(svg,/…/);
  const html=musicShareHtml(target,'tracks','example','zh-Hans'); assert.match(html,new RegExp('字{220}'));
});

test('published album image uses its own verified cover; replacing or withdrawing it denies the image', async () => {
  const f=await fixture(), id=fixtureId(9902), asset=fixtureId(9903), key=`music/album-covers/${id}/${asset}.png`;
  const pixels=randomBytes(1024*1024*4);
  for (let y=0;y<1024;y++) for (let x=0;x<1024;x++) {
    const at=(y*1024+x)*4; pixels[at+3]=128;
    if (x<450 && y<450) { pixels[at]=30;pixels[at+1]=170;pixels[at+2]=102;pixels[at+3]=255; }
  }
  const art=await sharp(pixels,{raw:{width:1024,height:1024,channels:4}}).png().toBuffer();
  assert.ok(art.length > 2*1024*1024 && art.length < 5*1024*1024);
  const object=await f.r2.bucket.put(key,art,{httpMetadata:{contentType:'image/png'}});
  await insertFixture(f.music.db,'music_collections',{id,slug:'cover-album',original_locale:'en',title_json:'{"en":"Album"}',description_json:'{"en":"A real album introduction."}',status:'draft',collection_type:'album',created_at:now-1000,updated_at:now-500});
  await insertFixture(f.music.db,'music_collection_tracks',{collection_id:id,track_id:f.content.tracks[0].id,position:0});
  await insertFixture(f.music.db,'music_collection_assets',{id:asset,owner_collection_id:id,kind:'cover',object_key:key,state:'validated',content_type:'image/png',format:'png',byte_size:art.length,sha256:createHash('sha256').update(art).digest('hex'),etag:object.etag,created_at:now-500});
  await f.music.db.prepare("UPDATE music_collections SET cover_asset_id=?, status='published' WHERE id=?").bind(asset,id).run();
  const get=f.r2.bucket.get; f.r2.bucket.get=async (...args)=>{const object=await get(...args); if(object)object.body=new Response(f.r2.objects.get(args[0]).bytes).body;return object;};
  f.env.ASSETS={async fetch(req){return new Response(readFileSync(new URL('../public'+new URL(req.url).pathname,import.meta.url)));}};
  await prepareCard(f,'albums','cover-album');
  const response=await call(f,'/music/share/albums/cover-album/card.png?locale=en'); assert.equal(response.status,200);
  const decoded=await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({resolveWithObject:true});
  const at=(200*decoded.info.width+200)*decoded.info.channels; assert.ok(decoded.data[at+1]>140 && decoded.data[at]<80,'green is the independent album cover');
  assert.deepEqual(f.r2.state.reads.filter(r=>r.method==='get').map(r=>r.key),[], 'precomputed album card avoids runtime image work');
  const direct=await call(f,'/music/share/albums/cover-album/cover.png'); assert.equal(direct.status,200);
  assert.equal(direct.headers.get('cache-control'),'private, no-store');
  const thumbnail=Buffer.from(await direct.arrayBuffer()); assert.ok(thumbnail.length<=2*1024*1024);
  const thumb=await sharp(thumbnail).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(thumb.info.width,512); assert.equal(thumb.info.height,512);
  const bottomRight=(500*512+500)*4; assert.ok(thumb.data[bottomRight+3]<200, 'alpha survives thumbnail generation');
  f.r2.objects.delete(key); assert.equal((await call(f,'/music/share/albums/cover-album/card.png')).status,503);
  assert.equal((await call(f,'/music/share/albums/cover-album/cover.png','HEAD')).status,503);
  f.music.sql.prepare("UPDATE music_collections SET status='archived' WHERE id=?").run(id);
  assert.equal((await call(f,'/music/share/albums/cover-album/card.png')).status,404);
});

test('workerd with real D1, R2, asset bindings and wasm renders and withdraws a social card', {timeout:60000}, async () => {
  const { build } = await import('esbuild'), { Miniflare } = await import('miniflare');
  const { basename, resolve } = await import('node:path');
  const { migrationStatements } = await import('./helpers/station-redesign-database.mjs');
  const { seedContent } = await import('./helpers/station-content-fixture.mjs');
  const wasm = new Map();
  const compiled=await build({ stdin:{resolveDir:process.cwd(),contents:`
    import {handleStationMusicShare} from './src/redesign/musicSharePage.js';
    import {isStationMusicShareAssetPath} from './src/redesign/musicShareAssets.js';
    export default {fetch(request, env) {if(isStationMusicShareAssetPath(new URL(request.url).pathname))return new Response(null,{status:404});return handleStationMusicShare(request, env, {clock:()=>${now}});}}`},
    bundle:true,format:'esm',platform:'browser',conditions:['workerd'],write:false,
    plugins:[{name:'wasm-modules',setup(builder){builder.onResolve({filter:/\.wasm$/},args=>{
      const name=basename(args.path); wasm.set(name,readFileSync(resolve(args.resolveDir,args.path))); return {path:'./'+name,external:true};});}}] });
  const assetRoot=await mkdtemp(resolve(tmpdir(),'station-share-assets-'));
  const target={kind:'track',title:'permanent-free',artist:'Station Cat fixture',description:'Isolated fixture.',cover:{sha256:createHash('sha256').update(await sharp({create:{width:240,height:240,channels:3,background:'#cc2255'}}).png().toBuffer()).digest('hex')}};
  const generated=await renderStationMusicShareCard(target,stationMusicShareLabels.en,null,font,icon);
  const cardPath=await stationMusicShareAssetPath(target,'tracks','permanent-free','en');
  await mkdir(dirname(resolve(assetRoot,'.'+cardPath)),{recursive:true});
  await writeFile(resolve(assetRoot,'.'+cardPath),generated);
  await mkdir(resolve(assetRoot,'images/station-music-app'),{recursive:true});
  await writeFile(resolve(assetRoot,'images/station-music-app/icon.webp'),icon);
  const mf=new Miniflare({modulesRoot:'/music-sharing',modules:[{type:'ESModule',path:'/music-sharing/index.mjs',contents:compiled.outputFiles[0].text},
    ...[...wasm].map(([name,contents])=>({type:'CompiledWasm',path:'/music-sharing/'+name,contents}))],
    compatibilityDate:'2026-08-01',host:'127.0.0.1',port:0,d1Databases:{MUSIC_DB:'share-fixture-music',WAITLIST_DB:'share-fixture-reader'},
    r2Buckets:{MUSIC_BUCKET:'share-fixture-bucket'},assets:{directory:assetRoot,binding:'ASSETS',routerConfig:{has_user_worker:true,static_routing:{user_worker:['/*']}}},
    bindings:{STATION_MUSIC_SHARE_ENABLED:'true',STATION_CONTENT_PUBLIC_ENABLED:'true',MUSIC_RATE_LIMIT_SECRET:'station-share-fixture-not-for-production-123'},
    outboundService:()=>new Response('outbound disabled',{status:403})});
  try {
    const db=await mf.getD1Database('MUSIC_DB'),bucket=await mf.getR2Bucket('MUSIC_BUCKET');
    for(const group of migrationStatements().slice(0,-1))await db.batch(group.statements.map(sql=>db.prepare(sql)));
    const art=await sharp({create:{width:240,height:240,channels:3,background:'#cc2255'}}).png().toBuffer();
    const content=await seedContent(db,bucket,{materializeAsset:async asset=>{
      const bytes=asset.kind==='cover'?art:new Uint8Array(100).fill(37);
      const object=await bucket.put(asset.object_key,bytes,{httpMetadata:{contentType:asset.content_type}});
      return {byte_size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),etag:object.etag};
    }});
    const fetch=path=>mf.dispatchFetch('https://wwwstationcat.org'+path,{headers:{'CF-Connecting-IP':'192.0.2.42'}});
    const path='/music/share/tracks/permanent-free/';
    let response=await fetch(path+'?locale=en'); assert.equal(response.status,200); assert.match(await response.text(),/Isolated fixture\./);
    response=await fetch(path+'card.png?locale=en'); assert.equal(response.status,200); const bytes=Buffer.from(await response.arrayBuffer());
    assert.equal((await sharp(bytes).metadata()).height,1500);
    const publish = (summary,story) => publishTrack(db,content.tracks[0],{
      cover_asset_id:null,
      metadata_json:JSON.stringify({originalLocale:'en',title:{en:'Fixture song'},summary:{en:summary},creatorName:'Fixture',story})
    });
    await publish('  ','Published story & details');
    response=await fetch(path+'?locale=en'); assert.equal(response.status,200);
    const storyHTML=await response.text(); assert.match(storyHTML,/property="og:description" content="Published story &amp; details"/);
    response=await fetch(path+'card.png?locale=en'); assert.equal(response.status,200); const storyPNG=Buffer.from(await response.arrayBuffer());
    await publish('','');
    response=await fetch(path+'?locale=en'); assert.equal(response.status,200); assert.doesNotMatch(await response.text(),/og:description/);
    response=await fetch(path+'card.png?locale=en'); assert.equal(response.status,200); const emptyPNG=Buffer.from(await response.arrayBuffer());
    assert.deepEqual(storyPNG,icon,'changed copy cannot reuse the old generated card');
    assert.deepEqual(emptyPNG,icon,'new coverless copy uses a bounded readable fallback');
    assert.equal((await fetch(cardPath)).status,404,'raw generated assets are not public');
    assert.equal((await fetch(cardPath.replace('__share-card-files','%5f%5fshare-card-files'))).status,404);
    await publish('Actual summary','Other published story');
    response=await fetch(path+'?locale=en'); assert.equal(response.status,200); const summaryHTML=await response.text();
    assert.match(summaryHTML,/property="og:description" content="Actual summary"/); assert.doesNotMatch(summaryHTML,/Other published story/);
    const album=fixtureId(9801),asset=fixtureId(9802),key=`music/album-covers/${album}/${asset}.png`;
    const albumImage=await sharp({create:{width:640,height:640,channels:4,background:{r:10,g:140,b:70,alpha:0.5}}}).png().toBuffer();
    const saved=await bucket.put(key,albumImage,{httpMetadata:{contentType:'image/png'}});
    await db.prepare("INSERT INTO music_collections(id,slug,original_locale,title_json,description_json,status,collection_type,created_at,updated_at) VALUES(?,?,'en',?,?, 'draft','album',?,?)")
      .bind(album,'worker-album','{"en":"Workerd album"}','{"en":""}',now-1000,now-500).run();
    await db.prepare('INSERT INTO music_collection_tracks(collection_id,track_id,position) VALUES(?,?,0)').bind(album,content.tracks[0].id).run();
    await db.prepare("INSERT INTO music_collection_assets(id,owner_collection_id,kind,object_key,state,content_type,format,byte_size,sha256,etag,created_at) VALUES(?,?,'cover',?,'validated','image/png','png',?,?,?,?)")
      .bind(asset,album,key,albumImage.length,createHash('sha256').update(albumImage).digest('hex'),saved.etag,now-500).run();
    await db.prepare("UPDATE music_collections SET status='published',cover_asset_id=? WHERE id=?").bind(asset,album).run();
    response=await fetch('/music/share/albums/worker-album/cover.png'); assert.equal(response.status,200);
    const thumb=await sharp(Buffer.from(await response.arrayBuffer())).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(thumb.info.width,512); assert.ok(thumb.data[3]<200);
    await db.prepare("UPDATE station_track_publications SET status='draft' WHERE track_id=?").bind(content.tracks[0].id).run();
    assert.equal((await fetch(path+'card.png')).status,404);
  } finally {await mf.dispose();await rm(assetRoot,{recursive:true,force:true});}
});
