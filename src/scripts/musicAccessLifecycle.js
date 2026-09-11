import { playerVariant } from './musicPlayerCatalog.js';
import { readMusicSelectionCatalog } from './musicCatalogSelection.js';
import { watchReaderSession } from './readerSessionEvents.js';

const mounts = new WeakMap(), MAX_TIMER = 2147483647;
const unavailable = { status: 'access_unavailable', code: 'ACCESS_UNAVAILABLE', message: '资格暂时无法确认，请重新核验；也可尝试免费曲或试听。' };
const checking = { ...unavailable, code: 'ACCESS_CHECKING', message: '正在重新核验资格，请稍候。' };
const required = code => ({ status: 'access_required', code, message: code === 'AUTH_REQUIRED'
  ? '请登录后重新核验，或手动播放试听。' : code === 'ACCOUNT_RESTRICTED'
    ? '账号状态受限，请前往会员中心查看。' : '当前没有完整收听资格，可手动播放试听或前往会员中心。' });
const contentError = { status: 'error', code: 'CONTENT_UNAVAILABLE', message: '歌曲已更新或暂不可用，请重新加载曲目。' };
const healthyAccess = body => ['free', 'vip'].includes(body?.effectiveAccess) && typeof body.canPlayFull === 'boolean' && typeof body.canPreview === 'boolean';
export function readPlayerCapabilities(body, elapsed = 0) {
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('INVALID_CLOCK');
  const server = Date.parse(body?.serverNow), until = body?.validUntil === null ? null : Date.parse(body?.validUntil);
  if (!body || typeof body.authenticated !== 'boolean' || !['none', 'expired', 'active'].includes(body.membershipStatus) ||
    typeof body.canPlayVipFull !== 'boolean' || typeof body.musicVipDeliveryEnabled !== 'boolean' ||
    typeof body.serverNow !== 'string' || !/T.*Z$/.test(body.serverNow) || !Number.isFinite(server) ||
    (until !== null && (typeof body.validUntil !== 'string' || !/T.*Z$/.test(body.validUntil) || !Number.isFinite(until))) ||
    (body.membershipStatus === 'active' && (!body.authenticated || until === null || until <= server + elapsed)) ||
    (body.canPlayVipFull && (body.membershipStatus !== 'active' || !body.musicVipDeliveryEnabled))) throw new Error('INVALID_CAPABILITIES');
  return { authenticated: body.authenticated, membershipStatus: body.membershipStatus,
    canPlayVipFull: body.canPlayVipFull, musicVipDeliveryEnabled: body.musicVipDeliveryEnabled,
    serverNow: body.serverNow, validUntil: body.validUntil, remaining: until === null ? null : until - server - elapsed };
}

