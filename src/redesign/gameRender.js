import { gameCopy, gamePlatformCopy, gameFeatureCopy } from './gameCopy.js';
import { gameHostCopy } from './gameHostCopy.js';
import { GAME_PLATFORMS, ECOSYSTEM_PLATFORMS, GAMES_HUB_ART, resolveGameDistribution } from './gamePlatforms.js';
import { stationHref } from './routes.js';
import { escapeMusicHtml as e } from './musicRender.js';

const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" aria-hidden="true"><use href="#sc-game-${name}"></use></svg>`;

const platformMeta = platform => GAME_PLATFORMS[platform] || { icon: 'gamepad', tone: 'default' };

const devicePills = (game, copy) =>
  (game.supportedDevices || [])
    .map(device => `<span>${['desktop', 'mobile'].includes(device) ? icon(device, 16) : ''}${e(copy[device] || device)}</span>`)
    .join('');

function channelLabel(channel, pCopy) {
  const name = pCopy.platforms[channel.platform] || channel.platform;
  return channel.channel ? `${name} · ${channel.channel}` : name;
}

function channelPills(channels, pCopy) {
  return channels.map(ch => {
    const meta = platformMeta(ch.platform);
    const statusText = ch.status && pCopy.statuses[ch.status] ? pCopy.statuses[ch.status] : '';
    return `<span class="sc-game-pill sc-game-pill-${e(meta.tone)}${ch.href ? ' is-open' : ''}" data-platform="${e(ch.platform)}">${icon(meta.icon, 15)}<span>${e(channelLabel(ch, pCopy))}</span>${statusText ? `<em class="sc-game-pill-status sc-game-status-${e(ch.status)}">${e(statusText)}</em>` : ''}</span>`;
  }).join('');
}

function channelCopyFor(ch, copy, pCopy) {
  const preset = ch.copyKey && pCopy.channels[ch.copyKey];
  const name = pCopy.platforms[ch.platform] || ch.platform;
  return {
    title: preset?.title || ch.title || name,
    intro: preset?.intro || ch.intro || '',
    cta: preset?.cta || ch.cta || `${copy.openChannel} ${name}`,
    shortCta: preset?.shortCta || ch.shortCta || name,
    steps: preset?.steps || ch.steps || '',
  };
}

