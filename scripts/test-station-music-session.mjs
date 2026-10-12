import assert from 'node:assert/strict';
import test from 'node:test';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicLocalData, MUSIC_LOCAL_KEY } from '../src/scripts/musicLocalData.js';
import { createStationMusicSession } from '../src/redesign/musicSession.js';
import { createStationPlaybackStore, readStationPlayback, STATION_PLAYBACK_KEY } from '../src/redesign/musicResume.js';

const origin = 'https://station.example.test', base = '/api/station/content', time = 1791351000000;
const id = letter => `${letter.repeat(8)}-${letter.repeat(4)}-4${letter.repeat(3)}-8${letter.repeat(3)}-${letter.repeat(12)}`;
const dto = (letter, patch = {}) => ({ id: id(letter), slug: 'song-' + letter, revision: 2, title: 'Song ' + letter, artist: 'Station Cat', durationMs: 200000,
  fullPlayback: { requiresAccessCheck: true, playbackPath: base + '/tracks/song-' + letter + '/playback?variant=full' },
  preview: { revision: 3, durationMs: 30000, playbackPath: base + '/tracks/song-' + letter + '/playback?variant=preview' }, ...patch });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const memory = () => {
  const values = new Map(), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { writes.push([key, value]); values.set(key, value); }, removeItem(key) { values.delete(key); } };
};
const pendingFetch = () => {
  const calls = [];
  return { calls, fetcher(path, options) { return new Promise(resolve => calls.push({ path, options, resolve })); } };
};
function setup(fetcher = async () => response({ code: 'NO_GRANT' }, 401), resumeStorage = memory()) {
  const audio = new Audio(), localStorage = memory(), local = createMusicLocalData({ storage: () => localStorage, now: () => time });
  const store = createStationPlaybackStore({ storage: () => resumeStorage, now: () => time });
  const session = createStationMusicSession(audio, { origin, fetcher, local, store, now: () => time });
  return { audio, session, localStorage, resumeStorage, local, store };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const starts = player => { const events = []; player.onPlaybackStart(state => events.push(state)); return events; };
const saved = (track, variant = 'preview', positionSec = 12) => JSON.stringify({ schemaVersion: 1, trackId: track.id, slug: track.slug,
  revision: track.revision, variant, previewRevision: variant === 'preview' ? track.preview.revision : null, positionSec, savedAt: time });

test('game handoff unloads real preview audio, locks background intents and returns paused at the same position', () => {
  const f = setup(), song = dto('a'); f.session.play(song, 'preview'); f.audio.metadata(30); f.audio.playing(); f.session.seek(11);
  const plays = f.audio.plays.length; f.session.setGameActive(true);
  assert.equal(f.audio.src, ''); assert(f.audio.paused); assert.equal(f.session.snapshot().status, 'paused');
  assert.equal(f.session.snapshot().currentTimeSec, 11); assert.equal(f.session.play(song, 'preview'), false);
  f.session.toggle(); assert.equal(f.audio.plays.length, plays); f.session.setGameActive(false);
  assert.equal(f.audio.plays.length, plays); f.session.toggle(); assert.equal(f.audio.plays.length, plays + 1);
  f.audio.metadata(30); assert.equal(f.audio.currentTime, 11); f.session.destroy();
});
test('game handoff cancels pending preview restoration and ignores late responses', async () => {
  const p = pendingFetch(), storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, saved(dto('a')));
  const f = setup(p.fetcher, storage), restoring = f.session.restore(); f.session.setGameActive(true);
  assert(p.calls[0].options.signal.aborted);
  p.calls[0].resolve(response({ schemaVersion: 1, locale: 'zh-Hant', track: dto('a') })); await restoring;
  assert.equal(f.session.snapshot().track, null); assert.equal(f.audio.src, ''); assert.equal(f.audio.plays.length, 0);
  f.session.setGameActive(false); assert.equal(f.audio.plays.length, 0); f.session.destroy();
});

