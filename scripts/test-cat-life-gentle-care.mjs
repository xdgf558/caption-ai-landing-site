import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../public/games/cat-life/', import.meta.url);
const scripts = [...readFileSync(new URL('index.html', root), 'utf8').matchAll(/<script src="\.\/(src\/js\/[^" ]+)"/g)]
  .map((match) => match[1]).filter((path) => !/main\.js|musicSystem\.js/.test(path));
const HOUR = 3600000;
const start = Date.parse('2026-09-05T00:00:00Z');
let now = start;
const storage = new Map();
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({
  window: {}, document: { hidden: false, baseURI: 'http://localhost/games/cat-life/' },
  Date: Clock, URL, console, setTimeout, clearTimeout,
  localStorage: {
    setItem: (key, value) => storage.set(key, value),
    getItem: (key) => storage.get(key) || null,
    removeItem: (key) => storage.delete(key),
  },
});
for (const path of scripts) vm.runInContext(readFileSync(new URL(path, root), 'utf8'), context, { filename: path });
const game = context.window.CatGame;
const care = game.systems.careSystem;
const cats = game.systems.catSystem;
let rolls = 0;
game.utils.random.chance = () => { rolls++; return false; };
const snapshot = (value) => JSON.parse(JSON.stringify(value));
function fresh() {
  now = start;
  game.state.game = game.state.createNewGame();
  game.state.selectedCatId = 'cat_001';
  return game.state.game.cats[0];
}
function sync(hours, source = 'init') {
  now = start + hours * HOUR;
  return cats.syncCatState(new Clock(), source);
}
function disease(cat) {
  cat.diseaseId = game.data.diseases[0].id;
  cat.diseaseStartedAt = new Clock().toISOString();
  cat.diseaseProgressAt = cat.diseaseStartedAt;
  cat.diseaseHistory.push({ id: cat.diseaseId, at: cat.diseaseStartedAt });
}

for (const hours of [24, 72, 168, 24 * 365 * 100]) {
  for (const source of ['init', 'visibility', 'focus', 'timer', 'import', 'cloud']) {
    for (const kind of ['healthy', 'sick', 'low']) {
      const cat = fresh();
      if (kind !== 'healthy') disease(cat);
      if (kind === 'low') { cat.hunger = 8; cat.health = 9; }
      const before = snapshot(cat);
      rolls = 0;
      sync(hours, source);
      assert.equal(cat.isAlive, true, `${hours} hours / ${source} / ${kind}`);
      assert.equal(cat.careStatus, 'sheltered');
      assert.equal(cat.hunger, Math.max(Math.min(before.hunger, 20), before.hunger - 16));
      assert.ok(cat.health >= Math.min(before.health, 30));
      assert.ok(cat.health <= before.health, 'offline floors are not free healing');
      assert.equal(rolls, 0, 'no historical infection lottery');
      const once = snapshot(cat);
      cats.syncCatState(new Clock(), 'timer');
      now += 1000;
      cats.syncCatState(new Clock(), 'timer');
      for (const key of ['hunger', 'health', 'clean', 'mood', 'energy', 'intimacy']) assert.equal(cat[key], once[key]);
      assert.equal(game.state.game.cats.filter((entry) => entry.unlocked).length, 1);
    }
  }
}

let cat = fresh();
sync(8);
assert.equal(cat.careStatus, 'home', 'exactly 8h does not yet require pick-up');
assert.equal(cat.health, 90, 'healthy cats no longer lose health');
assert.equal(cat.hunger, 64);
const afterEight = snapshot(cat);
cats.syncCatState(new Clock(), 'timer');
assert.equal(cat.hunger, afterEight.hunger);

cat = fresh();
cat.hunger = 1;
for (let minute = 1; minute <= 30; minute++) sync(minute / 60, 'timer');
assert.equal(cat.careStatus, 'sheltered', 'active play exhaustion shelters instead of killing');
assert.equal(cat.isAlive, true);

cat = fresh();
disease(cat);
cat.health = 1;
for (let minute = 1; minute <= 15; minute++) sync(minute / 60, 'timer');
assert.equal(cat.careStatus, 'sheltered', 'disease exhaustion uses the same safety path');
assert.equal(cat.isAlive, true);

// Timers may continue running in a hidden tab; they must not consume the away window.
cat = fresh();
context.document.hidden = true;
for (let hour = 1; hour <= 24; hour++) {
  now = start + hour * HOUR;
  game.systems.timeSystem.syncRealtimeState('timer');
}
assert.equal(cat.careLastSyncAt, new Clock(start).toISOString());
assert.equal(cat.hunger, 80);
context.document.hidden = false;
game.systems.timeSystem.syncRealtimeState('visibility');
assert.equal(cat.careStatus, 'sheltered');

// Rescue preserves identity/history and cannot be farmed or leave a timer backlog.
cat = fresh();
cat.name = '<Momo & friend>';
cat.intimacy = 63;
disease(cat);
sync(168);
const economy = snapshot({ player: game.state.game.player, inventory: game.state.game.inventory });
const identity = snapshot({ id: cat.id, name: cat.name, intimacy: cat.intimacy, history: cat.diseaseHistory, adoptions: cat.adoptionCount });
assert.equal(care.rescueCat(cat.id).ok, true);
assert.deepEqual(snapshot({ id: cat.id, name: cat.name, intimacy: cat.intimacy, history: cat.diseaseHistory, adoptions: cat.adoptionCount }), identity);
assert.deepEqual(snapshot({ player: game.state.game.player, inventory: game.state.game.inventory }), economy);
assert.equal(cat.diseaseId, null);
assert.equal(cat.careStatus, 'home');
const rescued = snapshot(cat);
assert.equal(care.rescueCat(cat.id).ok, false);
assert.deepEqual(snapshot(cat), rescued);
now += 1000;
cats.syncCatState(new Clock(), 'timer');
assert.equal(cat.hunger, rescued.hunger);
assert.equal(care.isProtected(cat, new Clock()), true);
const imported = game.state.normalizeGameData(snapshot(game.state.game));
assert.equal(imported.cats[0].careProtectedUntil, cat.careProtectedUntil);

