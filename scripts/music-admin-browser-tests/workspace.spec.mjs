import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const fixture = name => fileURLToPath(new URL('../../tests/fixtures/music-mp3/' + name,import.meta.url));
const unique = () => 'ui-' + crypto.randomUUID();
async function create(page, slug = unique()) {
  await page.goto('/admin/music/');
  await page.getByRole('button',{name:'新建曲目',exact:true}).click();
  await page.getByLabel('曲目链接标识',{exact:true}).fill(slug);
  await page.getByLabel('曲名',{exact:true}).fill('本地测试曲目');
  await page.getByLabel('演唱语言',{exact:true}).fill('无人声');
  await page.getByLabel('风格',{exact:true}).fill('Ambient');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await expect(page.locator('#track-version')).toHaveText('编辑版本 1');
  return slug;
}
async function upload(page,kind,file) {
  await page.locator('#file-' + kind).setInputFiles(file);
  await page.locator('[data-upload-kind="' + kind + '"]').click();
  await expect(page.locator('#music-status')).toContainText('文件已验证');
  await expect(page.locator('#file-' + kind)).toHaveValue('');
  await expect(page.locator('[data-upload-kind="' + kind + '"]')).toBeEnabled();
}
async function playMuted(audio) {
  await audio.evaluate(async a => {
    a.muted = true;
    try { await a.play(); } catch (error) { if (error.name !== 'AbortError') throw error; }
  });
  await expect.poll(() => audio.evaluate(a => !a.paused && a.currentTime > 0)).toBe(true);
}
async function rights(page) {
  await page.getByRole('tab',{name:'审核发布',exact:true}).click();
  const values = {sourcePlatform:'suno',planAtGeneration:'pro',planAtDownload:'pro',outputKind:'standard',downloadMethod:'official',permittedUse:'commercial'};
  for (const [key,v] of Object.entries(values)) await page.locator('[data-right="' + key + '"]').selectOption(v);
  for (const key of ['sourceSongId','authorizationBasis','lyricsRightsNotes','coverRightsNotes','audioInputRightsNotes']) await page.locator('[data-right="' + key + '"]').fill('本地合成夹具，不是正式授权');
  for (const key of ['generatedAt','downloadedAt','termsCheckedAt']) await page.locator('[data-right="' + key + '"]').fill('2026-01-01T12:00');
  await page.locator('#rights-decision').selectOption('approved'); await page.locator('#rights-reason').fill('仅隔离测试');
  await page.getByRole('button',{name:'提交权利核对',exact:true}).click();
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#rights-state')).toHaveText('已通过');
}
test('Enter saves a draft; full upload, review, publish, revision, unpublish and archive use real isolated API',async ({page}) => {
  const errors = []; page.on('pageerror',e => errors.push(e.message));
  const slug = await create(page);
  await page.getByLabel('修改说明',{exact:true}).fill('回车只保存');
  await page.getByLabel('曲名',{exact:true}).press('Enter');
  await expect(page.locator('#track-version')).toHaveText('编辑版本 2');
  await expect(page.locator('#track-state')).toHaveText('草稿');
  await page.getByRole('tab',{name:'素材',exact:true}).click();
  await upload(page,'audio',fixture('cbr-stereo.mp3'));
  await page.locator('#preview-end').fill('1');
  await upload(page,'preview',fixture('preview.mp3'));
  const png = await sharp({create:{width:160,height:160,channels:3,background:'#729284'}}).png().toBuffer();
  await upload(page,'cover',{name:'cover.png',mimeType:'image/png',buffer:png});
  await upload(page,'lyrics',{name:'lyrics.txt',mimeType:'text/plain',buffer:Buffer.from('本地歌词夹具')});
  await upload(page,'evidence',{name:'evidence.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('audio')).toHaveCount(2);
  await playMuted(page.locator('audio').first());
  await playMuted(page.locator('audio').last());
  await expect.poll(() => page.locator('audio').first().evaluate(a => a.paused)).toBe(true);
  await page.getByRole('button',{name:'保存素材到草稿',exact:true}).click();
  await expect(page.locator('#track-version')).toHaveText('编辑版本 3');
  await rights(page);
  if (!await page.locator('#technical-details').evaluate(e => e.open)) await page.locator('#technical-details summary').click();
  await page.locator('#technical-reason').fill('本地结构回归');
  await page.getByRole('button',{name:'提交技术核对',exact:true}).click();
  await expect(page.locator('#music-status')).toContainText('请先完成实际试听');
  for (const k of ['audioListened','previewListened','previewSourceConfirmed','artworkChecked']) await page.locator('[data-tech="' + k + '"]').check();
  await page.getByRole('button',{name:'提交技术核对',exact:true}).click();
  await expect(page.locator('#technical-state')).toHaveText('已核对');
  await page.locator('#track-publish').click();
  await expect(page.locator('#confirm-description')).toContainText('VIP 专享');
  await page.locator('#confirm-reason').fill('合成夹具发布测试');
  await page.locator('#confirm-reason').press('Enter');
  await expect(page.locator('#confirm-dialog')).toBeVisible();
  await expect(page.locator('#track-state')).toHaveText('草稿');
  await page.locator('#confirm-accept').click();
  await expect(page.locator('#track-state')).toHaveText('已发布');
  await page.reload(); await expect(page.locator('#track-state')).toHaveText('已发布');
  await page.getByRole('tab',{name:'基本资料',exact:true}).click();
  await page.getByLabel('曲名',{exact:true}).fill('新版草稿'); await page.getByLabel('修改说明',{exact:true}).fill('改稿');
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();
  await page.getByRole('tab',{name:'审核发布',exact:true}).click();
  await expect(page.locator('#track-publish')).toBeDisabled();
  await page.locator('#track-unpublish').click(); await page.locator('#confirm-reason').fill('回归下架'); await page.locator('#confirm-accept').click();
  await expect(page.locator('#track-state')).toHaveText('已下架');
  await page.locator('#track-archive').click(); await page.locator('#confirm-reason').fill('回归归档'); await page.locator('#confirm-accept').click();
  await expect(page.locator('#track-state')).toHaveText('已归档');
  await page.getByRole('button',{name:'操作记录',exact:true}).click(); await expect(page.locator('#audit-list')).toContainText('music.archive');
  expect(errors).toEqual([]);
});
test('lost create response survives reload and replays the exact key only on explicit retry',async ({page}) => {
  let originalKey, replayKey, count = 0;
  await page.route('**/admin/api/music/tracks',async route => {
    if (route.request().method() !== 'POST') return route.continue();
    count++;
    if (count === 1) { originalKey = route.request().headers()['idempotency-key']; await route.fetch(); await route.abort(); }
    else { replayKey = route.request().headers()['idempotency-key']; await route.continue(); }
  });
  await page.goto('/admin/music/'); await page.locator('#track-new').click();
  await page.locator('#track-slug').fill(unique()); await page.locator('#track-title').fill('丢响应');
  await page.locator('#track-language').fill('无人声'); await page.locator('#track-save').click();
  await expect(page.locator('#mutation-retry')).toBeVisible();
  await expect(page.locator('#track-new')).toBeDisabled();
  await page.reload(); expect(count).toBe(1);
  await page.locator('#mutation-retry').click(); await page.locator('#confirm-accept').click();
  await expect(page.locator('#track-version')).toHaveText('编辑版本 1');
  expect(replayKey).toBe(originalKey);
});
test('unknown PUT outcome is recovered by GET/complete without another PUT or reservation',async ({page}) => {
  await create(page); await page.getByRole('tab',{name:'素材',exact:true}).click();
  let puts = 0, reserves = 0;
  page.on('request',r => { if (r.method() === 'POST' && r.url().endsWith('/uploads')) reserves++; });
  await page.route('**/uploads/*/body',async route => { puts++; await route.fetch(); await route.abort(); });
  await page.locator('#file-audio').setInputFiles(fixture('cbr-stereo.mp3'));
  await page.locator('[data-upload-kind=audio]').click();
  await expect(page.locator('#music-status')).toContainText('无法确认');
  await page.reload(); await page.getByRole('tab',{name:'素材',exact:true}).click();
  await page.getByRole('button',{name:'查询并恢复',exact:true}).click();
  await expect(page.locator('#music-status')).toContainText('文件已验证');
  expect(puts).toBe(1); expect(reserves).toBe(1);
});
test('dirty editor guards filters and navigation; conflict does not overwrite newer version',async ({page}) => {
  await create(page); await page.locator('#track-title').fill('保留修改');
  await page.locator('#track-filter').selectOption('published'); await page.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.locator('#track-filter')).toHaveValue(''); await expect(page.locator('#track-title')).toHaveValue('保留修改');
  await page.locator('#save-reason').fill('冲突测试');
  await page.route('**/admin/api/music/tracks/*',route => route.request().method() === 'PATCH' ? route.fulfill({status:409,json:{ok:false,code:'MUSIC_EDIT_CONFLICT'}}) : route.continue());
  await page.locator('#track-save').click(); await expect(page.locator('#music-status')).toContainText('其他操作更新');
  await expect(page.locator('#track-save')).toBeDisabled(); await expect(page.locator('#track-title')).toHaveValue('保留修改');
});
test('different actor cannot replay a pending operation',async ({page}) => {
  let writes = 0; await create(page);
  await page.route('**/admin/api/music/status',async route => { const r = await route.fetch(), data = await r.json(); await route.fulfill({json:{...data,actorId:'different@example.test'}}); });
  page.on('request',r => { if (r.method() === 'PATCH') writes++; });
  await page.locator('#save-reason').fill('身份测试'); await page.locator('#track-save').click();
  await expect(page.locator('#music-status')).toContainText('账号已变化'); expect(writes).toBe(0);
});
test('keyboard tabs and desktop/mobile have no horizontal overflow; music service unavailable is fail closed',async ({page}) => {
  await create(page);
  await page.getByRole('tab',{name:'基本资料',exact:true}).focus();
  await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab',{name:'素材',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('End'); await expect(page.getByRole('tab',{name:'审核发布',exact:true})).toBeFocused();
  for (const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    for (const name of ['基本资料','素材','审核发布']) {
      await page.getByRole('tab',{name,exact:true}).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  for (const code of ['MUSIC_BINDINGS_UNAVAILABLE','MUSIC_NOT_CONFIGURED']) {
    await page.route('**/admin/api/music/status',route => route.fulfill({status:503,json:{ok:false,code}}));
    await page.reload(); await expect(page.locator('#track-new')).toBeDisabled();
    await expect(page.locator('#music-status')).toContainText('尚未配置');
    await page.unroute('**/admin/api/music/status');
  }
});
