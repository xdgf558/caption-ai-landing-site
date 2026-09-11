import assert from 'node:assert/strict';
import test from 'node:test';
import { createMusicPlayer, musicSource } from '../src/scripts/musicPlayerCore.js';
import { readPlayerCatalog, playerVariant, formatMusicTime } from '../src/scripts/musicPlayerCatalog.js';

const origin = 'https://music.example.test';
const track = (letter, patch = {}) => ({ id: `${letter.repeat(8)}-${letter.repeat(4)}-4${letter.repeat(3)}-8${letter.repeat(3)}-${letter.repeat(12)}`,
  audioVersion: 1, policyVersion: 1, durationSec: 222, title: 'Test song', creatorName: 'Test creator', effectiveAccess: 'free',
  previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12, coverUrl: '/cover', ...patch });
class Audio extends EventTarget {
  constructor() {
    super(); this.volume = 1; this.muted = false; this.currentSrc = ''; this.src = ''; this.currentTime = 0;
    this.duration = NaN; this.readyState = 0; this.paused = true; this.ended = false; this.error = null;
    this.seekable = { length: 0 }; this.plays = []; this.loads = 0;
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loads++; this.currentSrc = ''; this.currentTime = 0; this.readyState = 0; this.duration = NaN; this.error = null; this.ended = false; }
  play() {
    this.paused = false;
    return new Promise((resolve, reject) => this.plays.push({ resolve, reject }));
  }
  pause() { this.paused = true; }
  emit(event) { this.dispatchEvent(new Event(event)); }
  metadata(duration = 222) {
    this.currentSrc = this.src; this.readyState = 1; this.duration = duration;
    this.seekable = { length: 1, start: () => 0, end: () => duration };
    this.emit('loadedmetadata');
  }
  playing() { this.readyState = 4; this.paused = false; this.emit('playing'); }
}
const setup = () => { const audio = new Audio(); return { audio, player: createMusicPlayer(audio, { origin }) }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('initialization and selection never set a media URL or play; one controller per element', () => {
  const { audio, player } = setup();
  assert.equal(audio.preload, 'none'); assert.equal(audio.autoplay, false);
  assert.equal(createMusicPlayer(audio, { origin }), player);
  player.select(track('a'));
  assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0);
  assert.equal(player.snapshot().status, 'idle'); assert.equal(player.snapshot().currentTimeSec, 0);
  assert.equal(player.snapshot().activeVariant, 'full');
  player.destroy();
});
test('play is synchronous, but playing state is driven by native events, not Promise resolution', async () => {
  const { audio, player } = setup();
  player.playTrack(track('a'));
  assert.equal(audio.plays.length, 1);
  assert.equal(audio.src, origin + musicSource(track('a'), 'full'));
  assert.equal(player.snapshot().status, 'loading');
  audio.plays[0].resolve(); await tick();
  assert.equal(player.snapshot().status, 'loading');
  audio.metadata(); audio.playing();
  assert.equal(player.snapshot().status, 'playing');
  audio.currentTime = 48; audio.emit('timeupdate'); player.playTrack(track('a'));
  assert.equal(player.snapshot().status, 'paused'); assert.equal(player.snapshot().currentTimeSec, 48);
  player.playTrack(track('a')); assert.equal(audio.currentTime, 48);
  assert.equal(audio.plays.length, 2); player.destroy();
});
test('A/B/C rapid replacement ignores old play failures and old resource events', async () => {
  const { audio, player } = setup();
  player.playTrack(track('a')); const sourceA = audio.src;
  player.playTrack(track('b')); player.playTrack(track('c'));
  audio.plays[0].reject(new DOMException('old', 'NotSupportedError'));
  audio.plays[1].reject(new DOMException('switch', 'AbortError'));
  audio.currentSrc = sourceA; audio.readyState = 4; audio.currentTime = 99; audio.error = { code: 4 };
  audio.emit('error'); audio.emit('playing'); audio.emit('timeupdate'); await tick();
  assert.equal(player.snapshot().activeTrackId, track('c').id);
  assert.equal(player.snapshot().currentTimeSec, 0); assert.equal(player.snapshot().lastError, null);
  assert.equal(player.snapshot().status, 'loading');
  audio.error = null; audio.metadata(); audio.playing(); audio.emit('pause'); audio.emit('ended');
  assert.equal(player.snapshot().status, 'playing'); assert.equal(player.snapshot().sourceGeneration, 3);
  player.destroy();
});
test('pausing an unresolved play keeps silence and ignores its later rejection', async () => {
  const { audio, player } = setup(); player.playTrack(track('a')); player.pause();
  audio.plays[0].reject(new DOMException('blocked', 'NotAllowedError')); await tick();
  audio.metadata(); audio.playing();
  assert.equal(audio.paused, true); assert.equal(player.snapshot().status, 'paused');
  assert.equal(player.snapshot().lastError, null); player.destroy();
});
test('an earlier play attempt cannot overwrite a later resume on the same source', async () => {
  const { audio, player } = setup(); player.playTrack(track('a')); audio.metadata();
  player.pause(); player.play(); audio.playing();
  audio.plays[0].reject(new DOMException('late', 'NotAllowedError')); await tick();
  assert.equal(player.snapshot().status, 'playing'); assert.equal(player.snapshot().lastError, null); player.destroy();
});
test('buffering only while playback intended; genuine end stops with no automatic next song', () => {
  const { audio, player } = setup(); player.playTrack(track('a')); audio.metadata(); audio.playing();
  audio.readyState = 2; audio.emit('waiting'); assert.equal(player.snapshot().status, 'buffering');
  player.pause(); audio.emit('waiting'); assert.equal(player.snapshot().status, 'paused');
  player.play(); audio.playing(); audio.ended = true; audio.paused = true; audio.currentTime = 222; audio.emit('ended');
  assert.equal(player.snapshot().status, 'ended'); assert.equal(audio.plays.length, 2);
  player.play(); assert.equal(audio.currentTime, 0); player.destroy();
});
test('blocked and unsupported playback produce recoverable, non-payment errors', async () => {
  const { audio, player } = setup(); player.playTrack(track('a'));
  audio.plays[0].reject(new DOMException('blocked', 'NotAllowedError')); await tick();
  assert.equal(player.snapshot().status, 'paused'); assert.equal(player.snapshot().lastError.code, 'PLAY_NOT_ALLOWED');
  player.play(); audio.plays[1].reject(new DOMException('codec', 'NotSupportedError')); await tick();
  assert.equal(player.snapshot().status, 'error'); assert.equal(player.snapshot().lastError.code, 'MEDIA_UNSUPPORTED');
  assert.doesNotMatch(player.snapshot().lastError.message, /会员|付款|VIP/); player.destroy();
});
test('seek uses native metadata and seekable ranges; invalid values cannot corrupt progress', () => {
  const { audio, player } = setup(); player.playTrack(track('a')); assert.equal(player.seek(48), false);
  audio.metadata(200); audio.seekable = { length: 2, start: i => [0, 90][i], end: i => [40, 200][i] };
  assert.equal(player.seek(65), true); assert.equal(audio.currentTime, 40);
  assert.equal(player.seek(999), true); assert.equal(audio.currentTime, 200);
  for (const value of [-1, NaN, Infinity, '20']) assert.equal(player.seek(value), false);
  audio.currentTime = NaN; audio.emit('timeupdate'); assert.equal(player.snapshot().currentTimeSec, 0);
  player.destroy();
});
test('pause event queued by media failure does not erase the error state', () => {
  const { audio, player } = setup(); player.playTrack(track('a')); audio.metadata(); audio.playing();
  audio.error = { code: 3 }; audio.emit('error'); audio.emit('pause');
  assert.equal(player.snapshot().status, 'error'); assert.equal(player.snapshot().lastError.code, 'MEDIA_3');
  assert.equal(audio.paused, true); player.destroy();
});
test('replacement clears progress and preview uses its own independent URL and duration', () => {
  const { audio, player } = setup(); player.playTrack(track('a')); audio.metadata(); audio.currentTime = 100; audio.emit('timeupdate');
  player.playTrack(track('a', { audioVersion: 2 }), 'preview');
  assert.match(audio.src, /v=2&variant=preview$/); assert.equal(player.snapshot().currentTimeSec, 0);
  assert.equal(player.snapshot().durationSec, 30); assert.equal(player.snapshot().previewSourceStartSec, 12);
  assert.equal(player.snapshot().sourceGeneration, 2); player.destroy();
});
test('destroy unloads the source, removes listeners and invalidates pending work', async () => {
  const { audio, player } = setup(); let updates = 0; player.subscribe(() => updates++);
  player.playTrack(track('a')); player.destroy(); const count = updates;
  audio.plays[0].reject(new Error('late')); audio.emit('volumechange'); await tick();
  assert.equal(audio.src, ''); assert.equal(audio.paused, true); assert.equal(updates, count);
  player.destroy(); assert.notEqual(createMusicPlayer(audio, { origin }), player);
});
test('volume and mute follow native properties; snapshots cannot mutate internal state', () => {
  const { audio, player } = setup(); player.setVolume(5); assert.equal(audio.volume, 1);
  player.setVolume(-2); assert.equal(audio.volume, 0); player.setVolume(.4); player.setMuted(true);
  assert.equal(player.snapshot().volume, .4); assert.equal(player.snapshot().muted, true);
  player.snapshot().volume = 99; assert.equal(player.snapshot().volume, .4); player.destroy();
});
test('public catalog adapter canonicalizes media identity and fails closed on malformed policy', () => {
  const parsed = readPlayerCatalog({ schemaVersion: 2, tracks: [track('a', { coverUrl: 'https://evil.example/cover' })] });
  assert.equal(parsed[0].coverUrl, `/api/music/tracks/${track('a').id}/cover?v=1`);
  for (const patch of [{ id: '../evil' }, { durationSec: Infinity }, { effectiveAccess: 'unknown' }, { previewDurationSec: 999 }]) {
    assert.throws(() => readPlayerCatalog({ schemaVersion: 2, tracks: [track('a', patch)] }));
  }
  assert.throws(() => readPlayerCatalog({ schemaVersion: 2, tracks: [track('a'), track('a')] }));
  assert.throws(() => musicSource(track('a'), 'anything'));
  assert.equal(playerVariant(track('a'), null), 'full');
  assert.equal(playerVariant(track('a', { effectiveAccess: 'vip' }), null), 'preview');
  assert.equal(playerVariant(track('a', { effectiveAccess: 'vip', previewAvailable: false }), null), null);
  assert.equal(formatMusicTime(48.9), '00:48'); assert.equal(formatMusicTime(NaN), '--:--');
});
