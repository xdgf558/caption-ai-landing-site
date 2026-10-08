import '../../public/games/cat-life/src/js/state/saveStatus.js';
import { createMemberReadouts } from './memberReadouts.js';
import { memberText } from './memberCopy.js';
import { watchReaderSession, notifyReaderSession } from '../scripts/readerSessionEvents.js';
import { musicPageHref } from '../music/pagePaths.js';
import { readMusicResponse } from './musicResponse.js';

export function mountMemberServices({ root = document.querySelector('[data-sc-member-services]'), host = window } = {}) {
  if (!root || root.dataset.mounted) return () => {};
  root.dataset.mounted = 'true';
  const locale = root.dataset.locale, t = (key, values) => memberText(locale, key, values), $ = selector => root.querySelector(selector);
  const fetcher = host.fetch.bind(host), storage = () => host.localStorage;
  const session = createMemberReadouts({ fetcher, storage, probe: host.CatGameSaveStatus, onMismatch: () => notifyReaderSession('changing', host) });
  const events = new AbortController(), listen = (target, event, fn) => target.addEventListener(event, fn, { signal: events.signal });
  const titleRequests = new Set(), titleCache = new Map(), loadingLists = new Map(), limits = { favorites: 10, recent: 10 };
  let disposed = false, lastMusic = '', musicGeneration = 0;
  const localDate = value => new Date(value).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function renderList(kind, music) {
    const ids = music[kind], list = $('[data-sc-member-tracks="' + kind + '"]'); list.replaceChildren();
    $('[data-sc-member-count="' + kind + '"]').textContent = music.warning === 'corrupt' || music.warning === 'storage' ? '—' : t('count', { count: ids.length });
    if (!ids.length) {
      const empty = root.ownerDocument.createElement('li');
      empty.textContent = music.warning === 'corrupt' || music.warning === 'storage' ? t('music' + (music.warning === 'corrupt' ? 'Corrupt' : 'Storage')) : t(kind === 'favorites' ? 'emptyMusic' : 'emptyRecent');
      list.append(empty);
    }
    for (const [index, id] of ids.slice(0, limits[kind]).entries()) {
      const row = root.ownerDocument.createElement('li'), link = root.ownerDocument.createElement('a');
      link.href = musicPageHref(locale, new URLSearchParams({ track: id })); link.dataset.trackId = id;
      link.textContent = titleCache.get(id) || t('savedTrack', { number: index + 1 }); row.append(link); list.append(row);
    }
    $('[data-sc-member-more="' + kind + '"]').hidden = ids.length <= limits[kind];
  }
  async function loadTitles(kind) {
    const version = musicGeneration, ids = session.snapshot().music[kind].slice(0, limits[kind]);
    if (loadingLists.get(kind) === version) return;
    loadingLists.set(kind, version);
    // Only opened lists request metadata, at most four reads per list. No
    // audio, auth token, native sync or collection mutation is involved.
    try { for (let offset = 0; offset < ids.length; offset += 4) {
      await Promise.all(ids.slice(offset, offset + 4).map(async id => {
        if (titleCache.has(id) || disposed || version !== musicGeneration) return;
        const controller = new AbortController(); titleRequests.add(controller);
        const timer = setTimeout(() => controller.abort(), 8000);
        let title;
        try {
          const response = await fetcher('/api/music/tracks/' + id + '?' + new URLSearchParams({ locale }),
            { credentials: 'omit', cache: 'no-store', signal: controller.signal });
          const data = JSON.parse(await readMusicResponse(response, 128 * 1024));
          if (response.ok && data.track?.id === id && typeof data.track.title === 'string' && data.track.title.trim() && data.track.title.length <= 200) title = data.track.title;
          else title = t(response.status === 404 ? 'trackMissing' : 'trackUnavailable', { id: id.slice(0, 8) });
        } catch { title = t('trackUnavailable', { id: id.slice(0, 8) }); }
        finally { clearTimeout(timer); titleRequests.delete(controller); }
        if (disposed || version !== musicGeneration) return;
        titleCache.set(id, title);
        for (const link of root.querySelectorAll('[data-track-id]')) if (link.dataset.trackId === id) link.textContent = title;
      }));
    } } finally {
      if (loadingLists.get(kind) === version) { loadingLists.delete(kind);
        if (!disposed && version === musicGeneration && session.snapshot().music[kind].slice(0, limits[kind]).some(id => !titleCache.has(id))) void loadTitles(kind); }
    }
  }
  const unsubscribe = session.subscribe(state => {
    $('[data-sc-member-identity]').textContent = state.phase === 'guest' ? t('guest') : state.phase === 'error' ? t('identityError') : state.phase === 'changed' ? t('refreshSession') : state.phase === 'checking' ? t('checking') : '';
    $('[data-sc-member-local]').textContent = state.local === 'identity' ? state.phase === 'checking' ? t('checking') : t('identityError') : t(state.local);
    $('[data-sc-member-cloud]').textContent = t(({ checking: 'checking', guest: 'cloudGuest', missing: 'cloudMissing', error: 'cloudError', saved: 'cloudSaved' })[state.cloud.status] || 'cloudError',
      state.cloud.status === 'saved' ? { revision: state.cloud.revision, date: localDate(state.cloud.updatedAt) } : {});
    $('[data-sc-member-items]').textContent = t(({ checking: 'checking', guest: 'costumesGuest', error: 'costumesError', known: 'costumes' })[state.items.status] || 'costumesError', { count: state.items.count });
    const music = JSON.stringify(state.music);
    if (music !== lastMusic) {
      lastMusic = music; ++musicGeneration; titleCache.clear(); for (const request of titleRequests) request.abort();
      for (const kind of ['favorites', 'recent']) { renderList(kind, state.music); if ($('[data-sc-member-list="' + kind + '"]').open) void loadTitles(kind); }
      $('[data-sc-member-music-status]').textContent = t(({ legacy: 'musicLegacy', corrupt: 'musicCorrupt', storage: 'musicStorage' })[state.music.warning]);
    }
    const order = state.order;
    $('[data-sc-member-order-status]').textContent = order.status === 'found' ? t('orderFound', { status: t(({ fulfilled: 'fulfilled', pending: 'pending', review: 'review', refunded: 'refunded', failed: 'failed', expired: 'expired', unknown: 'orderUnknown' })[order.fulfillment]), amount: order.amount, currency: order.currency }) :
      t(({ idle: '', checking: 'checking', invalid: 'orderRequired', auth: 'orderAuth', other: 'orderOther', missing: 'orderNotFound', error: 'orderError', changed: 'refreshSession' })[order.status]);
    $('[data-sc-member-order-form] button').disabled = order.status === 'checking';
    $('[data-sc-member-refresh]').disabled = state.phase === 'checking';
  });
  for (const kind of ['favorites', 'recent']) {
    const details = $('[data-sc-member-list="' + kind + '"]');
    listen(details, 'toggle', () => { if (details.open) void loadTitles(kind); });
    listen($('[data-sc-member-more="' + kind + '"]'), 'click', () => { limits[kind] += 20; renderList(kind, session.snapshot().music); void loadTitles(kind); });
  }
  listen($('[data-sc-member-refresh]'), 'click', () => { session.readMusic(); void session.refresh(); });
  listen(root.ownerDocument, 'station-cat:member-refresh', () => { session.readMusic(); void session.refresh(); });
  listen($('[data-sc-member-order-form]'), 'submit', event => { event.preventDefault(); void session.lookupOrder($('#sc-member-order-reference').value); });
  const unwatch = watchReaderSession(phase => {
    session.invalidate(); $('#sc-member-order-reference').value = '';
    if (phase === 'changed') void session.refresh();
  }, host);
  listen(host, 'storage', event => { if (['stationcat.music.v1', 'stationcat.music.v2', null].includes(event.key)) session.readMusic(); });
  listen(host, 'focus', () => { session.readMusic(); void session.refresh(); });
  listen(host, 'pageshow', event => { if (event.persisted) { session.readMusic(); void session.refresh(); } });
  listen(host, 'pagehide', event => { session.invalidate(); $('#sc-member-order-reference').value = ''; if (!event.persisted) dispose(); });
  function dispose() { if (disposed) return; disposed = true; ++musicGeneration; events.abort(); unsubscribe(); unwatch(); session.destroy();
    for (const request of titleRequests) request.abort(); titleRequests.clear(); delete root.dataset.mounted; }
  void session.refresh();
  return dispose;
}
