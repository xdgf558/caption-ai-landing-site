import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = new URL('../public/games/cat-life/', import.meta.url);
const scripts = [...readFileSync(new URL('index.html', root), 'utf8').matchAll(/<script src="\.\/(src\/js\/[^" ]+)"/g)]
  .map((match) => match[1]).filter((path) => !/main\.js|musicSystem\.js/.test(path));
const start = Date.parse('2026-09-05T12:00:00Z');
const DAY = 86400000;
const copy = (value) => JSON.parse(JSON.stringify(value));

function setup() {
  let now = start;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const storage = new Map();
  const context = vm.createContext({
    window: {}, document: { hidden: false, baseURI: 'http://localhost/games/cat-life/' },
    Date: Clock, URL, console, setTimeout, clearTimeout,
    localStorage: {
      setItem: (key, value) => storage.set(key, value), getItem: (key) => storage.get(key) || null,
      removeItem: (key) => storage.delete(key),
    },
  });
  for (const path of scripts) vm.runInContext(readFileSync(new URL(path, root), 'utf8'), context, { filename: path });
  const game = context.window.CatGame;
  game.state.game = game.state.createNewGame();
  game.state.selectedCatId = 'cat_001';
  game.utils.random.chance = () => false;
  return {
    game, context, storage, learn: game.systems.onboardingSystem, state: game.state.game, cat: game.state.game.cats[0],
    at: (time) => { now = typeof time === 'string' ? Date.parse(time) : time; },
    reload: () => {
      game.state.saveSystem.saveGame(game.state.game);
      game.state.game = game.state.normalizeGameData(JSON.parse(storage.get(game.state.saveSystem.getStorageKey())));
      return game.state.game;
    },
  };
}

test('first-care path: real cat → supplies → effective feed → play → settled job', () => {
  const { game, state, cat, learn, at } = setup();
  const progress = state.player.careLearning;
  const rec = () => learn.recommendation(state);
  assert.equal(rec().kind, 'meet');
  assert.equal(learn.meetCat('missing').ok, false);
  assert.equal(learn.meetCat(cat.id).forceSave, true);
  assert.equal(learn.meetCat(cat.id).ok, false);
  assert.equal(rec().kind, 'supplies');
  const inventory = copy(state.inventory);
  assert.equal(learn.claimSupplies().forceSave, true);
  assert.equal(state.inventory.food, inventory.food + 2);
  assert.equal(state.inventory.litter, inventory.litter + 1);
  assert.equal(state.inventory.toys, inventory.toys + 2);
  assert.equal(progress.careDates.length, 0);
  assert.equal(rec().action, 'feedBasic');
  assert.equal(game.systems.catSystem.performAction(cat.id, 'feedBasic').forceSave, true);
  assert.equal(progress.fed, true);
  assert.equal(rec().action, 'play');
  assert.equal(game.systems.catSystem.performAction(cat.id, 'play').forceSave, true);
  assert.equal(progress.played, true);
  assert.equal(progress.careDates.length, 1);
  assert.equal(rec().page, 'work');
  const gold = state.player.gold;
  const job = state.jobs.find((entry) => entry.unlocked);
  assert.equal(game.systems.workSystem.startJob(job.id).ok, true);
  assert.equal(progress.worked, false, 'starting is not completing');
  assert.equal(rec().titleKey, 'learning_work_running');
  at(state.player.activeWork.endsAt);
  game.systems.workSystem.syncActiveWork('timer');
  assert.equal(progress.worked, true);
  assert.ok(state.player.gold > gold);
  const settledGold = state.player.gold;
  game.systems.workSystem.syncActiveWork('timer');
  assert.equal(state.player.gold, settledGold);
});

