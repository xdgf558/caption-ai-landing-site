import { createMusicPlayer } from '../scripts/musicPlayerCore.js';
import { createMusicLocalData } from '../scripts/musicLocalData.js';
import { stationMusicSource, previewPlayerTrack, fullPlayerTrack } from './musicPlayback.js';
import { contentBase, uuid, slug, positive } from './publicValidation.js';
import { stationLocales } from './routes.js';
import { requestStationMusic } from './musicRequest.js';
import { createStationPlaybackStore } from './musicResume.js';

const active = state => ['playing', 'loading', 'buffering'].includes(state.status);
export function createStationMusicSession(audio, { origin = globalThis.location?.origin, fetcher = globalThis.fetch,
  local = createMusicLocalData(), store = createStationPlaybackStore(), now = Date.now } = {}) {
  const player = createMusicPlayer(audio, { origin, sourceFor: stationMusicSource, resetRestoredEnd: true });
  const subscribers = new Set();
  let currentTrack = null, selectedVariant = null, restored = null, prepared = null, pending = null, notice = null;
  let controller = null, requestVersion = 0, destroyed = false, gameActive = false, locale = 'zh-Hant', lastSavedSecond = -1, lastSavedStatus = '';
  const snapshot = () => {
    const state = player.snapshot();
    return { ...state, ...(restored && state.activeTrackId === null ? {
      status: 'paused', activeTrackId: currentTrack.id, activeVariant: selectedVariant,
      currentTimeSec: restored.positionSec, durationSec: currentTrack.durationMs / 1000
    } : {}), track: currentTrack, selectedVariant, notice, pendingTrackId: pending, requestVersion, locale };
  };
  const emit = () => { if (!destroyed) for (const subscriber of subscribers) subscriber(snapshot()); };
  function cancelRequest() {
    requestVersion++; controller?.abort(); controller = null; pending = null; prepared = null; notice = null;
  }
  function save(force = false) {
    if (!currentTrack || !selectedVariant) return;
    const state = snapshot(), second = Math.floor(state.currentTimeSec);
    if (!force && second === lastSavedSecond && state.status === lastSavedStatus) return;
    lastSavedSecond = second; lastSavedStatus = state.status;
    store.save({ trackId: currentTrack.id, slug: currentTrack.slug, revision: currentTrack.revision, variant: selectedVariant,
      previewRevision: selectedVariant === 'preview' ? currentTrack.preview.revision : null,
      positionSec: state.status === 'ended' ? 0 : state.currentTimeSec });
  }
  const stateSubscription = player.subscribe(() => { save(); emit(); });
  const startSubscription = player.onPlaybackStart(state => local.recordPlayed(state.activeTrackId));
  const settings = local.snapshot().settings;
  player.setVolume(settings.volume); player.setMuted(settings.muted);
  function pause() {
    if (destroyed) return;
    cancelRequest();
    if (player.snapshot().activeTrackId) {
      player.pause();
      if (selectedVariant === 'full') player.unload();
    }
    save(true); emit();
  }
  async function prepareFull(dto) {
    if (destroyed || gameActive) return false;
    cancelRequest();
    // A check never starts media. Existing audio stops immediately, and a full
    // source is unloaded before a new private grant can be used.
    if (player.snapshot().activeTrackId) {
      const status = player.snapshot().status, settled = ['ended', 'error'].includes(status);
      if (!settled) player.pause();
      if (selectedVariant === 'full') player.unload({ status: settled ? status : 'paused' });
    }
    const version = requestVersion, request = new AbortController(); controller = request;
    pending = dto?.id; notice = { code: 'checking', trackId: dto?.id }; emit();
    try {
      const path = contentBase + '/tracks/' + dto.slug + '/playback?variant=full';
      if (dto.fullPlayback?.requiresAccessCheck !== true || dto.fullPlayback.playbackPath !== path) throw new Error('INVALID_ENDPOINT');
      const body = await requestStationMusic(path + '&locale=' + locale, request, fetcher);
      if (destroyed || version !== requestVersion) return false;
      const selection = fullPlayerTrack(dto, body);
      prepared = { id: dto.id, revision: dto.revision, selection, expiresAt: now() + 30000 };
      notice = { code: 'ready', trackId: dto.id }; return true;
    } catch (error) {
      if (!destroyed && version === requestVersion) notice = { code: error.status === 401 || error.status === 403 ? 'denied' : error.status === 409 ? 'stale' : 'failed', trackId: dto?.id };
      return false;
    } finally {
      if (!destroyed && version === requestVersion) { controller = null; pending = null; save(true); emit(); }
    }
  }
  const isPrepared = dto => Boolean(prepared && prepared.id === dto?.id && prepared.revision === dto.revision && prepared.expiresAt >= now());
  function play(dto, variant) {
    if (destroyed || gameActive) return false;
    if (currentTrack?.id === dto?.id && currentTrack.revision === dto.revision && selectedVariant === variant &&
      (variant === 'full' || currentTrack.preview?.revision === dto.preview?.revision) && active(player.snapshot())) { pause(); return true; }
    let selection;
    try { selection = variant === 'preview' ? previewPlayerTrack(dto) : isPrepared(dto) ? prepared.selection : null; }
    catch { notice = { code: 'stale' }; emit(); return false; }
    if (!selection) return false;
    const resume = restored && currentTrack?.id === dto.id && currentTrack.revision === dto.revision && selectedVariant === variant ? restored.positionSec : null;
    cancelRequest(); restored = null; currentTrack = dto; selectedVariant = variant;
    const changed = player.select(selection, variant);
    if (changed && resume !== null) player.restorePosition(resume);
    player.play({ userInitiated: true }); // synchronous; retain transient activation
    save(true); emit(); return true;
  }
  async function restore() {
    const saved = store.read(); if (!saved || destroyed || gameActive || currentTrack) return;
    cancelRequest(); const version = requestVersion, request = new AbortController(); controller = request;
    try {
      const body = await requestStationMusic(contentBase + '/tracks/' + saved.slug + '?locale=' + locale, request, fetcher);
      if (destroyed || version !== requestVersion || currentTrack) return;
      const dto = body.track;
      if (body.schemaVersion !== 1 || body.locale !== locale || !uuid(dto?.id) || !slug(dto.slug) || !positive(dto.revision) ||
        dto.id !== saved.trackId || dto.slug !== saved.slug || !positive(dto.durationMs) || dto.durationMs > 86400000) return;
      if (saved.variant === 'preview') {
        if (!dto.preview) return;
        const selection = previewPlayerTrack(dto);
        currentTrack = dto; selectedVariant = 'preview';
        player.select(selection, 'preview');
        player.restorePosition(dto.revision === saved.revision && dto.preview.revision === saved.previewRevision ? saved.positionSec : 0);
      } else if (dto.fullPlayback?.requiresAccessCheck === true) {
        currentTrack = dto; selectedVariant = 'full';
        restored = { positionSec: dto.revision === saved.revision ? Math.min(saved.positionSec, dto.durationMs / 1000) : 0 };
      }
      emit(); // Selection only: no src, play(), or persisted private grant.
    } catch {} // Quietly discard unavailable selectors; never start a fallback.
    finally { if (!destroyed && version === requestVersion) controller = null; }
  }
  function suspend() {
    if (destroyed) return;
    cancelRequest(); save(true);
    if (player.snapshot().activeTrackId) player.unload({ preservePosition: player.snapshot().status !== 'ended' });
    emit();
  }
  return {
    player, local, snapshot, isPrepared, prepareFull, play, pause, restore,
    setGameActive(value) { gameActive = Boolean(value); if (gameActive) suspend(); },
    subscribe(fn) { subscribers.add(fn); fn(snapshot()); return () => subscribers.delete(fn); },
    setLocale(value) { if (stationLocales.includes(value)) { locale = value; emit(); } },
    observeTracks(tracks) {
      const dto = [...tracks].find(track => track?.id === currentTrack?.id && Object.hasOwn(track, 'preview') && Object.hasOwn(track, 'fullPlayback'));
      if (!dto || !currentTrack) return;
      if (dto.revision !== currentTrack.revision || (selectedVariant === 'preview'
        ? !dto.preview || dto.preview.revision !== currentTrack.preview.revision : !dto.fullPlayback)) {
        cancelRequest(); currentTrack = null; selectedVariant = null; restored = null;
        player.clear(); store.clear(); notice = { code: 'stale', trackId: dto.id }; emit();
      } else { currentTrack = dto; emit(); } // Localize display; never select the viewed song.
    },
    toggle() {
      if (!currentTrack || gameActive) return;
      if (active(player.snapshot())) pause();
      else if (selectedVariant === 'full' && !isPrepared(currentTrack)) void prepareFull(currentTrack);
      else play(currentTrack, selectedVariant);
    },
    cancelPending() { cancelRequest(); emit(); },
    invalidateAccess() {
      cancelRequest();
      if (selectedVariant === 'full' && player.snapshot().activeTrackId) {
        player.unload({ code: 'ACCESS_CHANGED', message: '', preservePosition: true });
        notice = { code: 'recheck', trackId: currentTrack.id };
      }
      emit();
    },
    suspend,
    close() { cancelRequest(); currentTrack = null; selectedVariant = null; restored = null; player.clear(); store.clear(); emit(); },
    seek(value) { return player.seek(value); },
    setVolume(value) { player.setVolume(value); const saved = local.snapshot(); local.savePlayback({ queue: saved.queue,
      settings: { ...saved.settings, volume: player.snapshot().volume } }); },
    destroy() { if (destroyed) return; suspend(); destroyed = true; stateSubscription(); startSubscription(); player.destroy(); local.destroy(); subscribers.clear(); }
  };
}
