import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {wavFixture} from '../helpers/music-wav-fixture.mjs';
const mp3={name:'cbr-stereo.mp3',mimeType:'audio/mpeg',buffer:readFileSync(fileURLToPath(new URL('../../tests/fixtures/music-mp3/cbr-stereo.mp3',import.meta.url)))};
const wav={name:'本机测试.wav',mimeType:'audio/wav',buffer:wavFixture({seconds:2,bits:24,sampleRate:48000})};
async function setup(page,files=[mp3,wav]){
  page.on('dialog',d=>d.accept());
  await page.goto('/admin/music/collections/');await page.locator('#collection-new-album').click();await page.locator('#collection-slug').fill('batch-'+crypto.randomUUID());await page.locator('[data-collection-title="zh-Hans"]').fill('多文件专辑');
  await page.locator('#album-listening-mode').selectOption('vip');await page.locator('#collection-save').click();await expect(page.locator('#collection-version')).toHaveText('编辑版本 1');
  await page.locator('#album-batch-open').click();await page.locator('#batch-creator').fill('合成夹具');await page.locator('#batch-language').fill('无人声');await page.locator('#batch-instrumental').check();
  await page.locator('#batch-files').setInputFiles(files);await page.getByRole('button',{name:'生成上传清单',exact:true}).click();await expect(page.locator('#batch-rows > li')).toHaveCount(files.length);
  for(let i=0;i<files.length;i++)await page.locator('.batch-row select').nth(i).selectOption(i%2?'vip':'free');
}
async function start(page){await page.locator('#batch-start').click();await page.locator('#batch-confirm-accept').click();}
async function add(page){await page.locator('#batch-add').click();await page.locator('#batch-confirm-accept').click();}

test('mixed MP3/WAV upload creates separate drafts; explicit per-song policy, order, membership and deep link',async({page})=>{
  const errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/admin/api/music/'))calls.push(r);});
  await setup(page);await page.locator('.batch-row input:not([type=file])').nth(1).fill('改名后的 WAV');expect(calls.filter(r=>r.url().endsWith('/uploads'))).toHaveLength(0);
  await page.locator('.batch-row').nth(1).getByRole('button',{name:'上移',exact:true}).press('Enter');
  await start(page);await expect(page.locator('#batch-summary')).toHaveText('草稿完成 2 / 2 · 已加入 0');
  const creates=calls.filter(r=>r.url().endsWith('/tracks')&&r.method()==='POST');expect(creates).toHaveLength(2);expect(creates.map(r=>r.postDataJSON().policy.accessMode)).toEqual(['vip','free']);
  const reserves=calls.filter(r=>r.url().endsWith('/uploads'));expect(reserves).toHaveLength(2);expect(reserves.every(r=>r.postDataJSON().format==='mp3')).toBe(true);
  expect(calls.filter(r=>r.url().endsWith('/body'))).toHaveLength(2);expect(calls.some(r=>/publish|review|readers/.test(r.url()))).toBe(false);
  await add(page);await expect(page.locator('#batch-summary')).toHaveText('草稿完成 2 / 2 · 已加入 2');
  const order=calls.find(r=>r.method()==='PUT'&&r.url().endsWith('/tracks'));expect(order.postDataJSON().trackIds).toEqual(reserves.map(r=>r.postDataJSON().trackId));
  const href=await page.locator('.batch-row a').first().getAttribute('href');await page.locator('.batch-row a').first().click();await expect(page).toHaveURL(new RegExp(href.split('?')[1].split('=')[1]));
  await expect(page.locator('#track-title')).toHaveValue('改名后的 WAV');await expect(page.locator('#access-mode')).toHaveValue('vip');await expect(page.locator('#track-state')).toHaveText('草稿');expect(errors).toEqual([]);
});

test('lost reservation restores journal, original key and reselected file without duplicate drafts',async({page})=>{
  await setup(page,[mp3]);const keys=[];await page.route('**/admin/api/music/uploads',async route=>{if(route.request().method()!=='POST')return route.continue();keys.push(route.request().headers()['idempotency-key']);if(keys.length===1){await route.fetch();await route.abort();}else await route.continue();});
  let puts=0;page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/body'))puts++;});await start(page);await expect(page.locator('#batch-status')).toHaveAttribute('data-error','true');await expect(page.locator('#batch-retry')).toBeEnabled();expect(keys).toHaveLength(1);
  await page.reload();await expect(page.locator('#batch-start')).toBeDisabled();expect(keys).toHaveLength(1);expect(puts).toBe(0);
  await page.locator('#batch-retry').click();await page.locator('#batch-confirm-accept').click();await expect(page.locator('#batch-status')).toHaveText('原操作已确认。可继续批次。');await expect(page.locator('#batch-start')).toBeEnabled();await expect(page.locator('#batch-retry')).toBeHidden();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  await page.locator('.batch-row input[type=file]').setInputFiles(mp3);await page.locator('#batch-start').click();await expect(page.locator('#batch-summary')).toHaveText('草稿完成 1 / 1 · 已加入 0');expect(puts).toBe(1);
});

test('unknown PUT after server acceptance never uploads again, refresh is inert',async({page})=>{
  await setup(page,[mp3]);let puts=0;
  await page.route('**/admin/api/music/uploads/*/body',async route=>{puts++;await route.fetch();await route.abort();});
  await start(page);await expect(page.locator('.batch-row .badge')).toHaveText('上传待核对');await expect(page.locator('#batch-start')).toBeEnabled();
  await page.reload();await expect(page.locator('.batch-row .badge')).toHaveText('上传待核对');expect(puts).toBe(1);
  await page.locator('#batch-start').click();await expect(page.locator('#batch-summary')).toHaveText('草稿完成 1 / 1 · 已加入 0');expect(puts).toBe(1);
});

test('narrow keyboard controls and a real conversion cancellation preserve zero reservations',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setup(page,[wav]);
  await page.route('**/vendor/music-mp3/lamejs-1.2.7.js',async route=>{await new Promise(r=>setTimeout(r,1200));await route.continue();});
  let writes=0;page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/admin/api/music/'))writes++;});
  await start(page);await expect(page.locator('#batch-progress-label')).toContainText('本机转换');await page.locator('#batch-stop').click();await expect(page.locator('#batch-start')).toBeEnabled();
  expect(writes).toBe(0);await expect(page.locator('#batch-status')).toContainText('取消');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('.batch-row').getByRole('button',{name:'取消此项',exact:true}).press('Enter');await expect(page.locator('.batch-row .badge')).toHaveText('已取消');
});

test('changed account blocks pending recovery; restored original identity may retry the original operation',async({page})=>{
  await setup(page,[mp3]);let changed=true,writes=0;page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/admin/api/music/'))writes++;});
  await page.route('**/admin/api/music/status',async route=>{const r=await route.fetch();const b=await r.json();await route.fulfill({response:r,json:{...b,...(changed?{actorId:'other@example.test'}:{})}});});
  await start(page);await expect(page.locator('#batch-status')).toContainText('账号已变化');expect(writes).toBe(0);
  changed=false;await start(page);await expect(page.locator('#batch-summary')).toHaveText('草稿完成 1 / 1 · 已加入 0');
});
