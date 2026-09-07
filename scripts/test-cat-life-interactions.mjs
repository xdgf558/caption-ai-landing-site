import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const root = new URL('../public/games/cat-life/', import.meta.url);
const files = [...readFileSync(new URL('index.html', root), 'utf8').matchAll(/<script src="\.\/(src\/js\/[^" ]+)"/g)].map(m => m[1]).filter(p => !/main\.js|musicSystem\.js/.test(p));
const clone = value => JSON.parse(JSON.stringify(value));
function unchanged(state, before) {
  const changed = [];
  function visit(a, b, path) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { changed.push(path); return; }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) visit(a[key], b[key], path + '.' + key);
  }
  visit(state, JSON.parse(before), 'state');
  assert.deepEqual(changed, [], 'read-only calls changed state');
}
function setup() {
  let now = Date.parse('2026-09-07T12:00:00Z');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const storage = new Map();
  const context = vm.createContext({ window: {}, document: { hidden: false, baseURI: 'http://localhost/games/cat-life/' }, Date: Clock, URL, console, setTimeout, clearTimeout,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } });
  for (const file of files) vm.runInContext(readFileSync(new URL(file, root), 'utf8'), context);
  const game = context.window.CatGame;
  const state = game.state.game = game.state.normalizeGameData(game.state.createNewGame());
  game.state.selectedCatId = state.cats[0].id;
  game.utils.random.chance = () => false;
  Object.assign(state.inventory, { food: 10, toys: 10, premiumFood: 10, medicine: 10, litter: 10, catGrass: 10 });
  return { game, state, cat: state.cats[0], system: game.systems.catInteractionSystem, advance: ms => { now += ms; } };
}
test('feeding displays actual capped deltas and the exact consumed inventory', () => {
  const { cat, system } = setup(); cat.hunger = 98; cat.mood = 99;
  assert.equal(system.perform(cat.id, 'feedBasic').ok, true);
  assert.deepEqual(clone(system.current(cat).deltas), [{ key: 'hunger', value: 2 }, { key: 'mood', value: 1 }]);
  assert.equal(system.current(cat).used, 1);
  assert.equal(system.current(cat).memoryAdded, true);
});
test('pregnant food quantity, no-change receipt and no invented memory', () => {
  const { game, cat, system, advance } = setup();
  cat.gender = 'female'; cat.isPregnant = true; cat.hunger = 30;
  system.perform(cat.id, 'feedBasic');
  assert.equal(system.current(cat).used, game.config.pregnancyFoodMultiplier);
  advance(1000); cat.hunger = 100; cat.mood = 100;
  system.perform(cat.id, 'feedBasic');
  assert.equal(system.current(cat).deltas.length, 0);
  assert.equal(system.current(cat).memoryAdded, false);
  assert.match(game.ui.renderCatPanel(game.state.game), /本次没有数值变化/);
});
test('double activation is ignored; deliberate next action and later same action work', () => {
  const { cat, state, system, advance } = setup();
  system.perform(cat.id, 'play'); const inventory = state.inventory.toys;
  assert.equal(system.perform(cat.id, 'play'), null);
  assert.equal(state.inventory.toys, inventory);
  assert.equal(system.perform(cat.id, 'rest').ok, true);
  advance(700); assert.equal(system.perform(cat.id, 'rest').ok, true);
  advance(-10000); assert.equal(system.perform(cat.id, 'rest').ok, true, 'clock rollback must not freeze care');
});
test('failed and unavailable cats cannot retain a success receipt', () => {
  const { game, cat, state, system, advance } = setup();
  system.perform(cat.id, 'feedBasic'); advance(700); state.inventory.food = 0;
  assert.equal(system.perform(cat.id, 'feedBasic').ok, false);
  assert.equal(system.current(cat), null); assert.equal(game.state.catReaction, null);
  for (const status of ['dead', 'sheltered', 'locked']) {
    cat.isAlive = status !== 'dead'; cat.unlocked = status !== 'locked'; cat.careStatus = status === 'sheltered' ? 'sheltered' : 'home';
    assert.equal(system.perform(cat.id, 'rest').ok, false); assert.equal(system.current(cat), null);
  }
});
test('feedback is pure, not serialized, and cannot cross save/account identity', () => {
  const { game, cat, state, system } = setup(); system.perform(cat.id, 'rest');
  const before = JSON.stringify(state); const receipt = system.current(cat);
  game.ui.renderCatPanel(state); game.ui.renderCatPanel(state);
  assert.equal(JSON.stringify(state), before); assert.equal(system.current(cat), receipt);
  assert.doesNotMatch(before, /catReaction|deltas|memoryAdded|startedAt.*owner/);
  game.state.game = clone(state);
  assert.equal(system.current(game.state.game.cats[0]), null);
  assert.equal(game.utils.catArt.getCatReaction(game.state.game.cats[0]), '');
});
test('animation clock survives rerenders and ends; other cats keep their own artwork', () => {
  const { game, cat, system, advance, state } = setup();
  system.perform(cat.id, 'feedBasic'); advance(700);
  assert.match(game.ui.renderCatPanel(state), /--reaction-delay:-700ms/);
  assert.match(game.utils.catArt.getCatStageUrl(cat), /eating-bowl.webp/);
  cat.traits.artKey = 'cow_cat'; assert.match(game.utils.catArt.getCatStageUrl(cat), /cow-cat.png/);
  advance(1500); assert.equal(game.utils.catArt.getCatReaction(cat), '');
});
test('all seven actions stay available through the tray and additional care', () => {
  const { game, cat, system, state, advance } = setup();
  const actions = ['feedBasic', 'feedPremium', 'clean', 'play', 'rest', 'catGrass', 'medicine'];
  for (const action of actions) { advance(1000); assert.equal(system.perform(cat.id, action).ok, true); }
  const html = game.ui.renderCatPanel(state);
  for (const action of actions) assert.equal((html.match(new RegExp('id="cat-care-' + action + '"', 'g')) || []).length, 1);
  assert.match(html, /id="cat-extra-care"/); assert.match(html, /id="cat-extra-care-summary"/);
});
test('localized feedback and hostile names are safe in all supported languages', () => {
  const { game, cat, system, state } = setup(); system.perform(cat.id, 'rest');
  cat.name = '<img onerror=alert(1)>';
  for (const language of ['zh-CN', 'en', 'ja']) {
    state.settings.language = language;
    const html = game.ui.renderCatPanel(state);
    assert.doesNotMatch(html, /interaction_(ready|done|says|more|memory)|undefined|NaN|<img onerror/);
  }
});

