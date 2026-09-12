import {test,expect} from '@playwright/test';
import {tracks as fixtureTracks,demoWav} from '../fixtures/music-player/data.mjs';
const unique=()=> 'album-ui-'+crypto.randomUUID();
async function create(page){await page.goto('/admin/music/collections/');await page.locator('#collection-new-album').click();await page.locator('#collection-slug').fill(unique());await page.locator('[data-collection-title="zh-Hans"]').fill('隔离测试专辑');await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 1');}
async function confirm(page){await page.locator('#collection-confirm-accept').click();}

test('album metadata, keyboard order, reload and failed incomplete publication use isolated API',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await create(page);
  await expect(page.locator('#collection-list button[aria-current="true"]')).toHaveCount(1);
  await page.locator('#member-search-form button').click();
  await page.getByRole('button',{name:'添加 晚风经过车站',exact:true}).click();await page.getByRole('button',{name:'添加 月台上的雨',exact:true}).click();
  await expect(page.locator('#collection-publish')).toBeDisabled();await expect(page.locator('#collection-save')).toBeDisabled();
  await page.getByRole('button',{name:'上移 月台上的雨',exact:true}).press('Enter');
  await expect(page.locator('#collection-order li').first()).toContainText('月台上的雨');await expect(page.getByRole('button',{name:'上移 月台上的雨',exact:true})).toBeDisabled();
  await page.locator('#collection-order-reason').fill('先雨后晚风');await page.locator('#collection-order-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 2');
  await page.reload();await expect(page.locator('#collection-order li')).toHaveCount(2);await expect(page.locator('#collection-order li').first()).toContainText('月台上的雨');
  await page.locator('#album-listening-mode').selectOption('vip');await page.locator('#collection-reason').fill('VIP 专辑');await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 3');
  await page.locator('#collection-publish').click();await page.locator('#collection-confirm-reason').fill('测试拒绝不完整专辑');await page.locator('#collection-confirm-reason').press('Enter');await expect(page.locator('#collection-confirm')).toBeVisible();await confirm(page);
  await expect(page.locator('#collection-status')).toContainText('所有成员都必须已发布');await expect(page.locator('#collection-state')).toHaveText('专辑 · 草稿');expect(errors).toEqual([]);
});

test('unknown create receipt survives reload, blocks duplicates, and retries only the original key',async({page})=>{
  const keys=[];await page.route('**/admin/api/music/collections',async route=>{if(route.request().method()!=='POST')return route.continue();keys.push(route.request().headers()['idempotency-key']);if(keys.length===1){await route.fetch();await route.abort();}else await route.continue();});
  await page.goto('/admin/music/collections/');await page.locator('#collection-new-album').click();await page.locator('#collection-slug').fill(unique());await page.locator('[data-collection-title="zh-Hans"]').fill('原键重试');await page.locator('#collection-save').click();
  await expect(page.locator('#collection-retry')).toBeVisible();await expect(page.locator('#collection-new-album')).toBeDisabled();await page.reload();expect(keys).toHaveLength(1);
  await page.locator('#collection-retry').click();expect(keys).toHaveLength(1);await confirm(page);await expect(page.locator('#collection-version')).toHaveText('编辑版本 1');expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
});

test('narrow workspace stays usable and archive disables membership edits',async({page})=>{
  await page.setViewportSize({width:390,height:844});await create(page);await page.locator('#member-search-form button').click();await page.getByRole('button',{name:'添加 晚风经过车站',exact:true}).click();await page.locator('#collection-order-reason').fill('曲序');await page.locator('#collection-order-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 2');
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
  await page.locator('[data-detail-favorite]').click();await expect(card).toHaveAttribute('data-test-identity','retained');
  expect(await page.locator('audio').getAttribute('src')).toBe(source);expect(audioRequests).toBe(1);
});
