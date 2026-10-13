import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { AdminNode, adminScriptFixture } from './helpers/station-admin-dom.mjs';
import { fixtureId } from './helpers/station-redesign-database.mjs';
import { resolveAdminOwner } from '../src/scripts/stationWorkbenchState.js';

const first = fixtureId(901), target = fixtureId(902), other = fixtureId(903), asset = fixtureId(904);
const missing = () => Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND', status: 404 });
const object = (id, type = 'tracks', title = '目标作品', editVersion = 1) => ({ id, type, title, status: 'published', editVersion, jobs: [], revisions: [],
  draft: { revision: editVersion, data: { metadata: { originalLocale: 'zh-Hans', title: { 'zh-Hans': title }, creatorName: 'Station Cat' }, siteAudioMode: 'none' } }, published: null });
function contentApi({ type = 'tracks', targetExists = true } = {}) {
  const calls = []; let version = 1, title = '目标作品', uncertain = false;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options }); const url = new URL(path, 'http://fixture.test');
    if (path === '/status') return { actorId: 'test@example.test', role: 'publisher' };
    const detail = /^\/(tracks|games|clips)\/([^/]+)$/.exec(url.pathname);
    if (detail) {
      if (detail[1] !== type || detail[2] !== target || !targetExists) throw missing();
      if (options.method === 'PATCH') {
        if (uncertain) throw Object.assign(new Error('receipt lost'), { uncertain: true });
        if (options.etag !== '"edit-' + version + '"') throw Object.assign(new Error('STATION_EDIT_CONFLICT'), { code: 'STATION_EDIT_CONFLICT', status: 409 });
        version++; title = options.body.data.metadata.title['zh-Hans']; return { id: target };
      }
      return object(target, type, title, version);
    }
    if (['/tracks', '/games', '/clips'].includes(url.pathname)) return { items: url.pathname === '/tracks' ? [{ id: first, type: 'tracks', title: '首批另一首歌', status: 'published' }] : [], nextBefore: null };
    if (url.pathname === '/assets') return { items: [{ id: asset, kind: type === 'games' ? 'game_screenshot' : type === 'clips' ? 'poster' : 'cover', state: 'validated', rightsStatus: 'pending', basis: '合成夹具', rightsVersion: 1 }], nextBefore: null };
    throw new Error('Unexpected fixture request: ' + path);
  };
  return { calls, request, update() { version = 2; title = '另一标签页保存的版本'; }, uncertain() { uncertain = true; } };
}

