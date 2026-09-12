import { test, expect } from '@playwright/test';
import { tracks as fixtureTracks, demoWav } from '../fixtures/music-player/data.mjs';

const id = n => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12,'0')}`;
const free = { id:id(1), slug:'free-feature', lifecycle:'published', effectiveAccess:'free', title:{'zh-Hans':'免费主推'} };
const freeSecond = { id:id(2), slug:'free-second', lifecycle:'published', effectiveAccess:'free', title:{'zh-Hans':'清晨推荐'} };
const vip = { id:id(3), slug:'vip-feature', lifecycle:'published', effectiveAccess:'vip', title:{'zh-Hans':'会员推荐'} };
const album = { id:id(4), slug:'featured-album', status:'published', type:'album', title:{'zh-Hans':'本月专辑'} };

async function adminFixture(page,{ conflict = false } = {}) {
  const state = { editVersion:1, writes:[], featuredReads:0, conflict };
  await page.route('**/admin/api/music/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.endsWith('/status')) return route.fulfill({json:{ok:true,actorId:'featured@example.test',flags:{public:false,vipDelivery:false},storage:{quotaBytes:0,chargedBytes:0},capabilities:{featured:true}}});
    if (path.endsWith('/tracks')) return route.fulfill({json:{ok:true,items:[free,freeSecond,vip],nextBefore:null}});
    if (path.endsWith('/collections')) return route.fulfill({json:{ok:true,items:[album],nextBefore:null}});
    if (path.endsWith('/featured') && request.method() === 'GET') {
      state.featuredReads++;
      return route.fulfill({json:{ok:true,editVersion:state.editVersion,primaryTrackId:null,secondaryTrackIds:[],collectionIds:[],tracks:[],collections:[]}});
    }
    if (path.endsWith('/featured') && request.method() === 'PUT') {
      const record = { headers:request.headers(), body:request.postDataJSON() }; state.writes.push(record);
      if (state.conflict) { state.conflict=false; state.editVersion=2; return route.fulfill({status:409,json:{ok:false,code:'MUSIC_FEATURED_CONFLICT'}}); }
      state.editVersion++;
      return route.fulfill({json:{ok:true,editVersion:state.editVersion,catalogVersion:state.editVersion-1,replayed:false}});
    }
    return route.fulfill({status:404,json:{ok:false,code:'UNEXPECTED_REQUEST'}});
  });
  await page.goto('/admin/music/featured/');
  await expect(page.locator('#featured-version')).toHaveText('编辑版本 1');
  return state;
}

async function addTrack(page,kind,name) {
  await page.locator(`#featured-${kind}-search button`).click();
  await page.getByRole('button',{name,exact:true}).click();
}

test('one versioned save preserves manual order and never reads media or identity APIs', async ({page}) => {
  const outside=[]; page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/music/')||/assets|audio|cover|lyrics/.test(path))outside.push(path);});
  const state=await adminFixture(page);
  await page.locator('#featured-primary-search button').click();
  await expect(page.getByRole('button',{name:'设为主推 · 免费主推 · 免费',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/设为主推 · 会员推荐/})).toHaveCount(0);
  await page.getByRole('button',{name:'设为主推 · 免费主推 · 免费',exact:true}).click();
  await addTrack(page,'secondary','添加 · 会员推荐 · VIP');
  await addTrack(page,'secondary','添加 · 清晨推荐 · 免费');
  await page.getByRole('button',{name:'上移 清晨推荐',exact:true}).click();
  await page.locator('#featured-collections-search button').click();
  await page.getByRole('button',{name:'添加 · 本月专辑 · 专辑',exact:true}).click();
  await page.locator('#featured-reason').fill('首页秋季编排');
  await page.locator('#featured-save').click();
  await expect(page.locator('#featured-version')).toHaveText('编辑版本 2');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].headers['if-match']).toBe('"edit-1"');
  expect(state.writes[0].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.writes[0].body).toEqual({primaryTrackId:free.id,secondaryTrackIds:[freeSecond.id,vip.id],collectionIds:[album.id],reason:'首页秋季编排'});
  expect(outside).toEqual([]);
});

