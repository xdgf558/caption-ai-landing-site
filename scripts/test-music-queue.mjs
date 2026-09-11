import assert from 'node:assert/strict';
import test from 'node:test';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicQueue } from '../src/scripts/musicPlayerQueue.js';

const track = (n, patch = {}) => ({ id: `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`, title: `Song ${n}`,
  creatorName: 'Test', durationSec: 222, audioVersion: 1, policyVersion: 1, effectiveAccess: 'free',
  previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12, coverUrl: null, ...patch });
const vip = n => track(n, { effectiveAccess: 'vip' });
const qualified = { canPlayVipFull: true, musicVipDeliveryEnabled: true, membershipStatus: 'active' };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t, tracks = [track(1), track(2), track(3), track(4)]) {
  const audio = new Audio(), player = createMusicPlayer(audio, { origin: 'https://music.example.test' });
  let clock = 0;
  const queue = createMusicQueue(player, { random: () => .2, now: () => clock });
  queue.updateCatalog(tracks);
  const playing = () => { audio.metadata(player.snapshot().activeVariant === 'preview' ? 30 : 222); audio.playing(); };
  const end = () => { audio.currentTime = audio.duration; audio.ended = true; audio.paused = true; audio.emit('ended'); };
  const fail = () => { audio.currentSrc = audio.src; audio.error = { code: 3 }; audio.emit('error'); };
  const advance = (seconds, media = seconds) => { clock += seconds * 1000; audio.currentTime += media; audio.emit('timeupdate'); };
  t.after(() => { queue.destroy(); player.destroy(); });
  return { audio, player, queue, tracks, playing, end, fail, advance, active: () => player.snapshot().activeTrackId };
}