test('supply claims survive reload/import; renders, failed actions and no-op feeds never add care days', () => {
  const f = setup();
  const { game, cat, state, learn } = f;
  const original = copy(state);
  for (let i = 0; i < 5; i++) game.ui.renderCareJourney(state);
  assert.deepEqual(copy(state), original, 'pure render');
  state.inventory.food = 0;
  assert.equal(game.systems.catSystem.performAction(cat.id, 'feedBasic').ok, false);
  assert.equal(state.player.careLearning.careDates.length, 0);
  learn.claimSupplies();
  const after = copy(state.inventory);
  assert.equal(learn.claimSupplies().ok, false);
  assert.deepEqual(copy(state.inventory), after);
  state.settings.autoSave = false;
  f.reload();
  assert.equal(learn.claimSupplies().ok, false);
  assert.equal(game.state.game.player.careLearning.careDates.length, 0);
  game.state.game = game.state.normalizeGameData(copy(game.state.game));
  assert.equal(learn.claimSupplies().ok, false);
  const currentCat = game.state.game.cats[0];
  currentCat.hunger = 100;
  assert.equal(game.systems.catSystem.performAction(currentCat.id, 'feedBasic').ok, true);
  f.reload();
  assert.equal(game.state.game.player.careLearning.fed, false, 'legacy feed counter cannot turn a no-op into a lesson on reload');
  Object.assign(game.state.game.cats[0], { hunger: 100, health: 100, mood: 100, intimacy: 100, clean: 100, energy: 100 });
  game.systems.catSystem.performAction(currentCat.id, 'rest');
  assert.equal(game.state.game.player.careLearning.careDates.length, 0);
  assert.notEqual(learn.recommendation(game.state.game).kind, 'cat', 'do not encourage wasting supplies at full stats');
});

test('three non-consecutive UTC dates; repeat care, time away and rollback do not consume opportunities', () => {
  const { game, state, cat, learn, at } = setup();
  const progress = state.player.careLearning;
  learn.claimSupplies();
  game.systems.catSystem.performAction(cat.id, 'feedBasic');
  for (let i = 0; i < 8; i++) game.systems.catSystem.performAction(cat.id, 'rest');
  assert.deepEqual(copy(progress.careDates), ['2026-09-05']);
  at(start + 7 * DAY);
  game.systems.catSystem.syncCatState(new Date(start + 7 * DAY), 'focus');
  assert.equal(cat.careStatus, 'sheltered');
  assert.equal(progress.careDates.length, 1);
  assert.equal(learn.active(state), true);
  assert.equal(learn.canClaim(state), false, 'pick up the companion before collecting supplies');
  assert.equal(game.systems.careSystem.rescueCat(cat.id).ok, true);
  assert.equal(progress.careDates.length, 1);
  assert.equal(learn.lessonFor(state), 2);
  assert.equal(learn.claimSupplies().ok, true);
  game.systems.catSystem.performAction(cat.id, 'feedBasic');
  assert.deepEqual(copy(progress.careDates), ['2026-09-05', '2026-09-12']);
  at('2026-09-11T23:00:00Z');
  cat.energy = 20;
  game.systems.catSystem.performAction(cat.id, 'rest');
  assert.equal(progress.careDates.length, 2);
  assert.equal(learn.canClaim(state), false);
  at('2026-09-13T23:59:59Z');
  cat.energy = 20;
  game.systems.catSystem.performAction(cat.id, 'rest');
  assert.equal(progress.careDates.length, 3);
  assert.equal(learn.claimSupplies().ok, true, 'third package can be claimed after care on that UTC date');
  assert.equal(learn.active(state), true);
  assert.equal(progress.protectedUntil, '2026-09-14T00:00:00.000Z');
  at('2026-09-14T00:00:00Z');
  assert.equal(learn.active(state), false);
  assert.equal(learn.canClaim(state), false);
  cat.health = 10;
  assert.equal(game.systems.careSystem.rescueCat(cat.id).ok, true, 'permanent safety survives graduation');
  assert.equal(progress.careDates.length, 3);
});

