import { parseMusicLyrics, LYRICS_BYTES } from '../scripts/musicLyrics.js';
import { stationLocales, stationHref } from './routes.js';
import { contentBase, uuid, slug, positive } from './publicValidation.js';
import { musicCopy } from './musicCopy.js';
import { musicIcon, musicTime, musicCatalogHref, renderCatalogResults } from './musicRender.js';
import { indexStationMusicTracks } from './musicPlayback.js';
import { requestStationMusic } from './musicRequest.js';
import { getStationMusicSession, rememberStationMusicTrigger, stationMusicNotice } from './musicPlayerView.js';
import { readMusicResponse } from './musicResponse.js';

export function mountStationMusic() {
  const root = document.querySelector('[data-sc-music-page]'), bootstrap = document.getElementById('sc-music-bootstrap');
  if (!root || root.dataset.mounted || !bootstrap || bootstrap.textContent.length > 512 * 1024) return () => {};
  let model;
  try { model = JSON.parse(bootstrap.textContent); }
  catch { return () => {}; }
  if (!stationLocales.includes(model.locale) || !['catalog', 'detail'].includes(model.mode)) return () => {};
  root.dataset.mounted = 'true';
  const copy = musicCopy[model.locale], listeners = new AbortController(), requests = new Set();
  const tracks = new Map(), session = getStationMusicSession(model.locale);
  if (!session) { delete root.dataset.mounted; return () => {}; }
  const local = session.local;
  const $ = selector => document.querySelector(selector);
  let disposed = false, catalogGeneration = 0, catalogRequest, pendingCatalog = null;
  const listen = (target, type, callback, options = {}) => target?.addEventListener(type, callback, { ...options, signal: listeners.signal });
  function remember() {
    indexStationMusicTracks(model, tracks);
    session.observeTracks(tracks.values());
  }
  remember();
  function feedback(message, login = false) {
    const node = $('[data-sc-music-feedback]');
    node.hidden = !message; node.textContent = message || '';
    if (login) {
      const link = document.createElement('a'); link.href = stationHref(model.locale, 'member'); link.textContent = copy.login;
      node.append(link);
    }
  }
  async function getResponse(path, controller = new AbortController()) {
    requests.add(controller);
    try { return await requestStationMusic(path, controller); }
    finally { requests.delete(controller); }
  }
  const localSubscription = local.subscribe(snapshot => {
    for (const button of root.querySelectorAll('[data-sc-favorite]')) {
      const id = button.dataset.scFavorite, saved = snapshot.favorites.includes(id);
      button.setAttribute('aria-pressed', String(saved));
      button.querySelector('[data-sc-favorite-label]').textContent = saved ? copy.favorited : copy.favorite;
      button.setAttribute('aria-label', (saved ? copy.favorited : copy.favorite) + ' · ' + (tracks.get(id)?.title || ''));
    }
    const note = root.querySelector('[data-sc-local-note]');
    if (note) note.textContent = snapshot.warning === 'corrupt' ? copy.corrupt : snapshot.warning === 'limit' ? copy.limit : snapshot.persistent ? copy.local : copy.temporary;
  });
  function renderPlayerButtons(state) {
    if (disposed) return;
    const active = ['playing', 'loading', 'buffering'].includes(state.status);
    for (const button of root.querySelectorAll('[data-sc-preview]')) {
      const dto = tracks.get(button.dataset.scPreview), playing = active && state.activeVariant === 'preview' && state.activeTrackId === dto?.id;
      button.setAttribute('aria-label', (playing ? copy.pause : copy.preview) + ' · ' + (dto?.title || ''));
      button.innerHTML = musicIcon(playing ? 'pause' : 'play') + (button.classList.contains('sc-button')
        ? '<span>' + (playing ? copy.pause : copy.preview + ' ' + musicTime(dto?.preview?.durationMs)) + '</span>' : '');
    }
    for (const button of root.querySelectorAll('[data-sc-full-check]')) {
      const dto = tracks.get(button.dataset.scFullCheck);
      button.disabled = state.pendingTrackId === dto?.id;
      const playing = active && state.activeVariant === 'full' && state.activeTrackId === dto?.id;
      button.querySelector('span').textContent = button.disabled ? copy.prepare : playing ? copy.pause : session.isPrepared(dto) ? copy.ready : copy.full;
    }
  }
  const playerSubscription = session.subscribe(state => {
    renderPlayerButtons(state);
    feedback(state.notice ? stationMusicNotice(state, copy) : '', state.notice?.code === 'denied');
  });
  async function loadCatalog({ append = false, cursor = null, updateHistory = true } = {}) {
    if (model.mode !== 'catalog' || disposed) return;
    pendingCatalog = { append, cursor, updateHistory };
    catalogRequest?.abort(); catalogRequest = new AbortController();
    const controller = catalogRequest, generation = ++catalogGeneration;
    const form = root.querySelector('[data-sc-music-search]'), results = root.querySelector('[data-sc-catalog-results]');
    if (!append) model.query = { q: form.elements.q.value.trim().slice(0, 100), sort: form.elements.sort.value === 'release' ? 'release' : 'default', cursor: null };
    const query = new URLSearchParams({ locale: model.locale, limit: '20', sort: model.query.sort });
    if (model.query.q) query.set('q', model.query.q);
    if (cursor) query.set('cursor', cursor);
    results.setAttribute('aria-busy', 'true');
    const count = results.querySelector('.sc-music-count'); if (count) count.textContent = copy.loading;
    try {
      const body = await getResponse(contentBase + '/tracks?' + query, controller);
      if (disposed || generation !== catalogGeneration) return;
      if (body.schemaVersion !== 1 || body.locale !== model.locale || !Array.isArray(body.items) || body.items.length > 20 ||
        (body.nextCursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(body.nextCursor))) throw new Error('INVALID_RESPONSE');
      const incoming = body.items.filter(track => track && uuid(track.id) && slug(track.slug) && positive(track.revision));
      const unique = new Map((append ? model.items : []).map(track => [track.id, track]));
      incoming.forEach(track => unique.set(track.id, track)); model.items = [...unique.values()];
      model.nextCursor = body.nextCursor; model.error = null;
      if (!append && updateHistory) history.pushState(null, '', musicCatalogHref(model.locale, model.query));
    } catch (error) {
      if (disposed || generation !== catalogGeneration) return;
      if (!append) model.items = [];
      model.error = { status: error.status || 503 }; model.nextCursor = append ? cursor : null;
    } finally {
      if (!disposed && generation === catalogGeneration) {
        pendingCatalog = null;
        results.innerHTML = renderCatalogResults(model); results.removeAttribute('aria-busy');
        root.querySelector('[data-sc-curated]')?.toggleAttribute('hidden', Boolean(model.query.q));
        remember();
        renderPlayerButtons(session.snapshot());
        // Reapply the real local state after replacing only the result region.
        const state = local.snapshot();
        for (const button of root.querySelectorAll('[data-sc-favorite]')) {
          const saved = state.favorites.includes(button.dataset.scFavorite); button.setAttribute('aria-pressed', String(saved));
          button.querySelector('[data-sc-favorite-label]').textContent = saved ? copy.favorited : copy.favorite;
          button.setAttribute('aria-label', (saved ? copy.favorited : copy.favorite) + ' · ' + (tracks.get(button.dataset.scFavorite)?.title || ''));
        }
      }
    }
  }
  listen(root, 'click', event => {
    const button = event.target.closest('button, a'); if (!button) return;
    if (button.hasAttribute('data-sc-favorite')) local.toggleFavorite(button.dataset.scFavorite);
    else if (button.hasAttribute('data-sc-preview')) { const dto = tracks.get(button.dataset.scPreview); if (dto) { rememberStationMusicTrigger(button); session.play(dto, 'preview'); } }
    else if (button.hasAttribute('data-sc-full-check')) {
      const dto = tracks.get(button.dataset.scFullCheck); if (!dto) return;
      rememberStationMusicTrigger(button);
      const state = session.snapshot();
      if (session.isPrepared(dto) || (state.activeTrackId === dto.id && state.activeVariant === 'full' && ['playing', 'loading', 'buffering'].includes(state.status))) session.play(dto, 'full');
      else void session.prepareFull(dto);
    } else if (button.hasAttribute('data-sc-more')) { event.preventDefault(); if (!root.querySelector('[data-sc-catalog-results]')?.hasAttribute('aria-busy')) void loadCatalog({ append: true, cursor: model.nextCursor }); }
    else if (button.hasAttribute('data-sc-page-retry') && model.mode === 'catalog') { event.preventDefault(); void loadCatalog({ append: Boolean(model.items?.length), cursor: model.items?.length ? model.nextCursor : null }); }
  });
  const form = root.querySelector('[data-sc-music-search]');
  listen(form, 'submit', event => { event.preventDefault(); void loadCatalog(); });
  listen(form?.elements.sort, 'change', () => form.requestSubmit());
  listen(window, 'popstate', () => {
    if (!form) return;
    const query = new URL(location.href).searchParams; form.elements.q.value = query.get('q') || ''; form.elements.sort.value = query.get('sort') === 'release' ? 'release' : 'default';
    void loadCatalog({ updateHistory: false });
  });
  for (const details of root.querySelectorAll('[data-sc-lyrics]')) {
    let loaded = false, loading = false;
    async function loadLyrics() {
      if (loaded || loading || !details.open || disposed) return;
      loading = true; const text = details.querySelector('[data-sc-lyrics-text]'), retry = details.querySelector('[data-sc-lyrics-retry]');
      text.textContent = copy.reading; retry.hidden = true;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000); requests.add(controller);
      try {
        const response = await fetch(details.dataset.scLyrics, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
        if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim() !== 'text/plain') {
          await response.body?.cancel(); throw new Error('LYRICS_UNAVAILABLE');
        }
        const lyrics = parseMusicLyrics(await readMusicResponse(response, LYRICS_BYTES), model.track.lyricsKind);
        if (disposed) return;
        text.textContent = lyrics.kind === 'lrc' ? lyrics.lines.map(line => line.text).join('\n') : lyrics.text; loaded = true;
      } catch { if (!disposed) { text.textContent = copy.lyricsFailed; retry.hidden = false; } }
      finally { loading = false; requests.delete(controller); clearTimeout(timer); }
    }
    listen(details, 'toggle', () => { if (details.open) void loadLyrics(); });
    listen(details.querySelector('[data-sc-lyrics-retry]'), 'click', () => { void loadLyrics(); });
  }
  listen(root, 'error', event => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const owner = event.target.closest('.sc-song-hero, .sc-song-card');
    if (owner) { event.target.remove(); owner.classList.add('sc-song-no-cover'); }
    else if (event.target.closest('.sc-clip-card')) {
      const section = event.target.closest('.sc-music-section'); event.target.closest('.sc-clip-card').remove();
      if (!section.querySelector('.sc-clip-card')) section.remove();
    }
  }, { capture: true });
  function dispose() {
    if (disposed) return; disposed = true; catalogGeneration++; session.cancelPending();
    requests.forEach(controller => controller.abort()); requests.clear(); listeners.abort();
    localSubscription(); playerSubscription(); delete root.dataset.mounted;
  }
  listen(window, 'pagehide', event => {
    catalogGeneration++; session.suspend(); requests.forEach(controller => controller.abort());
    if (!event.persisted) dispose();
  });
  listen(window, 'pageshow', event => {
    // A page restored from the back/forward cache keeps its listeners. Resume
    // only an interrupted catalog intent, so "load more" cannot stay busy.
    if (event.persisted && pendingCatalog && !disposed) void loadCatalog(pendingCatalog);
  });
  return dispose;
}
