import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { catLifeSaveHarness } from './helpers/cat-life-save-harness.mjs';
const base = 'catGameSaveV1';
const sample = () => JSON.stringify(catLifeSaveHarness().game.state.game);
const statuses = { corrupt: '{broken', unsupported: JSON.stringify({ schemaVersion: 4 }), missing: null, valid: sample() };
for (const [status, raw] of Object.entries(statuses)) test(`read-only classifier: ${status}`, () => {
  const h = catLifeSaveHarness({ initial: raw === null ? {} : { [base]: raw } });
  assert.equal(h.context.CatGameSaveStatus.inspect(h.storage, base).status, status); assert.equal(h.writes.length, 0);
});
test('empty strings, empty objects, null, arrays, incomplete state and malformed cats are corrupt, never missing', () => {
  const h = catLifeSaveHarness();
  for (const raw of ['', '{}', 'null', '[]', '{"player":{"gold":200}}', JSON.stringify({ ...JSON.parse(sample()), cats: [null] }), JSON.stringify({ ...JSON.parse(sample()), cats: [] })]) assert.equal(h.context.CatGameSaveStatus.inspectRaw(raw).status, 'corrupt');
});
test('unavailable storage is distinct from missing and cannot be created', () => {
  const h = catLifeSaveHarness({ deniedRead: true }); assert.equal(h.game.state.saveSystem.inspect().status, 'unavailable');
  assert.throws(() => h.game.state.saveSystem.loadOrCreateGame(), error => error.saveStatus === 'unavailable'); assert.equal(h.writes.length, 0);
});
test('legacy schema 0, 1 and 2 are detected without writes and migrate real progress only when loaded', () => {
  for (const schema of [0, 1, 2]) {
    const data = JSON.parse(sample()); data.schemaVersion = schema; data.player.gold = 91;
    if (!schema) { data.player.coins = 91; delete data.player.gold; }
    const raw = JSON.stringify(data), h = catLifeSaveHarness({ initial: { [base]: raw } });
    assert.equal(h.game.state.saveSystem.inspect().status, 'valid'); assert.equal(h.game.state.saveSystem.loadGame().player.gold, 91);
    assert.equal(h.values.get(base), raw); assert.equal(h.writes.length, 0);
  }
});
test('legacy empty cat arrays retain currency and volume through the established repair migration', () => {
  for (const schema of [0, 1, 2]) {
    const data = JSON.parse(sample()); data.schemaVersion = schema; data.cats = []; data.player.gold = 42;
    if (!schema) { data.player.coins = 42; delete data.player.gold; }
    if (schema < 2) { delete data.settings.bgmVolume; delete data.settings.sfxVolume; data.settings.musicVolume = 55; }
    const raw = JSON.stringify(data), h = catLifeSaveHarness({ initial: { [base]: raw } }), s = h.game.state.saveSystem;
    assert.equal(s.inspect().status, 'valid'); h.game.state.game = s.loadGame();
    assert.equal(h.game.state.game.player.gold, 42); assert.ok(h.game.state.game.cats.length);
    if (schema < 2) { assert.equal(h.game.state.game.settings.bgmVolume, 55); assert.equal(h.game.state.game.settings.sfxVolume, 55); }
    assert.equal(h.values.get(base), raw); assert.equal(h.writes.length, 0);
    s.saveGame(); assert.equal(JSON.parse(h.values.get(base)).player.gold, 42); assert.equal(s.inspect().status, 'valid');
  }
});
for (const status of ['corrupt', 'unsupported']) test(`${status} is preserved through load, create, save, autosave and rejected import`, () => {
  const raw = statuses[status], h = catLifeSaveHarness({ initial: { [base]: raw } }), s = h.game.state.saveSystem;
  for (const action of [() => s.loadGame(), () => s.loadOrCreateGame(), () => s.createAndSaveGame(), () => s.saveGame(), () => s.autoSave()]) assert.throws(action, error => error.saveStatus === status);
  assert.throws(() => s.importText('{}')); assert.equal(s.getStorageKey(), base); assert.equal(h.values.get(base), raw); assert.equal(h.writes.length, 0);
});
test('fresh game writes only a missing slot and a quota error does not report a successful save', () => {
  const h = catLifeSaveHarness(), s = h.game.state.saveSystem;
  assert.equal(s.loadOrCreateGame().player.gold, 200); assert.equal(h.writes.length, 1);
  h.setDeniedWrite(true); const before = h.values.get(base); assert.throws(() => s.saveGame(), error => error.saveStatus === 'unavailable'); assert.equal(h.values.get(base), before);
});
test('valid slot changed by another tab is not overwritten, including another compatible save', () => {
  const h = catLifeSaveHarness({ initial: { [base]: sample() } }), s = h.game.state.saveSystem;
  h.game.state.game = s.loadGame(); const other = JSON.parse(sample()); other.player.gold = 923; const raw = JSON.stringify(other); h.values.set(base, raw);
  assert.throws(() => s.saveGame(), error => error.saveStatus === 'changed'); assert.equal(h.values.get(base), raw); assert.equal(h.writes.length, 0);
});
test('explicit recovery backs up exact damaged bytes then imports compatible progress', () => {
  const raw = ' {broken\n ', h = catLifeSaveHarness({ initial: { [base]: raw } }), s = h.game.state.saveSystem;
  assert.throws(() => s.loadGame()); const restored = s.importText(sample()); assert.equal(restored.schemaVersion, 3);
  const backup = [...h.values].find(([key]) => key.startsWith(base + ':recovery:')); assert.equal(backup[1], raw);
  assert.equal(s.inspect().status, 'valid'); s.saveGame();
});
test('backup denial, backup verification failure and target race all refuse replacement', () => {
  for (const mode of ['deny', 'verify', 'race']) {
    const raw = '{broken', h = catLifeSaveHarness({ initial: { [base]: raw }, deniedWrite: mode === 'deny' }), s = h.game.state.saveSystem;
    if (mode !== 'deny') { const write = h.storage.setItem; h.storage.setItem = (key, value) => { write(key, value); if (key.includes(':recovery:')) { if (mode === 'verify') h.values.set(key, 'truncated'); else h.values.set(base, 'other-tab'); } }; }
    assert.throws(() => s.importText(sample())); assert.equal(h.values.get(base), mode === 'race' ? 'other-tab' : raw);
  }
});
test('guest claim and account slot selection are read-only and never use a cached ID as authentication', async () => {
  const h = catLifeSaveHarness({ initial: { [base]: sample() }, cachedMember: 'other' }), p = h.context.CatGameSaveStatus;
  const identity = await p.session(async () => ({ ok: true, json: async () => ({ ok: true, authenticated: true, account: { id: 7 } }) }));
  assert.equal(identity.key, base + ':member:7'); assert.equal(p.select(h.storage, identity).key, base);
  h.values.set('catGameGuestSaveClaimV1', '8'); assert.equal(p.select(h.storage, identity).key, identity.key);
  h.values.set(identity.key, '{broken'); assert.equal(p.select(h.storage, identity).key, identity.key); assert.equal(h.writes.length, 0);
  await assert.rejects(p.session(async () => ({ ok: true, json: async () => ({ ok: true, authenticated: true, account: { id: '../invalid' } }) })));
});
for (const [name, options, expected] of [
  ['corrupt guest', { initial: { [base]: '{broken' } }, 'corrupt'],
  ['future guest', { initial: { [base]: '{"schemaVersion":4}' } }, 'unsupported'],
  ['unreadable storage', { deniedRead: true }, 'unavailable'],
  ['corrupt member', { initial: { [base + ':member:7']: '{broken' }, session: { ok: true, authenticated: true, account: { id: 7 } }, entry: true }, 'corrupt'],
  ['unknown session', { session: { ok: false }, entry: true }, 'identity']
]) test(`actual main startup and lifecycle retain ${name}`, async () => {
  const h = catLifeSaveHarness({ ...options, main: true }); await h.fire('DOMContentLoaded');
  assert.equal(h.walls.at(-1), expected); assert.equal(h.writes.length, 0); assert.equal(h.timers.length, 0);
  await h.fire('beforeunload'); await h.fire('pagehide'); await h.fire('focus'); for (const tick of h.timers) tick(); assert.equal(h.writes.length, 0);
});
test('actual account activation refuses corrupt destination and never copies member A to missing member B', () => {
  const h = catLifeSaveHarness({ main: true, initial: { [base + ':member:1']: sample(), [base + ':member:3']: '{broken' } }), s = h.game.state.saveSystem;
  s.setStorageKey(base + ':member:1'); h.game.state.game = s.loadGame(); h.game.state.game.player.gold = 889;
  // Replace rendering-only systems for this VM test; actual normalization and slot writes remain loaded.
  h.game.systems.homeSystem.recalculateComfort = () => {}; h.game.systems.workSystem.refreshJobUnlocks = () => {}; h.game.systems.taskSystem.refreshAllTasks = () => {};
  // A blocked destination is checked before rendering or cloud data can overwrite it.
  assert.throws(() => h.context.CatGameApp.activateMemberStorage(3, { allowGuestImport: true, remoteSave: { data: JSON.parse(sample()) } }));
  assert.equal(h.values.get(base + ':member:3'), '{broken');
  s.setStorageKey(base + ':member:1'); h.game.state.game = s.loadGame();
  const result = h.context.CatGameApp.activateMemberStorage(2, { allowGuestImport: true });
  assert.equal(result.source, 'fresh'); assert.equal(result.game.player.gold, 200); assert.equal(JSON.parse(h.values.get(base + ':member:1')).player.gold, 200);
});
test('existing duplicate cat identities use the established repair migration without rewriting during detection', () => {
  const data = JSON.parse(sample()); data.cats.push({ ...data.cats[0], name: 'Other kitten' });
  const raw = JSON.stringify(data), h = catLifeSaveHarness({ initial: { [base]: raw } });
  assert.equal(h.game.state.saveSystem.inspect().status, 'valid'); const loaded = h.game.state.saveSystem.loadGame();
  assert.equal(loaded.cats.filter(cat => cat.name === 'Other kitten').length, 1); assert.equal(h.values.get(base), raw); assert.equal(h.writes.length, 0);
});
test('explicit restore refuses an already-observed target changed before file selection completes', () => {
  const h = catLifeSaveHarness({ initial: { [base]: '{broken' } }), s = h.game.state.saveSystem;
  assert.throws(() => s.loadGame()); const other = sample(); h.values.set(base, other);
  assert.throws(() => s.importText(sample()), error => error.saveStatus === 'changed'); assert.equal(h.values.get(base), other); assert.equal(h.writes.length, 0);
});
test('original export Blob contains exact input bytes and causes no save writes', async () => {
  const raw = ' {broken\n ', h = catLifeSaveHarness({ initial: { [base]: raw } }); let exported;
  h.context.URL = { createObjectURL(blob) { exported = blob; return 'blob:local-test'; }, revokeObjectURL() {} };
  h.context.document.createElement = () => ({ click() {} }); h.context.document.body = { appendChild() {}, removeChild() {} };
  h.game.state.saveSystem.downloadRaw(h.game.state.saveSystem.inspect().raw);
  assert.equal(await exported.text(), raw); assert.equal(h.writes.length, 0);
});

