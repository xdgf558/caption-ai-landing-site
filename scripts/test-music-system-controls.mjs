import test from 'node:test';
import assert from 'node:assert/strict';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicQueue } from '../src/scripts/musicPlayerQueue.js';
import { createMusicSystemControls, MUSIC_PLAYBACK_CHANNEL } from '../src/scripts/musicSystemControls.js';

const song = (n, effectiveAccess = 'free') => ({ id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `Song ${n}`,
  creatorName: 'Station Cat', durationSec: 120, audioVersion: 1, policyVersion: 1, effectiveAccess,
  previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12, coverUrl: 'https://invalid.example/untrusted.jpg' });
const tracks = [song(1), song(2, 'vip'), song(3)];
const vip = { canPlayVipFull: true, membershipStatus: 'active', musicVipDeliveryEnabled: true };
const origin = 'https://music.example.test';
function hub() {
  const ports = new Set(), pending = [], sent = [];
  return { ports, pending, sent, flush() { while (pending.length) pending.shift()(); },
    BroadcastChannel: class {
      constructor(name) { this.name = name; ports.add(this); }
      postMessage(value) {
        sent.push(structuredClone(value));
        for (const port of ports) if (port !== this && port.name === this.name) pending.push(() => ports.has(port) && port.onmessage?.({ data: structuredClone(value) }));
      }
      close() { ports.delete(this); }
    }
  };
}
function setup(t, { bus = hub(), id = 'tab-a', session, audio = new Audio(), clock = () => 1000, capability = vip } = {}) {
  const handlers = new Map(), calls = [], positions = [];
  const media = session || { metadata: null, playbackState: 'none',
    setActionHandler(action, callback) { calls.push([action, callback]); handlers.set(action, callback); },
    setPositionState(value) { positions.push(value); }
  };
  const host = { location: { origin }, crypto: { randomUUID: () => id }, BroadcastChannel: bus.BroadcastChannel,
    navigator: { mediaSession: media }, MediaMetadata: class { constructor(value) { Object.assign(this, value); } } };
  audio.playbackRate = 1;
  const player = createMusicPlayer(audio, { origin }), queue = createMusicQueue(player);
  queue.updateCatalog(tracks); queue.updateCapabilities(capability);
  const system = createMusicSystemControls(player, queue, { audio, getTracks: () => tracks, host, clock });
  const play = (n = 1, variant = 'full') => {
    queue.playVariant(song(n).id, variant, tracks); audio.metadata(variant === 'preview' ? 30 : 120); audio.playing();
  };
  const action = (name, details) => handlers.get(name)?.(details);
  t.after(() => { system.destroy(); queue.destroy(); player.destroy(); });
  return { player, queue, system, host, audio, play, action, handlers, media, calls, positions, bus };
}

