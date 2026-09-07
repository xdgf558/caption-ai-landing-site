import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';

const code = readFileSync(new URL('../public/games/cat-life/src/js/systems/musicSystem.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const sources = [], audios = [], contexts = [], requests = [], events = {};
  const settings = { bgmEnabled: true, bgmVolume: 60, sfxVolume: 37, customMusicEnabled: false, customMusicData: '', customMusicName: '' };
  const document = { baseURI: 'https://example.test/games/cat-life/', hidden: false };
  const gain = () => ({ gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; }, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } }, connect() {}, disconnect() {} });
  class Context {
    constructor() { this.currentTime = 0; this.state = 'suspended'; contexts.push(this); }
    createGain() { return gain(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 75.02220833333334 }); }
    createBufferSource() {
      const node = { connect() {}, disconnect() {}, start(at, offset) { this.at = at; this.offset = offset; }, stop() { this.stopped = true; } };
      sources.push(node); return node;
    }
  }
  class Audio {
    constructor() { this.paused = true; this.currentTime = 0; audios.push(this); }
    play() { this.paused = false; this.plays = (this.plays || 0) + 1; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  const game = { state: { game: { settings } }, systems: {}, utils: { i18n: { t: key => key } } };
  const window = { CatGame: game, AudioContext: Context, addEventListener(name, fn) { events[name] = fn; }, fetch(url) { return new Promise(resolve => requests.push({ url, resolve })); } };
  vm.runInNewContext(code, { window, document, URL, Audio });
  const music = game.systems.musicSystem; music.init();
  const respond = (ok = true) => requests.at(-1).resolve({ ok, arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) });
  return { music, settings, sources, audios, contexts, requests, document, events, respond };
}

test('approved soft loop is present unchanged, without shipping WAV or soundbank', () => {
  const file = readFileSync(new URL('../public/games/cat-life/src/assets/audio/moonlight-tiptoes-soft.m4a', import.meta.url));
  assert.equal(createHash('sha256').update(file).digest('hex'), '2e853e7d5eaa5673053a442a9ec257e470488a0a909f311e25bd22279285aba2');
  assert.ok(file.length < 1_300_000);
});
test('init/render are lazy; repeated unlock, page changes and renders share one loop', async () => {
  const s = setup(); s.music.syncForState('home');
  assert.equal(s.contexts.length, 0); assert.equal(s.requests.length, 0);
  s.music.unlock(); s.music.unlock(); s.music.syncForState('work');
  assert.equal(s.requests.length, 1); s.respond(); await flush();
  for (const page of ['home', 'work', 'cats', 'arcade']) s.music.syncForState(page);
  await flush(); assert.equal(s.sources.length, 1);
  assert.equal(s.sources[0].loop, true); assert.equal(s.sources[0].loopEnd, 75);
  assert.equal(s.settings.sfxVolume, 37);
});
test('muting, volume zero and background pause; cached loop resumes at its position', async () => {
  const s = setup(); s.music.unlock(); s.respond(); await flush();
  s.contexts[0].currentTime = 18; s.settings.bgmEnabled = false; s.music.syncForState();
  assert.equal(s.sources[0].stopped, true);
  s.contexts[0].currentTime = 30; s.settings.bgmEnabled = true; s.music.syncForState(); await flush();
  assert.equal(s.sources.at(-1).offset, 18);
  s.contexts[0].currentTime = 40; s.document.hidden = true; s.music.syncForState();
  s.contexts[0].currentTime = 100; s.document.hidden = false; s.music.syncForState(); await flush();
  assert.equal(s.sources.at(-1).offset, 28);
  s.events.pagehide(); assert.equal(s.sources.at(-1).stopped, true);
  s.events.pageshow(); await flush(); assert.equal(s.sources.at(-1).offset, 28);
  s.settings.bgmVolume = 0; s.music.syncForState(); assert.equal(s.sources.at(-1).stopped, true);
  s.settings.bgmVolume = 60; s.music.syncForState(); await flush();
  assert.equal(s.requests.length, 1); assert.equal(s.sources.at(-1).offset, 28);
});
test('disabled or invalid volume never starts music, including first gesture', async () => {
  for (const volume of [0, -1, 'invalid']) {
    const s = setup(); s.settings.bgmVolume = volume; s.music.unlock(); await flush();
    assert.equal(s.requests.length, 0); assert.equal(s.sources.length, 0);
  }
  const s = setup(); s.settings.bgmEnabled = false; s.music.unlock();
  assert.equal(s.requests.length, 0);
});
test('late download cannot restart muted or hidden playback', async () => {
  for (const mode of ['mute', 'hidden', 'pagehide']) {
    const s = setup(); s.music.unlock();
    if (mode === 'mute') s.settings.bgmEnabled = false;
    if (mode === 'hidden') s.document.hidden = true;
    if (mode === 'pagehide') s.events.pagehide();
    s.music.syncForState(); s.respond(); await flush(); assert.equal(s.sources.length, 0);
  }
});
test('failed loads stay quiet, do not retry on render, and recover after a gesture', async () => {
  const s = setup(); s.music.unlock(); s.respond(false); await flush();
  assert.equal(s.music.getCurrentTrackLabel(), 'music_load_failed');
  for (let i = 0; i < 10; i++) s.music.syncForState();
  await flush(); assert.equal(s.requests.length, 1); assert.equal(s.sources.length, 0);
  s.music.unlock(); assert.equal(s.requests.length, 2); s.respond(); await flush();
  assert.equal(s.sources.length, 1); assert.equal(s.music.getCurrentTrackLabel(), 'music_track_moonlight');
});
test('custom music wins over an in-flight default download; pages do not restart it', async () => {
  const s = setup(); s.music.unlock();
  Object.assign(s.settings, { customMusicEnabled: true, customMusicData: 'data:audio/wav;base64,fixture', customMusicName: 'My song' });
  s.music.syncForState(); s.respond(); await flush();
  assert.equal(s.sources.length, 0); assert.equal(s.audios.length, 1); assert.equal(s.audios[0].paused, false);
  s.audios[0].currentTime = 12; s.music.syncForState('work'); await flush();
  assert.equal(s.audios[0].plays, 1); assert.equal(s.music.getCurrentTrackLabel(), 'My song');
  s.settings.bgmEnabled = false; s.music.syncForState(); assert.equal(s.audios[0].paused, true);
  s.settings.bgmEnabled = true; s.music.syncForState(); await flush();
  assert.equal(s.audios[0].currentTime, 12);
  s.music.clearCustomMusic(); s.music.syncForState(); await flush();
  assert.equal(s.audios[0].paused, true); assert.equal(s.sources.length, 1); assert.equal(s.requests.length, 1);
  assert.equal(s.settings.customMusicData, ''); assert.equal(s.settings.bgmVolume, 60);
});
test('selecting custom audio stops the default; clearing returns to the cached position', async () => {
  const s = setup(); s.music.unlock(); s.respond(); await flush();
  s.contexts[0].currentTime = 8;
  Object.assign(s.settings, { customMusicEnabled: true, customMusicData: 'data:audio/wav;base64,fixture' });
  s.music.syncForState(); await flush(); assert.equal(s.sources[0].stopped, true);
  s.music.clearCustomMusic(); s.music.syncForState(); await flush();
  assert.equal(s.sources.at(-1).offset, 8); assert.equal(s.requests.length, 1);
});
