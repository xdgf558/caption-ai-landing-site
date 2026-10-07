import { createMusicLocalData } from '../scripts/musicLocalData.js';
import { createMusicPlayer } from '../scripts/musicPlayerCore.js';
import { parseMusicLyrics, LYRICS_BYTES } from '../scripts/musicLyrics.js';
import { stationLocales, stationHref } from './routes.js';
import { contentBase, uuid, slug, positive } from './publicValidation.js';
import { musicCopy } from './musicCopy.js';
import { musicIcon, musicTime, musicCatalogHref, renderCatalogResults } from './musicRender.js';
import { stationMusicSource, previewPlayerTrack, fullPlayerTrack, indexStationMusicTracks } from './musicPlayback.js';
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
  const tracks = new Map(), prepared = new Map(), local = createMusicLocalData();
  const audio = document.querySelector('[data-sc-music-audio]'), dock = document.querySelector('[data-sc-player-dock]');
  const player = createMusicPlayer(audio, { origin: location.origin, sourceFor: stationMusicSource });
  const $ = selector => document.querySelector(selector);
  let disposed = false, catalogGeneration = 0, playbackGeneration = 0, catalogRequest, pendingCatalog = null, fullRequest, currentTrack = null, lastTrigger;
  const listen = (target, type, callback, options = {}) => target?.addEventListener(type, callback, { ...options, signal: listeners.signal });
  function remember() {
    indexStationMusicTracks(model, tracks);
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
  const stopFullRequest = () => { playbackGeneration++; fullRequest?.abort(); fullRequest = null; };
  async function getResponse(path, controller = new AbortController()) {
    if (!path.startsWith(contentBase + '/') || path.startsWith('//')) throw new Error('INVALID_ENDPOINT');
    requests.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      const text = await readMusicResponse(response);
      let body;
      try { body = JSON.parse(text); } catch { throw new Error('INVALID_RESPONSE'); }
      if (!response.ok) throw Object.assign(new Error('QUERY_FAILED'), { status: response.status, code: body.code });
      return body;
    } finally { clearTimeout(timer); requests.delete(controller); }
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
  const initialLocal = local.snapshot();
  player.setVolume(initialLocal.settings.volume); player.setMuted(initialLocal.settings.muted);
  const playerSubscription = player.subscribe(state => {
    if (disposed) return;
    dock.dataset.playbackState = state.status;
    const active = ['playing', 'loading', 'buffering'].includes(state.status);
    const toggle = $('[data-sc-play-toggle]');
    toggle.innerHTML = musicIcon(active ? 'pause' : 'play'); toggle.setAttribute('aria-label', active ? copy.pause : copy.play);
    $('[data-sc-now-title]').textContent = currentTrack?.title || '';
    $('[data-sc-now-artist]').textContent = currentTrack?.artist || '';
    $('[data-sc-current-time]').textContent = musicTime(Math.floor(state.currentTimeSec * 1000)) || '00:00';
    $('[data-sc-duration]').textContent = musicTime(Math.floor((state.durationSec || 0) * 1000)) || '00:00';
    const seek = $('[data-sc-seek]'); seek.max = String(state.durationSec || 1); seek.value = String(state.currentTimeSec); seek.disabled = audio.readyState < 1;
    $('[data-sc-volume]').value = String(state.volume); $('[data-sc-volume]').closest('label').hidden = !state.volumeSupported;
    $('[data-sc-player-status]').textContent = state.lastError ? state.lastError.code === 'PLAY_NOT_ALLOWED' ? copy.blocked : copy.playbackFailed : state.status === 'ended' ? copy.ended : '';
    for (const button of root.querySelectorAll('[data-sc-preview]')) {
      const dto = tracks.get(button.dataset.scPreview), playing = active && state.activeVariant === 'preview' && state.activeTrackId === dto?.id;
      const label = (playing ? copy.pause : copy.preview) + ' · ' + (dto?.title || '');
      button.setAttribute('aria-label', label);
      button.innerHTML = musicIcon(playing ? 'pause' : 'play') + (button.classList.contains('sc-button')
        ? '<span>' + (playing ? copy.pause : copy.preview + ' ' + musicTime(dto?.preview?.durationMs)) + '</span>' : '');
    }
  });
  const playedSubscription = player.onUserPlay(state => local.recordPlayed(state.activeTrackId));
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
  async function prepareFull(button, dto) {
    stopFullRequest(); player.pause();
    const generation = playbackGeneration, controller = new AbortController(); fullRequest = controller;
    button.disabled = true; button.querySelector('span').textContent = copy.prepare;
    try {
      const expected = contentBase + '/tracks/' + dto.slug + '/playback?variant=full';
      if (dto.fullPlayback?.requiresAccessCheck !== true || dto.fullPlayback.playbackPath !== expected) throw new Error('INVALID_ENDPOINT');
      const body = await getResponse(expected + '&locale=' + model.locale, controller);
      if (disposed || generation !== playbackGeneration) return;
      prepared.set(dto.id, fullPlayerTrack(dto, body));
      button.dataset.ready = 'true'; button.querySelector('span').textContent = copy.ready;
      feedback(copy.ready);
    } catch (error) {
      if (!disposed && generation === playbackGeneration) feedback(error.status === 401 || error.status === 403 ? copy.denied : error.status === 409 ? copy.stale : copy.playbackFailed,
        error.status === 401 || error.status === 403);
    } finally {
      if (!disposed && button.isConnected) {
        button.disabled = false;
        if (button.dataset.ready !== 'true') button.querySelector('span').textContent = copy.full;
      }
    }
  }
  function play(dto, variant, button) {
    stopFullRequest();
    try {
      const selection = variant === 'preview' ? previewPlayerTrack(dto) : prepared.get(dto.id);
      if (!selection) return;
      currentTrack = dto; lastTrigger = button; dock.hidden = false; $('[data-sc-account-help]').hidden = true; feedback('');
      player.playTrack(selection, variant);
    } catch { feedback(copy.stale); }
  }
  listen(root, 'click', event => {
    const button = event.target.closest('button, a'); if (!button) return;
    if (button.hasAttribute('data-sc-favorite')) local.toggleFavorite(button.dataset.scFavorite);
    else if (button.hasAttribute('data-sc-preview')) { const dto = tracks.get(button.dataset.scPreview); if (dto) play(dto, 'preview', button); }
    else if (button.hasAttribute('data-sc-full-check')) {
      const dto = tracks.get(button.dataset.scFullCheck); if (!dto) return;
      if (button.dataset.ready === 'true') play(dto, 'full', button); else void prepareFull(button, dto);
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
  listen($('[data-sc-play-toggle]'), 'click', () => {
    if (['playing', 'loading', 'buffering'].includes(player.snapshot().status)) player.pause(); else player.play({ userInitiated: true });
  });
  function resetPrepared() {
    prepared.clear();
    for (const button of root.querySelectorAll('[data-sc-full-check]')) {
      delete button.dataset.ready; button.disabled = false; button.querySelector('span').textContent = copy.full;
    }
  }
  listen($('[data-sc-player-close]'), 'click', () => { stopFullRequest(); player.clear(); dock.hidden = true; resetPrepared();
    if (lastTrigger?.isConnected) lastTrigger.focus(); else document.getElementById('station-main')?.focus(); });
  listen($('[data-sc-seek]'), 'input', event => player.seek(Number(event.target.value)));
  listen($('[data-sc-volume]'), 'input', event => {
    player.setVolume(Number(event.target.value)); const saved = local.snapshot();
    local.savePlayback({ queue: saved.queue, settings: { ...saved.settings, volume: player.snapshot().volume } });
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
    if (disposed) return; disposed = true; catalogGeneration++; stopFullRequest();
    requests.forEach(controller => controller.abort()); requests.clear(); listeners.abort();
    localSubscription(); playerSubscription(); playedSubscription(); player.destroy(); local.destroy(); prepared.clear();
    dock.hidden = true; delete root.dataset.mounted;
  }
  listen(window, 'pagehide', event => {
    catalogGeneration++; stopFullRequest(); resetPrepared();
    player.clear(); dock.hidden = true; requests.forEach(controller => controller.abort());
    if (!event.persisted) dispose();
  });
  listen(window, 'pageshow', event => {
    // A page restored from the back/forward cache keeps its listeners. Resume
    // only an interrupted catalog intent, so "load more" cannot stay busy.
    if (event.persisted && pendingCatalog && !disposed) void loadCatalog(pendingCatalog);
  });
  return dispose;
}
