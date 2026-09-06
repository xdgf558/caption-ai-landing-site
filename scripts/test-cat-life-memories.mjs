import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../public/games/cat-life/', import.meta.url);
const scripts = [...readFileSync(new URL('index.html', root), 'utf8').matchAll(/<script src="\.\/(src\/js\/[^" ]+)"/g)]
  .map((match) => match[1]).filter((path) => !/main\.js|musicSystem\.js/.test(path));
const copy = (value) => JSON.parse(JSON.stringify(value));
function setup() {
  let now = Date.parse('2026-09-06T12:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const storage = new Map();
  const context = vm.createContext({ window: {}, document: { hidden: false, baseURI: 'http://localhost/games/cat-life/' },
    Date: Clock, URL, console, setTimeout, clearTimeout, localStorage: {
      getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key),
    } });
  for (const path of scripts) vm.runInContext(readFileSync(new URL(path, root), 'utf8'), context, { filename: path });
  const game = context.window.CatGame;
  game.state.game = game.state.createNewGame();
  game.state.selectedCatId = 'cat_001';
  game.utils.random.chance = () => false;
  const state = game.state.game;
  state.inventory.food = 20; state.inventory.toys = 20;
  return { game, state, cat: state.cats[0], memory: game.systems.memorySystem,
    keys: (cat = state.cats[0]) => copy(game.systems.memorySystem.list(cat).map((entry) => entry.key)),
    at: (value) => { now = Date.parse(value); } };
}

test('real greeting, feeding and play are recorded once; failed and no-op care is not a memory', () => {
  const { game, cat, state, keys } = setup();
  assert.deepEqual(keys(), []);
  const before = copy(state);
  game.ui.renderCatMemories(cat); game.ui.renderLatestMemory(state); game.ui.renderMemoryBond(cat);
  assert.deepEqual(copy(state), before, 'render is pure');
  cat.hunger = 100;
  game.systems.catSystem.performAction(cat.id, 'feedBasic');
  assert.deepEqual(keys(), []);
  state.inventory.toys = 0;
  assert.equal(game.systems.catSystem.performAction(cat.id, 'play').ok, false);
  assert.deepEqual(keys(), []);
  game.systems.onboardingSystem.meetCat(cat.id);
  cat.hunger = 50;
  assert.equal(game.systems.catSystem.performAction(cat.id, 'feedBasic').forceSave, true);
  state.inventory.toys = 4;
  game.systems.catSystem.performAction(cat.id, 'play');
  assert.deepEqual(new Set(keys()), new Set(['met', 'feed', 'play']));
  const feed = copy(cat.memoryJournal.entries.find((entry) => entry.key === 'feed'));
  cat.hunger = 50;
  game.systems.catSystem.performAction(cat.id, 'feedBasic');
  assert.deepEqual(copy(cat.memoryJournal.entries.find((entry) => entry.key === 'feed')), feed);
});

test('veterans record effective care independently from the learning path, with no added rewards', () => {
  const { game, state, cat, keys } = setup();
  state.player.careLearning.eligible = false;
  cat.intimacy = 20; cat.mood = 60;
  const gold = state.player.gold, exp = state.player.exp;
  const result = game.systems.catSystem.performAction(cat.id, 'play');
  assert.equal(result.forceSave, true);
  assert.ok(keys().includes('bond_25'));
  assert.equal(cat.intimacy, 32);
  assert.equal(state.player.gold, gold); assert.equal(state.player.exp, exp);
  const empty = game.state.catMemory.normalize(undefined, { unlocked: true, intimacy: 0 });
  cat.memoryJournal = empty;
  const before = { ...cat, intimacy: 0 };
  cat.intimacy = 100;
  game.systems.memorySystem.recordCare(cat, 'play', before);
  for (const value of [25, 50, 75, 100]) assert.ok(keys().includes('bond_' + value));
  assert.equal(new Set(keys()).size, keys().length);
});

test('legacy bond is undated, no aggregate counters fabricate a first feed; normalization is idempotent', () => {
  const { game, state } = setup();
  state.cats[0].intimacy = 76; state.player.feedCount = 500;
  const original = copy(state);
  const normalized = game.state.normalizeGameData(state);
  assert.deepEqual(copy(state), original);
  const entries = normalized.cats[0].memoryJournal.entries;
  assert.deepEqual(copy(entries.map((entry) => entry.key)), ['bond_25', 'bond_50', 'bond_75']);
  assert.ok(entries.every((entry) => entry.at === null));
  assert.deepEqual(copy(game.systems.memorySystem.list(normalized.cats[0]).map((entry) => entry.key)), ['bond_75', 'bond_50', 'bond_25']);
  assert.deepEqual(copy(game.state.normalizeGameData(normalized).cats[0].memoryJournal), copy(normalized.cats[0].memoryJournal));
});