test('first clinic aid is charged once, survives reload, and no treatment is granted by a render', () => {
  const f = setup();
  const { game, state, cat, learn } = f;
  state.player.gold = 0;
  cat.diseaseId = game.data.diseases[0].id;
  // The existing breeding helper initializes legacy pregnancy runtime fields.
  game.systems.collectionSystem.getBreedableCats();
  const before = copy(state);
  const html = game.ui.renderHospitalPanel(state);
  assert.match(html, /data-treat-cat="cat_001"/);
  assert.match(html, /learning_treatment_help|首次门诊援助/);
  assert.deepEqual(copy(state), before);
  assert.equal(learn.recommendation(state).kind, 'treat');
  assert.equal(game.systems.hospitalSystem.treatCat(cat.id).forceSave, true);
  assert.equal(state.player.gold, 0);
  assert.equal(state.player.totalSpend, 0);
  assert.equal(state.player.hospitalVisits, 1);
  assert.equal(state.player.careLearning.treatmentUsed, true);
  assert.equal(state.player.careLearning.careDates.length, 1);
  assert.equal(game.systems.hospitalSystem.treatCat(cat.id).ok, false);
  f.reload();
  const recovered = game.state.game.cats[0];
  recovered.diseaseId = game.data.diseases[0].id;
  assert.equal(learn.canTreatFree(recovered, game.state.game), false);
  assert.equal(game.systems.hospitalSystem.treatCat(recovered.id).ok, false);
  assert.equal(game.systems.careSystem.rescueCat(recovered.id).ok, true, 'basic rescue remains free, without farming clinic visits');
  assert.equal(game.state.game.player.hospitalVisits, 1);
});

test('zero resources, both hungry: rescue → player meal → meet/supplies → useful care; no fabricated rewards', () => {
  const { game, state, cat, learn } = setup();
  cat.hunger = 10;
  state.player.gold = 0;
  state.player.hunger = 100;
  for (const key of Object.keys(state.inventory)) if (typeof state.inventory[key] === 'number') state.inventory[key] = 0;
  assert.equal(learn.recommendation(state).kind, 'rescue');
  game.systems.careSystem.rescueCat(cat.id);
  assert.equal(learn.recommendation(state).kind, 'meal');
  game.systems.careSystem.getMeal();
  assert.equal(state.player.careLearning.careDates.length, 0);
  assert.equal(state.player.exp, 0);
  assert.equal(state.player.gold, 0);
  assert.equal(learn.recommendation(state).kind, 'meet');
  learn.meetCat(cat.id);
  assert.equal(learn.recommendation(state).kind, 'supplies');
  learn.claimSupplies();
  assert.equal(learn.recommendation(state).action, 'feedBasic');
  assert.equal(game.systems.catSystem.performAction(cat.id, 'feedBasic').ok, true);
  assert.equal(state.player.careLearning.careDates.length, 1);
});

test('legacy saves resume honest counters without inventing dates, veteran saves skip lessons, future learning versions are retained', () => {
  const { game, state, learn } = setup();
  const legacy = copy(state);
  delete legacy.player.careLearning;
  legacy.player.feedTimes = 4;
  legacy.player.playTimes = 2;
  legacy.player.workTimes = 1;
  const before = copy(legacy);
  let normalized = game.state.normalizeGameData(legacy);
  assert.deepEqual(copy(legacy), before);
  assert.equal(normalized.player.careLearning.eligible, true);
  for (const field of ['metCat', 'fed', 'played', 'worked']) assert.equal(normalized.player.careLearning[field], true);
  assert.equal(normalized.player.careLearning.careDates.length, 0);
  legacy.player.level = 2;
  normalized = game.state.normalizeGameData(legacy);
  assert.equal(normalized.player.careLearning.eligible, false);
  assert.equal(learn.canClaim(normalized), false);
  legacy.player.careLearning = { version: 2, eligible: true, futureData: ['preserve'], supplyClaims: [1] };
  normalized = game.state.normalizeGameData(legacy);
  assert.deepEqual(copy(normalized.player.careLearning), legacy.player.careLearning);
  assert.equal(learn.canClaim(normalized), false);
});

