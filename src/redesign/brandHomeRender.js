import { escapeMusicHtml as e, musicIcon, musicBootstrap } from './musicRender.js';
import { homeCopy } from './home-copy.js';
import { homeStateCopy } from './home-state-copy.js';
import { providerName } from './musicCopy.js';
import { renderPlatformBackup } from './platformRender.js';
import { stationHref } from './routes.js';
import { stationHomeClipModel } from './clipView.js';

// Input is exclusively T07's live, rights-checked public home projection.
export function renderBrandHomeSlots(home, clipModels = []) {
  const lang = home.locale, state = homeStateCopy[lang], copy = homeCopy[lang];
  const music = home.music, game = home.game, model = stationHomeClipModel(home, clipModels);
  const more = (section, text) => `<a class="sc-button sc-button-secondary" href="${stationHref(lang, section)}">${e(text)}${musicIcon('arrow')}</a>`;
  const empty = (kind, title, text, section, action) => `<div class="home-empty" data-home-empty="${kind}"><h3>${e(title)}</h3><p>${e(text)}</p>${more(section, action)}</div>`;
  return {
    music: music ? `<div class="gentle-feature-body home-feature-body${music.preview ? ' has-preview' : ''}" data-home-track="${e(music.id)}">
      <a class="home-cover-link" href="${e(music.href)}" aria-label="${e(state.details + ' · ' + music.title)}"><img class="gentle-cover" src="${e(music.coverUrl)}" width="1024" height="1024" alt="${e(music.title)}"></a>
      <div class="gentle-work-copy"><span class="gentle-badge">${e(state.featured)}</span><h3><a href="${e(music.href)}">${e(music.title)}</a></h3><p class="home-artist">${e(state.artist + ' · ' + music.artist)}</p><p>${e(music.summary)}</p>
      ${music.preview ? `<a class="sc-icon-button gentle-play" href="${e(music.preview.href)}" aria-label="${e(state.preview + ' · ' + music.title + ' · ' + music.preview.durationSec + 's')}">${musicIcon('play')}</a>` : ''}</div>
      <div class="gentle-platforms home-platforms" id="station-platforms" aria-label="${e(copy.platforms)}">${music.platforms.length ? music.platforms.map(link => `<a href="${e(link.href)}" target="_blank" rel="noopener noreferrer" data-home-platform="${e(link.id)}" data-sc-platform-link data-track-id="${e(music.id)}" data-link-id="${e(link.id)}" data-provider="${e(link.provider)}">${musicIcon(link.provider === 'qishui' ? 'headphones' : 'music')}<span>${e(providerName(link.provider, lang))}</span></a>`).join('') : `<p class="home-platform-empty">${e(state.noPlatforms)}</p>`}${renderPlatformBackup(music, lang)}</div></div>` : empty('music', state.musicEmpty, state.musicEmptyText, 'music', copy.moreMusic),
    game: game ? `<div class="gentle-feature-body home-game-body" data-home-game="${e(game.id)}"><a class="home-cover-link" href="${e(game.href)}" aria-label="${e(copy.viewGame + ' · ' + game.title)}"><img class="gentle-cover" src="${e(game.screenshotUrl)}" width="1254" height="1254" alt="${e(game.title)}"></a><div class="gentle-work-copy"><span class="gentle-badge">${e(state.gameFeatured)}</span><h3><a href="${e(game.href)}">${e(game.title)}</a></h3><p>${e(game.summary)}</p></div><div class="gentle-game-actions"><a class="sc-button" href="${e(game.href)}">${e(copy.viewGame)}${musicIcon('arrow')}</a></div></div>` : empty('game', state.gameEmpty, state.gameEmptyText, 'games', copy.moreGames),
    selected: home.selectedTracks.length ? `<section class="home-selected" aria-labelledby="station-selected-title"><h2 id="station-selected-title">${e(state.selected)}</h2><div class="home-selected-grid">${home.selectedTracks.map(track => `<a class="home-selected-item" href="${e(track.href)}" data-selected-track="${e(track.id)}"><img src="${e(track.coverUrl)}" width="72" height="72" alt="" loading="lazy"><span><strong>${e(track.title)}</strong><small>${e(track.artist)}</small></span>${musicIcon('arrow')}</a>`).join('')}</div></section>` : '',
    clips: home.clips.length ? `<section class="home-clips" data-sc-home-clips id="station-clips" aria-labelledby="station-clips-title"><div class="gentle-section-header"><h2 id="station-clips-title">${e(state.clips)}</h2><p>${e(state.clipsText)}</p></div><div class="home-clip-grid">${home.clips.map(clip => `<a class="home-clip-card" href="${e(clip.href)}" data-home-clip="${e(clip.id)}"${model.clips.some(item => item.id === clip.id) ? ` data-sc-clip="${e(clip.id)}"` : ''}><img src="${e(clip.posterUrl)}" width="1024" height="1024" alt="" loading="lazy"><span class="home-clip-duration">${Math.ceil(clip.durationSec)}s</span><strong>${e(clip.title)}</strong><span class="home-clip-action">${musicIcon('play')}${e(state.watch)}</span></a>`).join('')}</div></section>` : '',
    bootstrap: musicBootstrap({ home: { locale: lang, music, clips: home.clips }, clips: model.clips }),
  };
}
