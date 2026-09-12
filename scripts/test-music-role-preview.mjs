import assert from 'node:assert/strict';
import { test } from 'node:test';
import { musicRolePreview, createMusicRolePreviewReader } from '../src/scripts/musicRolePreview.js';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const policy = (mode = 'vip', after = null) => ({ accessMode:mode, policyVersion:1,
  earlyAccessUntil: mode === 'early_access' ? '2026-09-12T12:00:00.000Z' : null, postEarlyAccessMode:after });
function fixture(mode = 'vip', after = null) {
  const r = { id:id(2), state:'draft', number:2, policy:policy(mode,after),
    metadata:{ originalLocale:'en', title:{ en:'Quiet platform','zh-Hans':'安静的月台' }, summary:{ en:'A synthetic song' }, creatorName:'Fixture', story:'Test story' },
    assets:{ audio:id(4), preview:id(5), cover:null, lyrics:null } };
  return { id:id(1), editVersion:3, lifecycle:'published', serverNow:'2026-09-12T11:59:59.999Z', draft:r,
    published:{ ...structuredClone(r), id:id(3), state:'sealed', number:1, policy:policy('free') },
    assets:[{ id:id(4), kind:'audio', state:'validated', byteSize:10000, durationMs:120000 },
      { id:id(5), kind:'preview', state:'validated', byteSize:2000, durationMs:30000, derivedFromAssetId:id(4), sourceStartMs:10000, sourceEndMs:40000 }] };
}
const open = { public:true, vipDelivery:true };
const variants = view => view.roles.map(r => r.variant);
const project = (row, options = {}, flags = open) => musicRolePreview(row,flags,{ scenario:'released', ...options });

