import { musicSource } from './musicPlayerCore.js';

const mounts = new WeakMap(), sessions = new WeakMap();
export const MUSIC_PLAYBACK_CHANNEL = 'station-cat:music-playback:v1';
const running = status => ['loading', 'playing', 'buffering'].includes(status);
const validClaim = value => value?.version === 1 && value.type === 'claim' &&
  typeof value.instanceId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.instanceId) &&
  Number.isSafeInteger(value.stamp) && value.stamp > 0 && value.stamp < Number.MAX_SAFE_INTEGER - 1 && Object.keys(value).length === 4;
const newer = (a, b) => !b || a.stamp > b.stamp || (a.stamp === b.stamp && a.instanceId > b.instanceId);

// Progressive enhancement for this music player only. No global keyboard/audio hooks.
export function createMusicSystemControls(player, queue, {
  audio, getTracks, host = globalThis, clock = Date.now, onChange = () => {}
} = {}) {
  if (mounts.has(player)) return mounts.get(player);
  let instanceId;
  try { instanceId = host.crypto.randomUUID(); } catch { instanceId = `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  let session = null, channel = null, disposed = false, held = false, winner = null, notice = null;
  let metadata = null, metadataOwned = false, metadataKey = '', stateKey = '', positionKey = '', positionSet = false, handlerEpoch = 0;
  let positionAvailable = true;
  const token = {}, registered = new Set();
  try { session = host.navigator?.mediaSession || null; } catch {}
  const snapshot = () => ({ mediaSessionSupported: Boolean(session), coordinationSupported: Boolean(channel), notice });
  const emit = () => { if (!disposed) onChange(snapshot()); };
  const ownsSession = () => {
    try { return session && sessions.get(session) === token && (!metadataOwned || session.metadata === metadata); } catch { return false; }
  };
  const clearPosition = () => {
    if (!positionSet) return;
    try { session.setPositionState?.(); } catch {}
    positionSet = false; positionKey = '';
  };
  const releaseSession = () => {
    handlerEpoch++;
    if (ownsSession()) {
      for (const action of registered) { try { session.setActionHandler(action, null); } catch {} }
      clearPosition();
      try { session.metadata = null; session.playbackState = 'none'; } catch {}
    }
    if (session && sessions.get(session) === token) sessions.delete(session);
    registered.clear(); metadata = null; metadataOwned = false; metadataKey = ''; stateKey = ''; positionKey = ''; positionSet = false;
  };
  const seek = value => {
    if (Number.isFinite(value)) player.seek(Math.max(0, value));
  };
  const skip = (details, direction) => {
    const offset = details?.seekOffset ?? 10;
    if (Number.isFinite(offset) && offset > 0) seek(player.snapshot().currentTimeSec + direction * offset);
  };
  const actions = {
    play: () => { if (!running(player.snapshot().status)) queue.playCurrent(getTracks()); },
    pause: () => player.pause(),
    stop: () => player.unload({ preservePosition: false }),
    nexttrack: () => queue.next(),
    previoustrack: () => queue.previous(),
    seekbackward: details => skip(details, -1),
    seekforward: details => skip(details, 1),
    seekto: details => seek(details?.seekTime)
  };
  const claimSession = () => {
    if (!session) return;
    if (!ownsSession()) { metadata = null; metadataOwned = false; metadataKey = ''; stateKey = ''; positionKey = ''; positionSet = false; }
    sessions.set(session, token);
    const generation = ++handlerEpoch;
    // Install each supported action independently. The closure also rejects stale callbacks.
    for (const [action, callback] of Object.entries(actions)) {
      try {
        session.setActionHandler(action, details => { if (!disposed && generation === handlerEpoch && held && ownsSession()) callback(details); });
        registered.add(action);
      } catch {}
    }
  };
  const sync = state => {
    if (disposed || !held || !ownsSession()) return;
    const track = getTracks().find(value => value.id === state.activeTrackId);
    const source = Boolean(audio.getAttribute?.('src') ?? audio.src);
    if (!track || !source) {
      clearPosition();
      try { session.metadata = null; metadataOwned = true; session.playbackState = 'none'; } catch {}
      metadata = null; metadataKey = ''; stateKey = '';
      return;
    }
    const key = JSON.stringify([track.id, state.activeAudioVersion, state.activeVariant, track.title, track.creatorName, Boolean(track.coverUrl)]);
    if (key !== metadataKey) {
      try {
        metadata = new host.MediaMetadata({ title: `${track.title}${state.activeVariant === 'preview' ? ' · 试听' : ''}`,
          artist: track.creatorName, album: 'Station Cat', artwork: track.coverUrl ? [{
            src: new URL(`/api/music/tracks/${track.id}/cover?v=${state.activeAudioVersion}`, host.location.origin).href
          }] : [] });
        session.metadata = metadata; metadataOwned = true;
      } catch { metadata = null; metadataOwned = false; }
      metadataKey = key;
    }
    const playback = running(state.status) ? 'playing' : 'paused';
    if (stateKey !== playback) { try { session.playbackState = playback; stateKey = playback; } catch {} }
    const expected = new URL(musicSource({ id: track.id, audioVersion: state.activeAudioVersion }, state.activeVariant), host.location.origin).href;
    const duration = audio.duration, position = state.currentTimeSec, rate = audio.playbackRate;
    if (audio.currentSrc !== expected || audio.readyState < 1 || !Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(position) || position < 0 || !Number.isFinite(rate) || rate <= 0) { clearPosition(); return; }
    // Event-driven and bounded; no position polling, background timer or animation loop.
    const next = `${state.sourceGeneration}:${state.status}:${state.seeking}:${duration}:${rate}:${Math.floor(position)}`;
    if (positionAvailable && next !== positionKey) {
      try {
        session.setPositionState?.({ duration, playbackRate: rate, position: Math.min(duration, position) });
        positionSet = true; positionKey = next;
      } catch { clearPosition(); positionAvailable = false; }
    }
  };
  const receive = value => {
    if (disposed || !validClaim(value) || value.instanceId === instanceId || !newer(value, winner)) return;
    winner = value;
    const state = player.snapshot(), wasHeld = held;
    held = false; releaseSession();
    if (running(state.status) || state.status === 'error') player.pause();
    if (wasHeld || running(state.status)) notice = '已在另一个音乐标签页播放；点击播放可切回这里。';
    emit();
  };
  try { channel = new host.BroadcastChannel(MUSIC_PLAYBACK_CHANNEL); channel.onmessage = event => receive(event.data); } catch { channel = null; }
  const unplay = player.onUserPlay(() => {
    const time = clock();
    // Logical increment survives a backwards local clock; simultaneous claims use an ID tie-break.
    const stamp = Math.max(Number.isSafeInteger(time) && time > 0 ? time : 1, (winner?.stamp || 0) + 1);
    winner = { version: 1, type: 'claim', instanceId, stamp };
    held = true; notice = null; claimSession(); emit();
    try { channel?.postMessage(winner); } catch {
      try { channel?.close(); } catch {}
      channel = null; emit();
    }
  });
  const unsubscribe = player.subscribe(sync);
  const api = { snapshot, destroy() {
    if (disposed) return;
    disposed = true; held = false; unplay(); unsubscribe(); releaseSession();
    if (channel) { channel.onmessage = null; try { channel.close(); } catch {} channel = null; }
    winner = null; notice = null; mounts.delete(player);
  } };
  mounts.set(player, api); emit(); return api;
}