// Owns only in-memory hints. /audio remains the authority on every new request.
export function createMusicAccessLifecycle(player, queue, {
  fetcher = globalThis.fetch.bind(globalThis), locale = 'zh-Hans', host = globalThis,
  document = globalThis.document, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  onCatalog = () => {}, onChange = () => {}, onCatalogError = () => {}, getSelection = () => ({})
} = {}) {
  if (mounts.has(player)) return mounts.get(player);
  let tracks = [], capabilities = null, deadline = null, timer = null, epoch = 0, disposed = false;
  let pending = null, checkingAccess = false, changingAccount = false, savedFullPosition = null, denial = null;
  let mediaRequest = null, mediaKey = '', refreshVersion = 0;
  let catalogVersion = 0, browsing = null;
  const requests = new Set(), invalidVersions = new Set();
  const activeTrack = () => tracks.find(track => track.id === player.snapshot().activeTrackId);
  const protectedFull = () => player.snapshot().activeVariant === 'full' && activeTrack()?.effectiveAccess !== 'free';
  const snapshot = () => ({ capabilities: capabilities ? { ...capabilities } : null, checking: checkingAccess,
    savedFullPosition: savedFullPosition ? { ...savedFullPosition } : null });
  const emit = () => { if (!disposed) onChange(snapshot()); };
  const publishCapabilities = value => { capabilities = value; queue.updateCapabilities(value); emit(); };
  const unload = reason => {
    const state = player.snapshot();
    if (state.activeVariant === 'full' && state.activeTrackId) savedFullPosition = {
      trackId: state.activeTrackId, audioVersion: state.activeAudioVersion, variant: 'full', positionSec: state.currentTimeSec
    };
    player.unload(reason);
  };
  const abortReads = () => { for (const controller of requests) controller.abort(); requests.clear(); mediaRequest = null; };
  const read = async path => {
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimer(() => controller.abort(), 8000);
    try {
      const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      return { status: response.status, body: await response.json() };
    } finally { clearTimer(timeout); requests.delete(controller); }
  };
  const cancelExpiry = () => { clearTimer(timer); timer = null; deadline = null; };
  const armExpiry = () => {
    clearTimer(timer);
    if (deadline === null || disposed) return;
    const remaining = deadline - now();
    timer = setTimer(() => {
      if (disposed) return;
      if (deadline > now()) { armExpiry(); return; }
      publishCapabilities(null); deadline = null;
      if (protectedFull()) unload(checking);
      void refresh('expiry');
    }, Math.max(1, Math.min(MAX_TIMER, remaining)));
  };
  const applyCatalog = (values, collections, view, resetUnavailable) => {
    const state = player.snapshot(), old = activeTrack();
    tracks = values;
    onCatalog(tracks, collections, view);
    queue.updateCatalog(tracks, { resetUnavailable });
    const current = activeTrack();
    if (old?.effectiveAccess === 'free' && current?.effectiveAccess === 'vip' && state.activeVariant === 'full' && playerVariant(current, capabilities) !== 'full') {
      unload(checkingAccess ? checking : unavailable);
    }
    if (current && old && (state.activeAudioVersion !== current.audioVersion || state.activePolicyVersion !== current.policyVersion)) {
      unload(contentError); player.select(current, playerVariant(current, capabilities) || 'preview');
    }
  };
  const enforce = () => {
    const state = player.snapshot();
    if (!state.activeTrackId) return;
    if (!activeTrack()) { unload(contentError); return; }
    if (!protectedFull() || (capabilities && playerVariant(activeTrack(), capabilities) === 'full')) {
      if (['access_required', 'access_unavailable'].includes(state.status)) player.unload({ status: 'paused' });
      return;
    }
    unload(capabilities ? required(capabilities.authenticated ? 'VIP_REQUIRED' : 'AUTH_REQUIRED') : denial || unavailable);
  };
  const loadCatalog = async (version, currentEpoch, resetUnavailable = false) => {
    const result = await read(`/api/music/catalog?locale=${locale}`);
    if (result.status !== 200) throw new Error('CATALOG_UNAVAILABLE');
    if (disposed || epoch !== currentEpoch || version !== catalogVersion) return;
    const activeId = player.snapshot().activeTrackId;
    const selected = await readMusicSelectionCatalog(result.body, { read, locale, selection: getSelection(),
      activeId, retained: queue.snapshot().items });
    if (disposed || epoch !== currentEpoch || version !== catalogVersion) return;
    // The user may start another queue while a target read is outstanding. That
    // read has no fresh metadata for the new audio, so it cannot replace its lookup.
    if (player.snapshot().activeTrackId !== activeId) return;
    if (resetUnavailable) invalidVersions.clear();
    applyCatalog(selected.tracks, selected.collections, selected.view, resetUnavailable);
  };
  const refresh = (reason = 'manual', { signal } = {}) => {
    if (disposed || signal?.aborted) return Promise.resolve();
    if (changingAccount && !['manual', 'foreground'].includes(reason)) return Promise.resolve();
    changingAccount = false;
    if (pending && ['foreground', 'initial'].includes(reason)) return pending;
    const version = ++refreshVersion, currentEpoch = ++epoch;
    const catalogReadVersion = ++catalogVersion;
    abortReads(); cancelExpiry(); checkingAccess = true; denial = null; publishCapabilities(null);
    if (reason !== 'initial' && protectedFull()) unload(checking);
    const started = now();
    const caps = read(`/api/music/me/capabilities?locale=${locale}`).then(result => {
      if (disposed || epoch !== currentEpoch) return;
      if (result.status !== 200) {
        if (result.status === 403 && result.body?.error?.code === 'ACCOUNT_RESTRICTED') denial = required('ACCOUNT_RESTRICTED');
        throw new Error('CAPABILITIES_UNAVAILABLE');
      }
      const value = readPlayerCapabilities(result.body, now() - started);
      publishCapabilities(value);
      if (value.membershipStatus === 'active') { deadline = now() + value.remaining; armExpiry(); }
    }).catch(() => { if (!disposed && epoch === currentEpoch) publishCapabilities(null); });
    const catalog = loadCatalog(catalogReadVersion, currentEpoch, true).catch(() => { if (!disposed && epoch === currentEpoch) onCatalogError(); });
    const cancel = () => {
      if (disposed || epoch !== currentEpoch) return;
      epoch++; refreshVersion++; catalogVersion++; abortReads(); cancelExpiry(); pending = null;
      checkingAccess = false; publishCapabilities(null); enforce();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    const work = Promise.all([caps, catalog]).then(() => {
      if (disposed || epoch !== currentEpoch) return;
      checkingAccess = false; enforce(); emit();
    }).finally(() => { signal?.removeEventListener('abort', cancel); if (refreshVersion === version) pending = null; });
    pending = work; return work;
  };
  const browse = () => {
    if (disposed) return Promise.resolve();
    if (pending) return pending.then(browse);
    if (browsing) return browsing;
    const version = ++catalogVersion, currentEpoch = epoch;
    // Viewing a new target does not revoke capabilities or stop the current audio.
    const work = loadCatalog(version, currentEpoch).then(() => {
      if (!disposed && epoch === currentEpoch && version === catalogVersion) { enforce(); emit(); }
    }).catch(() => { if (!disposed && epoch === currentEpoch && version === catalogVersion) onCatalogError(); })
      .finally(() => { if (browsing === work) browsing = null; });
    browsing = work; return work;
  };
  const accountChanged = phase => {
    if (disposed) return;
    epoch++; refreshVersion++; pending = null; abortReads(); cancelExpiry(); changingAccount = phase === 'changing';
    checkingAccess = true; denial = null; publishCapabilities(null);
    if (protectedFull()) unload({ ...checking, preservePosition: false });
    savedFullPosition = null;
    if (!changingAccount) void refresh('account');
  };
  const guard = state => {
    const track = activeTrack();
    if (!track || invalidVersions.has(`${state.activeTrackId}:${state.activeAudioVersion}`)) return contentError;
    if (state.activeVariant === 'preview') return track.previewAvailable ? null : contentError;
    if (track.effectiveAccess === 'free') return null;
    if (deadline !== null && deadline <= now()) {
      publishCapabilities(null); cancelExpiry(); void refresh('expiry');
      return checking;
    }
    return !changingAccount && capabilities && playerVariant(track, capabilities) === 'full' ? null
      : checkingAccess ? checking : capabilities ? required(capabilities.authenticated ? 'VIP_REQUIRED' : 'AUTH_REQUIRED') : denial || unavailable;
  };
  const playbackError = (state, recover) => {
    const key = `${state.sourceGeneration}:${state.activeTrackId}:${state.activeAudioVersion}`;
    if (mediaKey === key) return;
    mediaKey = key;
    const currentEpoch = epoch, controller = new AbortController();
    mediaRequest?.abort(); mediaRequest = controller; requests.add(controller);
    const current = () => !disposed && mediaRequest === controller && !controller.signal.aborted && epoch === currentEpoch &&
      player.snapshot().sourceGeneration === state.sourceGeneration && player.snapshot().status === 'error';
    const unavailableAfterError = () => {
      if (state.activeVariant === 'preview') recover();
      else { cancelExpiry(); publishCapabilities(null); unload(unavailable); }
    };
    const timeout = setTimer(() => {
      const stillCurrent = current(); controller.abort();
      if (stillCurrent) unavailableAfterError();
    }, 8000);
    void (async () => {
      try {
        const response = await fetcher(`/api/music/tracks/${state.activeTrackId}/access?v=${state.activeAudioVersion}`, {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal
        });
        const body = await response.json();
        if (!current()) return;
        if ([404, 409, 410].includes(response.status)) {
          invalidVersions.add(`${state.activeTrackId}:${state.activeAudioVersion}`);
          queue.markUnavailable(state.activeTrackId); unload(contentError); return;
        }
        // /access describes full access. A VIP denial cannot diagnose a preview decode failure.
        if (state.activeVariant === 'preview') { recover(); return; }
        if ([401, 403].includes(response.status) && ['AUTH_REQUIRED', 'VIP_REQUIRED', 'MEMBERSHIP_EXPIRED', 'ACCOUNT_RESTRICTED'].includes(body?.error?.code)) {
          cancelExpiry(); publishCapabilities(null); unload(required(body.error.code)); return;
        }
        if (response.status !== 200 || !healthyAccess(body) || !body.canPlayFull) {
          cancelExpiry(); publishCapabilities(null); unload(unavailable); return;
        }
        recover();
      } catch { if (current()) unavailableAfterError(); }
      finally { clearTimer(timeout); requests.delete(controller); if (mediaRequest === controller) mediaRequest = null; }
    })();
  };
  const unwatch = watchReaderSession(accountChanged, host);
  const foreground = () => { if (document?.visibilityState === 'visible') void refresh('foreground'); };
  const pageshow = event => { if (event.persisted) foreground(); };
  document?.addEventListener('visibilitychange', foreground); host.addEventListener('focus', foreground); host.addEventListener('pageshow', pageshow);
  const unsubscribe = player.subscribe(state => {
    if (state.status !== 'error') { mediaKey = ''; mediaRequest?.abort(); }
  });
  player.setPlayGuard(guard); queue.setErrorHandler(playbackError);
  const api = { snapshot, refresh, browse, accountChanged, destroy() {
    if (disposed) return;
    disposed = true; epoch++; cancelExpiry(); abortReads(); unsubscribe(); unwatch();
    document?.removeEventListener('visibilitychange', foreground); host.removeEventListener('focus', foreground); host.removeEventListener('pageshow', pageshow);
    player.setPlayGuard(null); queue.setErrorHandler(null); capabilities = null; savedFullPosition = null; mounts.delete(player);
  } };
  mounts.set(player, api); return api;
}