function artImage(art, alt, { className = '', eager = false, sizes = '(max-width: 900px) 100vw, 50vw' } = {}) {
  if (!art) return `<div class="${className} sc-game-art-placeholder" aria-hidden="true">${icon('gamepad', 40)}</div>`;
  const srcset = art.small ? ` srcset="${e(art.small)} 720w, ${e(art.url)} ${art.width}w" sizes="${sizes}"` : '';
  return `<img class="${className}" src="${e(art.url)}"${srcset} alt="${e(alt)}" width="${art.width}" height="${art.height}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

function featureChips(features, locale) {
  const fCopy = gameFeatureCopy[locale] || gameFeatureCopy['zh-Hant'];
  if (!features.length) return '';
  return `<ul class="sc-game-chips">${features.map(f => fCopy[f.key] ? `<li><span class="sc-game-chip-art"><img src="${e(f.image)}" alt="" width="${f.width}" height="${f.height}" loading="lazy" decoding="async"></span>${e(fCopy[f.key].title)}</li>` : '').join('')}</ul>`;
}

function primaryAction(channels, copy, pCopy, className = 'sc-button') {
  const open = channels.find(ch => ch.href);
  if (!open) return '';
  const c = channelCopyFor(open, copy, pCopy);
  return `<a class="${className}" href="${e(open.href)}" target="_blank" rel="noopener noreferrer">${icon(platformMeta(open.platform).icon, 18)}${e(c.cta)}</a>`;
}

/* ---------- Catalog ---------- */

function renderSpotlight(game, copy, pCopy, locale) {
  const dist = resolveGameDistribution(game);
  const badges = dist.channels.length
    ? `<div class="sc-game-badges">${channelPills(dist.channels, pCopy)}</div>`
    : `<div class="sc-game-devices">${devicePills(game, copy)}</div>`;
  return `<article class="sc-game-spotlight" data-game-slug="${e(game.slug || '')}">
    <a class="sc-game-spotlight-art" href="${e(game.href)}" tabindex="-1" aria-hidden="true">${artImage(dist.keyArt, game.title + ' · ' + copy.artAlt, { eager: true })}</a>
    <div class="sc-game-spotlight-body">
      ${badges}
      <h2><a href="${e(game.href)}">${e(game.title)}</a></h2>
      <p class="sc-game-lede">${e(game.summary)}</p>
      ${featureChips(dist.features, locale)}
      <div class="sc-game-actions">
        <a class="sc-button" href="${e(game.href)}">${copy.detail}${icon('arrow', 18)}</a>
        ${primaryAction(dist.channels, copy, pCopy, 'sc-button sc-button-secondary')}
      </div>
    </div>
  </article>`;
}

function renderCard(game, copy, pCopy) {
  const dist = resolveGameDistribution(game);
  const badges = dist.channels.length
    ? `<div class="sc-game-badges">${channelPills(dist.channels, pCopy)}</div>`
    : `<div class="sc-game-devices">${devicePills(game, copy)}</div>`;
  return `<article class="sc-game-card" data-game-slug="${e(game.slug || '')}">
    <a class="sc-game-card-art" href="${e(game.href)}" tabindex="-1" aria-hidden="true">${artImage(dist.keyArt, game.title + ' · ' + copy.artAlt, { sizes: '(max-width: 900px) 100vw, 33vw' })}</a>
    <div class="sc-game-card-body">
      ${badges}
      <h3><a href="${e(game.href)}">${e(game.title)}</a></h3>
      <p>${e(game.summary)}</p>
      <a class="sc-game-text-link" href="${e(game.href)}">${copy.detail}${icon('arrow', 16)}</a>
    </div>
  </article>`;
}

function renderRoadmap(items, copy, pCopy) {
  const activePlatforms = new Set();
  for (const game of items) for (const ch of resolveGameDistribution(game).channels) if (ch.href) activePlatforms.add(ch.platform);
  const chips = ECOSYSTEM_PLATFORMS.map(platform => {
    const meta = platformMeta(platform);
    const active = activePlatforms.has(platform);
    return `<li class="sc-game-eco${active ? ' is-active' : ''}" data-platform="${e(platform)}"><span class="sc-game-eco-icon">${icon(meta.icon, 20)}</span><strong>${e(pCopy.platforms[platform] || platform)}</strong><small>${e(active ? pCopy.statuses.live : pCopy.statuses.coming)}</small></li>`;
  }).join('');
  const art = GAMES_HUB_ART.panorama;
  return `<section class="sc-game-roadmap" aria-labelledby="sc-game-roadmap-title">
    <div class="sc-game-roadmap-copy">
      <h2 id="sc-game-roadmap-title">${copy.roadmapTitle}</h2>
      <p>${copy.roadmapIntro}</p>
    </div>
    <ul class="sc-game-eco-list" aria-label="${e(copy.ecosystemLabel)}">${chips}</ul>
    <img class="sc-game-roadmap-art" src="${e(art.url)}" alt="" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">
  </section>`;
}

function renderCatalog(model, copy, pCopy) {
  const back = stationHref(model.locale, 'games');
  const items = model.items || [];
  const [featured, ...rest] = items;
  return `<section class="sc-game-page sc-games-hub sc-container">
    <header class="sc-game-heading sc-games-hub-head">
      <div>
        <p class="sc-game-kicker">${copy.kicker}</p>
        <h1 class="sc-heading">${e(copy.title)}</h1>
        <p>${e(copy.intro)}</p>
      </div>
      ${items.length ? `<span class="sc-game-count">${e(copy.count(items.length))}</span>` : ''}
    </header>
    ${featured ? renderSpotlight(featured, copy, pCopy, model.locale) : `<p class="sc-game-empty">${copy.empty}</p>`}
    ${rest.length ? `<h2 class="sc-game-section-title">${copy.moreTitles}</h2><div class="sc-game-grid">${rest.map(game => renderCard(game, copy, pCopy)).join('')}</div>` : ''}
    ${model.nextCursor ? `<a class="sc-button sc-button-secondary sc-game-more" href="${back}?cursor=${encodeURIComponent(model.nextCursor)}">${copy.next}</a>` : ''}
    ${renderRoadmap(items, copy, pCopy)}
  </section>`;
}

/* ---------- Detail ---------- */

function renderFeatures(features, copy, locale) {
  const fCopy = gameFeatureCopy[locale] || gameFeatureCopy['zh-Hant'];
  const cards = features.filter(f => fCopy[f.key]).map(f => `<article class="sc-game-feature" data-feature="${e(f.key)}">
      <div class="sc-game-feature-art"><img src="${e(f.image)}" alt="" width="${f.width}" height="${f.height}" loading="lazy" decoding="async"></div>
      <h3>${e(fCopy[f.key].title)}</h3>
      <p>${e(fCopy[f.key].text)}</p>
    </article>`).join('');
  if (!cards) return '';
  return `<section class="sc-game-features" aria-labelledby="sc-game-features-title">
    <header class="sc-game-section-head"><p class="sc-game-kicker">${copy.featuresKicker}</p><h2 id="sc-game-features-title">${copy.featuresTitle}</h2></header>
    <div class="sc-game-feature-grid">${cards}</div>
  </section>`;
}

function renderChannels(channels, copy, pCopy) {
  const cards = channels.map(ch => {
    const meta = platformMeta(ch.platform);
    const c = channelCopyFor(ch, copy, pCopy);
    const statusText = ch.status && pCopy.statuses[ch.status] ? pCopy.statuses[ch.status] : '';
    const unavailable = ch.status === 'closed' ? copy.closedAction : copy.comingSoonAction;
    const action = ch.href
      ? `<a class="sc-button${ch.primary ? '' : ' sc-button-secondary'}" href="${e(ch.href)}" target="_blank" rel="noopener noreferrer">${e(c.cta)}${icon('external', 16)}</a>`
      : `<span class="sc-game-channel-soon">${e(unavailable)}</span>`;
    return `<article class="sc-game-channel sc-game-channel-${e(meta.tone)}${ch.href ? ' is-open' : ' is-closed'}" data-channel-id="${e(ch.id || ch.platform)}">
      <span class="sc-game-channel-icon">${icon(meta.icon, 26)}</span>
      <div class="sc-game-channel-body">
        <div class="sc-game-channel-head">
          <span class="sc-game-channel-label">${e(channelLabel(ch, pCopy))}</span>
          ${statusText ? `<span class="sc-game-status-tag sc-game-status-${e(ch.status)}">${e(statusText)}</span>` : ''}
        </div>
        <h3>${e(c.title)}</h3>
        ${c.intro ? `<p>${e(c.intro)}</p>` : ''}
        <div class="sc-game-channel-action">${action}</div>
        ${c.steps ? `<p class="sc-game-channel-steps">${e(c.steps)}</p>` : ''}
      </div>
    </article>`;
  }).join('');
  return `<section class="sc-game-channels" id="sc-game-channels" aria-labelledby="sc-game-channels-title">
    <header class="sc-game-section-head"><h2 id="sc-game-channels-title">${copy.platformsTitle}</h2><p>${copy.platformsIntro}</p></header>
    <div class="sc-game-channel-grid">${cards}</div>
  </section>`;
}

function renderFacts(channels, copy, pCopy, locale) {
  const platforms = channels.map(ch => `<span>${e(pCopy.platforms[ch.platform] || ch.platform)}<small>${e(pCopy.statuses[ch.status] || '')}</small></span>`).join('');
  return `<section class="sc-game-facts" aria-labelledby="sc-game-facts-title">
    <h2 id="sc-game-facts-title">${copy.factsTitle}</h2>
    <dl>
      <div><dt>${copy.availableOn}</dt><dd class="sc-game-fact-platforms">${platforms}</dd></div>
      <div><dt>${copy.languagesLabel}</dt><dd>${copy.languageNative}</dd></div>
      <div><dt>${copy.webRetiredLabel}</dt><dd>${copy.webRetiredNote} <a class="sc-game-member" href="${stationHref(locale, 'member')}" data-astro-reload>${copy.member}${icon('arrow', 14)}</a></dd></div>
    </dl>
  </section>`;
}

function renderClosing(dist, copy, pCopy) {
  const action = primaryAction(dist.channels, copy, pCopy);
  if (!action) return '';
  const art = dist.panorama;
  return `<section class="sc-game-closing">
    <div class="sc-game-closing-copy"><h2>${copy.closingTitle}</h2><p>${copy.closingText}</p>${action}</div>
    ${art ? `<img class="sc-game-closing-art" src="${e(art.url)}" alt="" width="${art.width}" height="${art.height}" loading="lazy" decoding="async">` : ''}
  </section>`;
}

function renderLegacyDetail(game, dist, copy, locale) {
  const hostCopy = gameHostCopy[locale] || gameHostCopy['zh-Hant'];
  const gallery = `<div class="sc-game-gallery">
    <h2>${copy.screen}</h2>
    <div class="sc-game-gallery-grid${dist.screenshots.length > 1 ? ' has-multi' : ''}">
      ${dist.screenshots.map((shot, index) => `<a class="sc-game-shot" href="${e(shot.url)}" target="_blank" rel="noopener" aria-label="${e(copy.screen + ' ' + (index + 1))}"><img src="${e(shot.url)}" alt="${e(game.title + ' · ' + copy.alt + ' ' + (index + 1))}" width="${shot.width || 1280}" height="${shot.height || 900}" loading="${index ? 'lazy' : 'eager'}"></a>`).join('') || `<p class="sc-game-empty">${copy.screenPending}</p>`}
    </div>
  </div>`;
  const aside = `<aside class="sc-game-save">
    <span class="sc-game-save-icon">${icon('shield', 22)}</span>
    <h2>${copy.save}</h2>
    <p>${copy.saveNote}</p>
    ${dist.supportsBrowserLaunch ? `<div class="sc-game-check" data-sc-game-entry><p data-sc-game-status role="status">${copy.checking}</p><a class="sc-button" data-sc-game-launch hidden></a><button class="sc-button sc-button-secondary" type="button" data-sc-game-retry>${copy.retry}</button><section data-sc-game-feedback hidden><p data-sc-game-host-error role="status"></p><button type="button" class="sc-button sc-button-secondary" data-sc-game-host-retry>${hostCopy.retry}</button></section><noscript><p>${copy.saveNote}</p><a href="/games/cat-life/?sc_entry=1">${copy.enter}</a></noscript></div>` : `<p>${copy.unavailableLaunch}</p>`}
    <a class="sc-game-member" href="${stationHref(locale, 'member')}" data-astro-reload>${copy.member}</a>
    <details><summary>${copy.moreSave}</summary><p>${copy.otherSave}</p></details>
  </aside>`;
  return `<div class="sc-game-detail">${gallery}${aside}</div>
    <section class="sc-game-device-note"><h2>${copy.devices}</h2><div class="sc-game-devices">${devicePills(game, copy)}</div><p>${copy.deviceNote}</p>${dist.supportsBrowserLaunch ? `<p>${copy.language}</p>` : ''}</section>`;
}

function renderDetail(model, copy, pCopy) {
  const game = model.game;
  const dist = resolveGameDistribution(game);
  const back = stationHref(model.locale, 'games');
  const badges = dist.channels.length ? `<div class="sc-game-badges">${channelPills(dist.channels, pCopy)}</div>` : '';
  const heroActions = dist.channels.length
    ? `<div class="sc-game-actions">${primaryAction(dist.channels, copy, pCopy)}<a class="sc-button sc-button-secondary" href="#sc-game-channels">${copy.allPlatforms}</a></div>`
    : '';
  const hero = `<header class="sc-game-hero">
    <div class="sc-game-hero-body">
      <p class="sc-game-kicker">${copy.kicker}</p>
      <h1 class="sc-heading">${e(game.title)}</h1>
      <p class="sc-game-lede">${e(game.summary)}</p>
      ${badges}
      ${heroActions}
    </div>
    <div class="sc-game-hero-art">${artImage(dist.keyArt, game.title + ' · ' + copy.artAlt, { eager: true })}</div>
  </header>`;

  const body = dist.webRetired
    ? `${renderFeatures(dist.features, copy, model.locale)}
       ${dist.channels.length ? renderChannels(dist.channels, copy, pCopy) : ''}
       ${renderFacts(dist.channels, copy, pCopy, model.locale)}
       ${renderClosing(dist, copy, pCopy)}`
    : `${dist.channels.length ? renderChannels(dist.channels, copy, pCopy) : ''}${renderLegacyDetail(game, dist, copy, model.locale)}`;

  return `<section class="sc-game-page sc-game-detail-page sc-container">
    <a class="sc-game-back" href="${back}">${icon('arrow', 18)}${copy.back}</a>
    ${hero}
    ${body}
  </section>`;
}

export function renderGamePage(model) {
  const copy = gameCopy[model.locale] || gameCopy['zh-Hant'];
  const pCopy = gamePlatformCopy[model.locale] || gamePlatformCopy['zh-Hant'];
  if (model.error) {
    const back = stationHref(model.locale, 'games');
    return `<section class="sc-game-page sc-container"><header class="sc-game-heading"><p class="sc-game-kicker">${copy.kicker}</p><h1 class="sc-heading">${e(model.game?.title || copy.title)}</h1><p>${e(model.game?.summary || copy.intro)}</p></header><div class="sc-game-empty"><h2>${copy.failed}</h2><a class="sc-button" href="${back}">${copy.retry}</a></div></section>`;
  }
  return model.mode === 'catalog' ? renderCatalog(model, copy, pCopy) : renderDetail(model, copy, pCopy);
}
