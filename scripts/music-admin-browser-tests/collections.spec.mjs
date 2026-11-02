import {test,expect} from '@playwright/test';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {tracks as fixtureTracks,demoWav} from '../fixtures/music-player/data.mjs';
const unique=()=> 'album-ui-'+crypto.randomUUID();
async function create(page){await page.goto('/admin/music/collections/');await page.locator('#collection-new-album').click();await page.locator('#collection-slug').fill(unique());await page.locator('[data-collection-title="zh-Hans"]').fill('隔离测试专辑');await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 1');}
async function confirm(page){if(await page.locator('#collection-confirm-listening-label').isVisible())await page.locator('#collection-confirm-listening').check();await page.locator('#collection-confirm-accept').click();}

test('album metadata, keyboard order, reload and missing member media feedback use isolated API',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await create(page);
  await expect(page.locator('#collection-list button[aria-current="true"]')).toHaveCount(1);
  const publications=[];page.on('request',r=>{if(r.method()==='PATCH'&&r.postDataJSON()?.status==='published')publications.push(r.url());});
  await page.locator('#collection-publish').click();
  await expect(page.locator('#collection-publish-result')).toContainText('这张专辑还没有歌曲');
  await expect(page.locator('#collection-publish-result')).toBeFocused();
  await expect(page.locator('#collection-confirm')).not.toBeVisible();expect(publications).toHaveLength(0);
  await page.locator('#member-search-form button').click();
  await page.getByRole('button',{name:'添加 晚风经过车站',exact:true}).click();await page.getByRole('button',{name:'添加 月台上的雨',exact:true}).click();
  await expect(page.locator('#collection-publish')).toBeDisabled();await expect(page.locator('#collection-save')).toBeDisabled();
  await page.getByRole('button',{name:'上移 月台上的雨',exact:true}).press('Enter');
  await expect(page.locator('#collection-order li').first()).toContainText('月台上的雨');await expect(page.getByRole('button',{name:'上移 月台上的雨',exact:true})).toBeDisabled();
  await page.locator('#collection-order-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 2');
  await page.reload();await expect(page.locator('#collection-order li')).toHaveCount(2);await expect(page.locator('#collection-order li').first()).toContainText('月台上的雨');
  await page.locator('#album-listening-mode').selectOption('mixed');await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 3');
  await page.locator('#collection-publish').click();await expect(page.locator('#collection-confirm-reason-label')).toBeHidden();await expect(page.locator('#collection-confirm-reason')).not.toHaveAttribute('required','');await expect(page.locator('#collection-confirm')).toBeVisible();await confirm(page);
  await expect(page.locator('#collection-publish-result')).toContainText('缺少已验证的完整音频');await expect(page.locator('#collection-publish-result')).toBeFocused();await expect(page.locator('#collection-state')).toHaveText('专辑 · 草稿');expect(errors).toEqual([]);
});

test('unknown create receipt survives reload, blocks duplicates, and retries only the original key',async({page})=>{
  const keys=[];await page.route('**/admin/api/music/collections',async route=>{if(route.request().method()!=='POST')return route.continue();keys.push(route.request().headers()['idempotency-key']);if(keys.length===1){await route.fetch();await route.abort();}else await route.continue();});
  await page.goto('/admin/music/collections/');await page.locator('#collection-new-album').click();await page.locator('#collection-slug').fill(unique());await page.locator('[data-collection-title="zh-Hans"]').fill('原键重试');await page.locator('#collection-save').click();
  await expect(page.locator('#collection-retry')).toBeVisible();await expect(page.locator('#collection-new-album')).toBeDisabled();await page.reload();expect(keys).toHaveLength(1);
  await page.locator('#collection-retry').click();expect(keys).toHaveLength(1);await confirm(page);await expect(page.locator('#collection-version')).toHaveText('编辑版本 1');expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});