test('missing, locked, deceased, sheltered and multi-cat recommendations target only the actual companion', () => {
  const { game, state, cat, learn } = setup();
  state.cats = [];
  assert.equal(learn.recommendation(state).page, 'save');
  assert.equal(learn.canClaim(state), false);
  state.cats = [cat];
  cat.unlocked = false;
  assert.equal(learn.recommendation(state).page, 'collection');
  assert.equal(learn.meetCat(cat.id).ok, false);
  cat.unlocked = true;
  cat.isAlive = false;
  assert.equal(learn.recommendation(state).kind, 'rescue');
  assert.equal(learn.canClaim(state), false);
  cat.isAlive = true;
  cat.careStatus = 'sheltered';
  assert.equal(learn.recommendation(state).buttonKey, 'care_pick_up');
  const another = { ...copy(cat), id: 'kitten_unique', name: '<Momo & friend>' };
  cat.careStatus = 'home';
  state.cats.push(another);
  assert.equal(learn.recommendation(state).catId, another.id);
  assert.match(game.ui.renderCareJourney(state), /data-rescue-cat="kitten_unique"/);
  assert.doesNotMatch(game.ui.renderCareJourney(state), /<Momo & friend>/);
  assert.equal(learn.recommendation(state, cat).catId, cat.id);
});

test('realtime hunger and stamina guide the player to food or sleep; pregnancy and premium stock are respected', () => {
  const { game, state, cat, learn } = setup();
  Object.assign(state.player.careLearning, { metCat: true, fed: true, played: true, supplyClaims: [1] });
  Object.assign(cat, { hunger: 100, clean: 100, energy: 100 });
  state.player.hunger = 100;
  state.inventory.bread = 1;
  assert.equal(learn.recommendation(state).itemId, 'bread');
  state.inventory.bread = 0;
  assert.equal(learn.recommendation(state).page, 'shop');
  state.player.hunger = 0;
  state.player.stamina = 0;
  assert.equal(learn.recommendation(state).kind, 'sleep');
  state.player.stamina = 100;
  state.inventory.food = 0;
  state.inventory.premiumFood = 4;
  cat.hunger = 60;
  assert.equal(learn.recommendation(state).action, 'feedPremium');
});

test('learning prevents new infections, not existing illness or the permanent gentle-care safety system', () => {
  const { game, state, cat, learn } = setup();
  assert.equal(game.systems.careSystem.isProtected(cat, new Date(start)), true);
  state.player.careLearning.careDates = ['2026-09-01', '2026-09-02', '2026-09-03'];
  state.player.careLearning.protectedUntil = '2026-09-04T00:00:00Z';
  assert.equal(learn.active(state), false);
  assert.equal(game.systems.careSystem.isProtected(cat, new Date(start)), false);
  cat.health = 5;
  assert.equal(game.systems.careSystem.rescueCat(cat.id).ok, true);
  assert.equal(game.systems.careSystem.isProtected(cat, new Date(start)), true);
});

test('all three languages resolve new literal and dynamic keys; one primary action and semantic progress', () => {
  const { game, state } = setup();
  const source = readFileSync(new URL('src/js/core/i18n.js', root), 'utf8');
  const keys = [...new Set([...source.matchAll(/\b(learning_\w+):/g)].map((match) => match[1]))];
  assert.ok(keys.length > 40);
  for (const language of ['zh-CN', 'en', 'ja']) {
    state.settings.language = language;
    for (const key of keys) assert.notEqual(game.utils.i18n.t(key), key, language + '/' + key);
    const html = game.ui.renderCareJourney(state);
    assert.equal((html.match(/<button /g) || []).length, 1);
    assert.equal((html.match(/data-learning-step=/g) || []).length, 4);
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
    assert.match(html, /<details class="care-journey-rules">/);
    assert.doesNotMatch(html, /undefined|NaN|>learning_\w+</);
  }
});