test('timestamps and per-cat identity survive rename, local save and import; duplicate IDs retain separate journals', () => {
  const { game, state, cat, keys } = setup();
  cat.hunger = 50;
  game.systems.catSystem.performAction(cat.id, 'feedBasic');
  const journal = copy(cat.memoryJournal);
  game.systems.catSystem.renameCat(cat.id, 'Momo');
  for (const lang of ['zh-CN', 'en', 'ja']) {
    state.settings.language = lang;
    assert.equal(game.utils.i18n.getDataText(cat, 'name'), 'Momo');
  }
  game.state.saveSystem.saveGame(state);
  const loaded = game.state.saveSystem.loadOrCreateGame();
  assert.deepEqual(copy(loaded.cats[0].memoryJournal), journal);
  const imported = game.state.saveSystem.importText(JSON.stringify(state));
  assert.deepEqual(copy(imported.cats[0].memoryJournal), journal);
  state.cats.push({ ...copy(cat), name: 'Twin', memoryJournal: { version: 1, entries: [] } });
  const restored = game.state.normalizeGameData(state);
  assert.notEqual(restored.cats[0].id, restored.cats[3].id);
  assert.deepEqual(copy(restored.cats[3].memoryJournal.entries), []);
  assert.equal(keys().filter((key) => key === 'feed').length, 1);
});

test('actual treatment and recovery record after success, failed legacy backup changes nothing', () => {
  const { game, cat, keys, state } = setup();
  cat.diseaseId = game.data.diseases[0].id;
  assert.equal(game.systems.hospitalSystem.treatCat(cat.id).ok, true);
  assert.ok(keys().includes('treat'));
  assert.equal(game.systems.hospitalSystem.treatCat(cat.id).ok, false);
  cat.isAlive = false;
  const backup = game.state.saveSystem.backupBeforeCareRecovery;
  game.state.saveSystem.backupBeforeCareRecovery = () => { throw new Error('full'); };
  const previous = copy(cat);
  assert.equal(game.systems.careSystem.rescueCat(cat.id).ok, false);
  assert.deepEqual(copy(cat), previous);
  game.state.saveSystem.backupBeforeCareRecovery = backup;
  assert.equal(game.systems.careSystem.rescueCat(cat.id).ok, true);
  assert.ok(keys().includes('welcome'));
  cat.careStatus = 'sheltered';
  game.systems.careSystem.rescueCat(cat.id);
  assert.equal(keys().filter((key) => key === 'welcome').length, 1);
  cat.hunger = 5;
  const gold = state.player.gold;
  game.systems.careSystem.rescueCat(cat.id);
  assert.ok(keys().includes('rescue'));
  assert.equal(state.player.gold, gold);
});

test('same-millisecond actions across cats and clock rollback still show the latest actual interaction', () => {
  const { game, state, cat, memory, at } = setup();
  memory.recordMeet(cat);
  const second = state.cats[1]; second.unlocked = true;
  memory.recordMeet(second);
  assert.equal(memory.latest(state).cat.id, second.id);
  at('2026-09-01T12:00:00Z');
  cat.hunger = 50;
  game.systems.catSystem.performAction(cat.id, 'feedBasic');
  assert.equal(memory.latest(state).cat.id, cat.id);
  assert.equal(memory.latest(state).entry.key, 'feed');
});

test('invalid/duplicate records are bounded and future journal versions are preserved without writing', () => {
  const { game, cat, memory } = setup();
  cat.memoryJournal = { version: 1, entries: [
    { key: 'feed', at: 'bad' }, { key: '__proto__', at: new Date().toISOString() },
    { key: 'bond_25', at: null }, { key: 'bond_25', at: '2026-09-05T12:00:00Z', order: Infinity },
    ...Array.from({ length: 100 }, () => ({ key: 'play', at: '2026-09-05T12:00:00Z', order: 2 })),
  ] };
  assert.equal(memory.list(cat).length, 2);
  assert.equal(memory.list(cat).find((entry) => entry.key === 'bond_25').order, 0);
  cat.memoryJournal = { version: 2, entries: [{ key: 'future', custom: 'keep' }], extra: true };
  const future = copy(cat.memoryJournal);
  assert.equal(memory.recordMeet(cat), false);
  game.systems.catSystem.performAction(cat.id, 'play');
  assert.deepEqual(copy(cat.memoryJournal), future);
  assert.deepEqual(copy(game.state.normalizeGameData(game.state.game).cats[0].memoryJournal), future);
});

test('all event and stage copy is localized; escaped names, locked cats and complete bond have honest UI', () => {
  const { game, state, cat, memory } = setup();
  memory.recordMeet(cat);
  cat.name = cat.nameEn = cat.nameJa = '<img onerror="bad">';
  for (const language of ['zh-CN', 'en', 'ja']) {
    state.settings.language = language;
    for (const key of ['met','feed','play','treat','welcome','rescue','bond_25','bond_50','bond_75','bond_100']) {
      for (const suffix of ['', '_copy']) assert.notEqual(game.utils.i18n.t('memory_' + key + suffix), 'memory_' + key + suffix);
    }
    for (let n = 0; n <= 4; n++) assert.notEqual(game.utils.i18n.t('memory_stage_' + n), 'memory_stage_' + n);
    assert.doesNotMatch(game.ui.renderLatestMemory(state), /<img|undefined|NaN/);
    cat.intimacy = 100;
    assert.doesNotMatch(game.ui.renderMemoryBond(cat), /NaN|undefined/);
  }
  cat.unlocked = false;
  assert.equal(game.ui.renderCatMemories(cat), '');
  assert.equal(game.ui.renderLatestMemory(state), '');
});