test('metadata-only publication uses saved members and replays the original request without publishing tracks',async({page})=>{
  await create(page);await page.locator('#member-search-form button').click();await page.getByRole('button',{name:'添加 晚风经过车站',exact:true}).click();
  await expect(page.locator('#collection-publish-metadata')).toBeDisabled();await page.locator('#collection-order-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 2');
  await page.locator('[data-collection-description="zh-Hans"]').fill('保存后的介绍');await expect(page.locator('#collection-publish-metadata')).toBeDisabled();await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 3');
  const attempts=[],songWrites=[];page.on('request',r=>{if(r.method()!=='GET'&&/\/tracks\/[^/]+\/publish(?:\?|$)/.test(r.url()))songWrites.push(r.url());});
  await page.route('**/admin/api/music/collections/*',async route=>{const r=route.request();if(r.method()!=='PATCH'||r.postDataJSON()?.status!=='published')return route.continue();attempts.push({key:r.headers()['idempotency-key'],etag:r.headers()['if-match'],body:r.postData()});if(attempts.length===1){await route.fetch();await route.abort();}else await route.continue();});
  await page.locator('#collection-publish-metadata').click();await expect(page.locator('#collection-confirm-text')).toContainText('不发布音频');await confirm(page);
  await expect(page.locator('#collection-retry')).toBeVisible();await expect(page.locator('#collection-publish-metadata')).toBeDisabled();await page.reload();await page.locator('#collection-retry').click();await confirm(page);
  await expect(page.locator('#collection-state')).toHaveText('专辑 · 已发布');expect(attempts).toHaveLength(2);expect(attempts[1]).toEqual(attempts[0]);expect(attempts[0].etag).toBe('"edit-3"');expect(songWrites).toEqual([]);
});

test('abandon unknown cover receipt survives reload and preserves unsaved album edits',async({page})=>{
  await create(page);let puts=0;const keys=[];
  await page.route('**/admin/api/music/collection-uploads/*/body',async route=>{puts++;await route.fetch();await route.abort();});
  await page.route('**/admin/api/music/collection-uploads/*/abandon',async route=>{keys.push(route.request().headers()['idempotency-key']);if(keys.length===1){await route.fetch();await route.abort();}else await route.continue();});
  const image=await sharp({create:{width:24,height:24,channels:3,background:'#444477'}}).png().toBuffer();
  await page.locator('#album-cover-file').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:image});await page.locator('#album-cover-upload').click();await expect(page.locator('#album-cover-abandon')).toBeVisible();
  await page.locator('[data-collection-description="zh-Hans"]').fill('未保存的介绍');await page.locator('#album-cover-abandon').click();await confirm(page);
  await expect(page.locator('#album-cover-recover')).toHaveText('核对放弃结果');await expect(page.locator('#album-cover-upload')).toBeDisabled();
  await page.reload();await expect(page.locator('[data-collection-description="zh-Hans"]')).toHaveValue('未保存的介绍');await page.locator('#album-cover-recover').click();
  await expect(page.locator('#album-cover-status')).toContainText('原上传已放弃');await expect(page.locator('[data-collection-description="zh-Hans"]')).toHaveValue('未保存的介绍');
  expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(puts).toBe(1);await expect(page.locator('#album-cover-recover')).toBeHidden();
});

test('another tab abandoning an in-flight cover cannot complete or attach it',async({page})=>{
  await create(page);let completions=0;
  page.on('request',r=>{if(r.url().endsWith('/complete')&&r.method()==='POST')completions++;});
  await page.route('**/admin/api/music/collection-uploads/*/body',async route=>{
    const written=await route.fetch();expect(written.ok()).toBe(true);
    const base=route.request().url().replace(/\/body$/,'');
    const abandoned=await page.request.post(base+'/abandon',{headers:{Origin:new URL(base).origin,'X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':crypto.randomUUID()},data:{}});
    expect(abandoned.ok()).toBe(true);
    const state=await page.request.get(base);expect(state.ok()).toBe(true);
    await route.fulfill({json:await state.json()});
  });
  const image=await sharp({create:{width:24,height:24,channels:3,background:'#444477'}}).png().toBuffer();
  await page.locator('#album-cover-file').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:image});await page.locator('#album-cover-upload').click();
  await expect(page.locator('#collection-status')).toContainText('这次封面上传已失效');await expect(page.locator('#album-cover-use')).toBeHidden();expect(completions).toBe(0);
});