test('mount and passive selection do not load audio, register system actions or claim playback', t => {
  const f = setup(t); f.player.select(tracks[0]);
  assert.equal(createMusicSystemControls(f.player, f.queue), f.system);
  assert.equal(f.audio.src, ''); assert.equal(f.audio.plays.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.bus.sent.length, 0);
  assert.equal(f.media.metadata, null); assert.equal(f.bus.ports.size, 1);
});
test('accepted user play registers independent actions and canonical public artwork only', t => {
  const f = setup(t); f.play();
  assert.equal(f.audio.plays.length, 1); assert.equal(f.handlers.size, 8);
  assert.equal(f.media.metadata.title, 'Song 1'); assert.equal(f.media.playbackState, 'playing');
  assert.deepEqual(f.media.metadata.artwork, [{ src: `${origin}/api/music/tracks/${tracks[0].id}/cover?v=1` }]);
  assert.equal(f.bus.sent.length, 1);
  assert.deepEqual(Object.keys(f.bus.sent[0]).sort(), ['instanceId', 'stamp', 'type', 'version']);
  assert.equal([...f.bus.ports][0].name, MUSIC_PLAYBACK_CHANNEL);
});
test('system play/pause/stop are idempotent and stop unloads without losing selection', t => {
  const f = setup(t); f.play(); f.action('play'); assert.equal(f.audio.plays.length, 1);
  f.audio.currentTime = 15; f.audio.emit('timeupdate'); f.action('pause'); assert.equal(f.audio.paused, true);
  assert.equal(f.media.playbackState, 'paused'); f.action('play'); assert.equal(f.audio.plays.length, 2);
  f.action('stop'); assert.equal(f.audio.src, ''); assert.equal(f.player.snapshot().currentTimeSec, 0);
  assert.equal(f.player.snapshot().activeTrackId, tracks[0].id); assert.equal(f.media.metadata, null);
  assert.equal(f.media.playbackState, 'none'); assert.equal(f.positions.at(-1), undefined);
});
test('system next and previous preserve queue permission filtering and the three-second rewind rule', t => {
  const f = setup(t, { capability: null }); f.play(); f.action('nexttrack');
  assert.equal(f.player.snapshot().activeTrackId, tracks[2].id);
  f.audio.metadata(120); f.audio.currentTime = 8; f.audio.emit('timeupdate'); f.action('pause');
  f.action('previoustrack'); assert.equal(f.audio.currentTime, 0); assert.equal(f.audio.paused, true);
  f.action('previoustrack'); assert.equal(f.player.snapshot().activeTrackId, tracks[0].id);
  assert.equal(f.audio.plays.length, 3); assert.equal(f.bus.sent.length, 3);
});
test('system seeks clamp to seekable media ranges, reject invalid numbers, and never start playback', t => {
  const f = setup(t); f.play(); f.action('pause');
  f.audio.seekable = { length: 1, start: () => 5, end: () => 20 };
  f.action('seekto', { seekTime: 1000, fastSeek: true }); assert.equal(f.audio.currentTime, 20);
  f.action('seekbackward'); assert.equal(f.audio.currentTime, 10);
  f.action('seekbackward', { seekOffset: 100 }); assert.equal(f.audio.currentTime, 5);
  for (const value of [NaN, Infinity, '12', undefined]) f.action('seekto', { seekTime: value });
  f.action('seekforward', { seekOffset: -1 }); assert.equal(f.audio.currentTime, 5);
  assert.equal(f.audio.paused, true); assert.equal(f.audio.plays.length, 1);
});
test('preview metadata and position describe the short resource, not full duration or source offset', t => {
  const f = setup(t, { capability: null }); f.play(2, 'preview');
  f.audio.currentTime = 7; f.audio.emit('timeupdate');
  assert.equal(f.media.metadata.title, 'Song 2 · 试听');
  assert.deepEqual(f.positions.at(-1), { duration: 30, playbackRate: 1, position: 7 });
  f.queue.setRepeat('all'); f.audio.ended = true; f.audio.emit('ended');
  assert.equal(f.audio.plays.length, 1); assert.equal(f.media.playbackState, 'paused');
});
test('position state waits for current metadata, throttles subsecond ticks, updates rate and clears on unload', t => {
  const f = setup(t); f.queue.playAll(tracks); assert.equal(f.positions.length, 0);
  f.audio.metadata(120); f.audio.playing(); const count = f.positions.length;
  for (let i = 1; i < 10; i++) { f.audio.currentTime = i / 10; f.audio.emit('timeupdate'); }
  assert.equal(f.positions.length, count);
  f.audio.playbackRate = 2; f.audio.emit('ratechange'); assert.equal(f.positions.at(-1).playbackRate, 2);
  f.audio.duration = Infinity; f.audio.emit('timeupdate'); assert.equal(f.positions.at(-1), undefined);
  f.audio.duration = 120; f.audio.emit('timeupdate'); f.player.unload({ status: 'access_required' });
  assert.equal(f.positions.at(-1), undefined); assert.equal(f.media.playbackState, 'none');
});
test('a denied core guard does not announce ownership or bypass access through a system action', t => {
  const f = setup(t); f.play(); f.player.unload({ status: 'access_required' });
  f.player.setPlayGuard(() => ({ status: 'access_required', code: 'VIP_REQUIRED' }));
  const claims = f.bus.sent.length; f.action('play');
  assert.equal(f.audio.src, ''); assert.equal(f.audio.plays.length, 1); assert.equal(f.bus.sent.length, claims);
});
test('last user play pauses another music player; automatic advancement never reclaims', t => {
  const bus = hub(), a = setup(t, { bus, id: 'a' }), b = setup(t, { bus, id: 'b', clock: () => 2000 });
  a.play(); bus.flush(); b.play(); bus.flush();
  assert.equal(a.audio.paused, true); assert.equal(b.audio.paused, false);
  assert.equal(a.media.metadata, null); assert.match(a.system.snapshot().notice, /另一个/);
  const claims = bus.sent.length; b.audio.ended = true; b.audio.emit('ended'); bus.flush();
  assert.equal(bus.sent.length, claims); assert.equal(a.audio.plays.length, 1);
  a.play(); bus.flush(); assert.equal(b.audio.paused, true); assert.equal(a.audio.paused, false);
});
test('same-tick concurrent claims converge without a pause echo or stale claim undoing a later click', t => {
  const bus = hub(), a = setup(t, { bus, id: 'a' }), b = setup(t, { bus, id: 'b' });
  a.play(); b.play(); bus.flush(); assert.equal(a.audio.paused, true); assert.equal(b.audio.paused, false);
  const stale = bus.sent[0]; a.play(); bus.flush();
  for (const port of bus.ports) port.onmessage({ data: stale });
  assert.equal(a.audio.paused, false); assert.equal(b.audio.paused, true); assert.equal(bus.sent.length, 3);
});
test('forged grant payloads, malformed claims and self echoes are ignored', t => {
  const f = setup(t); f.play(); const port = [...f.bus.ports][0];
  for (const value of [null, { ...f.bus.sent[0], stamp: Infinity }, { ...f.bus.sent[0], instanceId: 'other', stamp: 2000, canPlayVipFull: true }, f.bus.sent[0]]) port.onmessage({ data: value });
  assert.equal(f.audio.paused, false); assert.equal(f.bus.sent.length, 1);
});
test('remote takeover defeats pending errors and late play rejections without starting a third track', async t => {
  const bus = hub(), a = setup(t, { bus, id: 'a' }), b = setup(t, { bus, id: 'b' });
  let recover; a.queue.setErrorHandler((_, callback) => { recover = callback; });
  a.play(); a.audio.error = { code: 3 }; a.audio.emit('error'); b.play(); bus.flush(); recover();
  a.audio.plays[0].reject(new DOMException('late', 'NotSupportedError')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.audio.paused, true); assert.equal(a.audio.plays.length, 1); assert.equal(a.queue.snapshot().consecutiveFailures, 0);
});
test('missing channel and system API preserve basic playback', t => {
  const f = setup(t); f.system.destroy(); delete f.host.navigator.mediaSession;
  f.host.BroadcastChannel = class { constructor() { throw new Error('blocked'); } };
  const system = createMusicSystemControls(f.player, f.queue, { audio: f.audio, getTracks: () => tracks, host: f.host });
  t.after(() => system.destroy()); f.play(); assert.equal(f.audio.paused, false);
  assert.deepEqual(system.snapshot(), { mediaSessionSupported: false, coordinationSupported: false, notice: null });
});
test('unsupported actions and position API failures do not disable other media controls', t => {
  const handlers = new Map(), session = { metadata: null, playbackState: 'none',
    setActionHandler(action, callback) { if (action === 'seekto') throw new Error('unsupported'); handlers.set(action, callback); },
    setPositionState() { throw new Error('unavailable'); }
  };
  const f = setup(t, { session }); f.play(); handlers.get('pause')(); assert.equal(f.audio.paused, true);
  handlers.get('play')(); assert.equal(f.audio.plays.length, 2);
});
test('destroy clears owned handlers, metadata, positions and channel; captured callbacks become inert', t => {
  const f = setup(t); f.play(); const play = f.handlers.get('play');
  f.system.destroy(); f.system.destroy(); assert.equal(f.bus.ports.size, 0);
  assert.equal(f.media.metadata, null); assert.equal(f.media.playbackState, 'none');
  assert.ok([...f.handlers.values()].every(callback => callback === null));
  f.player.pause(); play(); assert.equal(f.audio.plays.length, 1);
});
test('a stale owner does not clear another component media session or act through old callbacks', t => {
  const f = setup(t); f.play(); const pause = f.handlers.get('pause'), count = f.calls.length;
  const foreign = { title: 'Other audio' }; f.media.metadata = foreign; pause();
  assert.equal(f.audio.paused, false); f.system.destroy();
  assert.equal(f.calls.length, count); assert.equal(f.media.metadata, foreign);
});
test('volume readback detects ignored/throwing writes and mute failures without loading media', t => {
  for (const throws of [false, true]) {
    const audio = new Audio(); Object.defineProperty(audio, 'volume', { get: () => 1, set() { if (throws) throw new Error('device volume'); } });
    const f = setup(t, { audio }); assert.equal(f.player.snapshot().volumeSupported, false);
    assert.equal(f.player.setVolume(.2), false); assert.equal(audio.src, '');
  }
  const f = setup(t); assert.equal(f.player.setVolume(.4), true); assert.equal(f.audio.volume, .4);
  Object.defineProperty(f.audio, 'muted', { get: () => false, set() { throw new Error('blocked'); } });
  assert.equal(f.player.setMuted(true), false); assert.equal(f.player.snapshot().muteSupported, false);
});
test('repeated mount/unmount and a virtual thirty-minute stream keep handles and broadcasts bounded', t => {
  const f = setup(t); f.play(); f.queue.setRepeat('all');
  for (let tick = 0; tick < 7200; tick++) {
    f.audio.currentTime = (tick / 4) % 120; f.audio.emit('timeupdate');
    if (tick && tick % 480 === 0) { f.audio.ended = true; f.audio.emit('ended'); f.audio.metadata(120); f.audio.playing(); }
  }
  assert.equal(f.bus.sent.length, 1); assert.equal(f.bus.ports.size, 1); assert.equal(f.handlers.size, 8);
  assert.ok(f.positions.length < 1900); f.system.destroy();
  for (let i = 0; i < 50; i++) {
    const system = createMusicSystemControls(f.player, f.queue, { audio: f.audio, getTracks: () => tracks, host: f.host });
    f.play(); system.destroy(); assert.equal(f.bus.ports.size, 0);
  }
});
test('old media handlers stay inert after ownership is lost and acquired again', t => {
  const bus = hub(), a = setup(t, { bus, id: 'a' }), b = setup(t, { bus, id: 'b' });
  a.play(); bus.flush(); const oldPause = a.handlers.get('pause');
  b.play(); bus.flush(); a.play(); bus.flush(); oldPause();
  assert.equal(a.audio.paused, false); assert.equal(b.audio.paused, true);
});
test('another component taking the session after our stop is preserved during cleanup', t => {
  const f = setup(t); f.play(); f.action('stop'); const count = f.calls.length;
  const foreign = { title: 'Game audio' }; f.media.metadata = foreign; f.system.destroy();
  assert.equal(f.media.metadata, foreign); assert.equal(f.calls.length, count);
});
test('throwing BroadcastChannel post and close degrade once without interrupting the accepted play', t => {
  const f = setup(t); f.system.destroy();
  f.host.BroadcastChannel = class { postMessage() { throw new Error('blocked'); } close() { throw new Error('closed'); } };
  const system = createMusicSystemControls(f.player, f.queue, { audio: f.audio, getTracks: () => tracks, host: f.host });
  f.play(); assert.equal(f.audio.plays.length, 1); assert.equal(system.snapshot().coordinationSupported, false);
  system.destroy();
});
test('an unsupported position API is not hammered by subsequent time updates', t => {
  const f = setup(t); let calls = 0; f.media.setPositionState = () => { calls++; throw new Error('unsupported'); };
  f.play(); for (let i = 1; i <= 100; i++) { f.audio.currentTime = i; f.audio.emit('timeupdate'); }
  assert.equal(calls, 1); assert.equal(f.audio.paused, false);
});
test('rewinding while paused and selecting a row never displaces another music tab', t => {
  const f = setup(t); f.play(); f.audio.currentTime = 20; f.audio.emit('timeupdate'); f.player.pause();
  const count = f.bus.sent.length; f.queue.previous(); f.player.select(tracks[2]);
  assert.equal(f.bus.sent.length, count); assert.equal(f.audio.paused, true);
});
test('last-user coordination does not touch unrelated audio elements', t => {
  const gameAudio = new Audio(); gameAudio.play();
  const bus = hub(), a = setup(t, { bus, id: 'a' }), b = setup(t, { bus, id: 'b' });
  a.play(); b.play(); bus.flush();
  assert.equal(a.audio.paused, true); assert.equal(gameAudio.paused, false);
});
