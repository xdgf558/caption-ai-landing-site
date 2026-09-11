// One native media element; UI views subscribe to its state, never their own timers.
const players = new WeakMap();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const finite = value => Number.isFinite(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;

export function musicSource(track, variant) {
  if (!track || !uuid.test(track.id) || !positive(track.audioVersion) || !['full', 'preview'].includes(variant)) {
    throw new TypeError('Invalid music source');
  }
  return `/api/music/tracks/${track.id}/audio?v=${track.audioVersion}&variant=${variant}`;
}

export function createMusicPlayer(audio, { origin = globalThis.location?.origin } = {}) {
  if (players.has(audio)) return players.get(audio);
  const listeners = new Set(), playListeners = new Set(), events = new Map();
  let destroyed = false, intent = false, attempt = 0, expectedSource = '', metadataReady = false;
  let state = {
    status: 'idle', activeTrackId: null, activeAudioVersion: null, activeVariant: null,
    activePolicyVersion: null, fullDurationSec: null, previewSourceStartSec: null,
    currentTimeSec: 0, durationSec: null, sourceGeneration: 0, seeking: false,
    volume: audio.volume, muted: audio.muted, volumeSupported: true, muteSupported: true, lastError: null
  };
  audio.preload = 'none';
  audio.autoplay = false;
  // Probe before a source exists. Some browsers silently ignore software volume.
  const initialVolume = audio.volume, probeVolume = initialVolume === 1 ? .5 : 1;
  try { audio.volume = probeVolume; state.volumeSupported = Math.abs(audio.volume - probeVolume) < .001; }
  catch { state.volumeSupported = false; }
  finally { try { audio.volume = initialVolume; } catch {} }
  state.volume = audio.volume;
  const snapshot = () => ({ ...state, lastError: state.lastError ? { ...state.lastError } : null });
  const publish = patch => {
    if (destroyed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(snapshot());
  };
  // Queued old media events have no source identity. Check the current resource
  // AND its native properties; never take an old event's name as proof of state.
  const current = () => !destroyed && expectedSource && audio.currentSrc === expectedSource;
  const on = (name, fn) => { audio.addEventListener(name, fn); events.set(name, fn); };
  const progress = () => {
    if (!current() || !metadataReady || audio.readyState < 1) return;
    if (resumePosition !== null && audio.seekable.length) {
      const position = resumePosition; resumePosition = null;
      if (api.seek(position)) return;
    }
    const durationSec = finite(audio.duration) && audio.duration > 0 ? audio.duration : state.durationSec;
    publish({ durationSec, seeking: Boolean(audio.seeking), currentTimeSec: finite(audio.currentTime)
      ? Math.min(audio.currentTime, durationSec ?? audio.currentTime) : 0 });
  };
  on('loadedmetadata', () => {
    if (!current() || audio.readyState < 1) return;
    metadataReady = true;
    progress();
  });
  on('durationchange', progress);
  on('timeupdate', progress);
  on('seeking', progress);
  on('seeked', progress);
  on('ratechange', progress);
  on('playing', () => {
    if (!current() || audio.readyState < 2 || audio.paused || audio.ended) return;
    if (!intent) { audio.pause(); return; }
    publish({ status: 'playing', lastError: null });
  });
  on('waiting', () => {
    if (current() && intent && !audio.paused && audio.readyState < 3) publish({ status: 'buffering' });
  });
  on('pause', () => {
    if (!current() || !audio.paused || audio.ended || !metadataReady) return;
    if (!intent && ['error', 'ended'].includes(state.status)) return;
    // pause() called during source replacement may dispatch after a new play().
    // Loading intent is settled by playing/error/play rejection, not that event.
    if (intent && ['loading', 'buffering'].includes(state.status)) return;
    intent = false;
    attempt++;
    publish({ status: 'paused' });
  });
  on('ended', () => {
    if (!current() || !metadataReady || !audio.ended) return;
    intent = false;
    attempt++;
    progress();
    publish({ status: 'ended' }); // Queue advancement is intentionally a later layer.
  });
  const failure = code => {
    intent = false;
    attempt++;
    audio.pause();
    publish({ status: 'error', lastError: { code, message: '暂时无法播放，请重试或选择另一首。' } });
  };
  on('error', () => {
    if (current() && audio.error) failure(`MEDIA_${audio.error.code || 'UNKNOWN'}`);
  });
  on('volumechange', () => publish({ volume: audio.volume, muted: audio.muted }));

  const stopSource = () => {
    intent = false;
    attempt++;
    expectedSource = '';
    metadataReady = false;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };
  const select = (track, variant = 'full') => {
    if (destroyed) return false;
    musicSource(track, variant); // Validate before disturbing the current source.
    if (state.activeTrackId === track.id && state.activeAudioVersion === track.audioVersion && state.activePolicyVersion === track.policyVersion && state.activeVariant === variant) return false;
    stopSource();
    resumePosition = null;
    publish({ status: 'idle', activeTrackId: track.id, activeAudioVersion: track.audioVersion,
      activeVariant: variant, activePolicyVersion: track.policyVersion,
      fullDurationSec: track.durationSec, previewSourceStartSec: variant === 'preview' ? track.previewSourceStartSec : null,
      currentTimeSec: 0, seeking: false, durationSec: variant === 'preview' ? track.previewDurationSec : track.durationSec,
      sourceGeneration: state.sourceGeneration + 1, lastError: null });
    return true;
  };
  const pause = () => {
    if (destroyed || !state.activeTrackId) return;
    intent = false;
    attempt++;
    audio.pause();
    publish({ status: 'paused' });
  };
  let playGuard = null, resumePosition = null;
  const unload = ({ status = 'paused', code = null, message = '', preservePosition = true } = {}) => {
    if (destroyed) return;
    stopSource();
    resumePosition = preservePosition ? state.currentTimeSec : null;
    publish({ status, seeking: false, sourceGeneration: state.sourceGeneration + 1,
      currentTimeSec: preservePosition ? state.currentTimeSec : 0,
      lastError: code ? { code, message } : null });
  };
  const play = ({ userInitiated = false } = {}) => {
    if (destroyed || !state.activeTrackId) return;
    const denied = playGuard?.(snapshot());
    if (denied) { unload(denied); return; }
    if (userInitiated) for (const listener of playListeners) listener(snapshot());
    const generation = state.sourceGeneration, invocation = ++attempt;
    intent = true;
    if (!expectedSource || audio.error) {
      metadataReady = false;
      expectedSource = new URL(musicSource({ id: state.activeTrackId, audioVersion: state.activeAudioVersion }, state.activeVariant), origin).href;
      audio.src = expectedSource;
      audio.load();
    } else if (audio.ended) {
      audio.currentTime = 0;
    }
    publish({ status: 'loading', lastError: null });
    // No await before play(): preserve the user's transient activation.
    try {
      Promise.resolve(audio.play()).catch(error => {
        if (destroyed || generation !== state.sourceGeneration || invocation !== attempt || !intent) return;
        if (error?.name === 'AbortError') {
          intent = false;
          audio.pause();
          publish({ status: 'paused' });
        } else if (error?.name === 'NotAllowedError') {
          intent = false;
          audio.pause();
          publish({ status: 'paused', lastError: { code: 'PLAY_NOT_ALLOWED', message: '浏览器尚未开始播放，请再次点击播放。' } });
        } else failure(error?.name === 'NotSupportedError' ? 'MEDIA_UNSUPPORTED' : 'PLAY_FAILED');
      });
    } catch { failure('PLAY_FAILED'); }
  };
  const api = {
    snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    onUserPlay(listener) { playListeners.add(listener); return () => playListeners.delete(listener); },
    select,
    play,
    pause,
    unload,
    restorePosition(value) {
      // Restore only a source-less selection. Metadata/seekable will clamp it
      // after the next explicit play; this method never assigns src or plays.
      if (destroyed || expectedSource || !state.activeTrackId || !finite(value) || !['idle', 'paused'].includes(state.status)) return false;
      resumePosition = Math.min(value, state.durationSec ?? value);
      publish({ status: 'paused', currentTimeSec: resumePosition });
      return true;
    },
    setPlayGuard(guard) { playGuard = guard; },
    clear() {
      if (destroyed) return;
      stopSource();
      resumePosition = null;
      publish({ status: 'idle', activeTrackId: null, activeAudioVersion: null, activeVariant: null,
        activePolicyVersion: null, fullDurationSec: null, previewSourceStartSec: null,
        currentTimeSec: 0, durationSec: null, seeking: false, sourceGeneration: state.sourceGeneration + 1, lastError: null });
    },
    playTrack(track, variant = 'full') {
      const changed = select(track, variant);
      if (!changed && intent) pause(); else play({ userInitiated: true });
    },
    seek(value) {
      if (!current() || !metadataReady || !finite(value) || !audio.seekable.length) return false;
      const requested = Math.min(value, state.durationSec ?? value);
      let nearest = null, distance = Infinity;
      for (let i = 0; i < audio.seekable.length; i++) {
        const start = audio.seekable.start(i), end = audio.seekable.end(i);
        if (!finite(start) || !finite(end) || start > end) continue;
        const candidate = Math.max(start, Math.min(requested, end));
        if (Math.abs(candidate - requested) < distance) { nearest = candidate; distance = Math.abs(candidate - requested); }
      }
      if (nearest === null) return false;
      try { audio.currentTime = nearest; progress(); return true; } catch { return false; }
    },
    setVolume(value) {
      if (destroyed || !state.volumeSupported || !Number.isFinite(value)) return false;
      const target = Math.max(0, Math.min(1, value));
      try { audio.volume = target; } catch { publish({ volumeSupported: false }); return false; }
      const supported = Math.abs(audio.volume - target) < .001;
      publish({ volume: audio.volume, volumeSupported: supported }); return supported;
    },
    setMuted(value) {
      if (destroyed || !state.muteSupported) return false;
      try { audio.muted = Boolean(value); } catch { publish({ muteSupported: false }); return false; }
      const supported = audio.muted === Boolean(value);
      publish({ muted: audio.muted, muteSupported: supported }); return supported;
    },
    destroy() {
      if (destroyed) return;
      stopSource();
      destroyed = true;
      for (const [event, handler] of events) audio.removeEventListener(event, handler);
      listeners.clear(); playListeners.clear();
      players.delete(audio);
    }
  };
  players.set(audio, api);
  return api;
}