for(const hasCurrentCover of [false,true])test(`unselected completed cover requires explicit snapshot confirmation (current cover: ${hasCurrentCover})`,async({page})=>{
  await create(page);await page.locator('#member-search-form button').click();await page.getByRole('button',{name:'添加 晚风经过车站',exact:true}).click();await page.locator('#collection-order-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 2');
  const image=await sharp({create:{width:177,height:177,channels:3,background:'#444477'}}).png().toBuffer();
  if(hasCurrentCover){await page.locator('#album-cover-file').setInputFiles({name:'first.png',mimeType:'image/png',buffer:image});await page.locator('#album-cover-upload').click();await expect(page.locator('#album-cover-status')).toContainText('请保存资料');await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 3');}
  const albumId=await page.locator('#collection-list button[aria-current="true"]').getAttribute('data-collection-id');
  const origin=new URL(page.url()).origin,headers={Origin:origin,'X-Requested-With':'StationCatMusicAdmin','Idempotency-Key':crypto.randomUUID()};
  async function anotherTabUpload(){
    const created=await page.request.post('/admin/api/music/collection-uploads',{headers:{...headers,'Idempotency-Key':crypto.randomUUID()},data:{collectionId:albumId,format:'png',byteSize:image.length,sha256:createHash('sha256').update(image).digest('hex')}});expect(created.ok()).toBe(true);const {uploadId}=await created.json();
    const body=await page.request.put(`/admin/api/music/collection-uploads/${uploadId}/body`,{headers:{...headers,'Idempotency-Key':crypto.randomUUID(),'Content-Type':'image/png'},data:image});expect(body.ok()).toBe(true);
    const completed=await page.request.post(`/admin/api/music/collection-uploads/${uploadId}/complete`,{headers:{...headers,'Idempotency-Key':crypto.randomUUID()},data:{}});expect(completed.ok()).toBe(true);
  }
  await anotherTabUpload();
  const attempts=[];let dropped=false;await page.route('**/admin/api/music/collections/*',async route=>{const r=route.request();if(r.method()!=='PATCH'||r.postDataJSON()?.status!=='published')return route.continue();attempts.push({body:r.postDataJSON(),key:r.headers()['idempotency-key']});if(r.postDataJSON()?.confirmIgnoredCoverSnapshot&&!dropped){const result=await route.fetch();if(result.ok()){dropped=true;return route.abort();}return route.fulfill({response:result});}await route.continue();});
  await page.locator('#collection-publish-metadata').click();await confirm(page);await expect(page.locator('#collection-publish-no-cover')).toBeVisible();expect(attempts[0].body.confirmIgnoredCoverSnapshot).toBeUndefined();
  await page.locator('#collection-publish-no-cover').click();await expect(page.locator('#collection-confirm-text')).toContainText(hasCurrentCover?'使用已保存的封面':'没有封面');await page.locator('#collection-confirm button[value="cancel"]').click();expect(attempts).toHaveLength(1);
  await page.locator('#collection-publish-no-cover').click();
  await expect(page.locator('#collection-confirm')).toBeVisible();
  if(!hasCurrentCover){await anotherTabUpload();await confirm(page);await expect(page.locator('#collection-publish-result')).toContainText('有已上传但未应用的封面');await expect(page.locator('#collection-state')).toHaveText('专辑 · 草稿');await expect(page.locator('#collection-publish-no-cover')).toBeEnabled({timeout:5000});await page.locator('#collection-publish-no-cover').click();await expect(page.locator('#collection-confirm-text')).toContainText('另有 2 张');}
  await confirm(page);await expect(page.locator('#collection-retry')).toBeEnabled();expect(attempts.at(-1).body.confirmIgnoredCoverSnapshot).toMatch(/^[a-f0-9]{64}$/);const pending=attempts.at(-1);
  await page.reload();await page.locator('#collection-retry').click();await confirm(page);await expect(page.locator('#collection-state')).toHaveText('专辑 · 已发布');expect(attempts.at(-1)).toEqual(pending);
});

test('narrow workspace stays usable and archive disables membership edits',async({page})=>{
  await page.setViewportSize({width:390,height:844});await create(page);await page.locator('#member-search-form button').click();await page.getByRole('button',{name:'添加 晚风经过车站',exact:true}).click();await page.locator('#collection-order-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 2');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#collection-archive').click();await page.locator('#collection-confirm-reason').fill('隔离归档');await confirm(page);await expect(page.locator('#collection-state')).toHaveText('专辑 · 已归档');
  await expect(page.getByRole('button',{name:'移除 晚风经过车站',exact:true})).toBeDisabled();await expect(page.locator('#collection-save')).toBeDisabled();await expect(page.locator('#collection-order-save')).toBeDisabled();
});

test('a failed initial status read can recover; account changes prevent a new write',async({page})=>{
  let reads=0;await page.route('**/admin/api/music/status',async route=>{reads++;if(reads===1)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'MUSIC_DATABASE_UNAVAILABLE'})});await route.continue();});
  await page.goto('/admin/music/collections/');await expect(page.locator('#collection-status')).toHaveAttribute('data-error','true');await expect(page.locator('#collection-new-album')).toBeDisabled();await page.locator('#collection-reload').click();await expect(page.locator('#collection-new-album')).toBeEnabled();
  await page.locator('#collection-new-album').click();await page.locator('#collection-slug').fill(unique());await page.locator('[data-collection-title="zh-Hans"]').fill('账号变化');
  await page.unroute('**/admin/api/music/status');await page.route('**/admin/api/music/status',async route=>{const r=await route.fetch(),body=await r.json();await route.fulfill({response:r,json:{...body,actorId:'changed@example.test'}});});
  let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/collections'))writes++;});await page.locator('#collection-save').click();await expect(page.locator('#collection-status')).toContainText('管理员账号已变化');expect(writes).toBe(0);await expect(page.locator('#collection-new-album')).toBeDisabled();
  await page.unroute('**/admin/api/music/status');await page.locator('#collection-reload').click();
  await expect(page.locator('#collection-retry')).toBeEnabled();expect(writes).toBe(0);
  await page.locator('#collection-retry').click();expect(writes).toBe(0);await confirm(page);
  await expect(page.locator('#collection-version')).toHaveText('编辑版本 1');expect(writes).toBe(1);
});


