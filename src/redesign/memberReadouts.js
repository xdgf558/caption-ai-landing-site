import { MUSIC_LOCAL_KEY, MUSIC_OLD_KEY, readMusicLocal } from '../scripts/musicLocalData.js';
import { readMusicResponse } from './musicResponse.js';

// T14 is a reader of the existing local format. In particular, opening Member
// must not migrate v1, adopt a guest game slot, or repair damaged data.
export function readMemberMusic(storage = () => globalThis.localStorage, now = Date.now()) {
  try {
    const backend = storage(), current = backend.getItem(MUSIC_LOCAL_KEY);
    const legacy = current === null ? backend.getItem(MUSIC_OLD_KEY) : null;
    if (current === null && legacy === null) return { favorites: [], recent: [], warning: null };
    try {
      const data = readMusicLocal(current ?? legacy, now, current === null);
      return { favorites: data.favorites, recent: data.recent, warning: current === null ? 'legacy' : null };
    } catch { return { favorites: [], recent: [], warning: 'corrupt' }; }
  } catch { return { favorites: [], recent: [], warning: 'storage' }; }
}

const accountId = value => Number.isSafeInteger(value) && value > 0;
export function memberIdentity(data) {
  if (data?.ok !== true || typeof data.authenticated !== 'boolean') throw new Error('SESSION_UNAVAILABLE');
  if (!data.authenticated) return { member: false, id: null };
  if (!accountId(data.account?.id)) throw new Error('SESSION_UNAVAILABLE');
  return { member: true, id: data.account.id };
}
const sameAccount = (data, identity) => data?.authenticated === true && data.account?.id === identity.id;
export function memberCloudSave(data, identity) {
  if (!sameAccount(data, identity)) throw new Error('ACCOUNT_CHANGED');
  if (data.save === null) return { status: 'missing' };
  if (!data.save || !accountId(data.save.revision) || typeof data.save.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(data.save.updatedAt))) throw new Error('INVALID_SAVE_RESPONSE');
  return { status: 'saved', revision: data.save.revision, updatedAt: data.save.updatedAt };
}
export function memberGameItems(data, identity) {
  if (!sameAccount(data, identity)) throw new Error('ACCOUNT_CHANGED');
  if (!Array.isArray(data.entitlements) || data.entitlements.length > 1000) throw new Error('INVALID_ITEMS_RESPONSE');
  return { status: 'known', count: data.entitlements.length };
}
export function memberOrder(data, identity) {
  if (data?.authenticated === true && (!identity?.member || data.account?.id !== identity.id)) throw new Error('ACCOUNT_CHANGED');
  if (!data?.order || typeof data.order.status !== 'string' || data.order.status.length > 40) throw new Error('INVALID_ORDER_RESPONSE');
  // The original endpoint is the owner of payment/fulfillment rules. Never infer
  // membership, a refunded balance or new access from an order status here.
  const fulfillment = data.fulfillment;
  if (!fulfillment || typeof fulfillment.complete !== 'boolean' || typeof fulfillment.needsReview !== 'boolean' ||
    typeof fulfillment.pending !== 'boolean') throw new Error('INVALID_ORDER_RESPONSE');
  return { status: 'found', amount: String(data.order.priceAmount ?? '').slice(0, 40),
    currency: String(data.order.priceCurrency ?? '').slice(0, 12),
    fulfillment: data.order.status === 'refunded' || fulfillment.reason === 'credits_reversed' ? 'refunded' :
      ['failed', 'expired'].includes(data.order.status) ? data.order.status :
      fulfillment.complete ? 'fulfilled' : fulfillment.needsReview ? 'review' : fulfillment.pending ? 'pending' : 'unknown' };
}

