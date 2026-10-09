import assert from 'node:assert/strict';
import test from 'node:test';
import { stationClips, clipOriginalLinks, clipNextLinks, stationHomeClipModel } from '../src/redesign/clipView.js';
import { createStationClipSession } from '../src/redesign/clipSession.js';
import { renderMusicDetail } from '../src/redesign/musicRender.js';
import { createStationMusicSession } from '../src/redesign/musicSession.js';
import { createMusicLocalData } from '../src/scripts/musicLocalData.js';
import { createStationPlaybackStore } from '../src/redesign/musicResume.js';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { mountStationClips } from '../src/redesign/clipClient.js';
import { fixtureId } from './helpers/station-redesign-database.mjs';

const time = Date.parse('2026-10-07T00:00:00Z'), base = '/api/station/content';
const track = { id: fixtureId(9000), revision: 1, slug: 'a-song', href: '/en/music/tracks/a-song/', title: 'Song', artist: 'Station Cat', durationMs: 200000 };
const clip = { id: fixtureId(9001), trackId: track.id, track: { id: track.id }, type: 'short_video', title: 'A small film', revision: 1,
  durationMs: 30000, publishedAt: new Date(time - 1000).toISOString(), mediaUrl: base + '/assets/' + fixtureId(9002), posterUrl: base + '/assets/' + fixtureId(9003),
  publications: [{ channel: 'youtube', href: 'https://www.youtube.com/watch?v=synthetic-fixture', publishedAt: new Date(time - 2000).toISOString() }] };
const second = { ...clip, id: fixtureId(9010), type: 'mv', mediaUrl: base + '/assets/' + fixtureId(9011) };
const model = clips => ({ mode: 'detail', locale: 'en', track, clips, related: [], error: null });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('home player DTOs cannot add cards outside the published home/promotion selection or replace its owned poster', () => {
  const home = { locale: 'en', music: track, clips: [{ id: clip.id, trackId: track.id, posterUrl: clip.posterUrl }] };
  assert.deepEqual(stationHomeClipModel(home, [clip, second]).clips.map(c => c.id), [clip.id]);
  for (const patch of [{ clips: [] }, { music: null }, { clips: [{ ...home.clips[0], posterUrl: second.mediaUrl }] }, { clips: [home.clips[0], { ...home.clips[0], id: clip.id.toUpperCase() }] }]) {
    assert.deepEqual(stationHomeClipModel({ ...home, ...patch }, [clip, second]).clips, []);
  }
  assert.deepEqual(stationHomeClipModel(home, [{ ...clip, trackId: fixtureId(2) }]).clips, []);
});
test('end-of-video navigation only returns the owning localized song and currently live verified platforms', () => {
  const links = [{ id: fixtureId(9090), provider: 'youtube', href: 'https://www.youtube.com/watch?v=synthetic-fixture', status: 'live', verifiedAt: new Date(time - 1).toISOString() }];
  assert.equal(clipNextLinks({ ...track, platforms: links }, 'en').platforms.length, 1);
  for (const status of ['planned', 'removed']) assert.deepEqual(clipNextLinks({ ...track, platforms: [{ ...links[0], status }] }, 'en').platforms, []);
  for (const href of ['https://evil.test/a', '/games/cat-life/', '/ja/music/tracks/a-song/']) assert.equal(clipNextLinks({ ...track, href }, 'en').song, null);
  assert.equal(clipNextLinks(track, 'unknown').song, null);
});