for (const stage of ['after-cloud-read', 'before-upload', 'same-account']) test(`actual cloud client rechecks session ${stage}`, async () => {
  const raw = sample(), h = catLifeSaveHarness({ main: true, initial: { [base]: raw } });
  h.game.state.game = h.game.state.saveSystem.loadGame(); h.context.crypto = globalThis.crypto;
  let sessionCount = 0, activations = 0, uploads = 0;
  h.context.CatGameApp = { activateMemberStorage() { activations++; return { source: 'member', game: h.game.state.game }; } };
  h.context.fetch = async (path, options = {}) => {
    let data;
    if (path === '/api/readers/session') {
      sessionCount++;
      const changed = stage === 'after-cloud-read' ? sessionCount >= 2 : stage === 'before-upload' ? sessionCount >= 3 : false;
      data = { ok: true, authenticated: true, account: { id: changed ? 8 : 7 } };
    } else if (options.method === 'PUT') { uploads++; data = { ok: true, save: { revision: 1, data: h.game.state.game, updatedAt: new Date().toISOString() } }; }
    else data = { ok: true, save: null };
    return { ok: true, async json() { return data; } };
  };
  vm.runInContext(readFileSync(new URL('../public/games/cat-life/cloud-sync-policy.js', import.meta.url), 'utf8'), h.context);
  vm.runInContext(readFileSync(new URL('../public/games/cat-life/cloud-sync.js', import.meta.url), 'utf8'), h.context);
  await h.context.CatGameCloud.init(h.game.state.game);
  assert.equal(activations, stage === 'after-cloud-read' ? 0 : 1);
  assert.equal(uploads, stage === 'same-account' ? 1 : 0);
  if (stage !== 'same-account') assert.equal(h.walls.at(-1), 'identity');
  assert.equal(h.values.get(base), raw);
  h.context.dispatchEvent(new h.context.CustomEvent('catgame:save-blocked', { detail: { status: 'identity' } }));
});

test('malformed known progress blocks are preserved instead of being normalised into fresh defaults', () => {
  for (const change of [{ jobs: 'lost jobs' }, { flags: [] }, { tasks: { daily: 'lost tasks' } }, { inventory: { furnitureOwned: 'lost inventory' } }]) {
    const raw = JSON.stringify({ ...JSON.parse(sample()), ...change }), h = catLifeSaveHarness({ initial: { [base]: raw } });
    assert.equal(h.game.state.saveSystem.inspect().status, 'corrupt'); assert.throws(() => h.game.state.saveSystem.loadOrCreateGame());
    assert.equal(h.values.get(base), raw); assert.equal(h.writes.length, 0);
  }
});