test('one audio/controller stays current when views subscribe and detach; viewing B never selects B', () => {
  const { audio, session } = setup(); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing();
  const before = session.snapshot(), detach = session.subscribe(() => {}); detach();
  session.setLocale('ja'); session.cancelPending(); const detachNewView = session.subscribe(() => {});
  assert.equal(createMusicPlayer(audio, { origin }), session.player); assert.equal(session.snapshot().activeTrackId, id('a'));
  assert.equal(session.snapshot().playbackId, before.playbackId); assert.equal(audio.plays.length, 1); assert.equal(audio.loads, 2);
  detachNewView(); session.destroy();
});
test('start requires native playing; duplicate playing, seek, buffering and pause/resume keep one ID/event', async () => {
  const { audio, session, local } = setup(), events = starts(session.player);
  session.play(dto('a'), 'preview'); const first = session.snapshot().playbackId;
  assert.match(first, /^[0-9a-f-]{36}$/); assert.deepEqual(local.snapshot().recent, []);
  audio.plays[0].resolve(); await tick(); assert.equal(events.length, 0);
  audio.metadata(30); audio.playing(); audio.playing(); assert.equal(events.length, 1); assert.deepEqual(local.snapshot().recent, [id('a')]);
  session.seek(10); audio.readyState = 2; audio.emit('waiting'); audio.playing(); session.pause(); session.play(dto('a'), 'preview'); audio.playing();
  assert.equal(session.snapshot().playbackId, first); assert.equal(events.length, 1); assert.equal(audio.currentTime, 10); session.destroy();
});
test('natural end is silent until explicit replay, which creates a new ID/start', () => {
  const { audio, session } = setup(), events = starts(session.player);
  session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing(); const first = session.snapshot().playbackId;
  audio.currentTime = 30; audio.ended = true; audio.paused = true; audio.emit('ended');
  assert.equal(session.snapshot().status, 'ended'); assert.equal(audio.plays.length, 1);
  session.play(dto('a'), 'preview'); assert.notEqual(session.snapshot().playbackId, first); assert.equal(audio.currentTime, 0);
  audio.ended = false; audio.playing(); assert.equal(events.length, 2); session.destroy();
});
test('rapid A/B/C source switches and late native play failures cannot start or overwrite old tracks', async () => {
  const { audio, session } = setup(), events = starts(session.player);
  session.play(dto('a'), 'preview'); const sourceA = audio.src, first = session.snapshot().playbackId;
  session.play(dto('b'), 'preview'); session.play(dto('c'), 'preview'); const current = session.snapshot().playbackId;
  audio.plays[0].reject(new DOMException('late A', 'NotAllowedError')); audio.plays[1].reject(new DOMException('late B', 'NotSupportedError'));
  audio.currentSrc = sourceA; audio.readyState = 4; audio.emit('playing'); await tick();
  assert.equal(events.length, 0); assert.equal(session.snapshot().activeTrackId, id('c')); assert.notEqual(current, first);
  assert.equal(session.snapshot().lastError, null); audio.metadata(30); audio.playing(); assert.equal(events.length, 1); session.destroy();
});
test('website rejects full and unknown playback intents without requests, media or recent-play writes', () => {
  let requests = 0; const { audio, session, local, store } = setup(async () => { requests++; return response({}); });
  for (const variant of ['full', 'audio', undefined]) assert.equal(session.play(dto('a'), variant), false);
  assert.equal(requests, 0); assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0);
  assert.equal(session.snapshot().track, null); assert.equal(store.read(), null); assert.deepEqual(local.snapshot().recent, []);
  session.play(dto('b'), 'preview'); audio.metadata(30); audio.playing(); const active = session.snapshot();
  assert.equal(session.play(dto('a'), 'full'), false); assert.equal(session.snapshot().playbackId, active.playbackId);
  assert.equal(session.snapshot().activeTrackId, id('b')); assert.equal(audio.paused, false); session.destroy();
});

test('failed or malformed public restoration stays empty and never falls back to full audio', async () => {
  for (const [status, body] of [[401, {}], [403, {}], [409, {}], [404, {}], [503, {}],
    [200, { schemaVersion: 1, locale: 'zh-Hant', track: dto('a', { preview: null }) }],
    [200, { schemaVersion: 1, locale: 'zh-Hant', track: dto('b') }]]) {
    const storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, saved(dto('a')));
    const { audio, session } = setup(async () => response(body, status), storage);
    await session.restore(); assert.equal(session.snapshot().track, null);
    session.toggle(); assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0); session.destroy();
  }
});