test('memory reads and latest selection do not reorder saved entries', () => {
  const { game, cat, state } = setup();
  cat.memoryJournal = { version: 1, entries: [
    { key: 'met', at: '2026-09-01T00:00:00Z', order: 1 },
    { key: 'feed', at: '2026-09-02T00:00:00Z', order: 2 },
    { key: 'bond_25', at: null, order: 0 }
  ] };
  const before = JSON.stringify(state);
  Object.freeze(cat.memoryJournal.entries);
  assert.deepEqual(clone(game.systems.memorySystem.list(cat)).map(e => e.key), ['feed', 'met', 'bond_25']);
  assert.equal(game.systems.memorySystem.latest(state).entry.key, 'feed');
  game.ui.renderCatPanel(state);
  unchanged(state, before);
  // Even a normalizer returning a shared immutable array must be safe to read.
  const normalize = game.state.catMemory.normalize;
  game.state.catMemory.normalize = () => cat.memoryJournal;
  assert.deepEqual(clone(game.systems.memorySystem.list(cat)).map(e => e.key), ['feed', 'met', 'bond_25']);
  game.state.catMemory.normalize = normalize;
  cat.memoryJournal = { version: 2, entries: [{ key: 'future', order: 99 }] };
  const future = JSON.stringify(cat.memoryJournal);
  assert.deepEqual(clone(game.systems.memorySystem.list(cat)), []);
  assert.equal(JSON.stringify(cat.memoryJournal), future);
});

test('veteran and novice guidance point to one real control without duplicate care actions', () => {
  const { game, state, cat } = setup();
  cat.hunger = 50;
  Object.assign(state.player.careLearning, { metCat: true, supplyClaims: [1, 2, 3] });
  for (const eligible of [false, true]) {
    state.player.careLearning.eligible = eligible;
    const before = JSON.stringify(state);
    const html = game.ui.renderCatPanel(state);
    assert.equal((html.match(/data-cat-action="/g) || []).length, 7);
    assert.equal((html.match(/data-focus-cat-action="feedBasic"/g) || []).length, 1);
    assert.match(html, /aria-controls="cat-care-feedBasic"/);
    assert.match(html, /只定位到照护按钮，不会消耗物品/);
    unchanged(state, before);
    assert.match(game.ui.renderCareJourney(state), /data-cat-action="feedBasic"/, 'home retains direct care');
  }
});

test('additional care guidance and all localized completion labels resolve safely', () => {
  const { game, state, cat, system } = setup();
  state.player.careLearning.eligible = false;
  cat.hunger = 100; cat.clean = 40; cat.health = 80; cat.mood = 90;
  for (const language of ['zh-CN', 'en', 'ja']) {
    state.settings.language = language;
    const html = game.ui.renderCatPanel(state);
    assert.match(html, /data-focus-cat-action="clean"/);
    assert.match(html, /aria-controls="cat-care-clean"/);
    assert.doesNotMatch(html, /interaction_find_|undefined|NaN/);
  }
  state.settings.language = 'en';
  system.perform(cat.id, 'feedBasic');
  const html = game.ui.renderCatPanel(state);
  assert.match(html, /Done: Feed/);
  assert.doesNotMatch(html, /Feed complete/);
  assert.doesNotMatch(game.ui.renderCareActionLink('clean', '<script>bad</script>', false), /<script>/);
  assert.match(game.ui.renderCareActionLink('clean', 'Clean', false), / disabled/);
});
