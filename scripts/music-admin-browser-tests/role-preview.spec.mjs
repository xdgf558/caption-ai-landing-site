import { test, expect } from '@playwright/test';
const id = n => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12,'0')}`;
function fixture() {
  const metadata = {originalLocale:'zh-Hans',title:{'zh-Hans':'月台四角色测试',en:'Platform preview'},summary:{'zh-Hans':'用于浏览器回归的合成资料'},creatorName:'Fixture',language:'无人声',instrumental:true,genres:[],moods:[],story:'已保存故事'};
  const draft = {id:id(2),number:2,state:'draft',metadata,policy:{accessMode:'early_access',earlyAccessUntil:'2099-01-01T00:00:00.000Z',postEarlyAccessMode:'free',policyVersion:2},assets:{audio:id(4),preview:id(5),cover:null,lyrics:null},technicalReviewedAt:null};
  return {ok:true,id:id(1),slug:'role-preview-test',lifecycle:'published',editVersion:3,serverNow:'2026-09-12T00:00:00.000Z',draft,
    published:{...structuredClone(draft),id:id(3),number:1,state:'sealed',metadata:{...metadata,title:{'zh-Hans':'旧发布曲名'}},policy:{accessMode:'free',earlyAccessUntil:null,postEarlyAccessMode:null,policyVersion:1}},
    rights:null,assets:[{id:id(4),kind:'audio',state:'validated',byteSize:10000,durationMs:120000},
      {id:id(5),kind:'preview',state:'validated',byteSize:2000,durationMs:30000,derivedFromAssetId:id(4),sourceStartMs:10000,sourceEndMs:40000}]};
}
async function setup(page) {
  const state = {row:fixture(), actor:'fixture@example.test', requests:[], fail:false};
  await page.route('**/admin/api/music/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.requests.push([request.method(),path]);
    if (request.method() !== 'GET') return route.fulfill({status:500,json:{ok:false,code:'UNEXPECTED_WRITE'}});
    if (path.endsWith('/status')) return route.fulfill({json:{ok:true,actorId:state.actor,flags:{public:false,vipDelivery:false},storage:{quotaBytes:0,chargedBytes:0},capabilities:{uploads:false}}});
    if (path.endsWith('/tracks')) return route.fulfill({json:{ok:true,items:[{id:id(1),slug:state.row.slug,lifecycle:'published',title:state.row.draft.metadata.title}],nextBefore:null}});
    if (path.endsWith('/tracks/' + id(1))) return route.fulfill({status:state.fail ? 503 : 200,json:state.fail ? {ok:false,code:'MUSIC_DATABASE_UNAVAILABLE'} : state.row});
    return route.fulfill({status:404,json:{ok:false,code:'UNEXPECTED_READ'}});
  });
  await page.goto('/admin/music/?track=' + id(1));
  await expect(page.locator('#track-version')).toHaveText('编辑版本 3');
  return state;
}
const role = (page,name) => page.locator('[data-preview-role="' + name + '"]');
const enter = async page => {
  await page.getByRole('tab',{name:'角色预览',exact:true}).click();
  await expect(page.locator('[data-role-notice]')).toContainText('读取于');
};
test('four role buttons, gate and boundary simulations use no public/media requests, writes or role storage', async ({page}) => {
  const state = await setup(page), outside = [];
  page.on('request',r => { if (new URL(r.url()).pathname.startsWith('/api/music/')) outside.push(r.url()); });
  await enter(page);
  await expect(page.locator('[data-preview-variant]')).toHaveCount(4);
  await expect(role(page,'vip').getByRole('button',{name:'暂不可播放'})).toBeDisabled();
  const calls = state.requests.length;
  await page.getByLabel('预览场景',{exact:true}).selectOption('released');
  await expect(role(page,'vip').getByRole('button',{name:'播放',exact:true})).toBeEnabled();
  for (const name of ['visitor','account','expired']) await expect(role(page,name).getByRole('button',{name:'播放试听',exact:true})).toBeEnabled();
  await role(page,'vip').getByRole('button',{name:'播放',exact:true}).click();
  await expect(page.locator('[data-role-action]')).toContainText('不会请求音频');
  await role(page,'expired').getByRole('button',{name:'会员中心',exact:true}).click();
  await expect(page.locator('[data-role-action]')).toContainText('不修改会员资格');
  await page.getByLabel('策略时刻',{exact:true}).selectOption('boundary');
  await expect(page.locator('[data-preview-variant="full"]')).toHaveCount(4);
  await page.getByLabel('内容语言',{exact:true}).selectOption('en');
  await expect(role(page,'visitor').getByRole('heading',{name:'Platform preview'})).toBeVisible();
  expect(state.requests.length).toBe(calls);
  expect(outside).toEqual([]); expect(state.requests.some(([method,path]) => method !== 'GET' || path.includes('/assets/'))).toBe(false);
  expect(await page.locator('audio').evaluateAll(nodes => nodes.every(a => !a.getAttribute('src') && a.paused))).toBe(true);
  const storage = await page.evaluate(() => Object.entries(sessionStorage).map(([,v]) => v).join(''));
  expect(storage).not.toMatch(/data-role|scenario|canPlayVipFull|membershipStatus/);
  // Re-reading the editor while the role tab remains selected must not reattach hidden media.
  await page.getByRole('button',{name:'重新读取服务状态',exact:true}).click();
  await expect(page.locator('#music-status')).toHaveText('已重新读取当前版本。');
  await expect(page.locator('[data-role-notice]')).toContainText('读取于');
  expect(await page.locator('audio').evaluateAll(nodes => nodes.every(a => !a.getAttribute('src') && a.paused))).toBe(true);
});
test('saved preview keeps unsaved input intact and published metadata independent', async ({page}) => {
  await setup(page);
  await page.getByLabel('曲名',{exact:true}).fill('仅在表单里的新曲名');
  await enter(page);
  await expect(page.locator('[data-role-unsaved]')).toBeVisible();
  await page.getByLabel('预览场景',{exact:true}).selectOption('released');
  await expect(role(page,'visitor').getByRole('heading',{name:'月台四角色测试'})).toBeVisible();
  await page.getByLabel('预览版本',{exact:true}).selectOption('published');
  await expect(role(page,'visitor').getByRole('heading',{name:'旧发布曲名'})).toBeVisible();
  await expect(page.getByLabel('策略时刻',{exact:true})).toHaveValue('read');
  await page.getByRole('tab',{name:'基本资料',exact:true}).click();
  await expect(page.getByLabel('曲名',{exact:true})).toHaveValue('仅在表单里的新曲名');
  await page.getByRole('tab',{name:'基本资料',exact:true}).press('End');
  await expect(page.getByRole('tab',{name:'角色预览',exact:true})).toBeFocused();
});
test('failed refresh and changed administrator clear old role cards; new server version does not overwrite editor', async ({page}) => {
  const state = await setup(page); await enter(page);
  state.row.editVersion = 4; state.row.draft.metadata.title['zh-Hans'] = '服务器新曲名';
  await page.getByRole('button',{name:'重新读取预览',exact:true}).click();
  await expect(page.locator('[data-role-notice]')).toContainText('服务器版本已变化');
  await expect(page.locator('#track-version')).toHaveText('编辑版本 3');
  state.fail = true;
  await page.getByRole('button',{name:'重新读取预览',exact:true}).click();
  await expect(page.locator('[data-role-notice]')).toContainText('旧预览已清除');
  await expect(page.locator('[data-preview-role]')).toHaveCount(0);
  state.fail = false; state.actor = 'changed@example.test';
  const count = state.requests.filter(([,p]) => p.endsWith(id(1))).length;
  await page.getByRole('button',{name:'重新读取预览',exact:true}).click();
  await expect(page.getByRole('button',{name:'新建曲目',exact:true})).toBeDisabled();
  expect(state.requests.filter(([,p]) => p.endsWith(id(1))).length).toBe(count);
  await expect(page.locator('[data-preview-role]')).toHaveCount(0);
});
test('narrow layout wraps tabs and keeps controls usable; metadata is text, not HTML', async ({page}) => {
  await page.setViewportSize({width:320,height:780});
  const state = await setup(page); state.row.draft.metadata.title['zh-Hans'] = '<img src=x onerror=alert(1)>';
  await enter(page);
  await expect(role(page,'visitor').getByRole('heading',{name:'<img src=x onerror=alert(1)>'})).toBeVisible();
  await expect(page.locator('#role-preview img, #role-preview audio, #role-preview a')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'前往素材核对',exact:true}).click();
  await expect(page.getByRole('tab',{name:'素材',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-asset-kind="audio"] audio')).toHaveAttribute('src', '/admin/api/music/assets/' + id(4));
});
