import { createMusicPlayer } from './musicPlayerCore.js';
import { createMusicQueue } from './musicPlayerQueue.js';
import { mountMusicQueueControls } from './musicQueueControls.js';
import { createMusicAccessLifecycle } from './musicAccessLifecycle.js';
import { createMusicSystemControls } from './musicSystemControls.js';
import { playerVariant, formatMusicTime } from './musicPlayerCatalog.js';

import { musicText } from './musicMessages.js';
import { mountMusicPanels } from './musicPanels.js';
import { mountMusicLibraryControls } from './musicLibraryControls.js';
import { createMusicLocalData } from './musicLocalData.js';
import { bindMusicLocalPlayback } from './musicLocalPlayback.js';
import { mountMusicLyrics } from './musicLyricsControls.js';
import { musicMembershipHref, MUSIC_RETURN_HASH } from '../music/navigation.js';
import { mountMusicSharing } from './musicSharingControls.js';
import { createMusicReturnSync } from './musicReturnSync.js';

const mounts = new WeakMap();
const statusText = { idle: '尚未播放', loading: '正在载入', playing: '正在播放', paused: '已暂停',
  buffering: '正在缓冲', ended: '播放结束', access_required: '暂不可播放', access_unavailable: '资格暂不可用', error: '播放遇到问题' };
const running = status => ['loading', 'playing', 'buffering'].includes(status);

