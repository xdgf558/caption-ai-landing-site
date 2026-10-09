import { stationClips, clipOriginalLinks, clipNextLinks } from './clipView.js';
import { createStationClipSession } from './clipSession.js';
import { musicCopy, providerName } from './musicCopy.js';
import { createStationMediaMeasurement } from './analyticsMedia.js';
import { observeStationEvent,stationEventsAllowed } from './analyticsControls.js';

export function mountStationClips(root, model, music) {
  const clips = stationClips(model), dialog = document.querySelector('[data-sc-clip-dialog]'), copy = musicCopy[model.locale];
  if (!clips.length || !dialog?.showModal || !copy) return () => {};
  const handlers = new AbortController(), panel = dialog.querySelector('.t-modal'), host = dialog.querySelector('[data-sc-video-host]');
  const $ = selector => dialog.querySelector(selector);
  const next = clipNextLinks(model.track, model.locale);
  const measurement=createStationMediaMeasurement({kind:'clip',emit:observeStationEvent,enabled:stationEventsAllowed});
  if (next.song) $('[data-sc-video-song]').href = next.song.href;
  for (const entry of next.platforms) {
    const link = document.createElement('a'); link.href = entry.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = providerName(entry.provider, model.locale); $('[data-sc-video-platforms]').append(link);
    const clicked=event=>{if(event.isTrusted===false||event.type==='auxclick'&&event.button!==1)return;observeStationEvent('platform_click',{trackId:model.track.id,platformLinkId:entry.id,interactionId:crypto.randomUUID()},true);};
    link.addEventListener('click',clicked,{signal:handlers.signal});link.addEventListener('auxclick',clicked,{signal:handlers.signal});
  }
  let trigger = null, disposed = false, closing = false, closeTimer = null, closeVersion = 0;
  const listen = (target, type, fn) => target.addEventListener(type, fn, { signal: handlers.signal });
  const controller = createStationClipSession({ clips, createVideo: () => document.createElement('video'), pauseMusic: () => music.pause(),
    observer({clip,video,playbackId,status}){measurement.observe({playbackId,trackId:clip?.trackId,clipId:clip?.id,variant:'clip',status:status==='playing'&&(video?.paused||video?.readyState<2)?'paused':status,positionSec:video?.currentTime??0,seeking:video?.seeking,nativeEnded:video?.ended===true});},
    mount(node) { host.replaceChildren(node); },
    view(state) {
      dialog.dataset.videoState = state.status; dialog.dataset.clipId = state.clip?.id || '';
      $('[data-sc-video-retry]').hidden = state.status !== 'error';
      $('[data-sc-video-next]').hidden = state.status !== 'ended' || !next.song;
      if (!state.clip) { $('[data-sc-video-status]').textContent = ''; return; }
      $('[data-sc-video-title]').textContent = state.clip.title;
      $('[data-sc-video-kind]').textContent = state.clip.type === 'mv' ? copy.mv : copy.short;
      $('[data-sc-video-select]').value = state.clip.id;
      $('[data-sc-video-status]').textContent = state.error ? state.error === 'PLAY_NOT_ALLOWED' ? copy.clipBlocked : copy.clipFailed :
        ({ loading: copy.clipLoading, buffering: copy.buffering, paused: copy.paused, ended: copy.ended, playing: copy.clipPlaying })[state.status] || '';
      const original = clipOriginalLinks(state.clip)[0], link = $('[data-sc-video-original]');
      link.hidden = !original; if (original) link.href = original.href; else link.removeAttribute('href');
    }
  });
  const select = $('[data-sc-video-select]');
  for (const clip of clips) { const option = document.createElement('option'); option.value = clip.id; option.textContent = clip.title; select.append(option); }
  $('[data-sc-video-selector]').hidden = clips.length < 2;
  function finishClose(version, focus) {
    if (version !== closeVersion) return;
    panel.classList.remove('is-open', 'is-closing'); dialog.close(); closing = false; closeTimer = null;
    if (focus && !disposed) { if (trigger?.isConnected) trigger.focus(); else document.getElementById('station-main')?.focus(); }
  }
  function close({ immediate = false, focus = true } = {}) {
    const version = ++closeVersion; clearTimeout(closeTimer); controller.close();
    if (!dialog.open) return;
    closing = true; panel.classList.remove('is-open'); panel.classList.add('is-closing');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = immediate || reduced ? 0 : Math.min(1000, Math.max(0, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-close-dur')) || 150));
    if (!duration) finishClose(version, focus); else closeTimer = setTimeout(() => finishClose(version, focus), duration);
  }
  function open(id, source) {
    if (disposed || !clips.some(clip => clip.id === id)) return;
    closeVersion++; clearTimeout(closeTimer); closing = false; trigger = source || trigger;
    panel.classList.remove('is-open', 'is-closing');
    try { if (!dialog.open) dialog.showModal(); }
    catch { return; }
    void panel.offsetWidth; panel.classList.add('is-open'); controller.open(id);
  }
  root.querySelectorAll('[data-sc-clip]').forEach(button => { if (clips.some(clip => clip.id === button.dataset.scClip)) button.hidden = false; });
  listen(root, 'click', event => {
    const button = event.target.closest('[data-sc-clip]');
    if (button && root.contains(button) && clips.some(c => c.id === button.dataset.scClip)) {
      if (button.tagName === 'A') event.preventDefault(); // Home keeps its native detail fallback without JS/DTOs.
      open(button.dataset.scClip, button);
    }
  });
  listen($('[data-sc-video-close]'), 'click', () => close());
  listen($('[data-sc-video-retry]'), 'click', () => { controller.retry(); $('[data-sc-video-close]').focus(); });
  listen(select, 'change', () => open(select.value));
  listen(dialog, 'keydown', event => {
    if (event.key !== 'Tab') return;
    const first = $('[data-sc-video-close]'), nativeVideo = host.querySelector('video');
    const last = !$('[data-sc-video-selector]').hidden ? select : !$('[data-sc-video-original]').hidden ? $('[data-sc-video-original]') :
      !$('[data-sc-video-retry]').hidden ? $('[data-sc-video-retry]') : !$('[data-sc-video-next]').hidden ? $('[data-sc-video-platforms]').lastElementChild || $('[data-sc-video-song]') : nativeVideo || first;
    // Keep the HTML action boundaries inside the panel. Let native video's
    // internal controls handle their own forward Tab sequence.
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && last !== nativeVideo && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  listen(dialog, 'cancel', event => { event.preventDefault(); close(); });
  listen(dialog, 'close', () => { if (!dialog.open && !closing) { closeVersion++; clearTimeout(closeTimer); controller.close(); panel.classList.remove('is-open', 'is-closing'); } });
  // A new music intent wins. Native modal controls are inert behind the dialog,
  // but late/scripted audio state must still be unable to overlap video.
  const unsubscribe = music.subscribe(state => { if (controller.snapshot().clip && ['playing', 'loading', 'buffering'].includes(state.status)) close({ immediate: true }); });
  listen(window, 'pagehide', () => close({ immediate: true, focus: false }));
  listen(window, 'station:game-enter', () => close({ immediate: true, focus: false }));
  listen(document,'visibilitychange',()=>measurement.resetSample());
  return () => { if (disposed) return; disposed = true; close({ immediate: true, focus: false }); handlers.abort(); unsubscribe(); controller.destroy(); };
}