test('a conflict keeps local curation and rebases only after an explicit merge', async ({page}) => {
  const state=await adminFixture(page,{conflict:true});
  await addTrack(page,'secondary','添加 · 会员推荐 · VIP');
  await page.locator('#featured-reason').fill('保留本地编排');
  await page.locator('#featured-save').click();
  await expect(page.locator('#featured-status')).toContainText('当前编排已保留');
  await expect(page.locator('#featured-secondary')).toContainText('会员推荐');
  await page.locator('#featured-merge').click();
  await expect(page.locator('#featured-version')).toContainText('编辑版本 2');
  await expect(page.locator('#featured-secondary')).toContainText('会员推荐');
  await page.locator('#featured-save').click();
  await expect(page.locator('#featured-version')).toHaveText('编辑版本 3');
  expect(state.writes).toHaveLength(2);
  expect(state.writes[1].headers['if-match']).toBe('"edit-2"');
  expect(state.writes[1].headers['idempotency-key']).not.toBe(state.writes[0].headers['idempotency-key']);
});

test('narrow management layout stays usable at 320 CSS pixels', async ({page}) => {
  await page.setViewportSize({width:320,height:780}); await adminFixture(page);
  await addTrack(page,'secondary','添加 · 会员推荐 · VIP');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'上移 会员推荐',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'移除 会员推荐',exact:true})).toBeVisible();
});

test('public featured cards use the one player and viewing another card keeps the active source', async ({page}) => {
  const tracks=fixtureTracks.map((track,index)=>({...track,coverUrl:null,durationSec:20,effectiveAccess:index===1?'vip':'free',previewAvailable:index===1,
    previewDurationSec:index===1?8:null,previewSourceStartSec:index===1?0:null}));
  const collection={id:id(5),slug:'public-featured-album',type:'album',listeningMode:'mixed',title:'公开精选专辑',description:'',coverTrackId:null,trackIds:[tracks[0].id,tracks[1].id]};
  let audioRequests=0;
  await page.route('**/api/music/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/catalog'))return route.fulfill({json:{schemaVersion:2,tracks,collections:[collection],featured:{version:2,primaryTrackId:tracks[0].id,primarySource:'primary',secondaryTrackIds:[tracks[1].id],collectionIds:[collection.id]}}});
    if(path.endsWith('/capabilities'))return route.fulfill({json:{canPlayVipFull:false,musicVipDeliveryEnabled:false,authenticated:false,membershipStatus:'none',serverNow:new Date().toISOString(),validUntil:null}});
    if(path.includes('/collections/'))return route.fulfill({json:{schemaVersion:2,tracks:tracks.slice(0,2),collection}});
    if(path.endsWith('/audio')){audioRequests++;return route.fulfill({status:200,contentType:'audio/wav',body:demoWav(tracks[0])});}
    return route.fulfill({status:404,json:{error:{code:'NOT_FOUND'}}});
  });
  await page.goto('/zh-hans/music/');
  await expect(page.locator('[data-featured-home]')).toBeVisible();
  await expect(page.locator('[data-featured-primary-title]')).toHaveText(tracks[0].title);
  await expect(page.locator('[data-featured-secondary]')).toContainText('VIP');
  await expect(page.locator('[data-featured-collections]')).toContainText('公开精选专辑');
  expect(audioRequests).toBe(0); expect(await page.locator('audio').getAttribute('src')).toBeNull();
  await page.locator('[data-featured-play]').click();
  await expect.poll(()=>page.locator('audio').evaluate(audio=>!audio.paused)).toBe(true);
  const source=await page.locator('audio').getAttribute('src'); expect(audioRequests).toBe(1);
  await page.locator('[data-featured-track-view]').click();
  expect(await page.locator('audio').getAttribute('src')).toBe(source); expect(audioRequests).toBe(1);
  await page.locator('[data-featured-collection-open]').click();
  await expect(page.locator('[data-list-title]')).toHaveText('公开精选专辑');
  expect(await page.locator('audio').getAttribute('src')).toBe(source); expect(audioRequests).toBe(1);
});
