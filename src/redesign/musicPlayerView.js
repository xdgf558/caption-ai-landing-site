import { createStationMusicSession } from './musicSession.js';
import { watchReaderSession } from '../scripts/readerSessionEvents.js';
import { musicCopy } from './musicCopy.js';
import { musicIcon, musicTime } from './musicRender.js';
import { stationHref } from './routes.js';

let mounted = null;
const active = state => ['playing', 'loading', 'buffering'].includes(state.status);
export function stationMusicNotice(state, copy) {
  if (state.notice) return ({ checking: copy.prepare, ready: copy.ready, denied: copy.denied, stale: copy.stale,
    failed: copy.playbackFailed, recheck: copy.fullAccessHint })[state.notice.code] || '';
  if (state.lastError) return state.lastError.code === 'PLAY_NOT_ALLOWED' ? copy.blocked :
    state.lastError.code === 'ACCESS_CHANGED' ? copy.fullAccessHint : copy.playbackFailed;
  return state.status === 'ended' ? copy.ended : state.status === 'buffering' ? copy.buffering :
    state.status === 'loading' ? copy.loading : state.status === 'paused' ? copy.paused : '';
}
export function getStationMusicSession(locale) {
  const audio = document.querySelector('[data-sc-music-audio]'), dock = document.querySelector('[data-sc-player-dock]');
  if (!audio || !dock) return null;
  if (mounted && mounted.audio !== audio) disposeStationMusicSession();
  if (!mounted) {
    const session = createStationMusicSession(audio), handlers = new AbortController();
    const $ = selector => dock.querySelector(selector);
    let trigger = null;
    const listen = (target, event, fn) => target.addEventListener(event, fn, { signal: handlers.signal });
    const unsubscribe = session.subscribe(state => {
      const copy = musicCopy[state.locale], fullCheck = state.selectedVariant === 'full' && !active(state) && !session.isPrepared(state.track);
      dock.hidden = !state.track; dock.dataset.playbackState = state.status;
      dock.dataset.playbackId = state.playbackId || '';
      $('.sc-music-player').setAttribute('aria-label', copy.player);
      const toggle = $('[data-sc-play-toggle]');
      toggle.innerHTML = musicIcon(active(state) ? 'pause' : fullCheck ? 'headphones' : 'play');
      toggle.setAttribute('aria-label', active(state) ? copy.pause : fullCheck ? copy.full : copy.play);
      toggle.disabled = Boolean(state.pendingTrackId && state.pendingTrackId === state.track?.id);
      $('[data-sc-now-title]').textContent = state.track?.title || '';
      $('[data-sc-now-artist]').textContent = state.track?.artist || '';
      $('[data-sc-current-time]').textContent = musicTime(Math.floor(state.currentTimeSec * 1000)) || '00:00';
      $('[data-sc-duration]').textContent = musicTime(Math.floor((state.durationSec || 0) * 1000)) || '00:00';
      const seek = $('[data-sc-seek]'); seek.max = String(state.durationSec || 1); seek.value = String(state.currentTimeSec);
      seek.disabled = audio.readyState < 1; seek.setAttribute('aria-label', copy.seek);
      seek.closest('label').querySelector('.sc-sr-only').textContent = copy.seek;
      const volume = $('[data-sc-volume]'); volume.value = String(state.volume); volume.setAttribute('aria-label', copy.volume);
      volume.closest('label').querySelector('.sc-sr-only').textContent = copy.volume;
      volume.closest('label').hidden = !state.volumeSupported;
      $('[data-sc-player-close]').setAttribute('aria-label', copy.close);
      const ownNotice = state.notice?.trackId === state.track?.id ? state.notice : null;
      $('[data-sc-player-status]').textContent = stationMusicNotice({ ...state, notice: ownNotice }, copy);
      const account = $('[data-sc-account-help]'); account.href = stationHref(state.locale, 'member'); account.textContent = copy.login;
      account.hidden = ownNotice?.code !== 'denied';
    });
    listen($('[data-sc-play-toggle]'), 'click', () => session.toggle());
    listen($('[data-sc-seek]'), 'input', event => session.seek(Number(event.target.value)));
    listen($('[data-sc-volume]'), 'input', event => session.setVolume(Number(event.target.value)));
    listen($('[data-sc-player-close]'), 'click', () => {
      session.close(); if (trigger?.isConnected) trigger.focus(); else document.getElementById('station-main')?.focus();
    });
    listen(window, 'pagehide', () => session.suspend());
    const unwatch = watchReaderSession(() => session.invalidateAccess());
    mounted = { audio, session, dispose() { handlers.abort(); unsubscribe(); unwatch(); session.destroy(); }, rememberTrigger(node) { trigger = node; } };
  }
  mounted.session.setLocale(locale);
  void mounted.session.restore();
  return mounted.session;
}
export function rememberStationMusicTrigger(node) { mounted?.rememberTrigger(node); }
export function disposeStationMusicSession() { mounted?.dispose(); mounted = null; }