test('blocked play stays paused without start/recent; user retry begins once', async () => {
  const { audio, session, local } = setup(), events = starts(session.player);
  session.play(dto('a'), 'preview'); const first = session.snapshot().playbackId;
  audio.plays[0].reject(new DOMException('blocked', 'NotAllowedError')); await tick();
  assert.equal(session.snapshot().status, 'paused'); assert.equal(session.snapshot().lastError.code, 'PLAY_NOT_ALLOWED');
  assert.equal(events.length, 0); assert.deepEqual(local.snapshot().recent, []);
  session.toggle(); audio.metadata(30); audio.playing(); assert.equal(events.length, 1); assert.equal(session.snapshot().playbackId, first); session.destroy();
});
test('native resource error is recoverable; a late pause cannot hide it', () => {
  const { audio, session } = setup(); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing();
  audio.error = { code: 4 }; audio.emit('error'); audio.emit('pause');
  assert.equal(session.snapshot().status, 'error'); assert.equal(session.snapshot().lastError.code, 'MEDIA_4'); assert.equal(audio.paused, true); session.destroy();
});

test('refresh restore queries current public DTO and keeps selection paused without source/start', async () => {
  const storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, saved(dto('a')));
  const { audio, session, local } = setup(async () => response({ schemaVersion: 1, locale: 'zh-Hant', track: dto('a') }), storage);
  const events = starts(session.player); await session.restore();
  assert.equal(session.snapshot().activeTrackId, id('a')); assert.equal(session.snapshot().currentTimeSec, 12);
  assert.equal(session.snapshot().status, 'paused'); assert.equal(session.snapshot().playbackId, null);
  assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0); assert.equal(events.length, 0); assert.deepEqual(local.snapshot().recent, []);
  session.toggle(); audio.metadata(30); audio.playing(); assert.equal(audio.currentTime, 12); assert.equal(events.length, 1); session.destroy();
});
test('old full selections are ignored without a request, prompt, autoplay, or changes to legacy local data', async () => {
  const storage = memory(), original = saved(dto('a'), 'full', 45); storage.values.set(STATION_PLAYBACK_KEY, original);
  let requests = 0; const { audio, session, store, localStorage } = setup(async () => { requests++; return response({}); }, storage);
  assert.equal(store.read(), null); assert.equal(readStationPlayback(original, time), null);
  await session.restore(); session.toggle();
  assert.equal(session.snapshot().track, null); assert.equal(session.snapshot().notice, null);
  assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0); assert.equal(requests, 0);
  assert.equal(storage.values.get(STATION_PLAYBACK_KEY), original); assert.equal(localStorage.writes.length, 0);
  session.play(dto('b'), 'preview'); assert.equal(store.read().variant, 'preview'); session.destroy();
});

test('restoration response cannot replace a new user selection', async () => {
  const storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, saved(dto('a')));
  const network = pendingFetch(), { audio, session } = setup(network.fetcher, storage);
  const restoring = session.restore(); session.play(dto('b'), 'preview'); network.calls[0].resolve(response({ schemaVersion: 1, locale: 'zh-Hant', track: dto('a') }));
  await restoring; assert.equal(session.snapshot().activeTrackId, id('b')); assert.match(audio.src, /song-b\/audio/); session.destroy();
});
test('changed public revisions reset saved position; withdrawn/preview-disabled selectors stay empty', async () => {
  for (const track of [dto('a', { revision: 4 }), dto('a', { preview: { ...dto('a').preview, revision: 4 } }), dto('a', { preview: null }), null]) {
    const storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, saved(dto('a')));
    const { audio, session } = setup(async () => response({ schemaVersion: 1, locale: 'zh-Hant', track }), storage);
    await session.restore(); assert.equal(session.snapshot().currentTimeSec, 0); assert.equal(audio.src, ''); assert.equal(audio.plays.length, 0);
    assert.equal(Boolean(session.snapshot().track), Boolean(track?.preview)); session.destroy();
  }
});
test('close/destroy cancel restoration; BFCache suspension keeps the preview paused with its progress', async () => {
  const { audio, session, store } = setup();
  session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing(); audio.currentTime = 8; audio.emit('timeupdate');
  session.suspend(); assert.equal(audio.src, ''); assert.equal(session.snapshot().status, 'paused'); assert.equal(store.read().positionSec, 8);
  session.close(); assert.equal(session.snapshot().track, null); assert.equal(store.read(), null); session.destroy();
  for (const action of ['close', 'destroy']) {
    const storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, saved(dto('a')));
    const network = pendingFetch(), f = setup(network.fetcher, storage), restoring = f.session.restore();
    f.session[action](); assert(network.calls[0].options.signal.aborted);
    network.calls[0].resolve(response({ schemaVersion: 1, locale: 'zh-Hant', track: dto('a') })); await restoring;
    assert.equal(f.session.snapshot().track, null); assert.equal(f.audio.src, ''); assert.equal(f.audio.plays.length, 0); f.session.destroy();
  }
});