export function mountMusicPlayer(root, { fetcher = globalThis.fetch.bind(globalThis) } = {}) {
  if (mounts.has(root)) return mounts.get(root);
  const t = musicText(root.dataset.locale), isLibrary = root.dataset.library === 'true';
  const locale = ['zh-Hans', 'zh-Hant', 'en', 'ja'].includes(root.dataset.locale) ? root.dataset.locale : 'zh-Hans';
  const returnedFromMembership = isLibrary && window.location.hash === MUSIC_RETURN_HASH;
  const $ = selector => root.querySelector(selector);
  const audio = $('[data-music-audio]'), player = createMusicPlayer(audio);
  const abort = new AbortController(), list = $('[data-track-list]'), rows = new Map();
  let rowSignature = '';
  let visibleTracks = [], shownTracks = [], viewTrackId = null, libraryControls = null, localPlayback = null, localUnsubscribe = null;
  let tracks = [], capabilities = null, disposed = false, scrub = null, selectedOnce = false, accessState = { checking: false };
  let rowAbort = new AbortController(), systemState = { notice: null, coordinationSupported: true };
  let catalogView = null, collections = [], browseScheduled = false, attemptedTarget = '', returnSync = null;
  const panels = isLibrary ? mountMusicPanels(root) : null;
  const local = isLibrary ? createMusicLocalData() : null;
  let favoriteIds = new Set(local?.snapshot().favorites || []);
  const lyrics = isLibrary ? mountMusicLyrics(root, { t, fetcher }) : null;
  const sharing = isLibrary ? mountMusicSharing(root, { t, locale }) : null;
  const queue = createMusicQueue(player);
  const queueControls = mountMusicQueueControls(root, { queue, player, getVisibleTracks: () => visibleTracks, getAllTracks: () => tracks, panels });
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: abort.signal });
  const setText = (selector, text) => { const node = $(selector); if (node.textContent !== text) node.textContent = text; };
  const permission = track => track.effectiveAccess === 'free' ? t('免费完整收听')
    : playerVariant(track, capabilities) === 'full' ? t('VIP 完整收听') : track.previewAvailable ? t('VIP · 可试听') : t('VIP · 暂无试听');
  const setImage = (node, url) => {
    if (!url) { node.hidden = true; node.removeAttribute('src'); return; }
    if (node.getAttribute('src') !== url) { node.hidden = false; node.src = url; }
  };
  listen($('[data-cover]'), 'error', () => { $('[data-cover]').hidden = true; $('[data-cover-fallback]').hidden = false; });
  if (isLibrary) listen($('[data-hero-cover]'), 'error', () => { $('[data-hero-cover]').hidden = true; });
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
    const target = libraryControls?.target() || {};
    sharing?.update({ track: viewed, collection: collections.find(item => item.slug === target.collection) });
    $('[data-membership-link]').href = musicMembershipHref(locale, new URLSearchParams({ ...target, ...(viewed ? { track: viewed.id } : {}) }));
    $('[data-membership-link]').hidden = !viewed || viewed.effectiveAccess !== 'vip' || accessState.checking || capabilities?.membershipStatus === 'active';
    if (isLibrary) $('[data-return-membership]').href = musicMembershipHref(locale, new URLSearchParams(target));
    root.dataset.status = state.status;
    root.dataset.volumeMode = state.volumeSupported ? 'software' : 'device';
    const notice = t(systemState.notice || '') || (!systemState.coordinationSupported ? t('当前浏览器的多个音乐标签页会独立播放。') : '');
    setText('[data-system-notice]', notice); $('[data-system-notice]').hidden = !notice;
    if (scrub && scrub.generation !== state.sourceGeneration) scrub = null;
    $('[data-track-detail]').hidden = !viewed;
    if (isLibrary && !viewed) setImage($('[data-hero-cover]'), null);
    $('[data-player-dock]').hidden = !selected;
    $('[data-access-refresh]').disabled = accessState.checking;
    setText('[data-access-refresh]', state.lastError?.code === 'CONTENT_UNAVAILABLE' ? t('重新加载曲目') : t('重新核验资格'));
    for (const track of shownTracks) {
      const row = rows.get(track.id), active = selected?.id === track.id;
      if (!row) continue;
      row.dataset.selected = String(viewed?.id === track.id);
      row.dataset.playing = String(active && state.status === 'playing');
      if (isLibrary) {
        const favorite = favoriteIds.has(track.id), button = row.querySelector('[data-row-favorite]');
        button.setAttribute('aria-pressed', String(favorite));
        button.setAttribute('aria-label', t(favorite ? '取消收藏：{title}' : '收藏：{title}', { title: track.title }));
      }
      row.querySelector('.station-music-select').setAttribute('aria-pressed', String(viewed?.id === track.id));
      row.querySelector('[data-row-creator]').textContent = `${track.creatorName} · `;
      row.querySelector('[data-row-access]').textContent = permission(track);
      const button = row.querySelector('[data-row-play]');
      button.disabled = playerVariant(track, capabilities) === null && !(active && running(state.status));
      button.setAttribute('aria-label', t('{action}：{title}', { action: active && running(state.status) ? t('暂停') : playerVariant(track, capabilities) === 'preview' ? t('试听') : t('播放'), title: track.title }));
      icons(button, active && ['loading', 'buffering'].includes(state.status), active && state.status === 'playing');
    }
    panels?.refresh();
    lyrics?.update(viewed, state);
    if (viewed) {
      setImage($('[data-cover]'), viewed.coverUrl);
      if (isLibrary) setImage($('[data-hero-cover]'), viewed.coverUrl);
      $('[data-cover-fallback]').hidden = !$('[data-cover]').hidden;
      setText('[data-track-title]', viewed.title);
      setText('[data-track-creator]', viewed.creatorName);
      setText('[data-track-access]', permission(viewed));
      if (isLibrary) {
        const favorite = favoriteIds.has(viewed.id);
        $('[data-detail-favorite]').setAttribute('aria-pressed', String(favorite));
        setText('[data-detail-favorite-label]', t(favorite ? '已收藏' : '收藏'));
        setText('[data-track-summary]', viewed.summary);
        $('[data-detail-play]').disabled = playerVariant(viewed, capabilities) === null;
        setText('[data-detail-play]', viewed.id === selected?.id && running(state.status) ? t('暂停') : playerVariant(viewed, capabilities) === 'preview' ? t('播放试听') : t('播放'));
      }
    }
    if (!selected) {
      setText('[data-play-status]', t('尚未播放'));
      $('[data-play-status]').dataset.state = 'idle';
      for (const selector of ['[data-play-full]', '[data-play-preview]', '[data-play-error]']) $(selector).hidden = true;
      return;
    }
    setText('[data-mini-status]', t(statusText[state.status]));
    setImage($('[data-mini-cover]'), selected.coverUrl);
    const selectedAccess = state.activeVariant === 'preview' && selected.previewAvailable
      ? `${selected.effectiveAccess === 'vip' ? 'VIP · ' : ''}${t('试听')}` : permission(selected);
    setText('[data-mini-title]', selected.title);
    setText('[data-mini-creator]', `${selected.creatorName} · `);
    setText('[data-mini-access]', selectedAccess);
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
    localPlayback?.touch();
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
    const focusId = focused?.dataset.trackId, focusSelector = document.activeElement?.hasAttribute('data-row-play') ? '[data-row-play]' : document.activeElement?.hasAttribute('data-row-favorite') ? '[data-row-favorite]' : '.station-music-select';
    rowAbort.abort(); rowAbort = new AbortController();
    list.replaceChildren(); rows.clear();
    const fragment = document.createDocumentFragment();
    for (const track of shownTracks) {
      const row = $('[data-track-template]').content.firstElementChild.cloneNode(true);
      row.dataset.trackId = track.id;
      row.querySelector('[data-row-title]').textContent = track.title;
      row.querySelector('[data-row-creator]').textContent = `${track.creatorName} · `;
      row.querySelector('[data-row-access]').textContent = permission(track);
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
    if (focusId) rows.get(focusId)?.querySelector(focusSelector)?.focus({ preventScroll: true });
  };
  // Delegate row actions, so replacing the catalog does not accumulate listeners.
  listen(list, 'click', event => {
    const button = event.target.closest('button'), row = button?.closest('[data-track-id]');
    if (!row || !list.contains(row) || button.disabled) return;
    const track = tracks.find(item => item.id === row.dataset.trackId);
    if (track) {
      if (button.hasAttribute('data-row-favorite')) {
        local?.toggleFavorite(track.id);
        if (!button.isConnected) $('[data-browse-mode][aria-pressed="true"]')?.focus();
        return;
      }
      const start = button.hasAttribute('data-row-play');
      choose(track, start);
      if (!start) panels?.open('detail', button);
    }
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
  const access = createMusicAccessLifecycle(player, queue, { fetcher, locale,
    getSelection: () => libraryControls?.target() || {},
    onChange(value) {
      accessState = value; capabilities = value.capabilities;
      // Completion also covers a foreground retry after the first catalog read failed.
      // The lifecycle enforces current access before publishing checking=false.
      if (!value.checking && tracks.length) localPlayback?.restore({ selection: libraryControls?.selection(),
        restoreCurrent: !libraryControls?.target().collection, capabilities });
      render(player.snapshot());
      scheduleBrowse();
    },
    onCatalog(values, groups, context) {
      tracks = values; collections = groups; catalogView = context;
      if (libraryControls) libraryControls.update(values, groups, context);
      else { visibleTracks = shownTracks = values; renderRows(); }
      $('[data-catalog-message]').hidden = visibleTracks.length > 0;
      $('[data-catalog-retry]').hidden = !context?.issues.track && !context?.issues.collection;
      if (!isLibrary && !tracks.length) setText('[data-catalog-message]', t('小站还在准备音乐，稍后再来听听。'));
      const first = viewTrackId ? tracks.find(track => track.id === viewTrackId) : visibleTracks[0];
      if (!selectedOnce && first) { selectedOnce = true; player.select(first, playerVariant(first, capabilities) || 'preview'); }
      render(player.snapshot());
    },
    onCatalogError() {
      setText('[data-catalog-message]', t('曲目暂时无法加载，请稍后重试。'));
      $('[data-catalog-message]').hidden = false; $('[data-catalog-retry]').hidden = false;
    }
  });
  function scheduleBrowse() {
    if (!libraryControls || disposed || accessState.checking || browseScheduled) return;
    const target = libraryControls.target(), key = JSON.stringify(target);
    const unresolved = target.track && !tracks.some(track => track.id === target.track) && catalogView?.selection.track !== target.track
      || target.collection && catalogView?.selection.collection !== target.collection;
    if (!unresolved || key === attemptedTarget) return;
    attemptedTarget = key; browseScheduled = true;
    queueMicrotask(async () => {
      if (!disposed) await access.browse();
      browseScheduled = false; scheduleBrowse();
    });
  }
  if (isLibrary) {
    libraryControls = mountMusicLibraryControls(root, { t, getLocal: () => local.snapshot(), onChange({ results, shown, trackId, loaded, mode }) {
      visibleTracks = results; shownTracks = shown; viewTrackId = trackId || null;
      renderRows();
      $('[data-play-all]').disabled = !results.length;
      if (loaded) {
        $('[data-catalog-message]').hidden = results.length > 0;
        setText('[data-catalog-message]', t(mode === 'albums' ? '暂无已发布专辑。专辑发布后会显示在这里。' : mode === 'favorites' ? '暂无可显示的收藏。未发布曲目的收藏仍会保留。' : mode === 'recent' ? '暂无可显示的播放记录。播放歌曲后会记录在这里。' : tracks.length ? '没有匹配的歌曲，试试其他条件。' : '小站还在准备音乐，稍后再来听听。'));
      }
      render(player.snapshot());
      if (loaded) scheduleBrowse();
    } });
    listen($('[data-detail-play]'), 'click', () => {
      const track = tracks.find(item => item.id === (viewTrackId || player.snapshot().activeTrackId));
      if (track) choose(track, true);
    });
    localPlayback = bindMusicLocalPlayback(player, queue, local, { getTracks: () => tracks, host: window, onNotice(kind) {
      const messages = { restored: '已恢复上次位置，点击播放继续。', changed: '音频版本或收听方式已变化，请重新选择播放。', missing: '上次曲目暂不可用，本机记录仍保留。' };
      setText('[data-resume-notice]', t(messages[kind])); $('[data-resume-notice]').hidden = false;
    } });
    localUnsubscribe = local.subscribe(value => {
      favoriteIds = new Set(value.favorites);
      const messages = { storage: '本机记录暂时无法保存，本次播放仍可继续。', corrupt: '本机记录无法读取。原始记录已保留，可先导出；本次使用临时记录。', migration: '已迁移旧收藏与设置。旧进度未恢复，请重新选择歌曲。', limit: '最多收藏 500 首，请先移除部分收藏。' };
      setText('[data-local-notice]', t(messages[value.warning] || '')); $('[data-local-notice]').hidden = !value.warning;
      $('[data-local-export]').hidden = !value.canExportOriginal;
      libraryControls.refreshLocal(); render(player.snapshot());
    });
    listen($('[data-detail-favorite]'), 'click', () => {
      const id = viewTrackId || player.snapshot().activeTrackId; if (id) local.toggleFavorite(id);
    });
    listen($('[data-local-export]'), 'click', () => {
      const raw = local.original(); if (raw === null) return;
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'stationcat-music-original.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    listen($('[data-local-clear]'), 'click', () => {
      if (window.confirm(t('清除这个浏览器的收藏、播放记录和保存进度？当前播放不会停止。'))) { localPlayback.clear(); $('[data-resume-notice]').hidden = true; }
    });
    returnSync = createMusicReturnSync(access, { onChange(status) {
      if (disposed || status === 'stopped') return;
      const messages = { checking: '会员权益正在同步，最多等待 60 秒。', ready: capabilities?.canPlayVipFull ? '权益已重新核验，点击播放继续。' : 'VIP 资格有效，完整音频暂未开放。',
        login: '请登录会员中心后返回音乐。', timeout: '会员权益尚未确认，请稍后重新核验或返回会员中心。' };
      setText('[data-music-return-notice]', t(messages[status])); $('[data-music-return-notice]').hidden = false;
      $('[data-return-membership]').hidden = !['timeout', 'login'].includes(status);
    } });
    for (const selector of ['[data-membership-link]', '[data-return-membership]']) listen($(selector), 'click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      player.pause(); localPlayback.flush();
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
    returnSync?.destroy(); sharing?.destroy(); localPlayback?.destroy(); localUnsubscribe?.(); local?.destroy(); lyrics?.destroy(); panels?.destroy(); libraryControls?.destroy(); rowAbort.abort(); abort.abort(); unsubscribe(); system.destroy(); access.destroy(); queueControls.destroy(); queue.destroy(); player.destroy(); mounts.delete(root);
  } };
  mounts.set(root, api);
  // Keep bfcache state: restoring a page does not mount a second player.
  listen(window, 'pagehide', event => { if (!event.persisted) api.destroy(); });
  if (returnedFromMembership) returnSync.start(); else load('initial');
  return api;
}
