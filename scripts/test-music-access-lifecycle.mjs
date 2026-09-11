import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicQueue } from '../src/scripts/musicPlayerQueue.js';
import { createMusicAccessLifecycle, readPlayerCapabilities } from '../src/scripts/musicAccessLifecycle.js';
import { notifyReaderSession, watchReaderSession, withReaderSessionChange, READER_SESSION_EVENT } from '../src/scripts/readerSessionEvents.js';

const song = (n, effectiveAccess = 'vip') => ({ id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `Song ${n}`,
  creatorName: 'Test', durationSec: 120, audioVersion: 1, policyVersion: 1, effectiveAccess,
  previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12, coverUrl: null });
const baseTime = Date.parse('2026-09-11T00:00:00.000Z');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
class Host extends EventTarget {
  constructor() {
    super(); this.crypto = webcrypto; this.CustomEvent = CustomEvent; this.writes = [];
    this.localStorage = { setItem: (key, value) => this.writes.push([key, value]), removeItem: key => this.writes.push([key, null]) };
    this.BroadcastChannel = class { constructor() { throw new Error('unavailable'); } };
  }
}
function setup(t) {
  let clock = 0, timerId = 0;
  const timers = new Map(), requests = [], host = new Host(), document = new EventTarget(); document.visibilityState = 'visible';
  const setTimer = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; };
  const clearTimer = id => timers.delete(id);
  const audio = new Audio(), player = createMusicPlayer(audio, { origin: 'https://music.example.test' });
  const queue = createMusicQueue(player, { now: () => clock });
  const model = { active: true, delivery: true, ttl: 60000, tracks: [song(1), song(2, 'free'), song(3)], capsStatus: 200,
    accessStatus: 200, accessBody: { effectiveAccess: 'vip', canPlayFull: true, canPreview: true }, capOverride: null, accessOverride: null };
  const caps = () => ({ authenticated: model.active, membershipStatus: model.active ? 'active' : 'none',
    canPlayVipFull: model.active && model.delivery, musicVipDeliveryEnabled: model.delivery,
    validUntil: model.active ? new Date(baseTime + clock + model.ttl).toISOString() : null, serverNow: new Date(baseTime + clock).toISOString() });
  const response = (status, body) => ({ status, json: async () => body });
  const fetcher = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/capabilities')) return model.capOverride ? model.capOverride() : response(model.capsStatus, caps());
    if (url.includes('/catalog')) return response(200, { schemaVersion: 2, tracks: model.tracks });
    if (url.includes('/access?')) return model.accessOverride ? model.accessOverride() : response(model.accessStatus, model.accessBody);
    throw new Error('Unexpected media fetch');
  };
  const lifecycle = createMusicAccessLifecycle(player, queue, { fetcher, host, document, now: () => clock, setTimer, clearTimer });
  const play = (id = 1, variant = 'full') => { queue.playVariant(song(id).id, variant, model.tracks); audio.metadata(variant === 'full' ? 120 : 30); audio.playing(); };
  const fail = () => { audio.currentSrc = audio.src; audio.error = { code: 3 }; audio.emit('error'); };
  const advance = async ms => {
    clock += ms;
    for (let tries = 0; tries < 20; tries++) {
      const due = [...timers.entries()].find(([, timer]) => timer.at <= clock);
      if (!due) break;
      timers.delete(due[0]); due[1].fn(); await flush();
      if (tries === 19) throw new Error('unbounded timers');
    }
  };
  t.after(() => { lifecycle.destroy(); queue.destroy(); player.destroy(); });
  return { lifecycle, player, queue, audio, model, host, document, requests, caps, response, play, fail, advance, timers,
    tickClock: ms => { clock += ms; } };
}

