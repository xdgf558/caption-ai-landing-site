import { localSource, positionKey } from './musicLocalData.js';
import { playerVariant } from './musicPlayerCatalog.js';

// Storage is a preference/input only. All playback still uses queue + core guard.
export function bindMusicLocalPlayback(player, queue, store, { getTracks, host = globalThis, now = Date.now, onNotice = () => {} } = {}) {
  let restored = false, touched = false, restoring = false, lastWrite = 0, previous = player.snapshot(), oldQueue = queue.snapshot();
  const played = new Set();
  const options = () => {
    const q = queue.snapshot(), p = player.snapshot();
    return { queue: q.items.map(track => track.id), settings: { volume: p.volume, muted: p.muted, shuffle: q.shuffle, repeat: q.repeat } };
  };
  const currentPosition = state => {
    const track = getTracks().find(track => track.id === state.activeTrackId && track.audioVersion === state.activeAudioVersion);
    return track ? { ...localSource(track, state.activeVariant), positionSec: state.status === 'ended' || (state.durationSec > 0 && state.currentTimeSec >= state.durationSec) ? 0 : state.currentTimeSec } : null;
  };
  const save = (state = player.snapshot(), force = false) => {
    if (!restored || restoring) return;
    const current = currentPosition(state);
    const key = current && positionKey(current);
    if (current && played.has(key) && (force || now() - lastWrite >= 5000)) {
      lastWrite = now(); store.savePlayback({ ...options(), current });
    } else if (force) store.savePlayback({ ...options(), ...(state.activeTrackId ? {} : { current: null }) });
  };
  const unsubscribePlayer = player.subscribe(state => {
    if (restoring) { previous = state; return; }
    if (!restored && (state.volume !== previous.volume || state.muted !== previous.muted)) touched = true;
    if (state.sourceGeneration !== previous.sourceGeneration || state.activeTrackId !== previous.activeTrackId) save(previous, true);
    const current = currentPosition(state);
    if (restored && current && state.status === 'playing') {
      played.add(positionKey(current)); store.recordPlayed(state.activeTrackId);
    }
    const force = state.status !== previous.status || state.volume !== previous.volume || state.muted !== previous.muted;
    save(state, force); previous = state;
  });
  const unsubscribeQueue = queue.subscribe(state => {
    if (!restored && !restoring && (state.shuffle !== oldQueue.shuffle || state.repeat !== oldQueue.repeat)) touched = true;
    oldQueue = state;
    if (restored && !restoring) store.savePlayback(options());
  });
  const unsubscribeUser = player.onUserPlay(() => { touched = true; });
  const pagehide = () => { save(player.snapshot(), true); };
  host.addEventListener?.('pagehide', pagehide);
  return {
    touch() { touched = true; },
    restore({ selection = null, capabilities = null, restoreCurrent = true } = {}) {
      if (restored) return;
      const saved = store.snapshot(), tracks = getTracks(), byId = new Map(tracks.map(track => [track.id, track]));
      restoring = true;
      if (!touched) {
        player.setVolume(saved.settings.volume); player.setMuted(saved.settings.muted);
        queue.setShuffle(saved.settings.shuffle); queue.setRepeat(saved.settings.repeat);
        queue.append(saved.queue.map(id => byId.get(id)).filter(Boolean));
        const id = selection || (restoreCurrent ? saved.current?.trackId : null), track = byId.get(id);
        if (track) {
          const variant = playerVariant(track, capabilities) || 'preview';
          player.select(track, variant);
          const position = store.findPosition(track, variant);
          if (position) { player.restorePosition(position.positionSec); onNotice('restored'); }
          else if (saved.current?.trackId === id) onNotice('changed');
        } else if (id && !selection) onNotice('missing');
      }
      restoring = false; restored = true; previous = player.snapshot();
      store.savePlayback(options());
    },
    flush: pagehide,
    clear() { played.clear(); lastWrite = now(); store.clear(); },
    destroy() { pagehide(); unsubscribePlayer(); unsubscribeQueue(); unsubscribeUser(); host.removeEventListener?.('pagehide', pagehide); }
  };
}
