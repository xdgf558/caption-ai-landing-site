import { musicCopy, providerName } from './musicCopy.js';
import { stationHref } from './routes.js';
import { contentBase, uuid, slug, positive, plain, localizedPath } from './publicValidation.js';
import { stationPlatformLinks, stationPlatformNotes } from './platformView.js';
import { renderPlatformBackup } from './platformRender.js';
import { stationClips, clipOriginalLinks } from './clipView.js';

export const escapeMusicHtml = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const musicBootstrap = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,
  c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const e = escapeMusicHtml;
const icons = new Set(['play', 'pause', 'heart', 'arrow', 'music', 'headphones', 'apple', 'youtube', 'spotify', 'search', 'close']);
export const musicIcon = name => icons.has(name) ? `<svg class="sc-music-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><use href="#sc-icon-${name}"></use></svg>` : '';
const imagePath = path => typeof path === 'string' && /^\/api\/station\/content\/assets\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(path);
const songHref = (track, locale) => {
  if (!uuid(track?.id) || !plain(track.title, 200) || !track.title.trim() || !plain(track.artist, 120) || !track.artist.trim()) return null;
  const name = track.slug || track.href?.split('/').at(-2);
  return slug(name) && track.href === localizedPath(locale, 'music/tracks', name) ? track.href : null;
};
export const musicTime = ms => positive(ms) ? String(Math.floor(ms / 60000)).padStart(2, '0') + ':' + String(Math.floor(ms / 1000) % 60).padStart(2, '0') : '';
const dateLabel = (iso, locale) => {
  if (typeof iso !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(iso) || !Number.isFinite(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
};
export function musicCatalogHref(locale, { q = '', sort = 'default', cursor = null } = {}) {
  const query = new URLSearchParams();
  if (plain(q, 100) && q.trim()) query.set('q', q.trim());
  if (sort === 'release') query.set('sort', sort);
  if (typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(cursor)) query.set('cursor', cursor);
  return stationHref(locale, 'music') + (query.size ? '?' + query : '');
}
function cover(track, important = false) {
  return imagePath(track.coverUrl) ? `<img class="sc-song-cover" src="${e(track.coverUrl)}" alt="" width="1024" height="1024" loading="${important ? 'eager' : 'lazy'}"${important ? ' fetchpriority="high"' : ''}>` : '';
}
function favorite(track, copy) {
  return `<button type="button" class="sc-button sc-button-secondary sc-song-favorite" data-sc-favorite="${e(track.id)}" aria-pressed="false" aria-label="${e(copy.favorite + ' · ' + track.title)}">${musicIcon('heart')}<span data-sc-favorite-label>${copy.favorite}</span></button>`;
}
export function musicPlatforms(track, locale) {
  const copy = musicCopy[locale];
  const links = stationPlatformLinks(track), notes = stationPlatformNotes(track.platformAvailability);
  if (!links.length && !notes.length) return `<p class="sc-music-muted sc-platform-pending">${track.platformAvailability?.state === 'removed' ? copy.platformUnavailable : copy.pending}</p>`;
  const glyph = provider => ({ apple_music: 'apple', youtube: 'youtube', spotify: 'spotify', netease: 'music', qishui: 'headphones' }[provider]);
  return `<section class="sc-song-platforms" aria-label="${copy.platforms}"><h2>${links.length ? copy.platforms : copy.platformInfo}</h2><div>${links.map(link =>
    `<a href="${e(link.href)}" target="_blank" rel="noopener noreferrer" class="sc-platform-link" data-sc-platform-link data-track-id="${e(track.id)}" data-link-id="${e(link.id)}" data-provider="${link.provider}" aria-label="${e(copy.visit + ' ' + providerName(link.provider, locale))}">${musicIcon(glyph(link.provider))}<span>${e(providerName(link.provider, locale))}</span>${musicIcon('arrow')}</a>`).join('')}</div>${notes.length ? '<p class="sc-platform-notes">' + notes.map(note => '<span>' + e(providerName(note.provider, locale)) + ' · ' + e(({ planned: copy.platformPlanned, region_unavailable: copy.platformRegion, region_unconfirmed: copy.platformRegionUnknown })[note.status]) + '</span>').join('') + '</p>' : ''}${renderPlatformBackup(track, locale)}</section>`;
}
function previewButton(track, copy, { compact = false } = {}) {
  if (!slug(track.slug) || !positive(track.revision) || !positive(track.preview?.revision) || !positive(track.preview?.durationMs) ||
    track.preview.playbackPath !== contentBase + '/tracks/' + track.slug + '/playback?variant=preview') return '';
  return `<button type="button" class="${compact ? 'sc-icon-button' : 'sc-button'}" data-sc-preview="${e(track.id)}" aria-label="${e(copy.preview + ' · ' + track.title + ' · ' + musicTime(track.preview.durationMs))}">${musicIcon('play')}${compact ? '' : '<span>' + copy.preview + ' ' + musicTime(track.preview.durationMs) + '</span>'}</button>`;
}
export function renderSongCard(track, locale, { brief = false } = {}) {
  const href = songHref(track, locale), copy = musicCopy[locale];
  if (!href) return '';
  const released = dateLabel(track.catalogReleasedAt, locale), duration = musicTime(track.durationMs);
  return `<article class="sc-song-card${!imagePath(track.coverUrl) ? ' sc-song-no-cover' : ''}" data-sc-song="${e(track.id)}">${cover(track)}<div class="sc-song-card-copy"><h3><a href="${e(href)}">${e(track.title)}</a></h3><p class="sc-song-artist">${e(track.artist)}</p>${!brief && plain(track.summary, 500) && track.summary ? '<p class="sc-song-summary">' + e(track.summary) + '</p>' : ''}${duration || released ? '<p class="sc-song-meta">' + [duration, released].filter(Boolean).map(e).join(' · ') + '</p>' : ''}<div class="sc-song-card-actions"><a class="sc-song-detail-link" href="${e(href)}">${copy.detail}${musicIcon('arrow')}</a>${brief ? '' : previewButton(track, copy, { compact: true })}</div></div></article>`;
}
export function renderSongHero(track, locale, { detail = false } = {}) {
  const copy = musicCopy[locale], href = songHref(track, locale);
  if (!href) return '';
  const heading = detail ? 'h1' : 'h2';
  const full = positive(track.revision) && track.fullPlayback?.requiresAccessCheck === true && track.fullPlayback.playbackPath === contentBase + '/tracks/' + track.slug + '/playback?variant=full';
  return `<section class="sc-song-hero${!imagePath(track.coverUrl) ? ' sc-song-no-cover' : ''}" aria-labelledby="sc-song-title">${cover(track, true)}<div class="sc-song-hero-copy"><p class="sc-music-eyebrow">${detail ? 'STATION CAT · MUSIC' : copy.featured}</p><${heading} id="sc-song-title">${detail ? e(track.title) : '<a href="' + e(href) + '">' + e(track.title) + '</a>'}</${heading}><p class="sc-song-artist">${e(track.artist)}${musicTime(track.durationMs) ? ' <span>· ' + musicTime(track.durationMs) + '</span>' : ''}</p>${plain(track.summary, 500) && track.summary ? '<p class="sc-song-intro">' + e(track.summary) + '</p>' : ''}<div class="sc-song-hero-actions" id="preview">${previewButton(track, copy)}${full ? '<button type="button" class="sc-button sc-button-secondary" aria-describedby="sc-full-access-note" data-sc-full-check="' + e(track.id) + '">' + musicIcon('headphones') + '<span>' + copy.full + '</span></button>' : ''}${favorite(track, copy)}</div>${full ? '<p class="sc-music-muted sc-full-access-note" id="sc-full-access-note">' + copy.fullAccessHint + '</p>' : ''}${musicPlatforms(track, locale)}${!detail ? '<a class="sc-song-detail-link" href="' + e(href) + '">' + copy.detail + musicIcon('arrow') + '</a>' : ''}</div></section>`;
}
export function renderCatalogResults(model) {
  const { locale, query, nextCursor, error } = model, copy = musicCopy[locale];
  const items = Array.isArray(model.items) ? model.items : [];
  const notice = error ? `<div class="sc-music-notice" role="alert"><h3>${copy.failed}</h3><a href="${e(musicCatalogHref(locale, query))}" class="sc-button sc-button-secondary" data-sc-page-retry>${copy.retry}</a></div>` :
    !items.length && !nextCursor ? `<div class="sc-music-notice"><h3>${query.q ? copy.empty : copy.preparing}</h3>${query.q ? '<p>' + copy.emptyHelp + '</p><a class="sc-button sc-button-secondary" href="' + stationHref(locale, 'music') + '">' + copy.clear + '</a>' : ''}</div>` : '';
  return `<p class="sc-music-count" aria-live="polite">${copy.shown} ${items.length} ${copy.songs}</p><div class="sc-song-grid">${items.map(track => renderSongCard(track, locale)).join('')}</div>${notice}<div class="sc-music-pagination">${nextCursor ? '<a class="sc-button sc-button-secondary" href="' + e(musicCatalogHref(locale, { ...query, cursor: nextCursor })) + '" data-sc-more>' + copy.more + musicIcon('arrow') + '</a>' : ''}${query.cursor ? '<a href="' + e(musicCatalogHref(locale, { ...query, cursor: null })) + '">' + copy.back + '</a>' : ''}</div>`;
}
function intro(locale) {
  const copy = musicCopy[locale];
  return `<header class="sc-music-intro"><p class="sc-music-eyebrow">STATION CAT · MUSIC</p><h1>${musicIcon('music')}${copy.title}</h1><p>${copy.tagline} <span>${copy.intro}</span></p></header>`;
}
export function renderMusicCatalog(model) {
  const { locale, query } = model, copy = musicCopy[locale];
  const curated = !query.q && !query.cursor && (model.featured || model.selected?.length) ? `<div class="sc-music-curated" data-sc-curated>${model.featured ? renderSongHero(model.featured, locale) : ''}${model.selected?.length ? '<aside class="sc-music-selected"><h2>' + copy.selected + '</h2>' + model.selected.slice(0, 3).map(track => renderSongCard(track, locale, { brief: true })).join('') + '</aside>' : ''}</div>` : '';
  return `<div class="sc-container sc-music-content">${intro(locale)}${curated}<section class="sc-music-catalog" aria-labelledby="sc-all-songs"><div class="sc-music-catalog-header"><h2 id="sc-all-songs">${copy.all}</h2><form method="get" action="${stationHref(locale, 'music')}" class="sc-music-search" data-sc-music-search><label class="sc-search-field">${musicIcon('search')}<span class="sc-sr-only">${copy.search}</span><input type="search" name="q" maxlength="100" value="${e(query.q)}" placeholder="${copy.search}"></label><button class="sc-button sc-button-secondary" type="submit">${copy.searchAction}</button><label class="sc-sort-field"><span class="sc-sr-only">${copy.sort}</span><select name="sort"><option value="default"${query.sort !== 'release' ? ' selected' : ''}>${copy.default}</option><option value="release"${query.sort === 'release' ? ' selected' : ''}>${copy.release}</option></select></label></form></div><div data-sc-catalog-results>${renderCatalogResults(model)}</div></section><p class="sc-music-local-note" data-sc-local-note>${copy.local}</p></div>`;
}
function renderClips(model, locale, type) {
  const copy = musicCopy[locale];
  const items = stationClips(model).filter(clip => clip.type === type);
  if (!items.length) return '';
  return `<section class="sc-music-section"><h2>${type === 'mv' ? copy.mv : copy.short}</h2><div class="sc-clip-grid">${items.map(clip => {
    const original = clipOriginalLinks(clip)[0];
    return `<article class="sc-clip-card" id="clip-${e(clip.id)}"><div class="sc-clip-art"><img src="${e(clip.posterUrl)}" alt="" width="1280" height="720" loading="lazy"><button type="button" class="sc-clip-open" data-sc-clip="${e(clip.id)}" aria-label="${e(copy.clipPlay + ' · ' + clip.title + ' · ' + musicTime(clip.durationMs))}" hidden>${musicIcon('play')}</button></div><div><h3>${e(clip.title)}</h3><p>${musicTime(clip.durationMs)}</p>${original ? '<a href="' + e(original.href) + '" target="_blank" rel="noopener noreferrer">' + copy.watch + musicIcon('arrow') + '</a>' : ''}</div></article>`;
  }).join('')}</div></section>`;
}
export function renderMusicDetail(model) {
  const { locale, track, error } = model, copy = musicCopy[locale];
  if (!track || error) return `<div class="sc-container sc-music-content"><a class="sc-music-back" href="${stationHref(locale, 'music')}">${copy.back}</a><section class="sc-music-notice" role="alert"><h1>${error?.status === 404 ? copy.notFound : copy.failed}</h1>${error?.status !== 404 ? '<a class="sc-button" data-sc-page-retry href="' + e(localizedPath(locale, 'music/tracks', model.detailSlug)) + '">' + copy.retry + '</a>' : ''}</section></div>`;
  return `<div class="sc-container sc-music-content sc-music-detail"><a class="sc-music-back" href="${stationHref(locale, 'music')}">${copy.back}</a>${renderSongHero(track, locale, { detail: true })}<p class="sc-music-local-note" data-sc-local-note>${copy.local}</p>${renderClips(model, locale, 'short_video')}${renderClips(model, locale, 'mv')}${model.clipsError ? '<p class="sc-music-muted">' + copy.clipsFailed + ' <a href="' + e(track.href) + '">' + copy.retry + '</a></p>' : ''}${imagePath(track.lyricsUrl) ? '<section class="sc-music-section sc-lyrics-section"><h2>' + copy.lyrics + '</h2><details data-sc-lyrics="' + e(track.lyricsUrl) + '"><summary>' + copy.readLyrics + '</summary><pre data-sc-lyrics-text></pre><button type="button" class="sc-button sc-button-secondary" data-sc-lyrics-retry hidden>' + copy.retry + '</button></details></section>' : ''}${typeof track.story === 'string' && track.story.trim() ? '<section class="sc-music-section sc-song-story"><h2>' + copy.story + '</h2><p>' + e(track.story) + '</p></section>' : ''}${model.related?.length ? '<section class="sc-music-section"><h2>' + copy.related + '</h2><div class="sc-song-grid">' + model.related.filter(song => song.id !== track.id).slice(0, 3).map(song => renderSongCard(song, locale, { brief: true })).join('') + '</div></section>' : ''}</div>`;
}
export const renderMusicPage = model => model.mode === 'detail' ? renderMusicDetail(model) : renderMusicCatalog(model);
