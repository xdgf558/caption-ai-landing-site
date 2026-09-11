import { createMusicPlayer } from './musicPlayerCore.js';
import { createMusicQueue } from './musicPlayerQueue.js';
import { mountMusicQueueControls } from './musicQueueControls.js';
import { readPlayerCatalog, playerVariant, formatMusicTime } from './musicPlayerCatalog.js';

const mounts = new WeakMap();
const statusText = { idle: '尚未播放', loading: '正在载入', playing: '正在播放', paused: '已暂停',
  buffering: '正在缓冲', ended: '播放结束', access_required: '暂不可播放', access_unavailable: '资格暂不可用', error: '播放遇到问题' };
const running = status => ['loading', 'playing', 'buffering'].includes(status);

export function mountMusicPlayer(root, { fetcher = globalThis.fetch.bind(globalThis) } = {}) {
  if (mounts.has(root)) return mounts.get(root);
  const $ = selector => root.querySelector(selector);
  const audio = $('[data-music-audio]'), player = createMusicPlayer(audio);
  const abort = new AbortController(), list = $('[data-track-list]'), rows = new Map();
  let tracks = [], capabilities = null, disposed = false, requestGeneration = 0, scrub = null;
  const queue = createMusicQueue(player);
  const queueControls = mountMusicQueueControls(root, { queue, player, getVisibleTracks: () => tracks });
  const requests = new Set();
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: abort.signal });
  const setText = (selector, text) => { const node = $(selector); if (node.textContent !== text) node.textContent = text; };
  const permission = track => track.effectiveAccess === 'free' ? '免费完整收听'
    : playerVariant(track, capabilities) === 'full' ? 'VIP 完整收听' : track.previewAvailable ? 'VIP · 可试听' : 'VIP · 暂无试听';
  const setImage = (node, url) => {
    if (!url) { node.hidden = true; node.removeAttribute('src'); return; }
    if (node.getAttribute('src') !== url) { node.hidden = false; node.src = url; }
  };
  listen($('[data-cover]'), 'error', () => { $('[data-cover]').hidden = true; $('[data-cover-fallback]').hidden = false; });
  listen($('[data-mini-cover]'), 'error', () => { $('[data-mini-cover]').hidden = true; });
  const icons = (node, busy, playing) => {
    node.querySelector('[data-play-icon]').toggleAttribute('hidden', busy || playing);
    node.querySelector('[data-pause-icon]').toggleAttribute('hidden', !playing || busy);
    node.querySelector('[data-loading-icon]').toggleAttribute('hidden', !busy);
  };
  const render = state => {
    if (disposed) return;
    const selected = tracks.find(track => track.id === state.activeTrackId);
    root.dataset.status = state.status;
    if (scrub && scrub.generation !== state.sourceGeneration) scrub = null;
    $('[data-track-detail]').hidden = !selected;
    $('[data-player-dock]').hidden = !selected;
    if (!selected) return;
    setImage($('[data-cover]'), selected.coverUrl);
    setImage($('[data-mini-cover]'), selected.coverUrl);
    $('[data-cover-fallback]').hidden = !$('[data-cover]').hidden;
    setText('[data-track-title]', selected.title);
    setText('[data-track-creator]', selected.creatorName);
    const selectedAccess = state.activeVariant === 'preview' ? 'VIP · 正在使用试听' : permission(selected);
    setText('[data-track-access]', selectedAccess);
    setText('[data-mini-title]', selected.title);
    setText('[data-mini-description]', `${selected.creatorName} · ${selectedAccess}`);
    const status = state.activeVariant === 'preview' ? `试听 · ${statusText[state.status]}` : statusText[state.status];
    setText('[data-play-status]', status);
    $('[data-play-status]').dataset.state = state.status;
    const unavailable = playerVariant(selected, capabilities) === null;
    $('[data-main-play]').disabled = unavailable && !running(state.status);
    const label = running(state.status) ? '暂停' : state.status === 'ended' ? '重新播放'
      : state.status === 'error' ? '重试播放' : state.currentTimeSec > 0 ? '继续播放'
      : state.activeVariant === 'preview' ? '播放试听' : '播放';
    setText('[data-play-label]', label);
    $('[data-main-play]').setAttribute('aria-label', `${label}：${selected.title}`);
    const message = unavailable ? '这首作品暂未提供试听。' : state.lastError?.message || '';
    for (const selector of ['[data-play-error]', '[data-dock-error]']) {
      setText(selector, message); $(selector).hidden = !message;
    }
    icons($('[data-main-play]'), ['loading', 'buffering'].includes(state.status), state.status === 'playing');
    const time = scrub?.value ?? state.currentTimeSec;
    setText('[data-current-time]', formatMusicTime(time));
    setText('[data-duration]', formatMusicTime(state.durationSec));
    const slider = $('[data-progress]');
    slider.max = String(state.durationSec || 1);
    slider.disabled = audio.readyState < 1 || !audio.seekable.length;
    if (!scrub) slider.value = String(state.currentTimeSec);
    slider.setAttribute('aria-valuetext', `${formatMusicTime(time)}，共 ${formatMusicTime(state.durationSec)}`);
    $('[data-volume]').value = String(state.volume);
    $('[data-mute]').setAttribute('aria-pressed', String(state.muted));
    $('[data-mute]').setAttribute('aria-label', state.muted ? '取消静音' : '静音');
    $('[data-sound-icon]').toggleAttribute('hidden', state.muted);
    $('[data-mute-icon]').toggleAttribute('hidden', !state.muted);
    for (const track of tracks) {
      const row = rows.get(track.id), active = selected.id === track.id;
      row.dataset.selected = String(active);
      row.querySelector('.station-music-select').setAttribute('aria-pressed', String(active));
      row.querySelector('[data-row-description]').textContent = `${track.creatorName} · ${permission(track)}`;
      const button = row.querySelector('[data-row-play]');
      button.disabled = playerVariant(track, capabilities) === null && !(active && running(state.status));
      button.setAttribute('aria-label', `${active && running(state.status) ? '暂停' : playerVariant(track, capabilities) === 'preview' ? '试听' : '播放'}：${track.title}`);
      icons(button, active && ['loading', 'buffering'].includes(state.status), active && state.status === 'playing');
    }
  };
  const choose = (track, start) => {
    if (start) { queue.playFromList(track.id, tracks); return; }
    const variant = playerVariant(track, capabilities);
    // The UI choice is a hint; /audio still performs the actual authorization.
    if (variant === null) { player.select(track, 'preview'); return; }
    player.select(track, variant);
  };
  const renderRows = () => {
    list.replaceChildren(); rows.clear();
    const fragment = document.createDocumentFragment();
    for (const track of tracks) {
      const row = $('[data-track-template]').content.firstElementChild.cloneNode(true);
      row.dataset.trackId = track.id;
      row.querySelector('[data-row-title]').textContent = track.title;
      row.querySelector('[data-row-duration]').textContent = formatMusicTime(track.durationSec);
      const image = row.querySelector('[data-row-cover]');
      setImage(image, track.coverUrl);
      row.querySelector('[data-row-fallback]').toggleAttribute('hidden', Boolean(track.coverUrl));
      listen(image, 'error', () => { image.hidden = true; row.querySelector('[data-row-fallback]').removeAttribute('hidden'); });
      const select = row.querySelector('.station-music-select');
      select.setAttribute('aria-label', `选择：${track.title}`);
      fragment.append(row); rows.set(track.id, row);
    }
    list.append(fragment);
  };
  // Delegate row actions, so replacing the catalog does not accumulate listeners.
  listen(list, 'click', event => {
    const button = event.target.closest('button'), row = button?.closest('[data-track-id]');
    if (!row || !list.contains(row) || button.disabled) return;
    const track = tracks.find(item => item.id === row.dataset.trackId);
    if (track) choose(track, button.hasAttribute('data-row-play'));
  });
  listen($('[data-main-play]'), 'click', () => {
    const state = player.snapshot();
    if (running(state.status)) player.pause(); else queue.playCurrent(tracks);
  });
  listen($('[data-progress]'), 'input', event => {
    scrub = { generation: player.snapshot().sourceGeneration, value: Number(event.target.value) };
    render(player.snapshot());
  });
  listen($('[data-progress]'), 'change', event => {
    if (scrub?.generation === player.snapshot().sourceGeneration) player.seek(Number(event.target.value));
    scrub = null; render(player.snapshot());
  });
  listen($('[data-progress]'), 'pointercancel', () => { scrub = null; render(player.snapshot()); });
  listen($('[data-volume]'), 'input', event => player.setVolume(Number(event.target.value)));
  listen($('[data-mute]'), 'click', () => player.setMuted(!player.snapshot().muted));
  const unsubscribe = player.subscribe(render);
  const json = async (path, controller) => {
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); requests.delete(controller); }
  };
  const load = () => {
    const generation = ++requestGeneration;
    for (const request of requests) request.abort();
    requests.clear(); capabilities = null; queue.updateCapabilities(null);
    $('[data-catalog-retry]').hidden = true;
    $('[data-catalog-message]').hidden = false;
    setText('[data-catalog-message]', '正在整理曲目…');
    const catalogRequest = new AbortController(), capabilityRequest = new AbortController();
    requests.add(catalogRequest); requests.add(capabilityRequest);
    const locale = ['zh-Hans', 'zh-Hant', 'en', 'ja'].includes(root.dataset.locale) ? root.dataset.locale : 'zh-Hans';
    // Capabilities failure must not withhold free tracks. Each request settles independently.
    void json(`/api/music/me/capabilities?locale=${locale}`, capabilityRequest).then(body => {
      if (disposed || generation !== requestGeneration) return;
      capabilities = body; queue.updateCapabilities(body); render(player.snapshot());
    }).catch(() => {});
    void json(`/api/music/catalog?locale=${locale}`, catalogRequest).then(body => {
      if (disposed || generation !== requestGeneration) return;
      tracks = readPlayerCatalog(body);
      queue.updateCatalog(tracks);
      renderRows();
      $('[data-catalog-message]').hidden = tracks.length > 0;
      if (!tracks.length) setText('[data-catalog-message]', '小站还在准备音乐，稍后再来听听。');
      if (tracks.length) choose(tracks[0], false);
      render(player.snapshot());
    }).catch(() => {
      if (disposed || generation !== requestGeneration) return;
      setText('[data-catalog-message]', '曲目暂时无法加载，请稍后重试。');
      $('[data-catalog-retry]').hidden = false;
    });
  };
  listen($('[data-catalog-retry]'), 'click', load);
  const api = { player, queue, destroy() {
    if (disposed) return;
    disposed = true; requestGeneration++;
    for (const request of requests) request.abort();
    requests.clear(); abort.abort(); unsubscribe(); queueControls.destroy(); queue.destroy(); player.destroy(); mounts.delete(root);
  } };
  mounts.set(root, api);
  // Keep bfcache state: restoring a page does not mount a second player.
  listen(window, 'pagehide', event => { if (!event.persisted) api.destroy(); });
  load();
  return api;
}