test('queue settings and catalog never load audio; one queue per controller', t => {
  const { audio, player, queue } = setup(t);
  assert.equal(createMusicQueue(player), queue);
  queue.setShuffle(true); queue.setRepeat('all'); queue.append([track(1)]);
  assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0);
  assert.equal(queue.snapshot().queueIndex, -1);
});
test('list playback freezes order/access metadata and tolerates subsequent browse reorder', t => {
  const { queue, tracks, active } = setup(t);
  const visible = [tracks[1], tracks[0], tracks[2]];
  queue.playFromList(tracks[1].id, visible);
  visible.reverse(); tracks[1].title = 'mutated outside';
  queue.updateCatalog([track(3), track(2), track(1), track(4)]);
  assert.deepEqual(queue.snapshot().items.map(x => x.id), [track(2).id, track(1).id, track(3).id]);
  assert.equal(queue.snapshot().items[0].title, 'Song 2');
  queue.snapshot().items.splice(0); queue.next(); assert.equal(active(), track(1).id);
});
test('current row toggles pause without replacing the queue or losing position', t => {
  const { queue, player, audio, tracks, playing } = setup(t);
  queue.playFromList(tracks[0].id, tracks); playing(); audio.currentTime = 2; audio.emit('timeupdate');
  queue.playFromList(tracks[0].id, [tracks[0]]);
  assert.equal(player.snapshot().status, 'paused'); assert.equal(queue.snapshot().items.length, 4);
  queue.playCurrent([tracks[0]]);
  assert.equal(queue.snapshot().items.length, 4); assert.equal(audio.currentTime, 2);
});
test('play-all, next and natural advance filter VIP without spending the failure budget', t => {
  const { queue, player, tracks, playing, end, active } = setup(t, [vip(1), track(2), vip(3), track(4)]);
  queue.playAll(tracks); assert.equal(active(), track(2).id); assert.equal(player.snapshot().activeVariant, 'full');
  playing(); end(); assert.equal(active(), track(4).id); assert.equal(queue.snapshot().consecutiveFailures, 0);
  playing(); end(); assert.equal(player.snapshot().status, 'ended');
});
test('qualified VIP permits full queue playback; later known eligibility narrows next selection', t => {
  const { queue, tracks, active } = setup(t, [track(1), vip(2), track(3)]);
  queue.updateCapabilities(qualified); queue.playAll(tracks); queue.next(); assert.equal(active(), vip(2).id);
  queue.updateCapabilities(null); queue.next(); assert.equal(active(), track(3).id);
  assert.equal(queue.snapshot().items[1].effectiveAccess, 'vip');
  assert.equal(queue.snapshot().items[1].canPlayFull, false);
});
test('explicit preview naturally stops in every repeat mode; manual next chooses full free track', t => {
  const { queue, player, audio, tracks, playing, end, active } = setup(t, [vip(1), vip(2), track(3)]);
  for (const repeat of ['off', 'one', 'all']) {
    queue.setRepeat(repeat); queue.playFromList(vip(1).id, tracks); playing(); const count = audio.plays.length;
    end(); assert.equal(player.snapshot().status, 'ended'); assert.equal(audio.plays.length, count);
    assert.equal(queue.snapshot().notice.code, 'PREVIEW_ENDED');
  }
  queue.next(); assert.equal(active(), track(3).id); assert.equal(player.snapshot().activeVariant, 'full');
});
test('all VIP and empty queues stop with explanation even with repeat/shuffle enabled', t => {
  const { queue, player, audio, tracks } = setup(t, [vip(1), vip(2)]);
  queue.setShuffle(true); queue.setRepeat('all'); queue.playAll(tracks); queue.next();
  assert.equal(audio.plays.length, 0); assert.equal(player.snapshot().activeTrackId, null);
  assert.equal(queue.snapshot().notice.code, 'NO_FULL_TRACKS');
  queue.playAll([]); assert.equal(queue.snapshot().notice.code, 'QUEUE_EMPTY');
});
test('previous rewinds only above three seconds and preserves pause; exactly three selects previous', t => {
  const { queue, player, audio, tracks, playing, active } = setup(t);
  queue.playFromList(track(2).id, tracks); playing(); audio.currentTime = 3.1; audio.emit('timeupdate'); player.pause();
  const count = audio.plays.length; queue.previous();
  assert.equal(active(), track(2).id); assert.equal(audio.currentTime, 0); assert.equal(audio.paused, true); assert.equal(audio.plays.length, count);
  audio.currentTime = 3; audio.emit('timeupdate'); queue.previous(); assert.equal(active(), track(1).id);
});
test('repeat one applies only at natural full end; manual next escapes and repeat-all wraps', t => {
  const { queue, tracks, playing, end, active, audio } = setup(t);
  queue.setRepeat('one'); queue.playAll(tracks); playing(); end();
  assert.equal(active(), track(1).id); assert.equal(audio.currentTime, 0); assert.equal(audio.plays.length, 2);
  queue.next(); assert.equal(active(), track(2).id);
  queue.playFromList(track(4).id, tracks); queue.setRepeat('all'); playing(); end(); assert.equal(active(), track(1).id);
});
test('shuffle draws a finite round without repeats and crosses rounds without adjacent duplicates', t => {
  const { queue, tracks, active } = setup(t);
  queue.setShuffle(true); queue.setRepeat('all'); queue.playAll(tracks);
  const heard = [active()];
  for (let n = 0; n < 11; n++) { queue.next(); heard.push(active()); }
  for (let n = 0; n < heard.length; n++) if (n) assert.notEqual(heard[n], heard[n - 1]);
  for (let n = 0; n < 12; n += 4) assert.equal(new Set(heard.slice(n, n + 4)).size, 4);
});
test('shuffle previous uses history, next retraces forward; disabling returns to original index', t => {
  const { queue, tracks, active } = setup(t);
  queue.setShuffle(true); queue.playAll(tracks); const first = active(); queue.next(); const second = active(); queue.next(); const third = active();
  queue.previous(); assert.equal(active(), second); queue.previous(); assert.equal(active(), first);
  queue.next(); assert.equal(active(), second); queue.next(); assert.equal(active(), third);
  queue.setShuffle(false); const index = tracks.findIndex(x => x.id === third); queue.setRepeat('all'); queue.next();
  assert.equal(active(), tracks[(index + 1) % tracks.length].id);
});
test('new catalog availability/version affects future play without replacing snapshot order', t => {
  const { queue, tracks, player, active } = setup(t);
  queue.playAll(tracks); queue.updateCatalog([track(1), track(3, { audioVersion: 2 }), track(4)]); queue.next();
  assert.equal(active(), track(3).id); assert.equal(player.snapshot().activeAudioVersion, 2);
  assert.equal(queue.snapshot().items.length, 4); assert.equal(queue.snapshot().items[1].available, false);
});
test('dedupe, 500 cap and append leave the current audio untouched', t => {
  const { queue, audio } = setup(t);
  queue.playAll([track(1)]); const source = audio.src, count = audio.plays.length;
  const many = Array.from({ length: 501 }, (_, i) => track(i + 1));
  queue.append([track(1), ...many]);
  assert.equal(queue.snapshot().items.length, 500); assert.equal(queue.snapshot().notice.code, 'QUEUE_LIMIT');
  assert.equal(audio.src, source); assert.equal(audio.plays.length, count);
  queue.append([track(1)]); assert.equal(queue.snapshot().items.length, 500);
});
test('removing pending does not affect sound; current removal requires an explicit action', t => {
  const { queue, audio, tracks, active } = setup(t);
  queue.playAll(tracks); const source = audio.src, count = audio.plays.length;
  queue.remove(track(2).id); assert.equal(audio.src, source); assert.equal(audio.plays.length, count);
  assert.deepEqual(queue.remove(track(1).id), { requiresConfirmation: true }); assert.equal(queue.snapshot().items.length, 3);
  queue.remove(track(1).id, { currentAction: 'next' }); assert.equal(active(), track(3).id);
  queue.remove(track(3).id, { currentAction: 'stop' }); assert.equal(active(), null); assert.equal(audio.src, ''); assert.equal(audio.paused, true);
});
test('removing the only playing entry cannot repeat it and clearing invalidates pending audio', async t => {
  const { queue, audio, player } = setup(t, [track(1)]);
  queue.setRepeat('all'); queue.playAll([track(1)]); queue.remove(track(1).id, { currentAction: 'next' });
  assert.equal(audio.src, ''); assert.equal(player.snapshot().activeTrackId, null);
  audio.plays[0].reject(new Error('late')); await tick(); assert.equal(queue.snapshot().consecutiveFailures, 0);
  queue.playAll([track(1)]); queue.clear(); assert.equal(audio.src, ''); assert.equal(queue.snapshot().items.length, 0);
});
test('third consecutive full failure stops; a new user play resets the budget', t => {
  const { queue, player, audio, tracks, fail, active } = setup(t);
  queue.setRepeat('all'); queue.playAll(tracks); fail(); fail(); fail();
  assert.equal(audio.plays.length, 3); assert.equal(active(), track(3).id); assert.equal(player.snapshot().status, 'error');
  assert.equal(queue.snapshot().consecutiveFailures, 3); assert.equal(queue.snapshot().notice.code, 'FAILURE_LIMIT');
  audio.emit('error'); assert.equal(audio.plays.length, 3);
  queue.playCurrent(tracks); assert.equal(queue.snapshot().consecutiveFailures, 0); assert.equal(audio.plays.length, 4);
});
test('exhausted one-song shuffle stops after one failure; denied autoplay is not a skip loop', async t => {
  const { queue, player, audio, fail } = setup(t, [track(1)]);
  queue.setShuffle(true); queue.setRepeat('all'); queue.playAll([track(1)]); fail();
  assert.equal(audio.plays.length, 1); assert.equal(queue.snapshot().notice.code, 'NO_WORKING_TRACKS');
  queue.playCurrent([track(1)]); audio.plays[1].reject(new DOMException('gesture', 'NotAllowedError')); await tick();
  assert.equal(player.snapshot().status, 'paused'); assert.equal(audio.plays.length, 2); assert.equal(queue.snapshot().consecutiveFailures, 0);
});
test('preview failures do not automatically launch another preview or full song', t => {
  const { queue, audio, tracks, fail } = setup(t, [vip(1), track(2)]);
  queue.playFromList(vip(1).id, tracks); fail(); assert.equal(audio.plays.length, 1); assert.equal(queue.snapshot().consecutiveFailures, 1);
});
test('failure reset needs continuous real progress, not seek jumps, pauses or brief playing events', t => {
  const { queue, player, tracks, playing, fail, advance, audio } = setup(t);
  queue.playAll(tracks); fail(); playing(); advance(1, 50); assert.equal(queue.snapshot().consecutiveFailures, 1);
  advance(9); assert.equal(queue.snapshot().consecutiveFailures, 1);
  player.pause(); audio.playing(); // An unsolicited playing event cannot resume intentional pause.
  assert.equal(audio.paused, true);
  player.play(); playing(); advance(9); assert.equal(queue.snapshot().consecutiveFailures, 1);
  audio.readyState = 2; audio.emit('waiting'); audio.playing(); advance(9); assert.equal(queue.snapshot().consecutiveFailures, 1);
  advance(1.1); assert.equal(queue.snapshot().consecutiveFailures, 0);
});
test('late A/B failures cannot advance the final C queue or spend its failure budget', async t => {
  const { queue, tracks, audio, active } = setup(t);
  for (const song of tracks.slice(0, 3)) queue.playFromList(song.id, tracks);
  audio.plays[0].reject(new Error('old')); audio.plays[1].reject(new DOMException('switch', 'AbortError')); await tick();
  assert.equal(active(), track(3).id); assert.equal(audio.plays.length, 3); assert.equal(queue.snapshot().consecutiveFailures, 0);
});
test('destroyed queue removes auto-advance without owning or replacing the audio element', t => {
  const { queue, tracks, playing, end, audio, player } = setup(t);
  queue.playAll(tracks); playing(); queue.destroy(); end(); queue.next();
  assert.equal(audio.plays.length, 1); assert.equal(player.snapshot().status, 'ended');
});
test('small native seeks also interrupt the ten-second success window', t => {
  const { queue, tracks, fail, playing, advance, audio } = setup(t);
  queue.playAll(tracks); fail(); playing(); advance(9);
  audio.seeking = true; audio.emit('seeking'); audio.currentTime += .2;
  audio.seeking = false; audio.emit('seeked'); advance(2);
  assert.equal(queue.snapshot().consecutiveFailures, 1);
  advance(8.1); assert.equal(queue.snapshot().consecutiveFailures, 0);
});
test('known removal of the active catalog item unloads it without replacing the queue', t => {
  const { queue, tracks, player, audio } = setup(t);
  queue.playAll(tracks); queue.updateCatalog([track(2), track(3)]);
  assert.equal(player.snapshot().activeTrackId, null); assert.equal(audio.src, '');
  assert.equal(queue.snapshot().items.length, 4); queue.next();
  assert.equal(player.snapshot().activeTrackId, track(2).id);
});
test('passive selection does not erase the previous actual shuffle history', t => {
  const { queue, tracks, player, active } = setup(t);
  queue.setShuffle(true); queue.playFromList(track(1).id, tracks);
  player.select(track(3)); queue.playCurrent(tracks); queue.previous();
  assert.equal(active(), track(1).id);
});
test('queued ended/error after user pause must not silently resume the queue', t => {
  const { queue, player, tracks, playing, end, fail, audio } = setup(t);
  queue.setRepeat('all'); queue.playAll(tracks); playing(); player.pause(); end();
  assert.equal(audio.plays.length, 1); assert.equal(audio.paused, true);
  queue.playAll(tracks); playing(); player.pause(); fail();
  assert.equal(audio.plays.length, 2); assert.equal(audio.paused, true);
  assert.equal(queue.snapshot().consecutiveFailures, 0);
});
test('mode changes and remove-and-stop do not reset an existing failure budget', t => {
  const { queue, tracks, fail, active } = setup(t);
  queue.playAll(tracks); fail(); assert.equal(queue.snapshot().consecutiveFailures, 1);
  queue.setRepeat('all'); queue.setShuffle(true); queue.remove(active(), { currentAction: 'stop' });
  assert.equal(queue.snapshot().consecutiveFailures, 1);
  queue.clear(); assert.equal(queue.snapshot().consecutiveFailures, 1);
});
test('manual repeat-all wrap and play-all restart a sole eligible song instead of retaining its position', t => {
  const { queue, tracks, playing, audio } = setup(t, [track(1), vip(2)]);
  queue.setRepeat('all'); queue.playAll(tracks); playing(); audio.currentTime = 42; audio.emit('timeupdate');
  queue.next(); assert.equal(audio.currentTime, 0);
  audio.currentTime = 20; audio.emit('timeupdate'); queue.playAll(tracks); assert.equal(audio.currentTime, 0);
  queue.setShuffle(true); audio.currentTime = 10; audio.emit('timeupdate'); queue.next(); assert.equal(audio.currentTime, 0);
});
test('previous with no current selection does not start an arbitrary repeat-all entry', t => {
  const { queue, tracks, audio } = setup(t);
  queue.append(tracks); queue.setRepeat('all'); queue.previous(); assert.equal(audio.plays.length, 0);
});
test('a current playing entry always remains pausable after eligibility changes', t => {
  const list = [vip(1)].map(song => ({ ...song, previewAvailable: false, previewDurationSec: null, previewSourceStartSec: null }));
  const { queue, player, audio, playing } = setup(t, list);
  queue.updateCapabilities(qualified); queue.playAll(list); playing(); queue.updateCapabilities(null);
  queue.playFromList(list[0].id, list);
  assert.equal(player.snapshot().status, 'paused'); assert.equal(audio.plays.length, 1);
  assert.equal(queue.playFromList(list[0].id, list), false); assert.equal(audio.plays.length, 1);
});
