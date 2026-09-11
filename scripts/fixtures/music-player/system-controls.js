// LOCAL PREVIEW ONLY. Buttons exercise registered callbacks, not real hardware keys.
import { mountMusicPlayer } from '../../../src/scripts/musicPlayerClient.js';

export function mountLocalSystemFixture() {
  if (new URLSearchParams(location.search).get('system-test') !== '1') return;
  const root = document.querySelector('[data-music-player]'), api = mountMusicPlayer(root);
  const media = navigator.mediaSession, handlers = new Map(), audio = root.querySelector('audio');
  const started = performance.now(), events = { playing: 0, ended: 0, error: 0, pause: 0 }, abort = new AbortController();
  for (const name of Object.keys(events)) audio.addEventListener(name, () => { events[name]++; }, { signal: abort.signal });
  const section = document.createElement('section'); section.dataset.localSystemFixture = '';
  section.style.cssText = 'margin:24px;padding:20px;border:1px solid #ddd;max-width:800px';
  const title = document.createElement('h2'); title.textContent = '本机系统控制夹具（按钮模拟回调）'; section.append(title);
  const output = document.createElement('pre'); output.dataset.localMediaSnapshot = ''; output.style.whiteSpace = 'pre-wrap';
  const original = media?.setActionHandler;
  if (media && original) media.setActionHandler = function(action, callback) {
    original.call(this, action, callback);
    if (callback) handlers.set(action, callback); else handlers.delete(action);
  };
  const render = () => { output.textContent = JSON.stringify({
    elapsedSec: Math.floor((performance.now() - started) / 1000), events,
    system: api.system.snapshot(), actions: [...handlers.keys()], metadata: media?.metadata ? {
      title: media.metadata.title, artist: media.metadata.artist, artwork: media.metadata.artwork
    } : null, playbackState: media?.playbackState || 'unsupported', player: api.player.snapshot(),
    src: audio.getAttribute('src'), paused: audio.paused, time: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : null,
    elements: document.querySelectorAll('audio').length
  }, null, 2); };
  const button = (text, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    node.style.cssText = 'min-height:44px;margin:4px;padding:8px 12px';
    node.addEventListener('click', () => { action(); render(); }); section.append(node);
  };
  for (const name of ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto']) {
    button(`模拟 ${name}`, () => handlers.get(name)?.({ seekTime: 15, seekOffset: 10 }));
  }
  button('读取本机状态', () => {});
  button('模拟设备音量限制', () => {
    const volume = audio.volume;
    Object.defineProperty(audio, 'volume', { configurable: true, get: () => volume, set() {} });
    api.player.setVolume(volume > .5 ? .25 : .75);
  });
  button('销毁播放器', () => { api.destroy(); abort.abort(); });
  section.append(output); document.querySelector('main').append(section); render();
  addEventListener('pagehide', event => {
    if (!event.persisted) { abort.abort(); if (media && original) media.setActionHandler = original; }
  });
}