test('cards require published, bounded, unambiguous clips associated with this exact song', () => {
  assert.equal(stationClips(model([clip]), time).length, 1);
  for (const patch of [{ trackId: fixtureId(3) }, { track: { id: fixtureId(3) } }, { type: 'iframe' }, { durationMs: 0 }, { durationMs: 86400001 },
    { revision: 0 }, { title: ' ' }, { title: '\u0000bad' }, { publishedAt: null }, { publishedAt: new Date(time + 1).toISOString() }]) {
    assert.deepEqual(stationClips(model([{ ...clip, ...patch }]), time), [], JSON.stringify(patch));
  }
  assert.deepEqual(stationClips({ ...model([clip]), mode: 'catalog' }, time), []);
  assert.deepEqual(stationClips(model(Array(5).fill(clip)), time), []);
  assert.deepEqual(stationClips(model([clip, { ...clip, id: clip.id.toUpperCase() }]), time), []);
});
test('media and poster only use exact controlled asset paths, never foreign URLs or private query strings', () => {
  for (const value of ['https://evil.test/a.mp4', '//evil.test/a', clip.mediaUrl + '?token=private', clip.mediaUrl + '#x', clip.mediaUrl + '/', '/games/cat-life/', '/api/music/audio/old']) {
    assert.deepEqual(stationClips(model([{ ...clip, mediaUrl: value }]), time), []);
    assert.deepEqual(stationClips(model([{ ...clip, posterUrl: value }]), time), []);
  }
  assert.deepEqual(stationClips(model([{ ...clip, posterUrl: clip.mediaUrl }]), time), []);
});
test('fallback URLs are past, verified provider HTTPS addresses; ambiguity and oversized arrays cannot leak targets', () => {
  assert.equal(clipOriginalLinks(clip, time).length, 1);
  for (const patch of [{ publishedAt: null }, { publishedAt: 'wrong' }, { publishedAt: new Date(time + 1).toISOString() }, { href: 'https://www.youtube.com.evil.test/watch?v=x' },
    { href: 'https://www.youtube.com/watch?v=x&token=private' }, { href: 'https://user:pass@www.youtube.com/watch?v=x' }, { channel: 'unknown' }]) {
    assert.deepEqual(clipOriginalLinks({ ...clip, publications: [{ ...clip.publications[0], ...patch }] }, time), []);
  }
  assert.equal(clipOriginalLinks({ ...clip, publications: [clip.publications[0], clip.publications[0]] }, time).length, 1);
  assert.deepEqual(clipOriginalLinks({ ...clip, publications: Array(11).fill(clip.publications[0]) }, time), []);
});
test('four languages render escaped posters/durations and no-JS original links without any video or eager media source', () => {
  for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja']) {
    const html = renderMusicDetail({ ...model([{ ...clip, title: '<script>alert("x")</script>' }, second]), locale, track: { ...track, href: (locale === 'zh-Hant' ? '/' : locale === 'zh-Hans' ? '/zh-hans/' : '/' + locale + '/') + 'music/tracks/a-song/' } });
    assert.match(html, /data-sc-clip="[a-f0-9-]+"[^>]+hidden/); assert.match(html, /00:30/);
    assert.match(html, /&lt;script&gt;/); assert(!html.includes('<script>') || !html.includes('alert("x")'));
    assert.match(html, /target="_blank" rel="noopener noreferrer"/); assert.match(html, /loading="lazy"/);
    assert(!/<(?:video|iframe)\b/.test(html)); assert(!html.includes(clip.mediaUrl)); assert(!html.includes('undefined'));
  }
  assert(!renderMusicDetail(model([{ ...clip, trackId: fixtureId(7) }])).includes('sc-clip-card'));
});