test('four roles reuse public full/preview semantics; ordinary and expired accounts are not VIP', () => {
  const result = project(fixture());
  assert.deepEqual(result.roles.map(r => r.role), ['visitor','account','vip','expired']);
  assert.deepEqual(variants(result), ['preview','preview','full','preview']);
  assert.deepEqual(result.roles.map(r => r.reason), ['LOGIN','VIP_REQUIRED','VIP_ACTIVE','EXPIRED']);
  assert.deepEqual(variants(project(fixture('free'))), Array(4).fill('full'));
  const noPreview = fixture(); noPreview.draft.assets.preview = null;
  assert.deepEqual(variants(project(noPreview)), [null,null,'full',null]);
});
test('current mode preserves publication and both actual gates; released is explicit UI fiction', () => {
  const row = fixture();
  assert.ok(project(row,{scenario:'current'}).roles.every(r => r.reason === 'NOT_PUBLISHED'));
  assert.deepEqual(variants(project(row,{scenario:'current',revision:'published'})), Array(4).fill('full'));
  for (const lifecycle of ['draft','unpublished','archived']) {
    row.lifecycle = lifecycle;
    assert.ok(project(row,{scenario:'current',revision:'published'}).roles.every(r => r.reason === 'NOT_PUBLISHED'));
  }
  row.lifecycle = 'published'; row.published.policy = policy();
  const closed = project(row,{scenario:'current',revision:'published'}, { public:false, vipDelivery:true });
  assert.ok(closed.roles.every(r => r.reason === 'PUBLIC_DISABLED' && r.variant === null));
  const noVip = project(row,{scenario:'current',revision:'published'},{ public:true, vipDelivery:false });
  assert.deepEqual(variants(noVip), Array(4).fill('preview'));
  assert.ok(noVip.roles.every(r => r.reason === 'VIP_DISABLED'));
  assert.equal(project(row,{}, { public:false,vipDelivery:false }).simulated,true);
});
test('server snapshot clock and exact early-access boundary, including post-VIP', () => {
  const row = fixture('early_access','free');
  assert.equal(project(row).policy.effectiveAccess,'vip');
  assert.equal(project(row,{at:'boundary'}).policy.effectiveAccess,'free');
  row.serverNow = row.draft.policy.earlyAccessUntil;
  assert.deepEqual(variants(project(row)),Array(4).fill('full'));
  row.draft.policy.postEarlyAccessMode = 'vip';
  assert.equal(project(row,{at:'boundary'}).policy.effectiveAccess,'vip');
  assert.throws(() => project(fixture(),{at:'boundary'}));
});
test('saved revisions are independent; locales fall back to original and projection drops private data', () => {
  const row = fixture(); row.draft.metadata.title.en = '<img src=x onerror=alert(1)>';
  row.draft.metadata.cookie = 'private-cookie'; row.rights = { secret:'private-rights' };
  row.assets[0].objectKey = 'private-key'; row.assets[0].sha256 = 'private-hash';
  const before = structuredClone(row), draft = project(row,{locale:'ja'}), published = project(row,{revision:'published',locale:'en'});
  assert.equal(draft.title,'<img src=x onerror=alert(1)>'); // Rendered with textContent, never HTML.
  assert.equal(published.title,'Quiet platform');
  assert.equal(draft.summary,'A synthetic song');
  assert.equal(project(row,{locale:'zh-Hans'}).title,'安静的月台');
  assert.doesNotMatch(JSON.stringify(draft),/private-|objectKey|sha256|Cookie|canPlay|\/audio|\/assets/);
  assert.deepEqual(row,before);
});
test('missing audio is not a playable release, invalid saved metadata fails closed', () => {
  const row = fixture(); row.draft.assets.audio = row.draft.assets.preview = null;
  assert.ok(project(row).roles.every(r => r.reason === 'AUDIO_MISSING' && r.variant === null));
  for (const change of [r => r.serverNow = 'bad',r => r.draft.policy = null,r => r.draft.policy.accessMode = 'unknown',
    r => r.assets[1].derivedFromAssetId = id(9),r => r.assets[1].sourceEndMs = 90000,r => r.assets[1].durationMs = 90000,
    r => r.assets[0].state = 'reserved',r => r.assets.push(r.assets[0]),r => r.draft.assets.cover = id(10),
    r => r.draft.metadata.originalLocale = 'xx',r => r.draft.metadata.title.en = '']) {
    const bad = fixture(); change(bad); assert.throws(() => project(bad));
  }
  assert.throws(() => project(fixture(),{scenario:'bypass'}));
  assert.throws(() => project(fixture(),{locale:'xx'}));
  assert.throws(() => project(fixture(),{},{}));
  row.draft = null; assert.throws(() => project(row),/NO_REVISION/);
});
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
test('fresh reader uses only existing admin GETs and rejects identity changes before reading content', async () => {
  const changes = [], calls = [];
  const reader = createMusicRolePreviewReader({ actorId:() => 'owner', onChange:s => changes.push(s),
    request:async path => { calls.push(path); return path === '/status' ? {actorId:'other',flags:open} : fixture(); } });
  await reader.read(id(1));
  assert.deepEqual(calls,['/status']); assert.equal(changes.at(-1).state,'error');
  assert.equal(changes.at(-1).message,'ROLE_PREVIEW_ACTOR_CHANGED');
});
test('switching tracks, leaving tab or newer refresh invalidates late responses and late errors', async () => {
  const pending = [], changes = [];
  const reader = createMusicRolePreviewReader({ actorId:() => 'owner', onChange:s => changes.push(s), request:path => {
    if (path === '/status') return Promise.resolve({actorId:'owner',flags:open});
    const job = deferred(); pending.push(job); return job.promise;
  } });
  const a = reader.read(id(1)); await Promise.resolve();
  const b = reader.read(id(1)); await Promise.resolve();
  pending[1].resolve(fixture()); await b; assert.equal(changes.at(-1).state,'ready');
  pending[0].reject(new Error('late error')); await a; assert.equal(changes.at(-1).state,'ready');
  const c = reader.read(id(1)); await Promise.resolve(); reader.clear();
  pending[2].resolve(fixture()); await c; assert.equal(changes.at(-1).state,'empty');
});
test('failed refresh clears prior view; invalid target or response is not accepted', async () => {
  const changes = []; let mode = 'ok';
  const reader = createMusicRolePreviewReader({ actorId:() => 'owner',onChange:s => changes.push(s),request:async path => {
    if (mode === 'fail') throw Object.assign(new Error('login expired'),{status:401});
    if (path === '/status') return {actorId:'owner',flags:open};
    return {...fixture(), id:mode === 'other' ? id(9) : id(1)};
  } });
  await reader.read(id(1)); assert.equal(changes.at(-1).state,'ready');
  mode = 'fail'; await reader.read(id(1));
  assert.equal(changes.at(-2).state,'loading'); assert.equal(changes.at(-1).denied,true); assert.equal(changes.at(-1).row,undefined);
  mode = 'other'; await reader.read(id(1)); assert.equal(changes.at(-1).state,'error');
  await reader.read('https://evil.example/'); assert.equal(changes.at(-1).state,'error');
});
