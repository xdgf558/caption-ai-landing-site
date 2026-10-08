import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createStationGameSession } from '../src/redesign/gameSession.js';
import { GAME_PROTOCOL, GAME_ID, GAME_START_TIMEOUT_MS } from '../src/redesign/gameProtocol.js';
import { handleStationGameRuntime } from '../src/redesign/gameRuntime.js';
import { catLifeSaveHarness } from './helpers/cat-life-save-harness.mjs';
const id = n => 'ff000000-0000-4000-8000-' + String(n).padStart(12, '0');
function setup({ pauseMedia, mount, uuid } = {}) {
  const order = [], frames = [], views = [], timers = new Map(); let sequence = 0, time = 0;
  class Frame extends EventTarget {
    constructor() { super(); this.contentWindow = { postMessage: (value, origin) => order.push(['post', value, origin]) }; this.removed = false; }
    set src(value) { this.source = value; order.push(['src', value]); }
    remove() { this.removed = true; order.push(['remove']); }
  }
  const session = createStationGameSession({ origin: 'https://wwwstationcat.org', locale: 'en',
    uuid: uuid || (() => id(frames.length + 1)), clock: () => time,
    pauseMedia: pauseMedia || (() => order.push(['pause'])),
    createFrame() { order.push(['create']); const frame = new Frame(); frames.push(frame); return frame; },
    mount: mount || (() => order.push(['mount'])), view: state => views.push(state),
    timer(fn, ms) { const key = ++sequence; timers.set(key, { fn, ms }); return key; }, clearTimer(key) { timers.delete(key); } });
  function message(type, patch = {}, fields = {}) {
    return session.receive({ origin: 'https://wwwstationcat.org', source: frames.at(-1)?.contentWindow,
      data: { protocol: GAME_PROTOCOL, game_id: GAME_ID, launch_id: session.snapshot().launchId, type, ...patch }, ...fields });
  }
  return { session, order, frames, views, timers, message, setTime(value) { time = value; },
    expire(ms) { for (const [key, job] of [...timers]) if (job.ms === ms) { timers.delete(key); job.fn(); } } };
}
test('gesture pauses owned media before creating exactly one allowed runtime; load never means ready', () => {
  const f = setup(); assert.equal(f.frames.length, 0); f.session.launch();
  assert.deepEqual(f.order.slice(0, 2), [['pause'], ['create']]); assert.equal(f.session.launch(), false);
  const url = new URL(f.frames[0].source); assert.equal(url.pathname, '/games/cat-life/'); assert.equal(url.searchParams.get('sc_entry'), '1');
  assert.equal(url.searchParams.get('lang'), 'en'); assert.equal(url.searchParams.get('sc_launch_id'), id(1));
  f.frames[0].dispatchEvent(new Event('load')); assert.equal(f.session.snapshot().status, 'loading');
  f.setTime(740); assert(f.message('ready')); assert.equal(f.session.snapshot().elapsedMs, 740);
  assert.equal(f.message('ready'), false); assert.equal(f.timers.size, 0); f.session.destroy();
});
test('origin, source, protocol, game and per-attempt launch identity are all required', () => {
  const f = setup(); f.session.launch();
  for (const fields of [{ origin: 'https://evil.test' }, { source: {} }, { source: null }]) assert.equal(f.message('ready', {}, fields), false);
  for (const patch of [{ protocol: 'other' }, { game_id: 'other' }, { launch_id: id(99) }, { launch_id: null }]) assert.equal(f.message('ready', patch), false);
  for (const data of [null, 'ready', {}, []]) assert.equal(f.message('ready', {}, { data }), false);
  assert.equal(f.session.snapshot().status, 'loading'); f.session.destroy();
});
test('quick return waits for stopped acknowledgement; old ready and late errors cannot replace a retry', () => {
  const f = setup(); f.session.launch(); const old = f.frames[0], oldId = f.session.snapshot().launchId;
  f.session.close(); assert.equal(f.session.snapshot().status, 'stopping'); assert.equal(f.session.launch(), false);
  assert.equal(f.message('ready'), false); assert.equal(f.order.at(-1)[1].type, 'exit');
  assert(f.message('stopped')); assert(old.removed); assert.equal(old.source, 'about:blank'); assert.equal(f.timers.size, 0);
  assert.equal(f.session.snapshot().status, 'idle'); f.session.launch();
  old.dispatchEvent(new Event('error')); assert.equal(f.message('ready', { launch_id: oldId }, { source: old.contentWindow }), false);
  assert.equal(f.session.snapshot().status, 'loading'); assert(!f.frames[1].removed); f.session.destroy();
});
test('timeout and failed runtime restore only after retirement, without any save API', () => {
  const f = setup(); f.session.launch(); f.expire(GAME_START_TIMEOUT_MS);
  assert.equal(f.session.snapshot().status, 'stopping'); assert.equal(f.message('ready'), false);
  f.expire(1000); assert.equal(f.session.snapshot().status, 'error'); assert.equal(f.session.snapshot().error, 'timeout'); assert(f.frames[0].removed);
  assert.equal(f.session.launch(), true); assert(f.message('failed')); f.message('stopped');
  assert.equal(f.session.snapshot().status, 'error'); assert.equal(f.session.snapshot().error, 'load'); f.session.destroy();
});
test('save recovery is separate from successful startup and cannot become ready on a delayed message', () => {
  const f = setup(); f.session.launch(); assert(f.message('recovery')); assert.equal(f.session.snapshot().status, 'recovery');
  assert.equal(f.session.snapshot().elapsedMs, null); assert.equal(f.timers.size, 0); assert.equal(f.message('ready'), false);
  f.session.close(); f.message('stopped'); assert.equal(f.session.snapshot().status, 'idle'); f.session.destroy();
});
test('construction errors and final disposal cannot leave a mounted frame, timer or listener', () => {
  const invalid = setup({ uuid: () => 'not-a-uuid' }); assert.equal(invalid.session.launch(), false); assert.equal(invalid.frames.length, 0);
  const fail = setup({ mount() { throw new Error(); } }); assert.equal(fail.session.launch(), false); assert(fail.frames[0].removed); assert.equal(fail.timers.size, 0);
  const f = setup(); f.session.launch(); f.session.destroy(); const views = f.views.length;
  f.frames[0].dispatchEvent(new Event('error')); assert.equal(f.message('ready'), false); assert.equal(f.session.launch(), false);
  assert.equal(f.views.length, views); assert.equal(f.timers.size, 0); assert(f.frames[0].removed);
});
const request = (path = '/games/cat-life/?sc_entry=1&sc_launch_id=' + id(1), method = 'GET') => new Request('https://wwwstationcat.org' + path, { method });
test('closed/half-enabled runtime policy returns null before accessing the asset binding', async () => {
  for (const flags of [{}, { STATION_GAME_PAGES_ENABLED: true }, { STATION_CONTENT_PUBLIC_ENABLED: true }])
    assert.equal(await handleStationGameRuntime(request(), { ...flags, get ASSETS() { throw new Error('must not access'); } }), null);
});
test('same-origin embedding only touches exact valid HTML requests; streams media without reading body', async () => {
  const flags = { STATION_GAME_PAGES_ENABLED: true, STATION_CONTENT_PUBLIC_ENABLED: true };
  const raw = () => new Response('<p>Original runtime</p>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY' } });
  const env = { ...flags, ASSETS: { fetch: async () => raw() } };
  const r = await handleStationGameRuntime(request(), env); assert.equal(r.headers.get('X-Frame-Options'), 'SAMEORIGIN');
  assert.match(r.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/); assert.match(r.headers.get('Content-Security-Policy'), /object-src 'none'/);
  assert.equal(await r.text(), '<p>Original runtime</p>'); assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await (await handleStationGameRuntime(request(undefined, 'HEAD'), env)).text(), '');
  for (const path of ['/games/cat-life/', '/games/cat-life', '/games/cat-life/index.html?sc_entry=1&sc_launch_id=' + id(1),
    '/games/cat-life/?sc_entry=1&sc_launch_id=invalid', '/games/cat-life/?sc_entry=1&sc_launch_id=' + id(1) + '&sc_launch_id=' + id(2),
    '/games/other/?sc_entry=1&sc_launch_id=' + id(1), '/games/cat-life/src/js/main.js?sc_entry=1&sc_launch_id=' + id(1)]) assert.equal(await handleStationGameRuntime(request(path), env), null);
  assert.equal(await handleStationGameRuntime(request(undefined, 'POST'), env), null);
  const nonHtml = new Response('error', { status: 404 }); assert.equal(await handleStationGameRuntime(request(), { ...flags, ASSETS: { fetch: async () => nonHtml } }), nonHtml);
});
const bridgeSource = readFileSync(new URL('../public/games/cat-life/host-bridge.js', import.meta.url), 'utf8');
function bridge(h, { search = '?sc_entry=1&sc_launch_id=' + id(1), parent = true } = {}) {
  const sent = []; h.context.location.origin = 'http://localhost'; h.context.location.search = search;
  h.context.parent = parent ? { postMessage(data, origin) { sent.push({ data, origin }); } } : h.context;
  h.context.document.body = { setAttribute() {}, removeAttribute() {} };
  vm.runInContext(bridgeSource, h.context, { filename: 'host-bridge.js' }); return sent;
}
test('runtime bridge is dormant on standalone, invalid and unmarked addresses', () => {
  for (const options of [{ parent: false }, { search: '' }, { search: '?sc_launch_id=' + id(1) }, { search: '?sc_entry=1&sc_launch_id=bad' }]) {
    const h = catLifeSaveHarness(); bridge(h, options); assert.equal(h.context.CatGameHostBridge, undefined);
  }
});
test('actual runtime bridge refuses foreign/old exits and emits only fixed identity fields to exact origin', () => {
  const h = catLifeSaveHarness(), sent = bridge(h); const receive = h.listeners.get('message')[0];
  const data = { protocol: GAME_PROTOCOL, type: 'exit', game_id: GAME_ID, launch_id: id(1) };
  for (const event of [{ data, origin: 'http://evil.test', source: h.context.parent }, { data, origin: 'http://localhost', source: {} },
    { data: { ...data, launch_id: id(2) }, origin: 'http://localhost', source: h.context.parent }]) receive(event);
  assert(!h.context.CatGameHostBridge.isStopped()); h.context.CatGameHostBridge.ready(); assert.equal(sent[0].data.type, 'ready');
  receive({ data, origin: 'http://localhost', source: h.context.parent }); assert(h.context.CatGameHostBridge.isStopped());
  h.context.CatGameHostBridge.ready(); assert.equal(sent.length, 2); assert.equal(sent[1].data.type, 'stopped');
  for (const value of sent) { assert.equal(value.origin, 'http://localhost'); assert.deepEqual(Object.keys(value.data).sort(), ['game_id', 'launch_id', 'protocol', 'type']); }
});
test('actual main emits recovery rather than ready and never writes a damaged slot on exit', async () => {
  const raw = ' {broken original '; const h = catLifeSaveHarness({ main: true, entry: true, initial: { catGameSaveV1: raw } }); const sent = bridge(h);
  await h.fire('DOMContentLoaded'); assert(sent.some(value => value.data.type === 'recovery')); assert(!sent.some(value => value.data.type === 'ready'));
  h.context.dispatchEvent({ type: 'catgame:host-exit' }); await h.fire('pagehide');
  assert.equal(h.storage.getItem('catGameSaveV1'), raw); assert.equal(h.writes.length, 0);
});
test('embedded account login leaves the host while preserving the original account destination', async () => {
  const h = catLifeSaveHarness(), login = { href: '/en/library/?returnTo=original', target: '' };
  h.context.document.querySelectorAll = selector => selector === '[data-cat-member-login]' ? [login] : [];
  bridge(h); await h.fire('DOMContentLoaded');
  assert.equal(login.target, '_top'); assert.equal(login.href, '/en/library/?returnTo=original');
});
test('return during the actual pending account check never creates a game or overwrites any slot', async () => {
  const h = catLifeSaveHarness({ main: true, entry: true }); bridge(h); let resolve;
  h.context.CatGameSaveRecovery.selectSlot = () => new Promise(done => { resolve = done; });
  const loading = h.fire('DOMContentLoaded'); await new Promise(done => setImmediate(done));
  h.listeners.get('message')[0]({ origin: 'http://localhost', source: h.context.parent, data: { protocol: GAME_PROTOCOL, type: 'exit', game_id: GAME_ID, launch_id: id(1) } });
  resolve({ key: 'catGameSaveV1', member: false }); await loading; assert.equal(h.writes.length, 0); assert.equal(h.timers.length, 0);
});
