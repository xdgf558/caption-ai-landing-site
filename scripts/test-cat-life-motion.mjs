import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/games/cat-life/src/js/utils/catMotion.js', import.meta.url), 'utf8');
function setup() {
  let reduce = false, scripts = [], reaction = '', skin = null;
  const cat = { id: 'orange', unlocked: true, isAlive: true, energy: 80, traits: { artKey: 'orange_tabby' } };
  const game = { state: { game: { cats: [cat] } }, utils: { catArt: { inferArtKeyFromTraits: traits => traits.artKey, getCatReaction: () => reaction } } };
  const window = { CatGame: game, CatGameCommerce: { getCatSprite: () => skin }, location: { protocol: 'https:' }, matchMedia: () => ({ matches: reduce }) };
  const document = { baseURI: 'https://wwwstationcat.org/games/cat-life/', head: { appendChild: node => scripts.push(node) }, querySelectorAll: () => [{ dataset: { catMotionId: cat.id } }], createElement: () => ({ remove() {} }) };
  vm.runInNewContext(source, { window, document, URL });
  return { cat, game, window, scripts, api: game.utils.catMotion, reduce(value) { reduce = value; }, skin(value) { skin = value; }, reaction(value) { reaction = value; } };
}
test('only healthy ordinary orange cats receive the rig; queries do not mutate saves', () => {
  const s = setup(), before = JSON.stringify(s.game.state);
  assert.equal(s.api.eligible(s.cat), true);
  assert.equal(JSON.stringify(s.game.state), before);
  for (const change of [{ unlocked: false }, { isAlive: false }, { careStatus: 'sheltered' }, { disease: { id: 'cold' } }, { energy: 35 }, { traits: { artKey: 'cow_cat' } }]) assert.equal(s.api.eligible({ ...s.cat, ...change }), false);
  s.skin('member.webp'); assert.equal(s.api.eligible(s.cat), false);
  s.skin(null); s.reaction('pounce'); assert.equal(s.api.eligible(s.cat), false);
  s.reaction('fish'); assert.equal(s.api.eligible(s.cat), true);
});
test('lazy loader avoids file URLs and reduced motion, deduplicates loads and never retries errors on each render', () => {
  const s = setup();
  s.window.location.protocol = 'file:'; s.api.sync(); assert.equal(s.scripts.length, 0);
  s.window.location.protocol = 'https:'; s.reduce(true); s.api.sync(); assert.equal(s.scripts.length, 0);
  s.reduce(false); s.api.sync(); s.api.sync(); assert.equal(s.scripts.length, 1);
  assert.equal(s.scripts[0].src, 'https://wwwstationcat.org/games/cat-life/src/vendor/cat-motion/runtime.js?v=1.28.0');
  s.scripts[0].onerror(); s.api.sync(); assert.equal(s.scripts.length, 1);
});
test('existing live tick reacts only to preference changes and reuses the runtime', () => {
  const s = setup(); let syncs = 0, snapshots = 0;
  s.game.utils.catMotionRuntime = { sync() { syncs++; }, beforeRender() { snapshots++; } };
  s.api.sync(); s.api.beforeRender();
  for (let i = 0; i < 10; i++) s.api.syncPreferences();
  assert.equal(syncs, 1); assert.equal(snapshots, 1);
  s.reduce(true); s.api.syncPreferences(); assert.equal(syncs, 2);
  s.reduce(false); s.api.syncPreferences(); assert.equal(syncs, 3);
});
