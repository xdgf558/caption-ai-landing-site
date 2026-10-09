import assert from 'node:assert/strict';import {test} from 'node:test';import {randomUUID} from 'node:crypto';
import {createCampaignRuntime,campaignMigration} from './helpers/station-campaign-fixture.mjs';
import {stationMusicAssets} from './helpers/station-music-runtime.mjs';
const base='/admin/api/music/site-content';
const bootstrap=text=>JSON.parse(/<script id="sc-music-bootstrap" type="application\/json">([^]*?)<\/script>/.exec(text)[1]);
test('actual Worker: Access, native transactions, registered landing and attribution isolation',async t=>{
  const f=await createCampaignRuntime({assets:stationMusicAssets});t.after(()=>f.close());
  const send=async(path,{method='GET',body,version=1,key=randomUUID(),token=f.actorToken,origin='https://wwwstationcat.org',headers={}}={})=>{
    const r=await f.mf.dispatchFetch('https://wwwstationcat.org'+path,{method,redirect:'manual',headers:{'CF-Connecting-IP':'192.0.2.173','Cf-Access-Jwt-Assertion':token,Origin:origin,'X-Requested-With':'StationCatMusicAdmin','Content-Type':'application/json','If-Match':`"edit-${version}"`,'Idempotency-Key':key,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return r;
  };
  const json=async(path,options)=>{const r=await send(path,options);return {r,data:await r.json()};};
  const track=f.content.tracks[0],command={id:'runtime-douyin',source:'douyin',medium:'short_video',clipId:f.content.clip,locale:'zh-Hant',legacySources:['runtime-old-src'],status:'active',reason:'原生临时库测试 Campaign'};
  await t.test('authorization precedes mutations; one flag, CSRF and editor cannot activate',async()=>{
    const path=base+'/promotions/'+track.id+'/campaigns';
    assert.equal((await send(path,{method:'POST',body:command,token:'forged'})).status,401);
    assert.equal((await send(path,{method:'POST',body:command,origin:'https://evil.test'})).status,403);
    for(const prefix of ['/fixture-campaign-off','/fixture-campaign-only'])assert.equal((await send(prefix+path,{method:'POST',body:command})).status,503);
    assert.equal((await send('/fixture-editor'+path,{method:'POST',body:command})).status,403);
    const draft=await json('/fixture-editor'+path,{method:'POST',body:{...command,id:'runtime-editor-draft',legacySources:[],status:'draft'}});assert.equal(draft.r.status,200);assert.equal(draft.data.status,'draft');
    assert.equal((await send(path+'?before=1&before=2')).status,400);
  });
  await t.test('0015 ledger mismatch closes new API and never writes or installs schema',async()=>{
    await f.db.prepare('DELETE FROM d1_migrations WHERE name=?').bind(campaignMigration).run();const r=await json(base+'/promotions/'+track.id+'/campaigns');assert.equal(r.data.code,'STATION_CAMPAIGN_SCHEMA_UNAVAILABLE');
    await f.db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(campaignMigration,new Date().toISOString()).run();
  });
  let campaign;
  await t.test('native original receipt replay creates one active row and guarded alias',async()=>{
    const options={method:'POST',body:command,key:randomUUID()},path=base+'/promotions/'+track.id+'/campaigns';
    const first=await json(path,options),again=await json(path,options);assert.equal(first.r.status,200,JSON.stringify(first.data));assert.equal(again.data.replayed,true);assert.equal(again.data.id,command.id);
    const view=await json(base+'/campaigns/'+command.id);campaign=view.data;assert.equal(campaign.effective,true);assert.equal(view.r.headers.get('cache-control'),'private, no-store');assert.equal(view.r.headers.get('etag'),'"edit-1"');assert.doesNotMatch(JSON.stringify(view.data),/object_key|sha256|etag|Cf-Access|rights_basis/);
    const aliases=await f.db.prepare('SELECT COUNT(*) AS n FROM station_campaign_legacy_sources WHERE campaign_id=?').bind(command.id).first();assert.equal(aliases.n,1);
  });
  await t.test('attribution schema failure becomes unknown and leaves content available instead of replaying old dimensions',async()=>{
    await f.db.prepare('DELETE FROM d1_migrations WHERE name=?').bind(campaignMigration).run();const url=new URL(campaign.url),r=await send(url.pathname+url.search);assert.equal(r.status,302);const a=bootstrap(await (await send(r.headers.get('location'))).text()).attribution;assert.equal(a.kind,'unknown');assert.equal(a.enabled,true);assert(!Object.hasOwn(a,'campaignId'));await f.db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(campaignMigration,new Date().toISOString()).run();
  });
  await t.test('actual Astro single page accepts registered tuple and keeps canonical/language links clean',async()=>{
    const url=new URL(campaign.url),r=await send(url.pathname+url.search);assert.equal(r.status,200);const html=await r.text(),model=bootstrap(html);assert.equal(model.attribution.campaignId,command.id);assert.equal(model.attribution.clipId,command.clipId);assert.equal(model.attribution.source,'douyin');assert.match(html,new RegExp('rel="canonical" href="https://wwwstationcat.org'+url.pathname+'"'));assert(!html.includes('rel="canonical" href="'+campaign.url));
    assert.match(html,/data-sc-language="en"[^>]*href="\/en\/music\/tracks\/permanent-free\/"|href="\/en\/music\/tracks\/permanent-free\/"[^>]*data-sc-language="en"/);assert.doesNotMatch(JSON.stringify(model.attribution),/landing_path|object_key|token=|http/);
  });
  await t.test('mapped UUID share and alias normalize to the same composed URL; no open redirect',async()=>{
    const share=await send('/music/?track='+track.id+'&src=runtime-old-src&token=private&redirect=https://evil.test/');assert.equal(share.status,302);assert.equal('https://wwwstationcat.org'+share.headers.get('location'),campaign.url);
    const alias=await send('/zh-hant/music/'+track.slug+'?src=runtime-old-src');assert.equal('https://wwwstationcat.org'+alias.headers.get('location'),campaign.url);
  });
  await t.test('unknown, repeated, too long and mixed inputs normalize to bounded unknown with no injected dimensions',async()=>{
    const url=new URL(campaign.url);
    for(const query of ['?utm_campaign=unregistered',url.search+'&utm_source=evil','?src='+'x'.repeat(3000),url.search+'&src=runtime-old-src','?utm_source=%3Cscript%3E&token=secret']){
      const r=await send(url.pathname+query);assert.equal(r.status,302);assert.equal(r.headers.get('location'),url.pathname+'?utm_campaign=unknown');const next=await send(r.headers.get('location'));assert.equal(next.status,200);const a=bootstrap(await next.text()).attribution;assert.equal(a.kind,'unknown');assert(!Object.hasOwn(a,'source'));assert.doesNotMatch(JSON.stringify(a),/script|secret|unregistered|evil/);
    }
  });
  await t.test('direct, external referrer and disabled attribution distinguish only known categories',async()=>{
    const path=campaign.landingPath,direct=await send(path);assert.equal(bootstrap(await direct.text()).attribution.kind,'direct_or_unknown');
    const external=await send(path,{headers:{Referer:'https://external.test/?private=sensitive'}});assert.equal(external.headers.get('location'),path+'?utm_campaign=unknown');
    const disabled=await send('/fixture-campaign-off'+path+new URL(campaign.url).search);assert.equal(disabled.status,200);assert.equal(bootstrap(await disabled.text()).attribution.enabled,false);
  });
  await t.test('concurrent native status updates preserve one edit version and invalidate old src and URL',async()=>{
    const options={method:'PATCH',body:{status:'archived',reason:'停止测试 Campaign'}},results=await Promise.all([send(base+'/campaigns/'+command.id,options),send(base+'/campaigns/'+command.id,options)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await json(base+'/campaigns/'+command.id)).data.url,null);const r=await send(campaign.landingPath+new URL(campaign.url).search);assert.equal(r.headers.get('location'),campaign.landingPath+'?utm_campaign=unknown');
    const legacy=await send('/music/?track='+track.id+'&src=runtime-old-src');assert.equal(legacy.headers.get('location'),campaign.landingPath+'?utm_campaign=unknown');
  });
  await t.test('stopping promotion blocks fresh activation; no new events, memberships, audio grants or old route retirement',async()=>{
    const stop=await json(base+'/promotions/'+track.id+'/unpublish',{method:'POST',version:2,body:{revision:1,reason:'停止推广测试'}});assert.equal(stop.r.status,200);
    const activate=await json(base+'/campaigns/'+command.id,{method:'PATCH',version:2,body:{status:'active',reason:'重新检查'}});assert.equal(activate.data.code,'STATION_CAMPAIGN_PROMOTION_REQUIRED');
    const count=await f.db.prepare('SELECT COUNT(*) AS n FROM station_analytics_events').first();assert.equal(count.n,0);
    const retired=await f.db.prepare('SELECT COUNT(*) AS n FROM station_route_migrations WHERE approved_at IS NOT NULL').first();assert.equal(retired.n,0);
    const old=await f.db.prepare('SELECT access_mode FROM music_track_revisions WHERE id=?').bind(track.revision).first();assert.equal(old.access_mode,'free');
  });
});
