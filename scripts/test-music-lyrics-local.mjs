import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicLyrics, currentLyricIndex, fetchMusicLyrics, LYRICS_BYTES } from '../src/scripts/musicLyrics.js';
import { createMusicLocalData, readMusicLocal, MUSIC_LOCAL_KEY, MUSIC_OLD_KEY, localSource } from '../src/scripts/musicLocalData.js';
import { bindMusicLocalPlayback } from '../src/scripts/musicLocalPlayback.js';
import { mountMusicLyrics } from '../src/scripts/musicLyricsControls.js';
import { createMusicPlayer } from '../src/scripts/musicPlayerCore.js';
import { createMusicQueue } from '../src/scripts/musicPlayerQueue.js';
import { readPlayerCatalog } from '../src/scripts/musicPlayerCatalog.js';
import { browseMusic } from '../src/scripts/musicLibrary.js';
import { createMusicAccessLifecycle } from '../src/scripts/musicAccessLifecycle.js';
import { Audio } from './fixtures/music-player/fake-audio.mjs';
import { tracks as originals } from './fixtures/music-player/data.mjs';
const tracks = readPlayerCatalog({ schemaVersion: 2, tracks: originals });
const now = 1_800_000_000_000;
const json = value => JSON.stringify(value);
const source = (track = tracks[0], variant = 'full', positionSec = 42) => ({ ...localSource(track, variant), positionSec, savedAt: now });
const storage = initial => {
  const values = new Map(Object.entries(initial || {}));
  return { values, writes: 0, getItem: key => values.get(key) ?? null, setItem(key, value) { this.writes++; values.set(key, value); }, removeItem: key => values.delete(key) };
};

test('LRC supports multi-tags, centiseconds/milliseconds, stable order, duplicate times and signed offset', () => {
  const result = parseMusicLyrics('[ti:test]\n[00:02.50][00:04.500]two\n[00:02.500]second voice\n[00:01]one\n[00:99]bad\n[offset:+500]', 'lrc');
  assert.deepEqual(result.lines, [{ startMs: 500, text: 'one' }, { startMs: 2000, text: 'two\nsecond voice' }, { startMs: 4000, text: 'two' }]);
  assert.equal(result.warnings, 1);
  assert.equal(parseMusicLyrics('[offset:-250]\n[00:01]late', 'lrc').lines[0].startMs, 1250);
  assert.equal(currentLyricIndex(result.lines, .499), -1);
  assert.equal(currentLyricIndex(result.lines, 0, 2), 1);
  assert.equal(currentLyricIndex(result.lines, 2, 2), 2);
});
test('TXT and malformed LRC stay inert text; limits include UTF-8, line and expanded-tag budgets', () => {
  const payload = '<script>alert(1)</script>\nhttps://example.test';
  assert.equal(parseMusicLyrics(payload, 'lrc').text, payload);
  assert.equal(parseMusicLyrics('\uFEFFa\r\nb\rc').text, 'a\nb\nc');
  for (const text of ['a\0b', '猫'.repeat(50000), '\n'.repeat(5000), '[00:01]'.repeat(5001)+'a']) assert.throws(() => parseMusicLyrics(text, 'lrc'));
  assert.equal(parseMusicLyrics('a'.repeat(LYRICS_BYTES)).text.length, LYRICS_BYTES);
});
test('lyrics requests reconstruct a versioned same-origin URL and reject wrong content, bad UTF-8 and streaming overflow', async () => {
  let called;
  const track = { ...tracks[0], lyricsKind: 'lrc', lyricsUrl: 'https://evil.test' };
  const result = await fetchMusicLyrics(track, { fetcher: async (url, options) => { called = { url, options }; return new Response('[00:01]safe', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); } });
  assert.equal(called.url, `/api/music/tracks/${track.id}/lyrics?v=1`); assert.equal(called.options.redirect, 'error'); assert.equal(called.options.cache, 'no-store');
  assert.equal(result.lines[0].text, 'safe');
  for (const response of [new Response('html', { headers: { 'content-type': 'text/html' } }), new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'text/plain' } }), new Response('x'.repeat(LYRICS_BYTES+1), { headers: { 'content-type': 'text/plain' } }), new Response('', { status: 409 })]) {
    await assert.rejects(fetchMusicLyrics(track, { fetcher: async () => response }));
  }
});
test('catalog validates lyric metadata and never imports identity, lyrics URLs or asset keys', () => {
  const parsed = readPlayerCatalog({ schemaVersion: 2, tracks: [{ ...tracks[0], instrumental: true, lyricsKind: 'lrc', lyricsUrl: 'https://evil.test', assetKey: 'private', isVip: true }] })[0];
  assert.equal(parsed.instrumental, true); assert.equal(parsed.lyricsKind, 'lrc');
  assert.equal(parsed.lyricsUrl, undefined); assert.equal(parsed.assetKey, undefined); assert.equal(parsed.isVip, undefined);
  for (const patch of [{ instrumental: 'yes' }, { lyricsKind: 'html' }]) assert.throws(() => readPlayerCatalog({ schemaVersion: 2, tracks: [{ ...tracks[0], ...patch }] }));
});