class Video extends EventTarget {
  constructor(order, result) { super(); this.order = order; this.result = result; this.attrs = new Map(); this.paused = true; this.ended = false; this.loads = 0; this.removed = false; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  removeAttribute(key) { this.attrs.delete(key); if (['src', 'poster'].includes(key)) this[key] = ''; }
  pause() { this.order.push('pause-video'); this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.loads++; }
  remove() { this.removed = true; }
  play() { this.order.push('play-video'); this.paused = false; this.dispatchEvent(new Event('play')); return this.result?.() || Promise.resolve(); }
  event(type) { this.dispatchEvent(new Event(type)); }
}
function setup(results = [], pauseMusic) {
  const order = [], videos = [], states = [];
  const session = createStationClipSession({ clips: [clip, second], pauseMusic: pauseMusic || (() => order.push('pause-music')),
    createVideo() { order.push('create-video'); const video = new Video(order, results[videos.length]); videos.push(video); return video; },
    mount(node) { assert.equal(node, videos.at(-1)); order.push('mount'); }, view(value) { states.push(value); } });
  return { session, order, videos, states };
}
test('nothing creates or plays media before a gesture; music pauses before video construction and play', () => {
  const f = setup(); assert.equal(f.videos.length, 0); assert.equal(f.session.snapshot().status, 'idle');
  assert.equal(f.session.open('unmapped'), false); assert.equal(f.videos.length, 0);
  f.session.open(clip.id); assert.deepEqual(f.order.slice(0, 4), ['pause-music', 'create-video', 'mount', 'play-video']);
  const video = f.videos[0]; assert.equal(video.src, clip.mediaUrl); assert.equal(video.poster, clip.posterUrl);
  assert(video.controls && video.playsInline); assert.equal(video.preload, 'none'); assert(video.attrs.has('playsinline'));
  f.session.destroy();
});
test('playing, buffering, pause and end reflect native events, not a fulfilled play promise', async () => {
  const f = setup(); f.session.open(clip.id); await tick(); assert.equal(f.session.snapshot().status, 'loading');
  const v = f.videos[0]; v.event('playing'); assert.equal(f.session.snapshot().status, 'playing');
  v.event('waiting'); assert.equal(f.session.snapshot().status, 'buffering');
  f.session.pause(); assert.equal(f.session.snapshot().status, 'paused');
  v.ended = true; v.event('ended'); assert.equal(f.session.snapshot().status, 'ended');
  v.play(); assert.equal(f.order.at(-1), 'pause-music'); f.session.destroy();
});
test('rapid switching tears down all previous elements; late promises/events cannot revive or overwrite the latest video', async () => {
  const pending = [], f = setup([() => new Promise(resolve => pending.push(resolve)), () => new Promise((resolve, reject) => pending.push(reject))]);
  f.session.open(clip.id); const first = f.videos[0];
  f.session.open(second.id); const next = f.videos[1];
  assert(first.paused && first.removed); assert.equal(first.src, ''); assert.equal(first.poster, ''); assert(first.loads > 0);
  first.event('playing'); first.event('error'); pending[0](); await tick();
  assert.equal(f.session.snapshot().clip.id, second.id); assert.equal(next.src, second.mediaUrl);
  f.session.open(clip.id); pending[1]({ name: 'NotAllowedError' }); await tick();
  assert.equal(f.session.snapshot().error, null); assert.equal(f.session.snapshot().clip.id, clip.id); f.session.destroy();
});
test('closing immediately clears source, aborts listeners, and does not resume audio when a pending play resolves', async () => {
  let done; const f = setup([() => new Promise(resolve => { done = resolve; })]);
  f.session.open(clip.id); const v = f.videos[0], calls = f.order.filter(item => item === 'pause-music').length;
  f.session.close(); assert(v.paused && v.removed); assert.equal(v.src, ''); assert.equal(f.session.snapshot().clip, null);
  v.event('playing'); done(); await tick(); assert.equal(f.session.snapshot().status, 'idle');
  assert.equal(f.order.filter(item => item === 'pause-music').length, calls); f.session.destroy();
});
test('codec and browser denial show distinct recoverable errors; retry makes a fresh element and retires the failed attempt', async () => {
  for (const blocked of [false, true]) {
    const f = setup(blocked ? [() => Promise.reject({ name: 'NotAllowedError' })] : []);
    f.session.open(clip.id); if (!blocked) f.videos[0].event('error'); await tick();
    assert.equal(f.session.snapshot().status, 'error'); assert.equal(f.session.snapshot().error, blocked ? 'PLAY_NOT_ALLOWED' : 'PLAY_FAILED');
    assert.equal(f.videos[0].src, ''); assert(f.session.retry()); assert.equal(f.videos.length, 2);
    f.videos[1].event('playing'); assert.equal(f.session.snapshot().status, 'playing'); f.session.destroy();
  }
});
test('synchronous music pause/video construction/play failure stays recoverable without a live element', () => {
  for (const failAt of ['music', 'create', 'play']) {
    let v;
    const s = createStationClipSession({ clips: [clip], pauseMusic() { if (failAt === 'music') throw Error('pause'); },
      createVideo() { if (failAt === 'create') throw Error('create'); v = new Video([], () => { throw Error('play'); }); return v; } });
    assert(s.open(clip.id)); assert.equal(s.snapshot().status, 'error'); if (v) assert.equal(v.src, ''); s.destroy();
  }
});
test('destroy is final and ignores late events, retries and new open attempts', async () => {
  let done; const f = setup([() => new Promise(resolve => { done = resolve; })]); f.session.open(clip.id); const v = f.videos[0];
  f.session.destroy(); done(); v.event('playing'); await tick();
  assert.equal(v.src, ''); assert(v.paused && v.removed); assert.equal(f.session.retry(), false); assert.equal(f.session.open(second.id), false);
});
test('video cancels a real T09 pending private handshake; its late successful response cannot prepare or play full audio', async () => {
  const audio = new Audio(), data = new Map(), storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  let respond;
  const song = { ...track, fullPlayback: { requiresAccessCheck: true, playbackPath: base + '/tracks/a-song/playback?variant=full' } };
  const music = createStationMusicSession(audio, { origin: 'https://station.example.test', local: createMusicLocalData({ storage: () => storage }),
    store: createStationPlaybackStore({ storage: () => storage }), fetcher: () => new Promise(resolve => { respond = resolve; }) });
  const checking = music.prepareFull(song), video = setup([], () => music.pause()); video.session.open(clip.id);
  respond(new Response(JSON.stringify({ trackId: song.id, variant: 'full', revision: 1, durationMs: song.durationMs, audioPath: base + '/tracks/a-song/audio?variant=full&v=1' }), { headers: { 'Content-Type': 'application/json' } }));
  assert.equal(await checking, false); assert.equal(music.isPrepared(song), false); assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0);
  video.session.close(); assert.equal(audio.plays.length, 0); video.session.destroy(); music.destroy();
});
test('video stops an actual T09 audio source before starting; closing leaves the music paused', () => {
  const audio = new Audio(), storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const music = createStationMusicSession(audio, { origin: 'https://station.example.test', local: createMusicLocalData({ storage: () => storage }), store: createStationPlaybackStore({ storage: () => storage }) });
  const song = { ...track, preview: { revision: 1, durationMs: 30000, playbackPath: base + '/tracks/a-song/playback?variant=preview' } };
  music.play(song, 'preview'); audio.metadata(30); audio.playing(); assert.equal(music.snapshot().status, 'playing');
  const f = setup([], () => music.pause()); f.session.open(clip.id);
  assert.equal(music.snapshot().status, 'paused'); assert.equal(audio.paused, true); const count = audio.plays.length;
  f.session.close(); assert.equal(audio.plays.length, count); f.session.destroy(); music.destroy();
});

