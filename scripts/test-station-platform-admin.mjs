import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { contentAdminFixture } from './helpers/station-content-admin-fixture.mjs';
import { adminScriptFixture } from './helpers/station-admin-dom.mjs';
import { createContentObject, contentPublication, saveContentRights } from '../src/redesign/contentAdmin.js';
import { platformReleaseState } from '../src/redesign/contentAdminModel.js';
import { handleMusicAdmin } from '../src/music/adminHttp.js';

const actor='platform-admin@example.test',ctx=()=>({actorId:actor,key:randomUUID(),ifMatch:'"edit-1"'});
const album='https://music.163.com/#/album?id=398968221',canonical='https://music.163.com/album?id=398968221';
const link=(trackId,patch={})=>({trackId,provider:'netease',status:'live',url:album,verifiedAt:Date.now()-1000,...patch});

async function fixture(t){
 const f=await contentAdminFixture();t.after(()=>f.sql.close());
 const track=f.tracks[0],other=f.tracks[1];
 for(const item of [track,other])await createContentObject(f.runtime,'tracks',{trackId:item.id,data:{metadata:item.metadata,coverAssetId:item.cover,siteAudioMode:'none'}},ctx());
 await saveContentRights(f.runtime,track.cover,{scope:'cover',status:'approved',basis:'本地合成夹具'},ctx());
 await contentPublication(f.runtime,'tracks',track.id,'publish',{revision:1},ctx());
 const env={MUSIC_DB:f.db,MUSIC_BUCKET:f.bucket,STATION_CONTENT_ADMIN_ENABLED:'true',ADMIN_ALLOWED_EMAILS:actor};
 const calls=[];let loseReceipt=false,failRead=false;
 const request=async(path,options={})=>{
   calls.push({path,...options});
   if(failRead&&path.startsWith('/platforms?'))throw new Error('temporary read failure');
   const headers={Origin:'https://content.local.test','Content-Type':'application/json','X-Requested-With':'StationCatMusicAdmin'};
   if(options.key)headers['Idempotency-Key']=options.key;if(options.etag)headers['If-Match']=options.etag;
   const response=await handleMusicAdmin(new Request('https://content.local.test/admin/api/music/site-content'+path,{method:options.method??'GET',headers,...(options.body===undefined?{}:{body:JSON.stringify(options.body)})}),env,async()=>actor);
   const data=await response.json();
   if(!response.ok)throw Object.assign(new Error(data.code),{code:data.code,status:response.status,uncertain:response.status>=500});
   if(loseReceipt&&options.method){loseReceipt=false;throw Object.assign(new Error('receipt lost'),{uncertain:true});}
   return data;
 };
 const save=(body,id=null,version=1)=>request('/platforms'+(id?'/'+id:''),{method:id?'PATCH':'POST',body,key:randomUUID(),etag:'"edit-'+version+'"'});
 return {...f,track,other,request,save,calls,loseReceipt:()=>{loseReceipt=true;},failRead:value=>{failRead=value;}};
}
const badge=(page,id)=>page.node('content-list').children.find(li=>li.children[0]?.dataset.workId===id)?.children[0].children[2];
const cover=(page,id)=>page.node('content-list').children.find(li=>li.children[0]?.dataset.workId===id)?.children[0].children[0].children[0];
const form=page=>page.node('content-platform-editor').children[0];
const field=(block,label)=>block.children.find(child=>child.tagName==='LABEL'&&child.textContent===label).children[0];
async function submit(page,block=form(page),values={}){
 for(const [label,value]of Object.entries(values))field(block,label).value=value;
 await block.fire('submit');await page.idle();
}
const values={'发行状态':'live','真实作品网址':album,'人工核对时间（新加坡 UTC+8）':'2026-01-01T08:00'};

test('release summaries require a verified live link and combine all registered regions and providers',()=>{
 const now=Date.now(),row={id:randomUUID(),track_id:randomUUID(),provider:'netease',status:'live',url:album,verified_at:now-1,territories_json:'["CN"]',sort_order:0};
 assert.equal(platformReleaseState([]),'unconfigured');
 for(const status of ['planned','unavailable','removed'])assert.equal(platformReleaseState([{...row,status}]),status);
 for(const patch of [{url:'https://evil.test/album'},{verified_at:null},{verified_at:now+60000},{territories_json:'["*","CN"]'},{territories_json:'invalid'}])assert.equal(platformReleaseState([{...row,...patch}],now),'unverified');
 assert.equal(platformReleaseState([{...row,status:'removed'},{...row,status:'planned'},row],now),'live');
 assert.equal(platformReleaseState([{...row,status:'unavailable'},{...row,status:'planned'}]),'planned');
 assert.equal(platformReleaseState([{...row,status:'removed'},{...row,status:'unavailable'}]),'unavailable');
 assert.equal(platformReleaseState(Array(26).fill(row)),'unverified');
});