test('corrupt, oversized, future-schema and inaccessible storage preserve originals while playback works', () => {
  for (const raw of ['{broken', 'x'.repeat(1025), JSON.stringify({ schemaVersion: 99 })]) {
    const storage = memory(); storage.values.set(STATION_PLAYBACK_KEY, raw); const { audio, session, store } = setup(undefined, storage);
    assert.equal(store.read(), null); assert.equal(store.persistent(), false); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing(); session.close();
    assert.equal(storage.values.get(STATION_PLAYBACK_KEY), raw); session.destroy();
  }
  const store = createStationPlaybackStore({ storage: () => { throw new Error('Denied'); } }); assert.equal(store.persistent(), false);
});
test('selector contains only bounded public fields; legacy positions/queue are unchanged', () => {
  const { audio, session, localStorage, resumeStorage } = setup(); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing();
  const selection = JSON.parse(resumeStorage.values.get(STATION_PLAYBACK_KEY));
  assert.deepEqual(Object.keys(selection).sort(), ['schemaVersion', 'trackId', 'slug', 'revision', 'variant', 'previewRevision', 'positionSec', 'savedAt'].sort());
  const legacy = JSON.parse(localStorage.values.get(MUSIC_LOCAL_KEY)); assert.equal(legacy.current, null); assert.deepEqual(legacy.positions, []); assert.deepEqual(legacy.queue, []);
  for (const extra of ['audioPath', 'authorizedPath', 'playbackId', 'membership', 'token']) assert.throws(() => readStationPlayback(JSON.stringify({ ...selection, [extra]: 'secret' }), time));
  assert.equal(readStationPlayback(saved(dto('a')), time + 31 * 86400000), null); session.destroy();
});

test('known locale metadata updates display only; known publication/promotion changes unload current selection', () => {
  for (const change of [{ revision: 3 }, { preview: null }, { preview: { ...dto('a').preview, revision: 4 } }]) {
    const { audio, session } = setup(); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing();
    const first = session.snapshot().playbackId;
    session.observeTracks([dto('b'), dto('a', { title: 'Localized A' })]);
    assert.equal(session.snapshot().track.title, 'Localized A'); assert.equal(session.snapshot().playbackId, first); assert.equal(audio.paused, false);
    session.observeTracks([dto('a', change)]); assert.equal(audio.src, ''); assert.equal(session.snapshot().track, null);
    assert.equal(session.snapshot().notice.code, 'stale'); session.destroy();
  }
});

test('invalid native position cannot make optional persistence interrupt playback', () => {
  const store = createStationPlaybackStore({ storage: () => memory(), now: () => time });
  assert.equal(store.save({ trackId: id('a'), slug: 'song-a', revision: 2, variant: 'preview', previewRevision: 3, positionSec: Infinity }), false);
});
test('leaving or refreshing after natural end restores at zero rather than an unplayable end position', () => {
  const { audio, session, store } = setup(); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing();
  audio.currentTime = 30; audio.ended = true; audio.paused = true; audio.emit('ended'); session.suspend();
  assert.equal(session.snapshot().status, 'paused'); assert.equal(store.read().positionSec, 0);
  assert.equal(session.snapshot().currentTimeSec, 0); assert.equal(audio.src, ''); session.destroy();
});
test('a saved position at the decoded native end starts at zero despite rounded DTO duration', async () => {
  const storage = memory(), track = dto('a', { preview: { ...dto('a').preview, durationMs: 1045 } });
  storage.values.set(STATION_PLAYBACK_KEY, saved(track, 'preview', 1));
  const { audio, session } = setup(async () => response({ schemaVersion: 1, locale: 'zh-Hant', track }), storage);
  await session.restore(); session.toggle(); audio.metadata(1); audio.playing(); assert.equal(audio.currentTime, 0); session.destroy();
});
test('an explicit newer promotion source switches instead of toggling the old preview', () => {
  const { audio, session } = setup(); session.play(dto('a'), 'preview'); audio.metadata(30); audio.playing(); const first = session.snapshot().playbackId;
  session.play(dto('a', { preview: { ...dto('a').preview, revision: 4 } }), 'preview');
  assert.match(audio.src, /&p=4$/); assert.equal(session.snapshot().status, 'loading'); assert.notEqual(session.snapshot().playbackId, first); session.destroy();
});