cat = fresh();
cat.hunger = 10;
game.state.game.player.gold = 0;
game.state.game.player.hunger = 100;
Object.keys(game.state.game.inventory).forEach((key) => {
  if (typeof game.state.game.inventory[key] === 'number') game.state.game.inventory[key] = 0;
});
assert.equal(care.rescueCat(cat.id).ok, true);
assert.equal(care.getMeal().ok, true);
assert.ok(game.state.game.player.hunger < game.config.playerCondition.hungerBlockThreshold);
assert.equal(care.getMeal().ok, false);
assert.equal(game.state.game.player.gold, 0);

// An old loss is opt-in. Backup errors cannot partly resurrect a cat.
cat = fresh();
cat.isAlive = false;
cat.name = 'Old friend';
cat.intimacy = 47;
cat.diedAt = new Clock().toISOString();
cat.deathReason = 'hunger_zero';
const legacy = snapshot(game.state.game);
legacy.schemaVersion = 2;
delete legacy.cats[0].careLastSyncAt;
delete legacy.cats[0].careStatus;
game.state.game = game.state.normalizeGameData(legacy);
cat = game.state.game.cats[0];
sync(168);
assert.equal(cat.isAlive, false, 'migration never automatically resurrects');
const beforeBackup = snapshot(cat);
const saveJSON = game.utils.storage.saveJSON;
game.utils.storage.saveJSON = () => { throw new Error('quota'); };
assert.equal(care.rescueCat(cat.id).ok, false);
assert.deepEqual(snapshot(cat), beforeBackup);
game.utils.storage.saveJSON = saveJSON;
assert.equal(care.rescueCat(cat.id).ok, true);
assert.equal(cat.name, 'Old friend');
assert.equal(cat.intimacy, 47);
assert.equal(cat.careLegacyRecord.deathReason, 'hunger_zero');
const backupKey = game.state.saveSystem.getStorageKey() + ':before-care-recovery';
assert.equal(JSON.parse(storage.get(backupKey)).cats[0].isAlive, false);
assert.equal(legacy.cats[0].isAlive, false, 'source save must remain unchanged');
const backupBefore = storage.get(backupKey);
game.state.saveSystem.backupBeforeCareRecovery();
assert.equal(storage.get(backupKey), backupBefore, 'later actions never overwrite the first safety snapshot');
const previousKey = game.state.saveSystem.getStorageKey();
game.state.saveSystem.setStorageKey('catGameSaveV1:member:other');
assert.equal(game.state.saveSystem.getCareRecoveryBackup(), null, 'backups stay within the active account slot');
game.state.saveSystem.setStorageKey(previousKey);

// Normal hospital care also receives a recovery grace period.
cat = fresh();
disease(cat);
assert.equal(game.systems.hospitalSystem.treatCat(cat.id).ok, true);
rolls = 0;
for (let minute = 1; minute <= 30; minute++) sync(minute / 60, 'timer');
assert.equal(rolls, 0);
assert.equal(cat.diseaseId, null);
assert.equal(care.isProtected(cat, new Clock(start + 24 * HOUR)), false);

// Generated kittens are companions too; reload/import must retain their IDs.
cat = fresh();
const kitten = { ...snapshot(cat), id: 'kitten_1', name: 'Little one', careStatus: 'sheltered', intimacy: 33 };
game.state.game.cats.push(kitten);
const roundTrip = game.state.normalizeGameData(snapshot(game.state.game));
assert.equal(roundTrip.cats.find((entry) => entry.id === 'kitten_1').intimacy, 33);
assert.equal(roundTrip.cats.find((entry) => entry.id === 'kitten_1').careStatus, 'sheltered');

cat = fresh();
sync(-24, 'timer');
assert.equal(cat.hunger, 80);
assert.equal(cat.health, 90);
assert.equal(cat.careLastSyncAt, new Clock().toISOString());

cat = fresh();
sync(24);
assert.equal(cats.performAction(cat.id, 'feedBasic').ok, false);
assert.equal(game.systems.hospitalSystem.treatCat(cat.id).ok, false);
assert.equal(game.systems.collectionSystem.getBreedableCats().some((entry) => entry.id === cat.id), false);
for (const language of ['zh-CN', 'en', 'ja']) {
  game.state.game.settings.language = language;
  for (const key of ['care_sheltered', 'care_pick_up', 'care_rescue_copy', 'care_legacy_action', 'care_meal_action']) {
    assert.notEqual(game.utils.i18n.t(key), key, `${language}/${key}`);
  }
  for (const render of [game.ui.renderHome, game.ui.renderCatPanel, game.ui.renderHospitalPanel, game.ui.renderCollectionPanel]) {
    const html = render(game.state.game);
    assert.match(html, /data-rescue-cat=/);
    assert.doesNotMatch(html, /undefined|NaN|>care_[a-z_]+</);
  }
}

console.log('Gentle care checks passed: away windows, hidden timers, rescue, legacy backups, identity, schema and 3-language UI.');
