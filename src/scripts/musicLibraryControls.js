import { browseMusic, libraryFilters, libraryLocation } from './musicLibrary.js';
import { musicSelection } from '../music/pagePaths.js';

// Browse state owns no audio, permission or queue state. History only restores the view.
export function mountMusicLibraryControls(root, { t, onChange, getLocal = () => ({}), host = window }) {
  const $ = selector => root.querySelector(selector), abort = new AbortController();
  let tracks = [], catalogTracks = [], collections = [], view = null, count = 50, loaded = false, albumSignature = null;
  let state = { query: '', genres: [], moods: [], access: '', mode: 'latest', ...libraryLocation(host.location.search) };
  const on = (node, event, callback) => node.addEventListener(event, callback, { signal: abort.signal });
  const render = () => {
    const candidates = state.collection && view?.selectedCollection?.slug === state.collection ? view.selectedCollection.tracks
      : ['favorites', 'recent'].includes(state.mode) ? tracks : catalogTracks;
    const results = browseMusic(candidates, collections, state, getLocal());
    const selected = collections.find(item => item.slug === state.collection);
    const albums = state.mode === 'albums' && !state.collection;
    const albumItems = collections.filter(item => item.type === 'album');
    $('[data-album-list]').hidden = !albums;
    // Favorites/recent playback refresh the library too. Retain cards, focus and
    // cover elements while the published album data stays unchanged.
    const signature = JSON.stringify(albumItems);
    if (albums && signature !== albumSignature) {
      albumSignature = signature; $('[data-album-list]').replaceChildren();
      for (const item of albumItems) {
      const li = document.createElement('li'), button = document.createElement('button'), title = document.createElement('strong'), info = document.createElement('span');
      button.type = 'button'; title.textContent = item.title;
      info.textContent = t('{count} 首', { count: item.trackIds.length }) + ' · ' + t(item.listeningMode === 'vip' ? 'VIP 专享' : item.listeningMode === 'free' ? '整张免费' : '按单曲收听');
      if (item.coverUrl) { const cover = document.createElement('img'); cover.src = item.coverUrl; cover.alt = ''; cover.width = 160; cover.height = 160; cover.loading = 'lazy'; button.append(cover); }
      button.append(title, info); button.onclick = () => change({ collection:item.slug, track:undefined, query:'', genres:[], moods:[], access:'' });
      li.append(button); $('[data-album-list]').append(li);
      }
    }
    $('[data-collection-share-label]').textContent = t(selected?.type === 'album' ? '分享专辑' : '分享歌单');
    $('[data-share-url="collection"]').setAttribute('aria-label', t(selected?.type === 'album' ? '专辑链接' : '歌单链接'));
    $('[data-song-search]').hidden = albums;
    $('[data-filter-panel]').hidden = albums;
    $('[data-play-all]').hidden = albums;
    $('[data-track-list]').hidden = albums;
    $('[data-list-title]').textContent = selected?.title || t(albums ? '专辑' : state.mode === 'favorites' ? '我的收藏' : state.mode === 'recent' ? '最近播放' : '全部歌曲');
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
    const issue = state.track && view?.selection?.track === state.track && view.issues.track
      || state.collection && view?.selection?.collection === state.collection && view.issues.collection;
    const notice = loaded && issue ? t(issue === 'missing' ? '分享的歌曲或歌单已不可用。' : '暂时无法读取这首歌曲或歌单，请重新加载。')
      : loaded && missing ? t('正在读取指定歌曲或歌单…') : loaded && unavailable ? t('有 {count} 首记录不在当前目录中，仍已保留。', { count: unavailable }) : '';
    $('[data-library-notice]').textContent = notice; $('[data-library-notice]').hidden = !notice;
    onChange({ results, shown: results.slice(0, count), trackId: state.track, collectionSlug: state.collection, loaded, mode: state.mode, albumOverview:albums, albumCount:albums ? albumItems.length : 0 });
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
  on($('[data-collection-filter]'), 'change', event => change({ collection: event.target.value, mode:collections.find(item => item.slug === event.target.value)?.type === 'album' ? 'albums' : 'latest' }));
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
    target: () => ({ ...(state.track ? { track: state.track } : {}), ...(state.collection ? { collection: state.collection } : {}) }),
    select(id) { if (state.track !== id) { state = { ...state, track: id }; save(); render(); } },
    update(values, groups, context = null) {
      tracks = values; catalogTracks = context?.catalogTracks || values; collections = groups; view = context; loaded = true;
      const select = $('[data-collection-filter]');
      select.replaceChildren(new Option(t('全部歌曲'), ''), ...collections.map(item => new Option(`${t(item.type === 'album' ? '专辑' : '歌单')} · ${item.title} · ${t('{count} 首', { count: item.trackIds.length })}`, item.slug)));
      const tags = libraryFilters([...catalogTracks, ...(view?.selectedCollection?.tracks || [])]);
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