test('public album browsing keeps one paused source until play and retains cards during favorite updates',async({page})=>{
  const tracks=fixtureTracks.map(t=>({...t,coverUrl:null,durationSec:20}));
  const album={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',slug:'album-test',type:'album',listeningMode:'mixed',title:'专辑夹具',description:'',coverTrackId:null,trackIds:tracks.map(t=>t.id).reverse()};
  let audioRequests=0;
  await page.route('**/api/music/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/catalog'))return route.fulfill({json:{schemaVersion:2,tracks,collections:[album]}});
    if(url.pathname.includes('/collections/'))return route.fulfill({json:{schemaVersion:2,tracks,collection:album}});
    if(url.pathname.endsWith('/capabilities'))return route.fulfill({json:{canPlayVipFull:false,musicVipDeliveryEnabled:false,authenticated:false,membershipStatus:'none',serverNow:new Date().toISOString(),validUntil:null}});
    if(url.pathname.endsWith('/audio')){audioRequests++;return route.fulfill({status:200,contentType:'audio/wav',body:demoWav(tracks[2])});}
    return route.fulfill({status:503,json:{error:{code:'MUSIC_PUBLIC_DISABLED'}}});
  });
  await page.goto('/zh-hans/music/');await expect(page.locator('[data-track-list] > li')).toHaveCount(3);
  await page.getByRole('button',{name:'专辑',exact:true}).click();await page.locator('[data-album-list] button').click();
  await expect(page.locator('[data-track-list]')).toContainText('慢慢醒来');await expect(page.locator('[data-list-title]')).toHaveText('专辑夹具');
  expect(audioRequests).toBe(0);expect(await page.locator('audio').evaluate(a=>a.getAttribute('src'))).toBeNull();
  await page.locator('[data-play-all]').click();await expect.poll(()=>page.locator('audio').evaluate(a=>!a.paused)).toBe(true);
  const source=await page.locator('audio').getAttribute('src');await page.getByRole('button',{name:'专辑',exact:true}).click();
  const card=page.locator('[data-album-list] button');await card.evaluate(n=>n.dataset.testIdentity='retained');
  await page.locator('[data-featured-view]').click();await expect(page.locator('[data-detail-dialog]')).toBeVisible();
  await page.locator('[data-detail-favorite]').click();await page.locator('[data-panel-close="detail"]').click();
  await expect(card).toHaveAttribute('data-test-identity','retained');
  expect(await page.locator('audio').getAttribute('src')).toBe(source);expect(audioRequests).toBe(1);
});


test('metadata-only album remains visible and opens with no songs or audio requests',async({page})=>{
  const album={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',slug:'album-empty',type:'album',listeningMode:'free',title:'即将更新的专辑',description:'',coverTrackId:null,trackIds:[]};let audioRequests=0;
  await page.route('**/api/music/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/catalog'))return route.fulfill({json:{schemaVersion:2,tracks:fixtureTracks,collections:[album]}});
    if(url.pathname.includes('/collections/'))return route.fulfill({json:{schemaVersion:2,tracks:[],collection:album}});
    if(url.pathname.endsWith('/capabilities'))return route.fulfill({json:{canPlayVipFull:false,musicVipDeliveryEnabled:false,authenticated:false,membershipStatus:'none',serverNow:new Date().toISOString(),validUntil:null}});
    if(url.pathname.endsWith('/audio'))audioRequests++;
    return route.fulfill({status:503,json:{error:{code:'MUSIC_PUBLIC_DISABLED'}}});
  });
  await page.goto('/zh-hans/music/');await page.getByRole('button',{name:'专辑',exact:true}).click();await expect(page.locator('[data-album-list] button')).toContainText('即将更新的专辑');await page.locator('[data-album-list] button').click();
  await expect(page.locator('[data-list-title]')).toHaveText('即将更新的专辑');await expect(page.locator('[data-track-list] > li')).toHaveCount(0);expect(audioRequests).toBe(0);expect(await page.locator('audio').getAttribute('src')).toBeNull();
});