test('initial reads do not load media; one lifecycle per audio controller', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial');
  assert.equal(createMusicAccessLifecycle(f.player, f.queue), f.lifecycle);
  assert.equal(f.audio.src, ''); assert.equal(f.audio.plays.length, 0); assert.equal(f.requests.length, 2);
  for (const { options } of f.requests) assert.deepEqual([options.credentials, options.cache, options.redirect], ['same-origin', 'no-store', 'error']);
});
test('invalid capability timestamps and inconsistent authorization fail closed', () => {
  const valid = { authenticated: true, membershipStatus: 'active', canPlayVipFull: true, musicVipDeliveryEnabled: true,
    serverNow: '2026-09-11T00:00:00.000Z', validUntil: '2026-09-11T00:01:00.000Z' };
  assert.equal(readPlayerCapabilities(valid, 1000).remaining, 59000);
  for (const patch of [{ serverNow: null }, { validUntil: null }, { validUntil: valid.serverNow }, { authenticated: false },
    { membershipStatus: 'none' }, { musicVipDeliveryEnabled: false }]) assert.throws(() => readPlayerCapabilities({ ...valid, ...patch }));
  assert.throws(() => readPlayerCapabilities(valid, 60001));
  assert.throws(() => readPlayerCapabilities(valid, NaN));
});
test('capabilities failure preserves free full and explicit preview without VIP full', async t => {
  const f = setup(t); f.model.capsStatus = 503; await f.lifecycle.refresh('initial');
  f.play(2); assert.match(f.audio.src, /variant=full/);
  f.play(1, 'preview'); assert.match(f.audio.src, /variant=preview/);
  assert.equal(f.queue.playVariant(song(1).id, 'full', f.model.tracks), false);
});
test('free catalog becomes available while the independent capability request is unresolved', async t => {
  const f = setup(t), wait = deferred(); f.model.capOverride = () => wait.promise;
  const pending = f.lifecycle.refresh('initial'); await flush(); f.play(2);
  assert.match(f.audio.src, /variant=full/); wait.resolve(f.response(503, {})); await pending;
  assert.equal(f.player.snapshot().status, 'playing');
});
test('expiry unloads protected full, preserves only in-memory full position and ignores late play rejection', async t => {
  const f = setup(t); f.model.ttl = 1000; await f.lifecycle.refresh('initial'); f.play();
  f.audio.currentTime = 25; f.audio.emit('timeupdate'); const generation = f.player.snapshot().sourceGeneration;
  f.model.active = false; await f.advance(1000);
  assert.equal(f.audio.src, ''); assert.equal(f.audio.paused, true);
  assert.equal(f.player.snapshot().status, 'access_required'); assert.ok(f.player.snapshot().sourceGeneration > generation);
  assert.equal(f.lifecycle.snapshot().savedFullPosition.positionSec, 25);
  f.audio.plays[0].reject(new DOMException('late', 'NotSupportedError')); await flush();
  assert.equal(f.player.snapshot().status, 'access_required'); assert.equal(f.requests.filter(r => r.url.includes('/access?')).length, 0);
});
test('renewal at expiry remains paused and can resume only after a new user action', async t => {
  const f = setup(t); f.model.ttl = 1000; await f.lifecycle.refresh('initial'); f.play();
  f.audio.currentTime = 25; f.audio.emit('timeupdate');
  await f.advance(1000); assert.equal(f.player.snapshot().status, 'paused'); assert.equal(f.audio.plays.length, 1);
  f.queue.playCurrent(f.model.tracks); assert.equal(f.audio.plays.length, 2);
  f.audio.metadata(120); assert.equal(f.audio.currentTime, 25);
});
test('a blocked timer cannot let a user play with an expired hint', async t => {
  const f = setup(t); f.model.ttl = 1; await f.lifecycle.refresh('initial'); f.play(); f.player.pause();
  // Advance monotonic time without running the expiry callback.
  const timer = [...f.timers.values()].find(value => value.at === 1); assert.ok(timer);
  f.model.active = false; f.tickClock(2); f.player.play();
  assert.equal(f.audio.plays.length, 1); assert.equal(f.audio.src, '');
  await flush(); assert.equal(f.player.snapshot().status, 'access_required');
});
test('account invalidation is immediate, rejects stale successful reads, and never inherits a previous full source', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
  const wait = deferred(); f.model.capOverride = () => wait.promise;
  const read = f.lifecycle.refresh('manual'); notifyReaderSession('changing', f.host);
  assert.equal(f.audio.src, ''); assert.equal(f.lifecycle.snapshot().capabilities, null);
  wait.resolve(f.response(200, f.caps())); await read;
  assert.equal(f.lifecycle.snapshot().capabilities, null); f.player.play(); assert.equal(f.audio.src, '');
  f.model.capOverride = null; f.model.active = false; notifyReaderSession('changed', f.host); await flush();
  assert.equal(f.player.snapshot().status, 'access_required'); assert.equal(f.audio.plays.length, 1);
});
test('account changes leave free full and previews playing, while clearing old hints', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play(2);
  notifyReaderSession('changing', f.host); assert.equal(f.audio.paused, false); assert.match(f.audio.src, /variant=full/);
  f.model.active = false; notifyReaderSession('changed', f.host); await flush(); f.play(1, 'preview');
  notifyReaderSession('changing', f.host); assert.equal(f.audio.paused, false); assert.match(f.audio.src, /variant=preview/);
});
test('upgrade does not switch an active preview; explicit full starts at zero', async t => {
  const f = setup(t); f.model.active = false; await f.lifecycle.refresh('initial'); f.play(1, 'preview');
  f.audio.currentTime = 12; f.audio.emit('timeupdate'); f.model.active = true; await f.lifecycle.refresh();
  assert.match(f.audio.src, /variant=preview/); assert.equal(f.audio.currentTime, 12); assert.equal(f.audio.plays.length, 1);
  f.queue.playVariant(song(1).id, 'full', f.model.tracks);
  assert.match(f.audio.src, /variant=full/); assert.equal(f.audio.currentTime, 0); assert.equal(f.audio.plays.length, 2);
});
test('foreground events coalesce, pause protected full and do not resume after checking', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play(); const count = f.requests.length;
  f.document.dispatchEvent(new Event('visibilitychange')); f.host.dispatchEvent(new Event('focus'));
  assert.equal(f.audio.src, ''); await flush(); assert.equal(f.requests.length, count + 2);
  assert.equal(f.player.snapshot().status, 'paused'); assert.equal(f.audio.plays.length, 1);
});
test('page hidden does not interrupt ordinary playback; bfcache restore rechecks', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.audio.paused, false); f.document.visibilityState = 'visible';
  const event = new Event('pageshow'); event.persisted = true; f.host.dispatchEvent(event); await flush();
  assert.equal(f.audio.src, ''); assert.equal(f.player.snapshot().status, 'paused');
});
test('fresh free policy permits full after expiry without assuming VIP is permanent', async t => {
  const f = setup(t); f.model.ttl = 1000; await f.lifecycle.refresh('initial'); f.play();
  f.model.active = false; f.model.tracks[0] = song(1, 'free'); await f.advance(1000);
  assert.equal(f.player.snapshot().status, 'paused'); f.queue.playCurrent(f.model.tracks);
  assert.match(f.audio.src, /variant=full/);
});
test('known free-to-VIP policy or version changes unload the previous resource', async t => {
  const f = setup(t); f.model.active = false; await f.lifecycle.refresh('initial'); f.play(2);
  f.model.tracks[1] = song(2); await f.lifecycle.refresh(); assert.equal(f.audio.src, '');
  f.model.active = true; await f.lifecycle.refresh(); f.play(2);
  f.model.tracks[1] = { ...song(2), audioVersion: 2 }; await f.lifecycle.refresh();
  assert.equal(f.audio.src, ''); assert.equal(f.player.snapshot().activeAudioVersion, 2);
  f.model.tracks[1] = { ...f.model.tracks[1], policyVersion: 2 }; await f.lifecycle.refresh();
  assert.equal(f.player.snapshot().activePolicyVersion, 2);
});
for (const [status, code, state] of [[401, 'AUTH_REQUIRED', 'access_required'], [403, 'MEMBERSHIP_EXPIRED', 'access_required'],
  [403, 'ACCOUNT_RESTRICTED', 'access_required'], [503, 'MEMBERSHIP_UNAVAILABLE', 'access_unavailable'], [409, 'VERSION_CONFLICT', 'error'], [410, 'TRACK_UNAVAILABLE', 'error']]) {
  test(`full media failure makes one access probe and handles ${status}/${code} without advancing`, async t => {
    const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
    f.model.accessStatus = status; f.model.accessBody = { error: { code } }; f.fail(); f.fail(); await flush();
    assert.equal(f.requests.filter(r => r.url.includes('/access?')).length, 1);
    assert.equal(f.player.snapshot().status, state); assert.equal(f.audio.src, ''); assert.equal(f.audio.plays.length, 1);
    assert.equal(f.queue.snapshot().consecutiveFailures, 0);
  });
}
test('healthy access preserves bounded three-failure media recovery, not a payment prompt', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.queue.playAll(f.model.tracks);
  for (let i = 0; i < 3; i++) { f.fail(); await flush(); }
  assert.equal(f.audio.plays.length, 3); assert.equal(f.queue.snapshot().notice.code, 'FAILURE_LIMIT');
  assert.equal(f.requests.filter(r => r.url.includes('/access?')).length, 3);
  assert.equal(f.player.snapshot().status, 'error');
});
test('a preview error plus full access 403 stays a media error and never prompts payment', async t => {
  const f = setup(t); f.model.active = false; await f.lifecycle.refresh('initial'); f.play(1, 'preview');
  f.model.accessStatus = 403; f.model.accessBody = { error: { code: 'VIP_REQUIRED' } }; f.fail(); await flush();
  assert.equal(f.player.snapshot().status, 'error'); assert.equal(f.audio.plays.length, 1);
  assert.equal(f.player.snapshot().lastError.code, 'MEDIA_3');
});
test('stale access denial cannot unload a later selected song; stale success cannot resume after pause', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
  let wait = deferred(); f.model.accessOverride = () => wait.promise; f.fail(); f.play(2);
  wait.resolve(f.response(403, { error: { code: 'VIP_REQUIRED' } })); await flush();
  assert.equal(f.player.snapshot().activeTrackId, song(2).id); assert.equal(f.player.snapshot().status, 'playing');
  wait = deferred(); f.fail(); f.player.pause(); wait.resolve(f.response(200, f.model.accessBody)); await flush();
  assert.equal(f.audio.plays.length, 2); assert.equal(f.player.snapshot().status, 'paused');
});
test('destroy aborts requests, timers and subscriptions without later playback or refresh', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play(); const count = f.requests.length;
  f.lifecycle.destroy(); assert.equal(f.timers.size, 0);
  f.host.dispatchEvent(new Event('focus')); notifyReaderSession('changed', f.host); await f.advance(70000);
  assert.equal(f.requests.length, count); assert.equal(f.audio.plays.length, 1);
});
test('session notifications contain no identity, deduplicate transports and release listeners', () => {
  const host = new Host(), received = []; const stop = watchReaderSession(value => received.push(value), host);
  notifyReaderSession('changing', host); notifyReaderSession('changed', host);
  assert.deepEqual(received, ['changing', 'changed']);
  const [key, encoded] = host.writes[0], body = JSON.parse(encoded);
  assert.deepEqual(Object.keys(body).sort(), ['nonce', 'phase', 'version']);
  const event = new Event('storage'); event.key = key; event.newValue = encoded; host.dispatchEvent(event);
  assert.equal(received.length, 2);
  host.dispatchEvent(new CustomEvent(READER_SESSION_EVENT, { detail: { ...body, nonce: 'forged', canPlayVipFull: true } }));
  assert.equal(received.length, 2); stop(); notifyReaderSession('changed', host); assert.equal(received.length, 2);
});
test('session mutation signals invalidate before the request and settle on success or uncertainty', async () => {
  const host = new Host(), events = []; const stop = watchReaderSession(phase => events.push(phase), host);
  const pending = deferred();
  const task = withReaderSessionChange(() => { events.push('request'); return pending.promise; }, host);
  assert.deepEqual(events, ['changing', 'request']); pending.resolve('response');
  assert.equal(await task, 'response'); assert.deepEqual(events, ['changing', 'request', 'changed']);
  await assert.rejects(withReaderSessionChange(() => { throw new Error('network uncertain'); }, host));
  assert.deepEqual(events.slice(-2), ['changing', 'changed']); stop();
});
test('missing session-change completion can be recovered by explicit recheck', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
  f.lifecycle.accountChanged('changing'); assert.equal(f.audio.src, '');
  await f.lifecycle.refresh('manual'); assert.equal(f.player.snapshot().status, 'paused');
  f.queue.playCurrent(f.model.tracks); assert.equal(f.audio.plays.length, 2);
});
test('known unavailable versions stay out of subsequent full queue traversal until catalog refresh', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play(1);
  f.model.accessStatus = 410; f.model.accessBody = { error: { code: 'TRACK_UNAVAILABLE' } }; f.fail(); await flush();
  assert.equal(f.queue.snapshot().items[0].available, false);
  f.queue.setRepeat('all'); f.queue.next(); f.queue.next(); f.queue.next();
  assert.equal(f.player.snapshot().activeTrackId, song(2).id);
});
test('long-lived hints use bounded timer chunks instead of overflowing into a refresh loop', async t => {
  const f = setup(t); f.model.ttl = 2147483647 + 5000; await f.lifecycle.refresh('initial');
  assert.equal([...f.timers.values()][0].at, 2147483647);
  const count = f.requests.length; await f.advance(2147483647); assert.equal(f.requests.length, count);
  f.model.active = false; await f.advance(5000); assert.equal(f.requests.length, count + 2);
});
test('an access timeout stops full playback without another probe or queue advance', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
  f.model.accessOverride = () => new Promise((_, reject) => {
    f.requests.at(-1).options.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true });
  });
  f.fail(); await f.advance(8000);
  assert.equal(f.player.snapshot().status, 'access_unavailable'); assert.equal(f.audio.src, '');
  assert.equal(f.requests.filter(r => r.url.includes('/access?')).length, 1); assert.equal(f.audio.plays.length, 1);
});
test('notification transport failures cannot block the underlying account request', async () => {
  const host = new Host(); host.crypto = { randomUUID() { throw new Error('unavailable'); } };
  host.localStorage = { setItem() { throw new Error('blocked'); } };
  host.dispatchEvent = () => { throw new Error('blocked'); };
  assert.equal(await withReaderSessionChange(() => 'completed', host), 'completed');
});
test('a stale access denial cannot affect a new failed attempt on the same source generation', async t => {
  const f = setup(t); await f.lifecycle.refresh('initial'); f.play();
  const first = deferred(), second = deferred(); let count = 0;
  f.model.accessOverride = () => ++count === 1 ? first.promise : second.promise;
  const generation = f.player.snapshot().sourceGeneration; f.fail();
  f.player.play(); f.audio.metadata(); f.audio.playing(); f.fail();
  assert.equal(f.player.snapshot().sourceGeneration, generation);
  first.resolve(f.response(403, { error: { code: 'VIP_REQUIRED' } })); await flush();
  assert.equal(f.player.snapshot().lastError.code, 'MEDIA_3'); assert.notEqual(f.audio.src, '');
  second.resolve(f.response(200, f.model.accessBody)); await flush();
  assert.equal(f.player.snapshot().activeTrackId, song(2).id);
});