test('actual HTTP lists persist external status independently of website publication; invalid saves and stale edits do not change it',async t=>{
 const f=await fixture(t),read=async id=>(await f.request('/tracks')).items.find(row=>row.id===id);
 assert.equal((await read(f.track.id)).status,'published');assert.equal((await read(f.track.id)).platformStatus,'unconfigured');
 await assert.rejects(f.save(link(f.track.id,{url:'https://music.163.com/#/album?id=1&redirect=evil'})),{code:'STATION_PLATFORM_URL_INVALID'});
 await assert.rejects(f.save(link(f.track.id,{verifiedAt:null})),{code:'STATION_PLATFORM_VERIFICATION_REQUIRED'});
 assert.equal((await read(f.track.id)).platformStatus,'unconfigured');
 const saved=await f.save(link(f.track.id));
 const records=await f.request('/platforms?trackId='+f.track.id);
 assert.equal(records.platformStatus,'live');assert.equal(records.items[0].url,canonical);
 assert.equal((await read(f.track.id)).platformStatus,'live');
 await f.save(link(f.other.id));assert.equal((await read(f.other.id)).status,'draft');assert.equal((await read(f.other.id)).platformStatus,'live');
 await f.save(link(f.track.id,{status:'removed'}),saved.id);
 assert.equal((await read(f.track.id)).status,'published');assert.equal((await read(f.track.id)).platformStatus,'removed');
 await assert.rejects(f.save(link(f.track.id),saved.id),{code:'STATION_EDIT_CONFLICT'});
 assert.equal((await read(f.track.id)).platformStatus,'removed');
 const before=f.dump();await f.request('/tracks');await f.request('/platforms?trackId='+f.track.id);assert.deepEqual(f.dump(),before);
});

test('search and later pages return their own bounded platform summaries',async t=>{
 const f=await fixture(t);
 for(let i=0;i<23;i++)await createContentObject(f.runtime,'tracks',{data:{metadata:{originalLocale:'zh-Hans',title:{'zh-Hans':'分页歌曲 '+i},creatorName:'合成测试'}}},ctx());
 await f.save(link(f.track.id));const first=await f.request('/tracks');assert.equal(first.items.length,20);assert(first.nextBefore);assert(!first.items.some(row=>row.id===f.track.id));
 const next=await f.request('/tracks?before='+first.nextBefore);assert.equal(next.items.find(row=>row.id===f.track.id).platformStatus,'live');
 const search=await f.request('/tracks?q='+encodeURIComponent(f.track.slug));assert.equal(search.items.find(row=>row.id===f.track.id).platformStatus,'live');
 assert(!JSON.stringify(first).includes('territories_json'));assert(!JSON.stringify(next).includes('music.163.com'));
});

test('real editor save, withdrawal and refresh update the row without replacing unchanged images; content view keeps website status',async t=>{
 const f=await fixture(t),page=await adminScriptFixture('adminStationContent.js',{search:'?view=platforms&owner='+f.track.id,request:f.request});
 assert.equal(page.node('content-status').dataset.error,'false',page.node('content-status').textContent);
 assert.equal(page.node('work-status-heading').textContent,'发行状态');assert.equal(badge(page,f.track.id).textContent,'未添加');
 const image=cover(page,f.track.id);await submit(page,form(page),values);
 assert.equal(page.node('content-status').textContent,'平台状态已保存。');assert.equal(badge(page,f.track.id).textContent,'已上线');assert.equal(cover(page,f.track.id),image);
 assert.equal(page.node('content-state').textContent,'已上线');assert.equal(field(form(page),'真实作品网址').value,canonical);
 await page.node('content-reload').click();await page.idle();assert.equal(badge(page,f.track.id).textContent,'已上线');assert.equal(cover(page,f.track.id),image);
 await submit(page,form(page),{'发行状态':'removed'});assert.equal(badge(page,f.track.id).textContent,'已下架');
 const reloaded=await adminScriptFixture('adminStationContent.js',{search:'?view=platforms&owner='+f.track.id,request:f.request});assert.equal(badge(reloaded,f.track.id).textContent,'已下架');
 const content=await adminScriptFixture('adminStationContent.js',{search:'?view=tracks&owner='+f.track.id,request:f.request});assert.equal(badge(content,f.track.id).textContent,'已公开');
 assert.equal(content.node('work-status-heading').textContent,'状态');
});

test('rejected or uncertain saves never optimistically show online; recovery replays only the original command',async t=>{
 const f=await fixture(t),page=await adminScriptFixture('adminStationContent.js',{search:'?view=platforms&owner='+f.track.id,request:f.request});
 await submit(page,form(page),{...values,'真实作品网址':'https://evil.test/album'});
 assert.equal(page.node('content-status').dataset.error,'true');assert.equal(badge(page,f.track.id).textContent,'未添加');assert.equal(page.state().pending,null);
 f.loseReceipt();await submit(page,form(page),values);
 assert(page.state().pending);assert.equal(badge(page,f.track.id).textContent,'未添加');assert.equal(page.node('content-reload').disabled,true);
 await page.node('content-retry').click();await page.idle();assert.equal(page.state().pending,null);assert.equal(badge(page,f.track.id).textContent,'已上线');
 assert.equal((await f.request('/platforms?trackId='+f.track.id)).items.length,1);
 const writes=f.calls.filter(call=>call.method==='POST'&&call.body.url===album);assert.equal(writes.length,2);assert.equal(writes[0].key,writes[1].key);
});

test('an acknowledged save with failed readback shows a recoverable message and cannot submit a duplicate add form',async t=>{
 const f=await fixture(t),page=await adminScriptFixture('adminStationContent.js',{search:'?view=platforms&owner='+f.track.id,request:f.request});
 f.failRead(true);await submit(page,form(page),values);
 assert.equal(page.state().pending,null);assert.equal(page.node('content-status').textContent,'平台状态已保存，但最新状态读取失败。请重新核对工作区。');
 assert.equal(badge(page,f.track.id).textContent,'待核对');assert.equal(page.node('content-platform-editor').children.length,0);
 f.failRead(false);await page.node('content-reload').click();await page.idle();assert.equal(badge(page,f.track.id).textContent,'已上线');
 assert.equal((await f.request('/platforms?trackId='+f.track.id)).items.length,1);
});
