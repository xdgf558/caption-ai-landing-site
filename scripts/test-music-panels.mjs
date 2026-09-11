import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicPanelHistory } from '../src/scripts/musicPanels.js';
import { mountMusicQueueControls } from '../src/scripts/musicQueueControls.js';

class HistoryHost extends EventTarget {
  constructor() {
    super();
    this.entries = [{ musicLibrary: { track: 'A', query: '' } }]; this.index = 0;
    this.location = { href: 'https://music.example.test/en/music/?track=A' };
    const host = this;
    this.history = {
      get state() { return host.entries[host.index]; },
      pushState(value, _, url) { assert.equal(url, host.location.href); host.entries.splice(++host.index, Infinity, structuredClone(value)); },
      replaceState(value, _, url) { assert.equal(url, host.location.href); host.entries[host.index] = structuredClone(value); },
      back() { host.move(-1); }
    };
  }
  move(direction) { this.index = Math.max(0, Math.min(this.index + direction, this.entries.length - 1)); this.dispatchEvent(new Event('popstate')); }
}

test('opening/closing a drawer leaves the URL and browse selection intact; back and forward restore presentation', () => {
  const host = new HistoryHost(), changes = [], panel = createMusicPanelHistory(host, value => changes.push(value));
  panel.open('detail'); assert.equal(host.entries.length, 2); assert.equal(changes.at(-1), 'detail');
  assert.deepEqual(host.history.state.musicLibrary, { track: 'A', query: '' });
  panel.close(); assert.equal(host.index, 0); assert.equal(changes.at(-1), null);
  host.move(1); assert.equal(changes.at(-1), 'detail');
  host.move(-1); assert.equal(changes.at(-1), null);
  panel.destroy(); const count = changes.length; host.move(1); assert.equal(changes.length, count);
});

test('switching from details to queue replaces the overlay entry instead of stacking players or history', () => {
  const host = new HistoryHost(), changes = [], panel = createMusicPanelHistory(host, value => changes.push(value));
  panel.open('detail'); panel.open('queue');
  assert.equal(host.entries.length, 2); assert.equal(changes.at(-1), 'queue');
  panel.close(); assert.equal(host.index, 0); assert.equal(changes.at(-1), null);
  panel.destroy();
});

test('a new panel requested during asynchronous Back survives the late popstate; double close never navigates twice', async () => {
  const host = new HistoryHost(), changes = [], panel = createMusicPanelHistory(host, value => changes.push(value));
  let backs = 0;
  host.history.back = () => { backs++; };
  panel.open('detail'); panel.close(); panel.close(); panel.open('filter');
  assert.equal(backs, 1); assert.equal(changes.at(-1), null);
  host.move(-1); await Promise.resolve();
  assert.equal(changes.at(-1), 'filter'); assert.equal(host.entries.length, 2);
  panel.destroy();
});

test('closing filters commits edited browse state instead of undoing the selected filter', () => {
  const host = new HistoryHost(), panel = createMusicPanelHistory(host, () => {});
  panel.open('filter');
  host.history.replaceState({ ...host.history.state, musicLibrary: { track: 'A', query: '', access: 'vip' } }, '', host.location.href);
  panel.close();
  assert.equal(host.history.state.musicLibrary.access, 'vip');
  assert.equal(host.history.state.musicPanel, undefined);
  host.move(-1); assert.equal(host.history.state.musicLibrary.access, undefined);
  panel.destroy();
});

test('resize/reset removes this mount’s panel marker without altering catalog history', () => {
  const host = new HistoryHost(), changes = [], panel = createMusicPanelHistory(host, value => changes.push(value));
  panel.open('detail'); panel.reset();
  assert.equal(changes.at(-1), null); assert.equal(host.history.state.musicPanel, undefined);
  assert.deepEqual(host.history.state.musicLibrary, { track: 'A', query: '' });
  panel.destroy();
});

test('a fresh mount ignores stale panel markers from another mount', () => {
  const host = new HistoryHost(), old = createMusicPanelHistory(host, () => {});
  old.open('detail'); old.close();
  const changes = [], current = createMusicPanelHistory(host, value => changes.push(value));
  host.move(1); assert.equal(changes.at(-1), null);
  current.destroy(); old.destroy();
});

// Small control harness: selectors are strict so malformed confirmation selectors fail.
class Node extends EventTarget {
  constructor() { super(); this.dataset = {}; this.textContent = ''; this.hidden = false; this.attributes = new Map(); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  toggleAttribute(name, value) { if (value) this.attributes.set(name, ''); else this.attributes.delete(name); }
  focus() { this.focused = true; }
  contains() { return false; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
}
function queueControls(locale = 'en') {
  const names = ['queue-dialog','queue-list','queue-count','repeat-label','repeat','repeat-one-icon','repeat-icon','shuffle','play-all','previous','next','queue-notice','dock-queue-notice','queue-empty','queue-clear','queue-add','queue-confirm','queue-close','queue-confirm-title','remove-next','remove-stop','remove-cancel'];
  const nodes = new Map(names.map(name => [`[data-${name}]`, new Node()]));
  const toggles = [new Node(), new Node()];
  const root = { dataset: { locale }, querySelector(selector) { assert.ok(nodes.has(selector), `unknown selector: ${selector}`); return nodes.get(selector); }, querySelectorAll(selector) { assert.equal(selector, '[data-queue-toggle]'); return toggles; } };
  const calls = [];
  const queue = { subscribe(fn) { fn({ items: [], repeat: 'off', activeTrackId: null, shuffle: false }); return () => calls.push('unsubscribe'); }, remove(id, options) { calls.push([id, options]); return options ? {} : { requiresConfirmation: true }; } };
  const controls = mountMusicQueueControls(root, { queue, player: { snapshot: () => ({ status: 'playing' }) }, getVisibleTracks: () => [] });
  return { nodes, toggles, calls, controls };
}

test('removing the playing song displays localized confirmation and does not remove it until an explicit choice', () => {
  const { nodes, calls, controls } = queueControls();
  const title = 'Afternoon <script> & friends';
  const row = { dataset: { queueId: 'A' }, querySelector(selector) { assert.equal(selector, '[data-queue-title]'); return { textContent: title }; } };
  const button = { disabled: false, closest: () => row, hasAttribute: () => false };
  nodes.get('[data-queue-list]').contains = node => node === row;
  const click = new Event('click'); Object.defineProperty(click, 'target', { value: { closest: () => button } });
  nodes.get('[data-queue-list]').dispatchEvent(click);
  assert.equal(nodes.get('[data-queue-confirm]').hidden, false);
  assert.equal(nodes.get('[data-queue-confirm-title]').textContent, `After removing “${title}”:`);
  assert.equal(nodes.get('[data-remove-next]').focused, true);
  assert.deepEqual(calls, [['A', undefined]]);
  nodes.get('[data-remove-stop]').dispatchEvent(new Event('click'));
  assert.deepEqual(calls.at(-1), ['A', { currentAction: 'stop' }]);
  assert.equal(nodes.get('[data-queue-confirm]').hidden, true);
  controls.destroy();
});

test('either queue opener receives focus again on close in the standalone preview', () => {
  const { nodes, toggles, controls } = queueControls();
  for (const toggle of toggles) {
    toggle.dispatchEvent(new Event('click'));
    assert.equal(nodes.get('[data-queue-dialog]').open, true);
    nodes.get('[data-queue-close]').dispatchEvent(new Event('click'));
    assert.equal(toggle.focused, true);
    assert.equal(toggle.attributes.get('aria-expanded'), 'false');
  }
  controls.destroy();
});