for (const type of ['tracks', 'games', 'clips']) test('asset deep-link resolves a ' + type + ' owner outside the first candidate page', async () => {
  const api = contentApi({ type }), f = await adminScriptFixture('adminStationContent.js', { search: '?view=assets&owner=' + target, request: api.request });
  assert(f.state().current, f.node('content-status').textContent);
  assert.equal(f.state().current.id, target);
  assert.equal(f.node('content-rights-editor').hidden, false);
  assert.equal(f.node('content-rights-editor').children[0].children[0].value, target);
  assert.equal(f.node('content-editor-heading').textContent, '目标作品');
  const inventories = api.calls.filter(call => call.path.startsWith('/assets?'));
  assert.equal(inventories.length, 1); assert.equal(new URL(inventories[0].path, 'http://fixture.test').searchParams.get('ownerId'), target);
  assert(!api.calls.some(call => call.path.includes('ownerId=' + first)));
});
test('missing, malformed or duplicated explicit owners show an error without another rights editor or asset read', async () => {
  for (const search of ['?view=assets&owner=' + target, '?view=assets&owner=bad', '?view=assets&owner=' + target + '&owner=' + other]) {
    const api = contentApi({ targetExists: false }), f = await adminScriptFixture('adminStationContent.js', { search, request: api.request });
    assert.equal(f.state().current, null); assert.equal(f.node('content-rights-editor').hidden, true);
    assert.equal(f.node('content-status').dataset.error, 'true'); assert(!f.node('content-status').textContent.includes('服务已就绪'));
    assert(!api.calls.some(call => call.path.startsWith('/assets?')));
  }
});
test('owner lookup never treats Access failure or mismatched/ambiguous detail identity as not found', async () => {
  await assert.rejects(resolveAdminOwner(async () => { throw Object.assign(new Error('ADMIN_AUTH_REQUIRED'), { code: 'ADMIN_AUTH_REQUIRED', status: 401 }); }, target), { code: 'ADMIN_AUTH_REQUIRED' });
  await assert.rejects(resolveAdminOwner(async path => object(first, path.split('/')[1]), target), /读取结果不一致/);
  await assert.rejects(resolveAdminOwner(async path => object(target, path.split('/')[1]), target), /多份资料/);
});
test('unregistered native track assets remain reachable by an exact bounded catalog match', async () => {
  const calls = [], result = await resolveAdminOwner(async path => {
    calls.push(path); if (/\/(tracks|games|clips)\//.test(path)) throw missing();
    return path === '/tracks' ? { items: [{ id: first, status: 'unregistered' }], nextBefore: 20 } : { items: [{ id: target, title: '尚未登记的歌曲', status: 'unregistered' }], nextBefore: null };
  }, target);
  assert.equal(result.id, target); assert.equal(result.type, 'tracks'); assert(calls.includes('/tracks?before=20'));
});

test('the primary platform destination selects a later-page song and submits links only for that song', async () => {
  const api = contentApi(), reads = [], writes = [];
  const request = async (path, options = {}) => {
    if (path.startsWith('/platforms')) {
      if (options.method) { writes.push(options.body); return { id: asset }; }
      reads.push(new URL(path, 'http://fixture.test').searchParams.get('trackId')); return { items: [] };
    }
    return api.request(path, options);
  };
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=platforms&owner=' + target, request });
  assert.equal(f.node('work-heading').textContent, '发行平台');
  assert.equal(f.nav.find(n => n.dataset.adminNav === 'platforms').attributes.get('aria-current'), 'page');
  assert.equal(f.nav.find(n => n.dataset.adminNav === 'content').attributes.has('aria-current'), false);
  assert.equal(f.node('content-platform-editor').hidden, false); assert.equal(f.node('content-editor-heading').textContent, '目标作品');
  const form = f.node('content-platform-editor').children.find(n => n.tagName === 'FORM');
  const field = name => form.children.find(n => n.tagName === 'LABEL' && n.textContent === name).children[0];
  field('真实作品网址').value = 'https://music.163.com/#/song?id=3438977672'; field('发行状态').value = 'live';
  field('人工核对时间（新加坡 UTC+8）').value = '2026-10-12T10:00';
  await form.fire('submit'); await f.idle();
  assert.deepEqual(reads, [target, target]); assert.equal(writes.length, 1); assert.equal(writes[0].trackId, target);
  assert.equal(writes[0].url, 'https://music.163.com/#/song?id=3438977672'); assert.equal(writes[0].status, 'live');
  assert.equal(writes[0].verifiedAt, Date.parse('2026-10-12T10:00+08:00')); assert.equal(f.state().pending, null);
});
test('the visible song shortcut carries the current owner and blocks navigation while edits are unsaved', async () => {
  const api = contentApi(), f = await adminScriptFixture('adminStationContent.js', { search: '?view=tracks&owner=' + target, request: api.request });
  assert.equal(f.node('work-platform-section').hidden, false);
  assert.equal(f.node('work-platform-link').href, '/admin-v2/?view=platforms&owner=' + target);
  let prevented = false;
  await f.node('work-platform-link').fire('click', { preventDefault() { prevented = true; } }); assert.equal(prevented, false);
  f.node('content-title').value = '尚未保存的标题'; await f.node('content-form').fire('input', { target: f.node('content-title') });
  const calls = api.calls.length;
  await f.node('work-platform-link').fire('click', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.node('content-title').value, '尚未保存的标题'); assert.equal(api.calls.length, calls);
  assert.match(f.node('content-status').textContent, /请先保存草稿/);
  const game = contentApi({ type: 'games' }), gameUi = await adminScriptFixture('adminStationContent.js', { search: '?view=games&owner=' + target, request: game.request });
  assert.equal(gameUi.node('work-platform-section').hidden, true);
});
test('a missing explicit platform owner never opens or reads another song\'s platform editor', async () => {
  const api = contentApi({ targetExists: false });
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=platforms&owner=' + target, request: api.request });
  assert.equal(f.state().current, null); assert.equal(f.node('content-platform-editor').hidden, true);
  assert.equal(f.node('content-status').dataset.error, 'true'); assert(!api.calls.some(call => call.path.startsWith('/platforms')));
});

test('opening the new menu before editing cannot bypass dirty protection at the actual type button', async () => {
  const api = contentApi(), f = await adminScriptFixture('adminStationContent.js', { search: '?view=tracks&owner=' + target, request: api.request });
  await f.node('content-new').click(); assert.equal(f.node('work-new-menu').hidden, false);
  f.node('content-title').value = '尚未保存的标题'; await f.node('content-title').fire('input'); await f.node('content-form').fire('input', { target: f.node('content-title') });
  const resets = f.node('content-form').resetCount, requests = api.calls.length;
  await f.creates.find(node => node.dataset.workCreate === 'games').click(); await f.idle();
  assert.equal(f.state().current.id, target); assert.equal(f.state().module, 'tracks'); assert.equal(f.state().dirty, true);
  assert.equal(f.node('content-title').value, '尚未保存的标题'); assert.equal(f.node('content-form').resetCount, resets); assert.equal(api.calls.length, requests);
  assert.match(f.node('content-status').textContent, /未保存/);
});

test('revision conflict can be cancelled or explicitly discarded, reloading the same work and permitting a current-version save', async () => {
  const api = contentApi();
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=tracks&owner=' + target, request: api.request });
  api.update(); f.node('content-title').value = '当前本机修改'; await f.node('content-form').fire('input', { target: f.node('content-title') });
  await f.node('content-form').fire('submit'); await f.idle();
  assert.equal(f.state().dirty, true); assert.equal(f.state().current.editVersion, 1); assert.equal(f.state().pending, null);
  assert.match(f.node('content-status').textContent, /版本已变化/);
  const calls = api.calls.length; await f.node('content-reload').click(); await f.idle();
  assert.equal(f.node('content-reload-confirm').hidden, false); assert.equal(f.node('content-reload-cancel').focused, true);
  await f.node('content-reload-cancel').click(); assert.equal(f.node('content-reload-confirm').hidden, true);
  assert.equal(api.calls.length, calls); assert.equal(f.state().dirty, true); assert.equal(f.node('content-title').value, '当前本机修改');
  await f.node('content-reload').click(); await f.node('content-reload-discard').click(); await f.idle();
  assert.equal(f.state().dirty, false); assert.equal(f.state().current.id, target); assert.equal(f.state().current.editVersion, 2);
  assert.equal(f.node('content-title').value, '另一标签页保存的版本'); assert.equal(f.node('content-reload-confirm').hidden, true);
  f.node('content-title').value = '核对后重新保存'; await f.node('content-form').fire('input', { target: f.node('content-title') });
  await f.node('content-form').fire('submit'); await f.idle();
  assert.equal(f.state().current.editVersion, 3); assert.equal(f.state().dirty, false);
  assert.equal(api.calls.filter(call => call.method === 'PATCH').at(-1).etag, '"edit-2"');
  assert(api.calls.filter(call => call.method === 'PATCH').every(call => !Object.hasOwn(call.body, 'reason')));
});
test('the rights editor submits its real authorization basis without a separate operation-note field', async () => {
  const api = contentApi(), writes = [];
  const request = async (path, options = {}) => {
    if (options.method === 'PUT') { writes.push({ path, ...options }); return { id: asset }; }
    return api.request(path, options);
  };
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=assets&owner=' + target, request });
  const form = f.node('content-rights-editor').children.at(-1).children[0];
  const fields = form.children.filter(node => node.tagName === 'LABEL');
  assert.deepEqual(fields.map(node => node.textContent), ['使用状态', '授权依据与允许的使用范围（单行）']);
  fields[0].children[0].value = 'approved'; fields[1].children[0].value = '夹具授权依据';
  await form.fire('submit'); await f.idle();
  assert.equal(writes.length, 1); assert.equal(writes[0].path, '/assets/' + asset + '/rights');
  assert.equal(writes[0].body.basis, '夹具授权依据'); assert.equal(Object.hasOwn(writes[0].body, 'reason'), false);
  assert.match(f.node('content-status').textContent, /权利登记已保存/);
});
for (const failure of ['network', 'unavailable']) test('workspace retry establishes the first identity after initial status ' + failure, async () => {
  const api = contentApi(), calls = []; let available = false;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (path === '/status' && !available) throw failure === 'network'
      ? Object.assign(new Error('network unavailable'), { uncertain: true })
      : Object.assign(new Error('STATION_CONTENT_UNAVAILABLE'), { code: 'STATION_CONTENT_UNAVAILABLE', status: 503, uncertain: true });
    return api.request(path, options);
  };
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=tracks&owner=' + target, request });
  assert.equal(f.state().current, null); assert.equal(f.node('content-fields').disabled, true);
  assert.equal(f.node('content-status').dataset.error, 'true'); assert.equal(f.node('content-reload').disabled, false);
  assert.equal(f.storageData.size, 0); assert.deepEqual(calls.map(c => c.path), ['/status']);
  // A failed retry must stay recoverable without navigating away or reloading.
  await f.node('content-reload').click(); await f.idle();
  assert.equal(f.state().current, null); assert.equal(f.node('content-fields').disabled, true);
  assert.equal(f.node('content-reload').disabled, false); assert.deepEqual(calls.map(c => c.path), ['/status', '/status']);
  available = true; await f.node('content-reload').click(); await f.idle();
  assert.equal(calls.filter(c => c.path === '/status').length, 3);
  assert(calls.some(c => c.path === '/tracks/' + target)); assert(calls.some(c => c.path.startsWith('/assets?ownerId=' + target)));
  assert.equal(f.state().current.id, target); assert.equal(f.state().dirty, false);
  assert.equal(f.node('content-title').value, '目标作品'); assert.equal(f.node('content-fields').disabled, false);
  assert.equal(f.node('content-status').dataset.error, 'false'); assert.match(f.node('content-status').textContent, /服务已就绪/);
  assert.equal(f.node('content-reload-confirm').hidden, true); assert.equal(f.node('content-reload').focused, true);
  assert.equal(f.storageData.size, 1); assert.equal(f.state().pending, null); assert(calls.every(c => !c.method || c.method === 'GET'));
});
test('connected workspace reload still rejects a changed actor before discarding local edits or reading content', async () => {
  const api = contentApi(), calls = []; let actor = 'test@example.test';
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    return path === '/status' ? { actorId: actor, role: 'publisher' } : api.request(path, options);
  };
  const f = await adminScriptFixture('adminStationContent.js', { search: '?view=tracks&owner=' + target, request });
  f.node('content-title').value = '原管理员的未保存修改'; await f.node('content-form').fire('input', { target: f.node('content-title') });
  const previousCalls = calls.length, previousJournal = [...f.storageData];
  actor = 'other@example.test'; await f.node('content-reload').click(); await f.node('content-reload-discard').click(); await f.idle();
  assert.deepEqual(calls.slice(previousCalls).map(c => c.path), ['/status']);
  assert.equal(f.state().current.id, target); assert.equal(f.state().dirty, true);
  assert.equal(f.node('content-title').value, '原管理员的未保存修改'); assert.equal(f.node('content-status').dataset.error, 'true');
  assert.equal(f.node('content-reload-confirm').hidden, false); assert.deepEqual([...f.storageData], previousJournal);
  actor = 'test@example.test'; await f.node('content-reload-discard').click(); await f.idle();
  assert.equal(f.state().dirty, false); assert.equal(f.node('content-title').value, '目标作品');
  assert.equal(f.node('content-status').dataset.error, 'false'); assert.equal(f.node('content-reload-confirm').hidden, true);
});
test('uncertain writes keep their original journal and cannot be discarded through reload', async () => {
  const api = contentApi(), f = await adminScriptFixture('adminStationContent.js', { search: '?view=tracks&owner=' + target, request: api.request });
  api.uncertain(); await f.node('content-form').fire('input', { target: f.node('content-title') });
  await f.node('content-form').fire('submit'); await f.idle();
  const pending = JSON.stringify(f.state().pending), calls = api.calls.length;
  assert.notEqual(pending, 'null'); assert.equal(f.node('content-reload').disabled, true);
  await f.node('content-reload').fire('click'); await f.idle();
  assert.equal(api.calls.length, calls); assert.equal(JSON.stringify(f.state().pending), pending); assert.equal(f.node('content-reload-confirm').hidden, true);
});