export function createMemberReadouts({ fetcher = globalThis.fetch.bind(globalThis), storage = () => globalThis.localStorage,
  probe, timeoutMs = 8000, now = Date.now, onMismatch = () => {} } = {}) {
  let generation = 0, orderGeneration = 0, controller, disposed = false;
  let state = { phase: 'checking', identity: null, music: readMemberMusic(storage, now()), local: 'identity',
    cloud: { status: 'checking' }, items: { status: 'checking' }, order: { status: 'idle' } };
  const listeners = new Set(), orderRequests = new Set(), emit = () => { for (const fn of listeners) fn(api.snapshot()); };
  const current = version => !disposed && version === generation;
  async function get(path, signal, maxBytes = 128 * 1024) {
    const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', signal });
    const data = JSON.parse(await readMusicResponse(response, maxBytes));
    if (!response.ok || data.ok !== true) throw Object.assign(new Error(data.code || 'SERVICE_UNAVAILABLE'), { status: response.status });
    return data;
  }
  function clear(phase) {
    controller?.abort(); ++generation; ++orderGeneration;
    for (const request of orderRequests) request.abort();
    orderRequests.clear();
    state = { ...state, phase, identity: null, local: 'identity', cloud: { status: 'checking' }, items: { status: 'checking' }, order: { status: 'idle' } };
    emit();
  }
  async function refresh() {
    if (disposed) return;
    clear('checking'); const version = generation;
    controller = new AbortController(); const signal = controller.signal;
    const timer = setTimeout(() => controller?.signal === signal && controller.abort(), timeoutMs);
    try {
      const identity = memberIdentity(await get('/api/readers/session', signal));
      if (!current(version)) return;
      state.identity = identity; state.phase = identity.member ? 'member' : 'guest';
      try {
        const key = identity.member ? probe.memberKey(identity.id) : probe.baseKey;
        state.local = probe.inspect(storage(), key).status;
      } catch { state.local = 'unavailable'; }
      state.cloud = { status: identity.member ? 'checking' : 'guest' };
      state.items = { status: identity.member ? 'checking' : 'guest' }; emit();
      if (!identity.member) return;
      const readOwned = async (key, path, projector, maxBytes) => {
        try {
          const data = await get(path, signal, maxBytes);
          if (!current(version)) return;
          const value = projector(data, identity);
          if (!current(version)) return;
          state[key] = value; emit();
        } catch (error) {
          if (!current(version)) return;
          if (error.message === 'ACCOUNT_CHANGED') { clear('changed'); onMismatch(); return; }
          state[key] = { status: 'error' }; emit();
        }
      };
      await Promise.all([
        readOwned('cloud', '/api/readers/game-saves/cat-life', memberCloudSave, 1024 * 1024),
        readOwned('items', '/api/games/cat-life/entitlements', memberGameItems, 256 * 1024),
      ]);
    } catch {
      if (current(version)) { state.phase = 'error'; state.identity = null; state.local = 'identity';
        state.cloud = { status: 'error' }; state.items = { status: 'error' }; emit(); }
    } finally { clearTimeout(timer); }
  }
  async function lookupOrder(value) {
    const token = typeof value === 'string' ? value.trim() : '';
    if (disposed) return;
    for (const request of orderRequests) request.abort();
    orderRequests.clear();
    const version = generation, orderVersion = ++orderGeneration;
    const live = () => current(version) && orderVersion === orderGeneration;
    if (!token || token.length > 80) { state.order = { status: 'invalid' }; emit(); return; }
    const own = new AbortController(), signal = own.signal, timer = setTimeout(() => own.abort(), timeoutMs);
    orderRequests.add(own);
    state.order = { status: 'checking' }; emit();
    try {
      const data = await get('/api/novels/payments/order?' + new URLSearchParams({ order: token }), signal);
      if (!live()) return;
      state.order = memberOrder(data, state.identity); emit();
    } catch (error) {
      if (!live()) return;
      state.order = { status: error.message === 'ACCOUNT_CHANGED' ? 'changed' :
        error.status === 401 ? 'auth' : error.status === 403 ? 'other' : error.status === 404 ? 'missing' : 'error' }; emit();
    } finally { clearTimeout(timer); orderRequests.delete(own); }
  }
  const api = {
    snapshot: () => structuredClone(state),
    subscribe(fn) { listeners.add(fn); fn(api.snapshot()); return () => listeners.delete(fn); },
    refresh, lookupOrder,
    invalidate() { if (!disposed) clear('changed'); },
    readMusic() { if (!disposed) { state.music = readMemberMusic(storage, now()); emit(); } },
    destroy() { disposed = true; controller?.abort(); for (const request of orderRequests) request.abort(); orderRequests.clear();
      ++generation; ++orderGeneration; listeners.clear(); },
  };
  return api;
}
