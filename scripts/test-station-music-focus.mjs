import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { getStationMusicSession, disposeStationMusicSession, rememberStationMusicTrigger } from '../src/redesign/musicPlayerView.js';
import { STATION_PLAYBACK_KEY } from '../src/redesign/musicResume.js';

const track = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'a-song', revision: 1, title: 'A song', artist: 'Station Cat', durationMs: 180000,
  preview: { revision: 1, durationMs: 30000, playbackPath: '/api/station/content/tracks/a-song/playback?variant=preview' } };
function fixture(t, storedFull = false) {
  const originals = new Map(['document', 'window', 'location', 'localStorage', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = new EventTarget(), audio = new Audio(), memory = new Map(); let fetches = 0;
  class Node extends EventTarget {
    constructor() { super(); this.dataset = {}; this.attributes = {}; this.nodes = new Map(); this.isConnected = true; this.hidden = false; }
    setAttribute(key, value) { this.attributes[key] = value; }
    querySelector(key) { if (!this.nodes.has(key)) this.nodes.set(key, new Node()); return this.nodes.get(key); }
    closest() { return this.querySelector('label'); }
    focus() { document.activeElement = this; }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const dock = new Node(), main = new Node(), trigger = new Node();
  document.querySelector = selector => selector === '[data-sc-music-audio]' ? audio : selector === '[data-sc-player-dock]' ? dock : null;
  document.getElementById = id => id === 'station-main' ? main : null;
  const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
  if (storedFull) memory.set(STATION_PLAYBACK_KEY, JSON.stringify({ schemaVersion: 1, trackId: track.id, slug: track.slug, revision: 1,
    variant: 'full', previewRevision: null, positionSec: 40, savedAt: Date.now() }));
  for (const [key, value] of Object.entries({ document, window: new EventTarget(), location: { origin: 'https://station.example.test' },
    localStorage: storage, sessionStorage: storage, fetch: async () => { fetches++; throw new Error('Unexpected request'); } })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    disposeStationMusicSession();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  const session = getStationMusicSession('zh-Hant');
  return { audio, dock, document, main, trigger, session, fetches: () => fetches };
}

test('closing the preview dock unloads audio and returns focus to its real trigger', t => {
  const f = fixture(t); rememberStationMusicTrigger(f.trigger); f.session.play(track, 'preview'); f.audio.metadata(30); f.audio.playing();
  assert.equal(f.dock.hidden, false); assert.equal(f.dock.querySelector('[data-sc-play-toggle]').attributes['aria-label'], '暫停');
  f.dock.querySelector('[data-sc-play-toggle]').click();
  assert.equal(f.audio.paused, true); assert.equal(f.dock.querySelector('[data-sc-play-toggle]').attributes['aria-label'], '播放');
  f.dock.querySelector('[data-sc-player-close]').click();
  assert.equal(f.document.activeElement, f.trigger); assert.equal(f.dock.hidden, true); assert.equal(f.audio.src, '');
});
test('closing after the preview trigger leaves the page focuses the main region', t => {
  const f = fixture(t); rememberStationMusicTrigger(f.trigger); f.session.play(track, 'preview'); f.trigger.isConnected = false;
  f.dock.querySelector('[data-sc-player-close]').click(); assert.equal(f.document.activeElement, f.main);
});
test('mounting with an old full selection keeps the dock hidden without requests or focus changes', async t => {
  const f = fixture(t, true); f.trigger.focus(); await f.session.restore();
  assert.equal(f.dock.hidden, true); assert.equal(f.session.snapshot().track, null); assert.equal(f.audio.src, '');
  assert.equal(f.fetches(), 0); assert.equal(f.document.activeElement, f.trigger);
  assert.equal(f.dock.querySelector('[data-sc-player-status]').textContent, '');
  f.dock.querySelector('[data-sc-play-toggle]').click(); assert.equal(f.audio.plays.length, 0);
});