function mediaApi() {
  const uploads = [], calls = [];
  const uploader = { busy: () => false, pending: () => null, jobs: () => [], async start(command) { uploads.push(command); return { stage: 'completed' }; } };
  const request = async path => {
    calls.push(path); const url = new URL(path, 'http://fixture.test');
    if (url.pathname === '/site-uploads/status') return { enabled: true, actorId: 'test@example.test', storage: { chargedBytes: 0, quotaBytes: 100000 } };
    if (url.pathname === '/site-uploads') return { items: [], nextCursor: null };
    if (url.pathname === '/site-uploads/owners') return url.searchParams.has('cursor') ? { items: [{ id: other, title: '下一页游戏 C' }], nextCursor: null } : { items: [{ id: first, title: '游戏 A' }, { id: target, title: '游戏 B' }], nextCursor: 'next' };
    throw new Error('Unexpected media fixture request: ' + path);
  };
  return { uploads, calls, uploader, request };
}
test('media pagination and refresh preserve a manual owner; submit uploads to that owner', async () => {
  const api = mediaApi(), f = await adminScriptFixture('adminStationMedia.js', { search: '?kind=game_screenshot&owner=' + first, request: api.request, mediaUploader: api.uploader });
  assert.equal(f.node('media-owner').value, first);
  f.node('media-owner').value = target; await f.node('media-owner').fire('change');
  await f.node('media-more-owners').click(); await f.idle(); assert.equal(f.node('media-owner').value, target);
  await f.node('media-reload').click(); await f.idle(); assert.equal(f.node('media-owner').value, target);
  f.node('media-file').files = [{ name: 'synthetic.webp', size: 100 }]; await f.node('media-form').fire('submit'); await f.idle();
  assert.equal(api.uploads.length, 1); assert.equal(api.uploads[0].ownerId, target); assert.equal(f.node('media-owner').value, target);
});
test('a deep-link owner on a later page stays blank until found, and an intervening manual selection wins', async () => {
  for (const manual of [false, true]) {
    const api = mediaApi(), f = await adminScriptFixture('adminStationMedia.js', { search: '?kind=game_screenshot&owner=' + other, request: api.request, mediaUploader: api.uploader });
    assert.equal(f.node('media-owner').value, ''); assert.equal(f.node('media-start').disabled, true);
    if (manual) { f.node('media-owner').value = target; await f.node('media-owner').fire('change'); }
    await f.node('media-more-owners').click(); await f.idle(); assert.equal(f.node('media-owner').value, manual ? target : other);
  }
});
test('explicitly clearing the media owner is not undone by the next page', async () => {
  const api = mediaApi(), f = await adminScriptFixture('adminStationMedia.js', { search: '?kind=game_screenshot&owner=' + first, request: api.request, mediaUploader: api.uploader });
  f.node('media-owner').value = ''; await f.node('media-owner').fire('change'); await f.node('media-more-owners').click(); await f.idle();
  assert.equal(f.node('media-owner').value, ''); assert.equal(f.node('media-start').disabled, true);
});