test('v2 allowlist keeps favorites, strips identity/URLs, and separates versions and variants with 30-day expiry', () => {
  const fresh = source(), preview = source(tracks[0], 'preview', 8);
  const data = readMusicLocal(json({ schemaVersion: 2, favorites: [tracks[0].id, tracks[0].id, 'bad'], queue: [tracks[1].id], settings: { volume: 9, repeat: 'forever', isVip: true }, current: { ...fresh, cookie: 'secret' },
    positions: [fresh, preview, { ...fresh, revisionNo: 2, assetVersion: 2 }, { ...fresh, trackId: tracks[1].id, savedAt: now-31*86400000 }, { ...fresh, trackId: tracks[2].id, savedAt: now+1000 }], isVip: true, cookie: 'secret' }), now);
  assert.deepEqual(data.favorites, [tracks[0].id]); assert.equal(data.positions.length, 3); assert.equal(data.settings.volume, 1);
  assert.doesNotMatch(json(data), /secret|cookie|isVip|https/);
});
test('legacy migrates only validated ID lists and settings; original stays exportable and old full progress cannot authorize', () => {
  const raw = json({ schemaVersion: 1, favorites: [tracks[0].id], queue: [tracks[1].id], settings: { shuffle: true, volume: .4 }, position: { trackId: tracks[0].id, positionSec: 99 }, isVip: true });
  const disk = storage({ [MUSIC_OLD_KEY]: raw }), store = createMusicLocalData({ storage: () => disk, now: () => now });
  assert.deepEqual(store.snapshot().favorites, [tracks[0].id]); assert.deepEqual(store.snapshot().positions, []); assert.equal(store.snapshot().current, null);
  assert.equal(store.original(), raw); assert.equal(disk.getItem(MUSIC_OLD_KEY), raw); assert.ok(disk.getItem(MUSIC_LOCAL_KEY));
  assert.doesNotMatch(disk.getItem(MUSIC_LOCAL_KEY), /isVip|positionSec/);
});
test('corrupt/unknown local schemas are retained and never overwritten; disabled storage remains usable in memory', () => {
  for (const raw of ['{bad', json({ schemaVersion: 7 }), json({ schemaVersion: 2, favorites: {} })]) {
    const disk = storage({ [MUSIC_LOCAL_KEY]: raw }), store = createMusicLocalData({ storage: () => disk });
    store.toggleFavorite(tracks[0].id); store.recordPlayed(tracks[0].id);
    assert.equal(disk.getItem(MUSIC_LOCAL_KEY), raw); assert.equal(disk.writes, 0); assert.equal(store.original(), raw);
    assert.deepEqual(store.snapshot().favorites, [tracks[0].id]); assert.equal(store.snapshot().warning, 'corrupt');
  }
  const store = createMusicLocalData({ storage: () => { throw new Error('SecurityError'); } });
  assert.equal(store.toggleFavorite(tracks[0].id), true); assert.equal(store.snapshot().persistent, false);
});
test('quota errors do not throw or delete disk records; favorite/recent limits and unavailable IDs survive', () => {
  const disk = storage(), store = createMusicLocalData({ storage: () => disk });
  disk.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(store.toggleFavorite(tracks[0].id), true); assert.equal(store.snapshot().warning, 'storage');
  for (let i=1; i<=501; i++) store.toggleFavorite(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
  assert.equal(store.snapshot().favorites.length, 500);
  for (let i=1; i<=55; i++) store.recordPlayed(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
  assert.equal(store.snapshot().recent.length, 50);
  assert.deepEqual(browseMusic(tracks, [], { mode: 'favorites' }, store.snapshot()).map(t=>t.id), [tracks[0].id]);
  assert.equal(store.snapshot().favorites.length, 500);
});
test('saved/recent order intersects playlist and access filters without mutating stored IDs', () => {
  const local = { favorites: [tracks[2].id, tracks[0].id, tracks[1].id], recent: [tracks[1].id, tracks[0].id] };
  const groups = [{ slug:'demo', trackIds:[tracks[0].id,tracks[2].id] }];
  assert.deepEqual(browseMusic(tracks,groups,{mode:'favorites',collection:'demo'},local).map(t=>t.id),[tracks[2].id,tracks[0].id]);
  assert.deepEqual(browseMusic(tracks,groups,{mode:'recent',collection:'demo'},local).map(t=>t.id),[tracks[0].id]);
  assert.deepEqual(browseMusic(tracks,groups,{mode:'favorites',access:'vip'},local),[]);
  assert.equal(local.favorites.length,3);
});
function playback(saved = {}, overrideTracks = tracks) {
  let time = now;
  const disk = storage({ [MUSIC_LOCAL_KEY]: json({ schemaVersion: 2, ...saved }) });
  const store = createMusicLocalData({ storage: () => disk, now: () => time }), audio = new Audio();
  const player = createMusicPlayer(audio, { origin: 'https://music.example.test' }), queue = createMusicQueue(player), host = new EventTarget();
  queue.updateCatalog(overrideTracks); player.select(overrideTracks[0], 'full');
  const notices = [];
  const binding = bindMusicLocalPlayback(player, queue, store, { host, getTracks: () => overrideTracks, now: () => time, onNotice: value => notices.push(value) });
  return { audio, player, queue, store, disk, host, binding, notices, tick(ms) { time += ms; }, destroy() { binding.destroy(); queue.destroy(); player.destroy(); } };
}
test('restoration resolves fresh catalog IDs, stays paused without src/play, then seeks only after user play and metadata', () => {
  const row = source();
  const h = playback({ favorites: [tracks[2].id], queue: [tracks[2].id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', tracks[0].id], current: row, positions: [row], settings: { volume: .25, repeat: 'all', shuffle: true } });
  h.binding.restore();
  assert.equal(h.audio.src, ''); assert.equal(h.audio.plays.length, 0); assert.equal(h.player.snapshot().status, 'paused'); assert.equal(h.player.snapshot().currentTimeSec, 42);
  assert.deepEqual(h.queue.snapshot().items.map(t=>t.id), [tracks[2].id, tracks[0].id]);
  assert.equal(h.queue.snapshot().repeat, 'all'); assert.equal(h.audio.volume, .25);
  h.queue.playCurrent(tracks); assert.equal(h.audio.plays.length, 1); h.audio.metadata(30);
  assert.equal(h.audio.currentTime, 30); h.destroy();
});
test('saved VIP full never restores into preview or grants playback; changed version does not reuse progress', () => {
  const vip = { ...tracks[0], effectiveAccess: 'vip', previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12 };
  const full = source(vip), h = playback({ current: full, positions: [full] }, [vip]); h.binding.restore();
  assert.equal(h.player.snapshot().activeVariant, 'preview'); assert.equal(h.player.snapshot().currentTimeSec, 0); assert.equal(h.audio.src, '');
  assert.equal(h.queue.snapshot().items.length, 0); h.destroy();
  const row = source(), newer = { ...tracks[0], audioVersion: 2 }, b = playback({ current: row, positions: [row] }, [newer]); b.binding.restore();
  assert.equal(b.player.snapshot().activeAudioVersion, 2); assert.equal(b.player.snapshot().currentTimeSec, 0); assert.deepEqual(b.notices, ['changed']); b.destroy();
});
test('a collection landing keeps its selection instead of restoring an unrelated saved current song', () => {
  const h = playback({ current: source(), positions: [source()], settings: { volume: .3 } });
  h.player.select(tracks[2], 'full'); h.binding.restore({ restoreCurrent: false });
  assert.equal(h.player.snapshot().activeTrackId, tracks[2].id); assert.equal(h.player.snapshot().currentTimeSec, 0);
  assert.equal(h.audio.volume, .3); assert.equal(h.audio.src, ''); assert.equal(h.audio.plays.length, 0); h.destroy();
});
test('explicit user choice before initial reads finish wins over saved current/queue/settings', () => {
  const row = source(), h = playback({ current: row, positions: [row], queue: [tracks[0].id], settings: { volume: .1 } });
  h.queue.playFromList(tracks[1].id, tracks); const src = h.audio.src;
  h.binding.restore(); assert.equal(h.audio.src, src); assert.equal(h.player.snapshot().activeTrackId, tracks[1].id); assert.equal(h.audio.volume, 1); h.destroy();
});
test('early volume or queue preferences win; matching preview progress stays paused and variant-bound', () => {
  for (const edit of [h => h.player.setVolume(.6), h => h.queue.setShuffle(true)]) {
    const h = playback({ settings: { volume: .1 }, current: source(), positions: [source()] });
    edit(h); h.binding.restore(); assert.equal(h.player.snapshot().currentTimeSec, 0);
    assert.notEqual(h.audio.volume, .1); h.destroy();
  }
  const vip = { ...tracks[0], effectiveAccess: 'vip', previewAvailable: true, previewDurationSec: 30, previewSourceStartSec: 12 };
  const row = source(vip, 'preview', 8), h = playback({ current: row, positions: [row] }, [vip]);
  h.binding.restore(); assert.equal(h.player.snapshot().activeVariant, 'preview'); assert.equal(h.player.snapshot().currentTimeSec, 8);
  assert.equal(h.audio.src, ''); assert.equal(h.audio.plays.length, 0); h.destroy();
});
test('a successful foreground retry can restore after the initial catalog failed, without trusting saved VIP hints', async () => {
  const h = playback({ current: source(), positions: [source()] }); let catalog = [], failed = true;
  h.player.clear(); // No initial selection exists until a catalog has been read.
  const binding = bindMusicLocalPlayback(h.player, h.queue, h.store, { getTracks: () => catalog, host: h.host });
  const lifecycle = createMusicAccessLifecycle(h.player, h.queue, { host: h.host, document: new EventTarget(),
    fetcher: async url => ({ status: url.includes('/catalog') && failed ? 503 : 200, json: async () => url.includes('/catalog') ? { schemaVersion: 2, tracks } : {
      authenticated: false, membershipStatus: 'none', canPlayVipFull: false, musicVipDeliveryEnabled: false, validUntil: null, serverNow: new Date(now).toISOString()
    } }),
    onCatalog: value => { catalog = value; },
    onChange: value => { if (!value.checking && catalog.length) binding.restore({ capabilities: value.capabilities }); }
  });
  await lifecycle.refresh('initial'); assert.equal(h.player.snapshot().currentTimeSec, 0);
  failed = false; await lifecycle.refresh('foreground'); assert.equal(h.player.snapshot().currentTimeSec, 42);
  assert.equal(h.audio.src, ''); assert.equal(h.audio.plays.length, 0);
  binding.destroy(); lifecycle.destroy(); h.destroy();
});
test('progress writes at five seconds, pause and pagehide; recently played requires native playing', () => {
  const h = playback(); h.binding.restore(); h.queue.playAll(tracks);
  assert.deepEqual(h.store.snapshot().recent, []); h.audio.metadata(); h.audio.playing();
  assert.deepEqual(h.store.snapshot().recent, [tracks[0].id]);
  const before = h.disk.writes;
  for (let i=1; i<=4; i++) { h.tick(1000); h.audio.currentTime = i; h.audio.emit('timeupdate'); }
  assert.equal(h.disk.writes, before);
  h.tick(1000); h.audio.currentTime = 5; h.audio.emit('timeupdate'); assert.equal(h.disk.writes, before+1);
  h.audio.currentTime = 6; h.audio.emit('timeupdate'); h.player.pause(); assert.equal(h.store.snapshot().current.positionSec, 6);
  h.audio.currentTime = 7; h.audio.emit('timeupdate'); h.host.dispatchEvent(new Event('pagehide')); assert.equal(h.store.snapshot().current.positionSec, 7);
  h.destroy();
});
test('restored positions are discarded on source selection and cannot override already-loaded media', () => {
  const audio = new Audio(), player = createMusicPlayer(audio, { origin: 'https://music.example.test' });
  player.select(tracks[0]); assert.equal(player.restorePosition(42), true); player.select(tracks[1]); player.play({ userInitiated: true }); audio.metadata();
  assert.equal(audio.currentTime, 0); assert.equal(player.restorePosition(8), false); player.destroy();
});

class Element extends EventTarget {
  constructor() { super(); this.children=[]; this.hidden=false; this.open=true; this.textContent=''; this.attrs=new Map(); this.offsetTop=0; this.offsetHeight=30; this.clientHeight=100; }
  replaceChildren() { this.children=[]; this.textContent=''; }
  append(node) { node.offsetTop=this.children.length*30; this.children.push(node); }
  setAttribute(k,v) { this.attrs.set(k,v); } removeAttribute(k) { this.attrs.delete(k); }
  getClientRects() { return [1]; } scrollTo(value) { this.scrolled=value.top; }
}
test('instrumental/missing lyrics do not fetch; progress never retries errors, explicit retry works and destruction rejects late responses', async () => {
  const nodes = new Map(['panel','message','content','follow','retry'].map(key=>[`[data-lyrics-${key}]`,new Element()]));
  let calls = 0, finish;
  const view = mountMusicLyrics({ ownerDocument: { hidden:false, createElement:()=>new Element() }, querySelector:s=>nodes.get(s) }, {
    t:x=>x, fetcher:async()=> { calls++; if (calls===1) return new Response('',{status:503}); return new Promise(resolve=>{finish=resolve;}); }
  });
  view.update({...tracks[0], instrumental:true, lyricsKind:'none'},{});
  assert.equal(nodes.get('[data-lyrics-message]').textContent,'这首作品为纯音乐');
  view.update({...tracks[0], instrumental:false, lyricsKind:'none'},{});
  assert.equal(nodes.get('[data-lyrics-message]').textContent,'暂未提供歌词'); assert.equal(calls,0);
  view.update({...tracks[0], instrumental:false, lyricsKind:'lrc'},{}); await new Promise(r=>setImmediate(r));
  assert.equal(nodes.get('[data-lyrics-retry]').hidden,false);
  for (let second=0; second<20; second++) view.update({...tracks[0], instrumental:false, lyricsKind:'lrc'}, {activeTrackId:tracks[0].id,activeAudioVersion:1,activeVariant:'full',currentTimeSec:second});
  nodes.get('[data-lyrics-panel]').open=false; nodes.get('[data-lyrics-panel]').dispatchEvent(new Event('toggle'));
  nodes.get('[data-lyrics-panel]').open=true; nodes.get('[data-lyrics-panel]').dispatchEvent(new Event('toggle'));
  assert.equal(calls,1); assert.equal(nodes.get('[data-lyrics-retry]').hidden,false);
  nodes.get('[data-lyrics-retry]').dispatchEvent(new Event('click')); assert.equal(calls,2);
  view.destroy(); finish(new Response('[00:01]late',{headers:{'content-type':'text/plain'}})); await new Promise(r=>setImmediate(r));
  assert.equal(nodes.get('[data-lyrics-content]').children.length,0);
});
test('late lyric A never overwrites B; manual scrolling suspends follow and another song never highlights', async () => {
  const nodes = new Map(['panel','message','content','follow','retry'].map(key=>[`[data-lyrics-${key}]`,new Element()]));
  const doc = { hidden:false, createElement:()=>new Element() }, pending=[];
  const view=mountMusicLyrics({ ownerDocument:doc,querySelector:s=>nodes.get(s) },{t:x=>x,fetcher:()=>new Promise(resolve=>pending.push(resolve))});
  const a={...tracks[0],lyricsKind:'lrc'},b={...tracks[1],lyricsKind:'lrc'},state={activeTrackId:a.id,activeAudioVersion:1,activeVariant:'preview',previewSourceStartSec:12,currentTimeSec:0};
  view.update(a,state); view.update(b,state);
  pending[1](new Response('[00:12]B first\n[00:15]B second',{headers:{'content-type':'text/plain'}}));
  await new Promise(r=>setTimeout(r,0));
  pending[0](new Response('[00:00]A late',{headers:{'content-type':'text/plain'}}));
  await new Promise(r=>setTimeout(r,0));
  const content=nodes.get('[data-lyrics-content]'); assert.equal(content.children[0].textContent,'B first'); assert.equal(content.children[0].attrs.has('aria-current'),false);
  view.update(b,{...state,activeTrackId:b.id}); assert.equal(content.children[0].attrs.get('aria-current'),'true');
  content.dispatchEvent(new Event('wheel')); const before=content.scrolled;
  view.update(b,{...state,activeTrackId:b.id,currentTimeSec:3}); assert.equal(content.scrolled,before); assert.equal(nodes.get('[data-lyrics-follow]').hidden,false);
  nodes.get('[data-lyrics-follow]').dispatchEvent(new Event('click')); assert.notEqual(content.scrolled,before);
  view.destroy();
});
