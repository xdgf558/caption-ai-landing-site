import { createMusicPlayer } from './musicPlayerCore.js';
import { createMusicQueue } from './musicPlayerQueue.js';
import { mountMusicQueueControls } from './musicQueueControls.js';
import { createMusicAccessLifecycle } from './musicAccessLifecycle.js';
import { createMusicSystemControls } from './musicSystemControls.js';
import { playerVariant, formatMusicTime } from './musicPlayerCatalog.js';

import { musicText } from './musicMessages.js';
import { mountMusicLibraryControls } from './musicLibraryControls.js';

const mounts = new WeakMap();
const statusText = { idle: '尚未播放', loading: '正在载入', playing: '正在播放', paused: '已暂停',
  buffering: '正在缓冲', ended: '播放结束', access_required: '暂不可播放', access_unavailable: '资格暂不可用', error: '播放遇到问题' };
const running = status => ['loading', 'playing', 'buffering'].includes(status);

export function mountMusicPlayer(root, { fetcher = globalThis.fetch.bind(globalThis) } = {}) {
  if (mounts.has(root)) return mounts.get(root);
  const t = musicText(root.dataset.locale), isLibrary = root.dataset.library === 'true';
  const $ = selector => root.querySelector(selector);
  const audio = $('[data-music-audio]'), player = createMusicPlayer(audio);
  const abort = new AbortController(), list = $('[data-track-list]'), rows = new Map();
  let rowSignature = '';
  let visibleTracks = [], shownTracks = [], viewTrackId = null, libraryControls = null;
  let tracks = [], capabilities = null, disposed = false, scrub = null, selectedOnce = false, accessState = { checking: false };
  let rowAbort = new AbortController(), systemState = { notice: null, coordinationSupported: true };
  const queue = createMusicQueue(player);
  const queueControls = mountMusicQueueControls(root, { queue, player, getVisibleTracks: () => visibleTracks, getAllTracks: () => tracks });
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: abort.signal });
  const setText = (selector, text) => { const node = $(selector); if (node.textContent !== text) node.textContent = text; };
  const permission = track => track.effectiveAccess === 'free' ? t('免费完整收听')
    : playerVariant(track, capabilities) === 'full' ? t('VIP 完整收听') : track.previewAvailable ? t('VIP · 可试听') : t('VIP · 暂无试听');
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
    root.dataset.pageHidden = String(document.visibilityState === 'hidden');
    if (document.visibilityState === 'hidden') return;
    const selected = tracks.find(track => track.id === state.activeTrackId);
    const viewed = tracks.find(track => track.id === viewTrackId) || (!viewTrackId ? selected : null);
    root.dataset.status = state.status;
    root.dataset.volumeMode = state.volumeSupported ? 'software' : 'device';
    const notice = t(systemState.notice || '') || (!systemState.coordinationSupported ? t('当前浏览器的多个音乐标签页会独立播放。') : '');
    setText('[data-system-notice]', notice); $('[data-system-notice]').hidden = !notice;
    if (scrub && scrub.generation !== state.sourceGeneration) scrub = null;
    $('[data-track-detail]').hidden = !viewed;
    $('[data-player-dock]').hidden = !selected;
    $('[data-access-refresh]').disabled = accessState.checking;
    setText('[data-access-refresh]', state.lastError?.code === 'CONTENT_UNAVAILABLE' ? t('重新加载曲目') : t('重新核验资格'));
    for (const track of shownTracks) {
      const row = rows.get(track.id), active = selected?.id === track.id;
      if (!row) continue;
      row.dataset.selected = String(viewed?.id === track.id);
      row.querySelector('.station-music-select').setAttribute('aria-pressed', String(viewed?.id === track.id));
      row.querySelector('[data-row-description]').textContent = `${track.creatorName} · ${permission(track)}`;
      const button = row.querySelector('[data-row-play]');
      button.disabled = playerVariant(track, capabilities) === null && !(active && running(state.status));
      button.setAttribute('aria-label', t('{action}：{title}', { action: active && running(state.status) ? t('暂停') : playerVariant(track, capabilities) === 'preview' ? t('试听') : t('播放'), title: track.title }));
      icons(button, active && ['loading', 'buffering'].includes(state.status), active && state.status === 'playing');
    }
    if (!selected) return;
    if (viewed) {
      setImage($('[data-cover]'), viewed.coverUrl);
      $('[data-cover-fallback]').hidden = !$('[data-cover]').hidden;
      setText('[data-track-title]', viewed.title);
      setText('[data-track-creator]', viewed.creatorName);
      setText('[data-track-access]', permission(viewed));
      if (isLibrary) {
        setText('[data-track-summary]', viewed.summary);
        $('[data-detail-play]').disabled = playerVariant(viewed, capabilities) === null;
        setText('[data-detail-play]', viewed.id === selected.id && running(state.status) ? t('暂停') : playerVariant(viewed, capabilities) === 'preview' ? t('播放试听') : t('播放'));
      }
    }
    setImage($('[data-mini-cover]'), selected.coverUrl);
    const selectedAccess = state.activeVariant === 'preview' && selected.previewAvailable
      ? `${selected.effectiveAccess === 'vip' ? 'VIP · ' : ''}${t('试听')}` : permission(selected);
    setText('[data-mini-title]', selected.title);
    setText('[data-mini-description]', `${selected.creatorName} · ${selectedAccess}`);
    const status = viewed?.id !== selected.id ? t('尚未播放') : state.activeVariant === 'preview' ? `${t('试听')} · ${t(statusText[state.status])}` : t(statusText[state.status]);
    setText('[data-play-status]', status);
    $('[data-play-status]').dataset.state = viewed?.id === selected.id ? state.status : 'idle';
    const unavailable = playerVariant(selected, capabilities) === null;
    $('[data-main-play]').disabled = unavailable && !running(state.status);
    const blockedFull = state.activeVariant === 'full' && ['access_required', 'access_unavailable'].includes(state.status);
    const label = running(state.status) ? t('暂停') : blockedFull && selected.previewAvailable && playerVariant(selected, capabilities) !== 'full' ? t('播放试听') : state.status === 'ended' ? t('重新播放')
      : state.status === 'error' ? t('重试播放') : state.currentTimeSec > 0 ? t('继续播放')
      : state.activeVariant === 'preview' ? t('播放试听') : t('播放');
    setText('[data-play-label]', label);
    $('[data-main-play]').setAttribute('aria-label', t('{action}：{title}', { action: label, title: selected.title }));
    const message = state.lastError?.message || (unavailable ? t('这首作品暂未提供试听。') : '');
    $('[data-play-full]').hidden = viewed?.id !== selected.id || state.activeVariant !== 'preview' || playerVariant(selected, capabilities) !== 'full';
    $('[data-play-preview]').hidden = viewed?.id !== selected.id || state.activeVariant !== 'full' || !selected.previewAvailable;
    $('[data-membership-link]').hidden = viewed?.id !== selected.id || state.status !== 'access_required';
    for (const selector of ['[data-play-error]', '[data-dock-error]']) {
      setText(selector, t(message)); $(selector).hidden = !message || (selector === '[data-play-error]' && viewed?.id !== selected.id);
    }
    icons($('[data-main-play]'), ['loading', 'buffering'].includes(state.status), state.status === 'playing');
    const time = scrub?.value ?? state.currentTimeSec;
    setText('[data-current-time]', formatMusicTime(time));
    setText('[data-duration]', formatMusicTime(state.durationSec));
    const slider = $('[data-progress]');
    slider.max = String(state.durationSec || 1);
    slider.disabled = audio.readyState < 1 || !audio.seekable.length;
    if (!scrub) slider.value = String(state.currentTimeSec);
    slider.setAttribute('aria-valuetext', t('{time}，共 {duration}', { time: formatMusicTime(time), duration: formatMusicTime(state.durationSec) }));
    $('[data-volume]').value = String(state.volume);
    $('[data-volume]').hidden = !state.volumeSupported;
    $('[data-volume]').disabled = !state.volumeSupported;
    $('[data-mute]').disabled = !state.muteSupported;
    $('[data-mute]').setAttribute('aria-pressed', String(state.muted));
    $('[data-mute]').setAttribute('aria-label', state.muted ? t('取消静音') : t('静音'));
    $('[data-sound-icon]').toggleAttribute('hidden', state.muted);
    $('[data-mute-icon]').toggleAttribute('hidden', !state.muted);

  };
  const choose = (track, start) => {
    viewTrackId = track.id;
    if (libraryControls) libraryControls.select(track.id);
    if (start) { queue.playFromList(track.id, visibleTracks.some(item => item.id === track.id) ? visibleTracks : [track]); return; }
    // Browsing never selects a new audio source or replaces the queue.
    if (!player.snapshot().activeTrackId) player.select(track, playerVariant(track, capabilities) || 'preview');
    render(player.snapshot());
  };
  const renderRows = () => {
    const next = JSON.stringify(shownTracks);
    if (next === rowSignature) return;
    rowSignature = next;
    const focused = document.activeElement?.closest('[data-track-id]');
    const focusId = focused?.dataset.trackId, focusPlay = document.activeElement?.hasAttribute('data-row-play');
    rowAbort.abort(); rowAbort = new AbortController();
    list.replaceChildren(); rows.clear();
    const fragment = document.createDocumentFragment();
    for (const track of shownTracks) {
      const row = $('[data-track-template]').content.firstElementChild.cloneNode(true);
      row.dataset.trackId = track.id;
      row.querySelector('[data-row-title]').textContent = track.title;
      row.querySelector('[data-row-description]').textContent = `${track.creatorName} · ${permission(track)}`;
      row.querySelector('[data-row-play]').setAttribute('aria-label', t('{action}：{title}', { action: t('播放'), title: track.title }));
      row.querySelector('[data-row-play]').disabled = playerVariant(track, capabilities) === null;
      row.querySelector('[data-row-duration]').textContent = formatMusicTime(track.durationSec);
      const image = row.querySelector('[data-row-cover]');
      setImage(image, track.coverUrl);
      row.querySelector('[data-row-fallback]').toggleAttribute('hidden', Boolean(track.coverUrl));
      image.addEventListener('error', () => { image.hidden = true; row.querySelector('[data-row-fallback]').removeAttribute('hidden'); }, { signal: rowAbort.signal });
      const select = row.querySelector('.station-music-select');
      select.setAttribute('aria-label', t('选择：{title}', { title: track.title }));
      fragment.append(row); rows.set(track.id, row);
    }
    list.append(fragment);
    if (focusId) rows.get(focusId)?.querySelector(focusPlay ? '[data-row-play]' : '.station-music-select')?.focus({ preventScroll: true });
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
  listen(document, 'visibilitychange', () => render(player.snapshot()));
  const unsubscribe = player.subscribe(render);
  const locale = ['zh-Hans', 'zh-Hant', 'en', 'ja'].includes(root.dataset.locale) ? root.dataset.locale : 'zh-Hans';
  $('[data-membership-link]').href = { 'zh-Hans': '/zh-hans/library/', 'zh-Hant': '/zh-hant/library/', en: '/en/library/', ja: '/ja/library/' }[locale];
  const access = createMusicAccessLifecycle(player, queue, { fetcher, locale,
    onChange(value) { accessState = value; capabilities = value.capabilities; render(player.snapshot()); },
    onCatalog(values, collections) {
      tracks = values;
      if (libraryControls) libraryControls.update(values, collections);
      else { visibleTracks = shownTracks = values; renderRows(); }
      $('[data-catalog-message]').hidden = visibleTracks.length > 0;
      if (!tracks.length) setText('[data-catalog-message]', t('小站还在准备音乐，稍后再来听听。'));
      if (!selectedOnce && tracks.length && (!viewTrackId || tracks.some(track => track.id === viewTrackId))) { selectedOnce = true; const first = tracks.find(track => track.id === viewTrackId) || visibleTracks[0] || tracks[0];
        player.select(first, playerVariant(first, capabilities) || 'preview'); }
      render(player.snapshot());
    },
    onCatalogError() {
      setText('[data-catalog-message]', t('曲目暂时无法加载，请稍后重试。'));
      $('[data-catalog-message]').hidden = false; $('[data-catalog-retry]').hidden = false;
    }
  });
  if (isLibrary) {
    libraryControls = mountMusicLibraryControls(root, { t, onChange({ results, shown, trackId, loaded }) {
      visibleTracks = results; shownTracks = shown; viewTrackId = trackId || null;
      renderRows();
      $('[data-play-all]').disabled = !results.length;
      if (loaded) {
        $('[data-catalog-message]').hidden = results.length > 0;
        setText('[data-catalog-message]', t(tracks.length ? '没有匹配的歌曲，试试其他条件。' : '小站还在准备音乐，稍后再来听听。'));
      }
      render(player.snapshot());
    } });
    listen($('[data-detail-play]'), 'click', () => {
      const track = tracks.find(item => item.id === (viewTrackId || player.snapshot().activeTrackId));
      if (track) choose(track, true);
    });
  }
  const load = (reason = 'manual') => {
    $('[data-catalog-retry]').hidden = true;
    $('[data-catalog-message]').hidden = false;
    setText('[data-catalog-message]', t('正在整理曲目…'));
    void access.refresh(reason);
  };
  const system = createMusicSystemControls(player, queue, { audio, getTracks: () => tracks, locale,
    onChange(value) { systemState = value; render(player.snapshot()); }
  });
  listen($('[data-catalog-retry]'), 'click', () => load());
  listen($('[data-access-refresh]'), 'click', () => load());
  for (const variant of ['full', 'preview']) listen($(`[data-play-${variant}]`), 'click', () => {
    const id = player.snapshot().activeTrackId;
    if (id) queue.playVariant(id, variant, tracks);
  });
  const api = { player, queue, access, system, destroy() {
    if (disposed) return;
    disposed = true;
    libraryControls?.destroy(); rowAbort.abort(); abort.abort(); unsubscribe(); system.destroy(); access.destroy(); queueControls.destroy(); queue.destroy(); player.destroy(); mounts.delete(root);
  } };
  mounts.set(root, api);
  // Keep bfcache state: restoring a page does not mount a second player.
  listen(window, 'pagehide', event => { if (!event.persisted) api.destroy(); });
  load('initial');
  return api;
}