test('real service tab clicks/keyboard synchronize hash so the same sidebar destination works in both directions', async () => {
  const source = await readFile(new URL('../src/pages/admin-v2/services/index.astro', import.meta.url), 'utf8');
  const start = source.indexOf('    const serviceTabs ='), end = source.indexOf("    elements.contentForm.addEventListener('submit', saveContent);", start);
  assert(start > 0 && end > start);
  const window = new AdminNode(), location = { hash: '#accounts' }, state = { keep: 'existing-history' }, changes = [], loaded = [];
  const names = ['accounts', 'commerce', 'game-commerce', 'access', 'audit'], tabs = names.map(name => { const n = new AdminNode('button', { adminV2Tab: name }); n.classList = { toggle() {} }; return n; });
  const panels = names.map(name => new AdminNode('section', { adminV2Panel: name + '-list' }));
  const headingNodes = new Map();
  const context = vm.createContext({ setStatus() {}, $: id => { if (!headingNodes.has(id)) headingNodes.set(id, new AdminNode()); return headingNodes.get(id); }, runServiceAction: action => action(), window, location, history: { state, replaceState(value, _, hash) { assert.equal(value, state); location.hash = hash; changes.push(hash); } }, elements: { tabs, panels }, document: { querySelectorAll: () => [] },
    loadAccounts: async () => loaded.push('accounts'), loadOrders: async () => loaded.push('commerce'), loadGameCommerce: async () => loaded.push('game-commerce'), loadEntitlements: async () => loaded.push('access'), loadAuditLogs: async () => loaded.push('audit') });
  vm.runInContext(source.slice(start, end) + "\nwindow.addEventListener('hashchange', () => { void switchTab(location.hash.slice(1)); });", context);
  await vm.runInContext("switchTab('accounts')", context);
  await tabs[1].fire('click'); assert.equal(location.hash, '#commerce'); assert.equal(panels[1].hidden, false);
  location.hash = '#accounts'; await window.fire('hashchange'); assert.equal(panels[0].hidden, false);
  await tabs[0].fire('keydown', { key: 'ArrowRight' }); assert.equal(location.hash, '#commerce'); assert.equal(tabs[1].focused, true);
  location.hash = '#accounts'; await window.fire('hashchange'); assert.equal(panels[0].hidden, false);
  await tabs[0].fire('click'); location.hash = '#commerce'; await window.fire('hashchange'); assert.equal(panels[1].hidden, false);
  const count = loaded.length; await vm.runInContext("switchTab('content')", context); assert.equal(loaded.length, count); assert.equal(location.hash, '#commerce');
  assert.deepEqual(changes, ['#commerce', '#commerce']); assert.deepEqual(loaded, ['accounts', 'commerce', 'accounts', 'commerce', 'accounts', 'accounts', 'commerce']);
});
