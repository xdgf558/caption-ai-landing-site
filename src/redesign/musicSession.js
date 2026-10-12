import { createMusicPlayer } from '../scripts/musicPlayerCore.js';
import { createMusicLocalData } from '../scripts/musicLocalData.js';
import { stationMusicSource, previewPlayerTrack } from './musicPlayback.js';
import { contentBase, uuid, slug, positive } from './publicValidation.js';
import { stationLocales } from './routes.js';
import { requestStationMusic } from './musicRequest.js';
import { createStationPlaybackStore } from './musicResume.js';
import { createStationMediaMeasurement } from './analyticsMedia.js';
import { observeStationEvent, stationEventsAllowed } from './analyticsControls.js';

const active = state => ['playing', 'loading', 'buffering'].includes(state.status);
export function createStationMusicSession(audio, { origin = globalThis.location?.origin, fetcher = globalThis.fetch,
  local = createMusicLocalData(), store = createStationPlaybackStore() } = {}) {
  const player = createMusicPlayer(audio, { origin, sourceFor: stationMusicSource, resetRestoredEnd: true });
  const measurement=createStationMediaMeasurement({kind:'music',emit:observeStationEvent,enabled:stationEventsAllowed});
  const visibility=()=>measurement.resetSample();
  globalThis.document?.addEventListener('visibilitychange',visibility);
  const subscribers = new Set();
  let currentTrack = null, selectedVariant = null, notice = null;
  let controller = null, requestVersion = 0, destroyed = false, gameActive = false, locale = 'zh-Hant', lastSavedSecond = -1, lastSavedStatus = '';
  const snapshot = () => {
    const state = player.snapshot();
    return { ...state, track: currentTrack, selectedVariant, notice, requestVersion, locale };
  };
  const emit = () => { if (!destroyed) for (const subscriber of subscribers) subscriber(snapshot()); };
  function cancelRequest() {
    requestVersion++; controller?.abort(); controller = null; notice = null;
  }
  function save(force = false) {
    if (!currentTrack || !selectedVariant) return;
    const state = snapshot(), second = Math.floor(state.currentTimeSec);
    if (!force && second === lastSavedSecond && state.status === lastSavedStatus) return;
    lastSavedSecond = second; lastSavedStatus = state.status;
    store.save({ trackId: currentTrack.id, slug: currentTrack.slug, revision: currentTrack.revision, variant: selectedVariant,
      previewRevision: currentTrack.preview.revision,
      positionSec: state.status === 'ended' ? 0 : state.currentTimeSec });
  }
  const stateSubscription = player.subscribe(state => { save(); emit();
    measurement.observe({playbackId:state.playbackId,trackId:state.activeTrackId,variant:state.activeVariant,status:state.status,
      positionSec:state.currentTimeSec,seeking:state.seeking,nativeEnded:audio.ended===true});
  });
  const startSubscription = player.onPlaybackStart(state => local.recordPlayed(state.activeTrackId));
  const settings = local.snapshot().settings;
  player.setVolume(settings.volume); player.setMuted(settings.muted);
  function pause() {
    if (destroyed) return;
    cancelRequest();
    if (player.snapshot().activeTrackId) player.pause();
    save(true); emit();
  }
  function play(dto, variant) {
    if (destroyed || gameActive || variant !== 'preview') return false;
    if (currentTrack?.id === dto?.id && currentTrack.revision === dto.revision && selectedVariant === variant &&
      currentTrack.preview?.revision === dto.preview?.revision && active(player.snapshot())) { pause(); return true; }
    let selection;
    try { selection = previewPlayerTrack(dto); }
    catch { notice = { code: 'stale' }; emit(); return false; }
    cancelRequest(); currentTrack = dto; selectedVariant = variant;
    player.select(selection, variant);
    player.play({ userInitiated: true }); // synchronous; retain transient activation
    save(true); emit(); return true;
  }
  async function restore() {
    const saved = store.read(); if (!saved || saved.variant !== 'preview' || destroyed || gameActive || currentTrack) return;
    cancelRequest(); const version = requestVersion, request = new AbortController(); controller = request;
    try {
      const body = await requestStationMusic(contentBase + '/tracks/' + saved.slug + '?locale=' + locale, request, fetcher);
      if (destroyed || version !== requestVersion || currentTrack) return;
      const dto = body.track;
      if (body.schemaVersion !== 1 || body.locale !== locale || !uuid(dto?.id) || !slug(dto.slug) || !positive(dto.revision) ||
        dto.id !== saved.trackId || dto.slug !== saved.slug || !positive(dto.durationMs) || dto.durationMs > 86400000) return;
      if (!dto.preview) return;
      const selection = previewPlayerTrack(dto);
      currentTrack = dto; selectedVariant = 'preview';
      player.select(selection, 'preview');
      player.restorePosition(dto.revision === saved.revision && dto.preview.revision === saved.previewRevision ? saved.positionSec : 0);
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
    player, local, snapshot, play, pause, restore,
    setGameActive(value) { gameActive = Boolean(value); if (gameActive) suspend(); },
    subscribe(fn) { subscribers.add(fn); fn(snapshot()); return () => subscribers.delete(fn); },
    setLocale(value) { if (stationLocales.includes(value)) { locale = value; emit(); } },
    observeTracks(tracks) {
      const dto = [...tracks].find(track => track?.id === currentTrack?.id && Object.hasOwn(track, 'preview'));
      if (!dto || !currentTrack) return;
      if (dto.revision !== currentTrack.revision || !dto.preview || dto.preview.revision !== currentTrack.preview.revision) {
        cancelRequest(); currentTrack = null; selectedVariant = null;
        player.clear(); store.clear(); notice = { code: 'stale', trackId: dto.id }; emit();
      } else { currentTrack = dto; emit(); } // Localize display; never select the viewed song.
    },
    toggle() {
      if (!currentTrack || gameActive) return;
      if (active(player.snapshot())) pause();
      else play(currentTrack, selectedVariant);
    },
    cancelPending() { cancelRequest(); emit(); },
    suspend,
    close() { cancelRequest(); currentTrack = null; selectedVariant = null; player.clear(); store.clear(); emit(); },
    seek(value) { return player.seek(value); },
    setVolume(value) { player.setVolume(value); const saved = local.snapshot(); local.savePlayback({ queue: saved.queue,
      settings: { ...saved.settings, volume: player.snapshot().volume } }); },
    destroy() { if (destroyed) return; suspend(); destroyed = true; globalThis.document?.removeEventListener('visibilitychange',visibility); measurement.reset();stateSubscription(); startSubscription(); player.destroy(); local.destroy(); subscribers.clear(); }
  };
}