// Controlled DOM substitute for timing and reciprocal music intent. Native
// dialog focus/inertness/decoding are checked separately in the actual browser.
class Node extends EventTarget {
  constructor() { super(); this.hidden = true; this.dataset = {}; this.nodes = new Map(); this.options = []; this.isConnected = true; this.classes = new Set();
    this.classList = { add: (...names) => names.forEach(n => this.classes.add(n)), remove: (...names) => names.forEach(n => this.classes.delete(n)) }; }
  querySelector(name) { return this.nodes.get(name); }
  querySelectorAll() { return this.buttons || []; }
  append(node) { this.options.push(node); }
  replaceChildren(node) { this.child = node; }
  removeAttribute(name) { delete this[name]; }
  focus() { document.activeElement = this; }
  contains(node) { return this.buttons?.includes(node); }
  closest() { return this; }
}
class Click extends Event { constructor(target) { super('click', { cancelable: true }); this.node = target; } get target() { return this.node; } }
function clientFixture({ reduced = true, supported = true } = {}) {
  const previous = ['document', 'window', 'matchMedia', 'getComputedStyle'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const dialog = new Node(), panel = new Node(), root = new Node(), videos = [], status = { status: 'idle' }, main = new Node();
  const buttons = [clip, second].map(c => { const node = new Node(); node.dataset.scClip = c.id; return node; }); root.buttons = buttons;
  dialog.open = false; dialog.showModal = supported ? () => { dialog.open = true; dialog.querySelector('[data-sc-video-close]').focus(); } : undefined;
  dialog.close = () => { dialog.open = false; }; // native close event can arrive later, after re-opening
  dialog.nodes.set('.t-modal', panel);
  for (const name of ['host', 'retry', 'status', 'title', 'kind', 'select', 'original', 'selector', 'close', 'song', 'next', 'platforms']) dialog.nodes.set('[data-sc-video-' + name + ']', new Node());
  let subscriber, pauses = 0;
  const music = { pause() { pauses++; subscriber?.({ status: 'paused' }); }, subscribe(fn) { subscriber = fn; fn(status); return () => { subscriber = null; }; } };
  const doc = Object.assign(new EventTarget(), { activeElement: null, documentElement: {}, visibilityState:'visible', querySelector: () => dialog, getElementById: () => main,
    createElement(type) { if (type !== 'video') return new Node(); const v = new Video([], () => Promise.resolve()); videos.push(v); return v; } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc }); Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: reduced }) });
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ getPropertyValue: () => '150ms' }) });
  const dispose = mountStationClips(root, model([clip, second]), music);
  return { dialog, buttons, videos, panel, main, doc, pauses: () => pauses,
    click(index) { const event = new Click(buttons[index]); root.dispatchEvent(event); return event; }, musicIntent(value) { subscriber?.({ status: value }); },
    close() { dialog.querySelector('[data-sc-video-close]').dispatchEvent(new Event('click')); },
    cleanup() { dispose(); for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } }, dispose };
}
test('dialog escape stops immediately and returns focus to the exact triggering card', () => {
  const f = clientFixture(); try {
    assert(f.buttons.every(b => !b.hidden)); f.click(1); assert(f.dialog.open); assert.equal(f.videos.length, 1);
    const event = new Event('cancel', { cancelable: true }); f.dialog.dispatchEvent(event);
    assert(event.defaultPrevented); assert.equal(f.dialog.open, false); assert.equal(f.videos[0].src, ''); assert.equal(f.doc.activeElement, f.buttons[1]);
  } finally { f.cleanup(); }
});
test('game entry closes the actual T11 dialog immediately, clears media and cannot return focus behind the game', () => {
  const f = clientFixture({ reduced: false }); try {
    f.click(0); const focus = f.doc.activeElement;
    window.dispatchEvent(new Event('station:game-enter'));
    assert.equal(f.dialog.open, false); assert.equal(f.videos[0].src, ''); assert(f.videos[0].paused);
    assert.equal(f.doc.activeElement, focus);
    f.dispose(); const count = f.videos.length; window.dispatchEvent(new Event('station:game-enter')); assert.equal(f.videos.length, count);
  } finally { f.cleanup(); }
});
test('validated home card uses the same click player; unsupported dialog leaves ordinary navigation intact', () => {
  let f = clientFixture(); try { f.buttons[0].tagName = 'A'; assert(f.click(0).defaultPrevented); f.videos[0].event('ended'); assert.equal(f.dialog.querySelector('[data-sc-video-next]').hidden, false); assert.equal(f.dialog.querySelector('[data-sc-video-song]').href, track.href); } finally { f.cleanup(); }
  f = clientFixture({ supported: false }); try { f.buttons[0].tagName = 'A'; assert(!f.click(0).defaultPrevented); } finally { f.cleanup(); }
});
test('HTML action boundaries keep Tab in the dialog while native video controls retain their own sequence', () => {
  const f = clientFixture(); try {
    f.click(0); const first = f.dialog.querySelector('[data-sc-video-close]'), last = f.dialog.querySelector('[data-sc-video-select]');
    const backward = new Event('keydown', { cancelable: true }); Object.defineProperties(backward, { key: { value: 'Tab' }, shiftKey: { value: true } });
    f.dialog.dispatchEvent(backward); assert(backward.defaultPrevented); assert.equal(f.doc.activeElement, last);
    const forward = new Event('keydown', { cancelable: true }); Object.defineProperties(forward, { key: { value: 'Tab' }, shiftKey: { value: false } });
    f.dialog.dispatchEvent(forward); assert(forward.defaultPrevented); assert.equal(f.doc.activeElement, first);
    const enter = new Event('keydown', { cancelable: true }); Object.defineProperty(enter, 'key', { value: 'Enter' }); f.dialog.dispatchEvent(enter); assert(!enter.defaultPrevented);
  } finally { f.cleanup(); }
});
test('close animation never owns media; rapid re-open and an old native close event cannot destroy the new attempt', async () => {
  const f = clientFixture({ reduced: false }); try {
    f.click(0); f.close(); assert(f.dialog.open); assert.equal(f.videos[0].src, '');
    f.click(1); f.dialog.dispatchEvent(new Event('close')); await new Promise(resolve => setTimeout(resolve, 200));
    assert(f.dialog.open); assert.equal(f.dialog.dataset.clipId, second.id); assert.equal(f.videos[1].src, second.mediaUrl);
  } finally { f.cleanup(); }
});
test('a new music intent closes video synchronously, while paused/error music cannot close a new video', () => {
  for (const value of ['loading', 'playing', 'buffering']) {
    const f = clientFixture(); try {
      f.click(0); f.musicIntent('paused'); f.musicIntent('error'); assert(f.dialog.open);
      f.musicIntent(value); assert.equal(f.dialog.open, false); assert.equal(f.videos[0].src, '');
    } finally { f.cleanup(); }
  }
});
test('pagehide and view disposal unload video without resuming audio or letting detached clicks re-open it', () => {
  const f = clientFixture(); try {
    f.click(0); window.dispatchEvent(new Event('pagehide')); assert.equal(f.dialog.open, false); assert.equal(f.videos[0].src, '');
    f.click(1); f.dispose(); assert.equal(f.videos[1].src, ''); const count = f.videos.length; f.click(0); assert.equal(f.videos.length, count);
  } finally { f.cleanup(); }
});
test('removed trigger falls back to main focus, and unsupported native dialog keeps inert play controls hidden', () => {
  let f = clientFixture(); try { f.click(0); f.buttons[0].isConnected = false; f.close(); assert.equal(f.doc.activeElement, f.main); } finally { f.cleanup(); }
  f = clientFixture({ supported: false }); try { assert(f.buttons.every(b => b.hidden)); f.click(0); assert.equal(f.videos.length, 0); } finally { f.cleanup(); }
});
