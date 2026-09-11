import { readPlayerCatalog, playerVariant } from './musicPlayerCatalog.js';

const queues = new WeakMap();
const LIMIT = 500, FAILURE_LIMIT = 3;
const running = status => ['loading', 'playing', 'buffering'].includes(status);
const messages = {
  QUEUE_LIMIT: '队列最多保留 500 首，重复曲目只保留一次。',
  QUEUE_EMPTY: '队列为空，选择歌曲或点击播放全部。',
  NO_FULL_TRACKS: '队列中暂无可完整收听的曲目，可以选择单曲试听。',
  QUEUE_END: '已到队列末尾。',
  QUEUE_START: '已到队列开头。',
  PREVIEW_ENDED: '试听已结束，再次收听请手动播放。',
  FAILURE_LIMIT: '连续三首播放失败，已停止。请稍后手动重试。',
  NO_WORKING_TRACKS: '可播放的曲目暂时无法载入，请稍后手动重试。',
  TRACK_UNAVAILABLE: '这首曲目暂不可播放。',
  SEEK_UNAVAILABLE: '暂时无法回到开头，请稍后重试。'
};

// Snapshot order/access metadata is independent of the current browse results.
// Fresh catalog/capabilities can narrow eligibility, but never grant media access.
export function createMusicQueue(player, { random = Math.random, now = () => performance.now() } = {}) {
  if (queues.has(player)) return queues.get(player);
  let items = [], catalog = new Map(), capabilities = null, shuffle = false, repeat = 'off';
  let pending = [], past = [], future = [], failures = 0, notice = null, destroyed = false;
  let lastStarted = null;
  let errorHandler = null;
  let terminal = '', previous = player.snapshot(), sample = null, continuous = 0;
  const blocked = new Set(), unavailableIds = new Set(), listeners = new Set();
  const copy = track => readPlayerCatalog({ schemaVersion: 2, tracks: [track] })[0];
  const active = () => player.snapshot().activeTrackId;
  const resolve = id => catalog.get(id) || null;
  const full = id => !unavailableIds.has(id) && Boolean(resolve(id)) && playerVariant(resolve(id), capabilities) === 'full';
  const eligible = id => full(id) && !blocked.has(id);
  const ids = () => items.map(track => track.id);
  const boundedPush = (stack, id) => { if (id) stack.push(id); if (stack.length > LIMIT) stack.shift(); };
  const shuffled = values => {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const value = random(), unit = Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0;
      const j = Math.floor(unit * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };
  const snapshot = () => ({
    items: items.map(track => ({ ...track, available: !unavailableIds.has(track.id) && Boolean(resolve(track.id)), canPlayFull: full(track.id) })),
    queueIndex: items.findIndex(track => track.id === active()), activeTrackId: active(),
    shuffle, repeat, consecutiveFailures: failures, pending: [...pending], history: [...past],
    notice: notice ? { code: notice, message: messages[notice] } : null
  });
  const emit = () => { if (!destroyed) for (const listener of listeners) listener(snapshot()); };
  const resetFailures = () => { failures = 0; blocked.clear(); continuous = 0; sample = null; notice = null; };
  const collect = values => {
    if (!Array.isArray(values)) throw new TypeError('Invalid queue');
    const seen = new Set(), result = [];
    let limited = false;
    for (const value of values) {
      if (seen.has(value?.id)) continue;
      if (result.length === LIMIT) { limited = true; break; }
      const track = copy(value); seen.add(track.id); result.push(track);
    }
    return { result, limited };
  };
  const replace = (values, selectedId) => {
    const { result, limited } = collect(values);
    // Do not change a playing queue if an out-of-limit selection cannot join it.
    if (selectedId && !result.some(track => track.id === selectedId)) { notice = 'QUEUE_LIMIT'; emit(); return false; }
    items = result; past = []; future = [];
    pending = shuffle ? shuffled(ids().filter(id => id !== selectedId)) : [];
    notice = limited ? 'QUEUE_LIMIT' : null;
    return true;
  };
  const remember = (id, { back = false, forward = false } = {}) => {
    const current = lastStarted;
    if (current && current !== id && items.some(track => track.id === current)) {
      boundedPush(back ? future : past, current);
    }
    if (!back && !forward) future = [];
    pending = pending.filter(candidate => candidate !== id);
    lastStarted = id;
  };
  const start = (id, variant, { user = false, back = false, forward = false, restart = false } = {}) => {
    const track = resolve(id);
    if (!track || unavailableIds.has(id) || (variant === 'full' ? !full(id) : !track.previewAvailable)) {
      notice = 'TRACK_UNAVAILABLE'; emit(); return false;
    }
    if (user) resetFailures();
    remember(id, { back, forward });
    const changed = player.select(track, variant);
    if (restart && !changed && !player.seek(0)) { player.clear(); player.select(track, variant); }
    player.play({ userInitiated: user }); // Synchronous, after the core's access guard.
    emit(); return true;
  };
  const nextCandidate = () => {
    const current = active();
    if (shuffle) {
      while (future.length) { const id = future.pop(); if (eligible(id)) return { id, forward: true }; }
      while (pending.length) { const id = pending.shift(); if (id !== current && eligible(id)) return { id }; }
      if (repeat !== 'all') return null;
      const available = ids().filter(eligible);
      pending = shuffled(available);
      if (pending.length > 1 && pending[0] === current) [pending[0], pending[1]] = [pending[1], pending[0]];
      return pending.length ? { id: pending.shift() } : null;
    }
    const order = ids(), index = order.indexOf(current);
    // At most one pass, including a repeat-all wrap. Permission skips are free.
    for (let step = 1; step <= order.length; step++) {
      const position = index + step;
      if (position >= order.length && repeat !== 'all') break;
      const id = order[position % order.length];
      if (eligible(id)) return { id };
    }
    return null;
  };
  const stopAtBoundary = (automatic, failure) => {
    if (!automatic) player.pause();
    notice = !items.length ? 'QUEUE_EMPTY' : !ids().some(full) ? 'NO_FULL_TRACKS'
      : failure ? 'NO_WORKING_TRACKS' : 'QUEUE_END';
    emit(); return false;
  };
  const advance = ({ user = false, failure = false } = {}) => {
    if (destroyed) return false;
    if (user) resetFailures();
    const next = nextCandidate();
    return next ? start(next.id, 'full', { ...next, user, restart: user }) : stopAtBoundary(!user, failure);
  };
  const observe = state => {
    if (destroyed) return;
    const time = now();
    if (state.status === 'playing' && state.activeVariant === 'full' && !state.seeking) {
      if (sample && sample.generation === state.sourceGeneration) {
        const elapsed = (time - sample.time) / 1000, media = state.currentTimeSec - sample.position;
        // A seek jump or stalled clock cannot count as ten seconds of playback.
        if (elapsed >= 0 && media >= 0 && media <= elapsed + .5) continuous += Math.min(media, elapsed);
        else continuous = 0;
        if (continuous >= 10 && failures) { failures = 0; blocked.clear(); emit(); }
      } else continuous = 0;
      sample = { time, position: state.currentTimeSec, generation: state.sourceGeneration };
    } else { sample = null; continuous = 0; }
    const wasRunning = running(previous.status);
    const changed = previous.activeTrackId !== state.activeTrackId || previous.status !== state.status;
    previous = state;
    if (!['ended', 'error'].includes(state.status)) terminal = '';
    else {
      const key = `${state.sourceGeneration}:${state.status}`;
      if (terminal !== key) {
        terminal = key;
        if (state.status === 'ended') {
          if (state.activeVariant === 'preview') { notice = 'PREVIEW_ENDED'; emit(); return; }
          // A queued end after an explicit pause must not start another song.
          if (!wasRunning) { emit(); return; }
          if (repeat === 'one' && eligible(state.activeTrackId)) start(state.activeTrackId, 'full');
          else advance();
          return;
        }
        if (!wasRunning) { emit(); return; }
        let recovered = false;
        const recover = () => {
          const current = player.snapshot();
          if (destroyed || recovered || current.sourceGeneration !== state.sourceGeneration || current.status !== 'error') return;
          recovered = true;
          failures++; blocked.add(state.activeTrackId);
          if (failures >= FAILURE_LIMIT) { notice = 'FAILURE_LIMIT'; emit(); return; }
          if (state.activeVariant === 'full') advance({ failure: true });
          else emit();
        };
        if (errorHandler) { errorHandler(state, recover); return; }
        recover(); return;
      }
    }
    if (changed) emit();
  };
  const unsubscribe = player.subscribe(observe);
  const api = {
    snapshot,
    setErrorHandler(handler) { errorHandler = handler; },
    markUnavailable(id) { unavailableIds.add(id); emit(); },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    updateCatalog(values) {
      if (destroyed) return;
      const parsed = readPlayerCatalog({ schemaVersion: 2, tracks: values });
      unavailableIds.clear();
      catalog = new Map(parsed.map(track => [track.id, track]));
      if (active() && !catalog.has(active())) { player.clear(); notice = 'TRACK_UNAVAILABLE'; }
      emit();
    },
    updateCapabilities(value) {
      if (destroyed) return;
      capabilities = value ? { canPlayVipFull: value.canPlayVipFull, musicVipDeliveryEnabled: value.musicVipDeliveryEnabled,
        membershipStatus: value.membershipStatus } : null;
      emit(); // Applies to future choices; lifecycle refresh/unload is M3-03.
    },
    playFromList(id, visible) {
      if (destroyed) return false;
      const track = resolve(id), variant = track && playerVariant(track, capabilities), state = player.snapshot();
      if (state.activeTrackId === id && running(state.status)) {
        player.pause(); return true;
      }
      if (!variant) { notice = 'TRACK_UNAVAILABLE'; emit(); return false; }
      if (!replace(visible, id)) return false;
      const limited = notice;
      const result = start(id, variant, { user: true });
      if (limited) { notice = limited; emit(); }
      return result;
    },
    playAll(visible) {
      if (destroyed) return false;
      if (!replace(visible)) return false;
      const limited = notice; resetFailures();
      const candidates = ids().filter(full), id = shuffle ? shuffled(candidates)[0] : candidates[0];
      if (!id) { player.clear(); return stopAtBoundary(true, false); }
      const result = start(id, 'full', { user: true, restart: true });
      if (limited) notice = limited;
      emit(); return result;
    },
    playCurrent(visible) {
      if (destroyed) return false;
      const state = player.snapshot(), track = resolve(state.activeTrackId);
      if (!track) { notice = 'TRACK_UNAVAILABLE'; emit(); return false; }
      if (!items.some(item => item.id === track.id) && !replace(visible, track.id)) return false;
      const variant = state.activeVariant === 'preview' && track.previewAvailable ? 'preview' : playerVariant(track, capabilities);
      return variant ? start(track.id, variant, { user: true }) : stopAtBoundary(false, false);
    },
    playQueued(id) {
      if (destroyed || !items.some(track => track.id === id)) return false;
      const track = resolve(id), variant = track && playerVariant(track, capabilities);
      const state = player.snapshot();
      if (state.activeTrackId === id && running(state.status)) { player.pause(); return true; }
      return variant ? start(id, variant, { user: true }) : false;
    },
    playVariant(id, variant, visible) {
      if (destroyed || !['full', 'preview'].includes(variant)) return false;
      if (!items.some(track => track.id === id) && !replace(visible, id)) return false;
      return start(id, variant, { user: true, restart: true });
    },
    next() { return advance({ user: true }); },
    previous() {
      if (destroyed) return false;
      const state = player.snapshot();
      if (!state.activeTrackId) { notice = 'QUEUE_EMPTY'; emit(); return false; }
      if (state.currentTimeSec > 3) {
        if (!player.seek(0)) { notice = 'SEEK_UNAVAILABLE'; emit(); return false; }
        // Rewind preserves a user's pause. It is not a new playback attempt.
        if (state.status === 'error' || state.status === 'ended') return api.playCurrent(items);
        emit(); return true;
      }
      resetFailures();
      if (shuffle) {
        while (past.length) { const id = past.pop(); if (eligible(id)) return start(id, 'full', { user: true, back: true }); }
      } else {
        const order = ids(), index = order.indexOf(active());
        for (let step = 1; step <= order.length; step++) {
          const position = index - step;
          if (position < 0 && repeat !== 'all') break;
          const id = order[(position + order.length) % order.length];
          if (eligible(id)) return start(id, 'full', { user: true, restart: true });
        }
      }
      notice = 'QUEUE_START'; emit(); return false;
    },
    setShuffle(value) {
      if (destroyed || shuffle === Boolean(value)) return;
      shuffle = Boolean(value); pending = shuffle ? shuffled(ids().filter(id => id !== active())) : []; future = [];
      emit();
    },
    setRepeat(value) {
      if (destroyed || !['off', 'all', 'one'].includes(value)) return;
      repeat = value; emit();
    },
    append(values) {
      if (destroyed) return false;
      const before = new Set(ids()), { result, limited } = collect([...items, ...values]);
      items = result;
      if (shuffle) pending.push(...shuffled(ids().filter(id => !before.has(id) && id !== active())));
      notice = limited ? 'QUEUE_LIMIT' : null; emit(); return !limited;
    },
    remove(id, { currentAction } = {}) {
      if (destroyed || !items.some(track => track.id === id)) return false;
      const isCurrent = active() === id;
      if (isCurrent && !['next', 'stop'].includes(currentAction)) return { requiresConfirmation: true };
      if (isCurrent && currentAction === 'next') resetFailures();
      const next = isCurrent && currentAction === 'next' ? nextCandidate() : null;
      items = items.filter(track => track.id !== id);
      pending = pending.filter(value => value !== id); past = past.filter(value => value !== id); future = future.filter(value => value !== id);
      if (isCurrent) {
        if (next && next.id !== id) start(next.id, 'full', { ...next, user: true });
        else player.clear();
      }
      notice = items.length ? null : 'QUEUE_EMPTY'; emit(); return true;
    },
    clear() {
      if (destroyed) return;
      items = []; pending = []; past = []; future = []; lastStarted = null; notice = 'QUEUE_EMPTY';
      player.clear(); emit();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; unsubscribe(); listeners.clear(); queues.delete(player);
    }
  };
  queues.set(player, api);
  return api;
}
