import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { musicProductionCandidate, productionRoot } from './build-music-production-candidate.mjs';

test('complete built site and production-date Worker keep native music asset routing closed', async () => {
  // Synthetic IDs stay in memory. No cloud bindings, auth material or remote calls.
  const config = musicProductionCandidate(await readFile(path.join(productionRoot, 'wrangler.toml'), 'utf8'), {
    account_id: '3f5394e0ef5a531c63c0ceaa74262e0d', compatibility_date: '2026-09-13',
    d1_databases: [{binding:'MUSIC_DB',database_name:'station-cat-music-production',database_id:'11111111-1111-4111-8111-111111111111',migrations_dir:path.join(productionRoot,'migrations-music')}],
    r2_buckets: [{binding:'MUSIC_BUCKET',bucket_name:'station-cat-music-production-private'}]
  });
  for (const relative of ['index.html','en/index.html','ja/index.html','zh-hans/index.html',
    'music/index.html','en/music/index.html','ja/music/index.html','zh-hans/music/index.html',
    'admin/music/index.html','admin/music/collections/index.html','admin/music/collections/upload/index.html',
    'admin/music/featured/index.html','images/music-turntable-silver.webp']) {
    assert.ok((await stat(path.join(config.assets.directory,relative))).size>0,relative);
  }
  const bundle = await build({entryPoints:[config.main],bundle:true,format:'esm',platform:'browser',
    conditions:['workerd','worker'],write:false,loader:{'.wasm':'binary'}});
  let outbound=0;
  const mf = new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,
    ...(config.compatibility_flags ? {compatibilityFlags:config.compatibility_flags} : {}),
    host:'127.0.0.1',port:0,bindings:config.vars,
    assets:{directory:config.assets.directory,binding:config.assets.binding,routerConfig:{has_user_worker:true,
      static_routing:{user_worker:config.assets.run_worker_first},not_found_handling:config.assets.not_found_handling}},
    outboundService:()=>{outbound++;return new Response('External traffic disabled',{status:503})}});
  try {
    for (const url of ['/music','/music/','/music/index.html','/en/music/','/ja/music/','/zh-hans/music/','/zh-hant/music/',
      '/%6dusic/','/m%75sic/','/music%2f','/music%2findex.html','/en/%6dusic/','/en%2fmusic/','/%2fmusic/']) {
      for (const method of ['GET','HEAD']) {
        const r=await mf.dispatchFetch('https://wwwstationcat.org'+url,{method,redirect:'manual'});
        assert.equal(r.status,503,method+' '+url);assert.match(r.headers.get('cache-control'),/no-store/);
        if(method==='GET')assert.equal((await r.json()).error.code,'MUSIC_PUBLIC_DISABLED');else assert.equal(await r.text(),'');
      }
    }
    for(const url of ['/','/en/','/ja/','/zh-hans/']) {
      const r=await mf.dispatchFetch('https://wwwstationcat.org'+url,{redirect:'manual'});
      assert.equal(r.status,200,url);assert.match(r.headers.get('content-type'),/text\/html/);
      assert.match(await r.text(),/Station Cat/);
    }
    const denied=await mf.dispatchFetch('https://wwwstationcat.org/admin/api/music/diagnostics',{redirect:'manual'});
    assert.equal(denied.status,401);assert.equal(outbound,0);
  } finally {await mf.dispose();}
});
