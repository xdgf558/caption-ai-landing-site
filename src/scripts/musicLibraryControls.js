import { browseMusic, libraryFilters, libraryLocation } from './musicLibrary.js';
import { musicSelection } from '../music/pagePaths.js';

// Browse state owns no audio, permission or queue state. History only restores the view.
export function mountMusicLibraryControls(root, { t, onChange, getLocal = () => ({}), host = window }) {
  const $ = selector => root.querySelector(selector), abort = new AbortController();
  let tracks = [], collections = [], count = 50, loaded = false;
  let state = { query: '', genres: [], moods: [], access: '', mode: 'latest', ...libraryLocation(host.location.search) };
  const on = (node, event, callback) => node.addEventListener(event, callback, { signal: abort.signal });
  const render = () => {
    const results = browseMusic(tracks, collections, state, getLocal());
    const albums = state.mode === 'albums';
    $('[data-song-search]').hidden = albums;
    $('[data-filter-panel]').hidden = albums;
    $('[data-play-all]').hidden = albums;
    $('[data-track-list]').hidden = albums;
    $('[data-list-title]').textContent = t(albums ? '专辑' : state.mode === 'favorites' ? '我的收藏' : state.mode === 'recent' ? '最近播放' : '全部歌曲');
    $('[data-library-count]').hidden = albums;
    $('[data-show-more]').hidden = results.length <= count;
    $('[data-library-count]').textContent = t('显示 {shown} / {total} 首', { shown: Math.min(count, results.length), total: results.length });
    $('[data-music-search]').value = state.query;
    $('[data-access-filter]').value = state.access;
    $('[data-collection-filter]').value = state.collection || '';
    for (const button of root.querySelectorAll('[data-browse-mode]')) button.setAttribute('aria-pressed', String(button.dataset.browseMode === state.mode));
    for (const input of root.querySelectorAll('[data-tag-group]')) input.checked = state[input.dataset.tagGroup].includes(input.value);
    const description = collections.find(item => item.slug === state.collection)?.description || '';
    $('[data-collection-description]').textContent = description; $('[data-collection-description]').hidden = !description;
    $('[data-picks-help]').hidden = state.mode !== 'picks';
    $('[data-clear-filters]').hidden = !state.query && !state.genres.length && !state.moods.length && !state.access && !state.collection && state.mode === 'latest';
    const filterToggle = $('[data-filter-toggle]');
    if (filterToggle) filterToggle.dataset.active = String(Boolean(state.genres.length || state.moods.length || state.access || state.collection));
    const missing = (state.track && !tracks.some(item => item.id === state.track)) || (state.collection && !collections.some(item => item.slug === state.collection));
    const stored = state.mode === 'favorites' ? getLocal().favorites || [] : state.mode === 'recent' ? getLocal().recent || [] : [];
    const availableIds = new Set(tracks.map(track => track.id));
    const unavailable = stored.filter(id => !availableIds.has(id)).length;
    const notice = loaded && missing ? t('当前目录中未找到此歌曲或歌单。') : loaded && unavailable ? t('有 {count} 首记录不在当前目录中，仍已保留。', { count: unavailable }) : '';
    $('[data-library-notice]').textContent = notice; $('[data-library-notice]').hidden = !notice;
    onChange({ results, shown: results.slice(0, count), trackId: state.track, loaded, mode: state.mode });
  };
  const save = (replace = false) => {
    const params = new URLSearchParams();
    if (state.track) params.set('track', state.track);
    if (state.collection) params.set('collection', state.collection);
    const query = musicSelection(params).toString();
    host.history[replace || host.history.state?.musicPanel ? 'replaceState' : 'pushState']({ ...host.history.state, musicLibrary: { ...state } }, '', host.location.pathname + (query ? `?${query}` : ''));
  };
  const change = (patch, replace = false) => { state = { ...state, ...patch }; count = 50; save(replace); render(); };
  on($('[data-music-search]'), 'input', event => change({ query: event.target.value.slice(0, 200) }, true));
  on($('[data-access-filter]'), 'change', event => change({ access: event.target.value }));
  on($('[data-collection-filter]'), 'change', event => change({ collection: event.target.value }));
  for (const button of root.querySelectorAll('[data-browse-mode]')) on(button, 'click', () => change({ mode: button.dataset.browseMode, collection: '' }));
  for (const key of ['genres', 'moods']) on($(key === 'genres' ? '[data-genre-filter]' : '[data-mood-filter]'), 'change', () => change({ [key]: [...root.querySelectorAll(`[data-tag-group="${key}"]:checked`)].map(input => input.value) }));
  on($('[data-clear-filters]'), 'click', () => change({ query: '', genres: [], moods: [], access: '', collection: '', mode: 'latest' }));
  on($('[data-show-more]'), 'click', () => { count = Math.min(500, count + 50); render(); });
  on(host, 'popstate', event => {
    const old = event.state?.musicLibrary || {}, tags = libraryFilters(tracks);
    state = { ...libraryLocation(host.location.search), query: typeof old.query === 'string' ? old.query.slice(0, 200) : '',
      genres: Array.isArray(old.genres) ? tags.genres.filter(tag => old.genres.includes(tag)) : [],
      moods: Array.isArray(old.moods) ? tags.moods.filter(tag => old.moods.includes(tag)) : [],
      access: ['free', 'vip'].includes(old.access) ? old.access : '', mode: ['picks', 'albums', 'favorites', 'recent'].includes(old.mode) ? old.mode : 'latest' };
    count = 50; render();
  });
  save(true);
  return {
    refreshLocal: render,
    selection: () => state.track || null,
    select(id) { if (state.track !== id) { state = { ...state, track: id }; save(); render(); } },
    update(values, groups) {
      tracks = values; collections = groups; loaded = true;
      const select = $('[data-collection-filter]');
      select.replaceChildren(new Option(t('全部歌曲'), ''), ...collections.map(item => new Option(`${item.title} · ${t('{count} 首', { count: item.trackIds.length })}`, item.slug)));
      const tags = libraryFilters(tracks);
      for (const [key, selector] of [['genres', '[data-genre-filter]'], ['moods', '[data-mood-filter]']]) {
        const fieldset = $(selector);
        for (const label of fieldset.querySelectorAll('label')) label.remove();
        for (const tag of tags[key]) {
          const label = document.createElement('label'), input = document.createElement('input');
          input.type = 'checkbox'; input.value = tag; input.dataset.tagGroup = key;
          label.append(input, document.createTextNode(tag)); fieldset.append(label);
        }
        fieldset.hidden = !tags[key].length;
      }
      $('[data-tag-filters]').hidden = !tags.genres.length && !tags.moods.length;
      render();
    }, destroy() { abort.abort(); }
  };
}
