import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catLifeSaveHarness } from './helpers/cat-life-save-harness.mjs';
// Import the same classic probe/client as the built Astro shell.
const listeners = new Map();
globalThis.window = { addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, fetch() {} };
const { mountGameEntry } = await import('../src/redesign/gameClient.js');
function ui({ initial = {}, deniedRead = false, fetcher, member = false } = {}) {
  const h = catLifeSaveHarness({ initial, deniedRead }), events = new Map();
  const status = { textContent: '' }, launch = { hidden: true, href: null, removeAttribute() { this.href = null; } }, retry = { disabled: false, addEventListener(type, fn) { events.set(type, fn); }, removeEventListener() {} };
  const root = { dataset: {}, querySelector(name) { return name.includes('status') ? status : name.includes('launch') ? launch : retry; } };
  const doc = { documentElement: { lang: 'en' }, querySelector() { return root; } };
  const response = { ok: true, json: async () => ({ ok: true, authenticated: member, ...(member ? { account: { id: 7 } } : {}) }) };
  const dispose = mountGameEntry({ document: doc, probe: h.context.CatGameSaveStatus, storage: () => h.storage, fetcher: fetcher || (async () => response) });
  return { h, root, status, launch, retry, events, dispose };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
for (const [state, value, label] of [['missing', null, 'Start game'], ['valid', 'real', 'Continue game'], ['corrupt', '{broken', 'Recovery options'], ['unsupported', '{"schemaVersion":4}', 'Recovery options']]) test(`entry ${state} offers only the appropriate action without writes`, async () => {
  const raw = value === 'real' ? JSON.stringify(catLifeSaveHarness().game.state.game) : value;
  const u = ui({ initial: raw === null ? {} : { catGameSaveV1: raw } }); await settle();
  assert.equal(u.root.dataset.saveStatus, state); assert.equal(u.launch.textContent, label); assert.equal(u.launch.hidden, false);
  assert.equal(u.launch.href, '/games/cat-life/?sc_entry=1&lang=en'); assert.equal(u.h.writes.length, 0); u.dispose();
});
test('member missing is local-only evidence; unreadable storage is not a new game', async () => {
  const member = ui({ member: true }); await settle(); assert.equal(member.launch.textContent, 'Enter game'); assert.match(member.status.textContent, /cloud/); member.dispose();
  const denied = ui({ deniedRead: true }); await settle(); assert.equal(denied.root.dataset.saveStatus, 'unavailable'); assert.equal(denied.launch.textContent, 'Recovery options'); denied.dispose();
});
test('late successful session cannot re-enable launch after a newer failed check or disposal', async () => {
  let resolve, calls = 0;
  const u = ui({ fetcher: () => ++calls === 1 ? new Promise(done => { resolve = done; }) : Promise.reject(new Error('offline')) });
  u.events.get('click')(); await settle(); assert.equal(u.root.dataset.saveStatus, 'identity'); assert.equal(u.launch.hidden, true); assert.equal(u.launch.href, null);
  resolve({ ok: true, json: async () => ({ ok: true, authenticated: false }) }); await settle(); assert.equal(u.root.dataset.saveStatus, 'identity'); assert.equal(u.launch.hidden, true); u.dispose();
});
