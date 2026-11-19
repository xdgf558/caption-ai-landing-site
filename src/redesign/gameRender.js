import { gameCopy, gamePlatformCopy } from './gameCopy.js';
import { gameHostCopy } from './gameHostCopy.js';
import { GAME_PLATFORMS, ECOSYSTEM_PLATFORMS, resolveGameDistribution } from './gamePlatforms.js';
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
    return `<span class="sc-game-pill sc-game-pill-${e(meta.tone)}" data-platform="${e(ch.platform)}">${icon(meta.icon, 15)}<span>${e(channelLabel(ch, pCopy))}</span>${statusText ? `<em class="sc-game-pill-status sc-game-status-${e(ch.status)}">${e(statusText)}</em>` : ''}</span>`;
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

const coverImage = (game, screenshots, copy, className = '') =>
  screenshots?.[0]
    ? `<img class="${className}" src="${e(screenshots[0].url)}" alt="${e(game.title + ' · ' + copy.alt)}" width="${screenshots[0].width || 1280}" height="${screenshots[0].height || 900}" loading="lazy">`
    : `<div class="${className} sc-game-cover-placeholder" aria-hidden="true">${icon('gamepad', 36)}</div>`;

function renderCatalogCard(game, copy, pCopy) {
  const dist = resolveGameDistribution(game);
  const badges = dist.channels.length
    ? `<div class="sc-game-badges">${channelPills(dist.channels, pCopy)}</div>`
    : `<div class="sc-game-devices">${devicePills(game, copy)}</div>`;
  const quickLinks = dist.channels
    .filter(ch => ch.href)
    .map(ch => {
      const meta = platformMeta(ch.platform);
      const c = channelCopyFor(ch, copy, pCopy);
      const btnClass = ch.primary ? 'sc-button sc-button-secondary sc-game-channel-btn-primary' : 'sc-button sc-button-secondary';
      return `<a class="${btnClass}" href="${e(ch.href)}" target="_blank" rel="noopener noreferrer">${icon(meta.icon, 17)}${e(c.shortCta)}</a>`;
    })
    .join('');

  return `<article class="sc-game-card" data-game-slug="${e(game.slug || '')}">
    <a class="sc-game-cover-wrap" href="${e(game.href)}" aria-label="${e(game.title)}">${coverImage(game, dist.screenshots, copy, 'sc-game-cover')}</a>
    <div class="sc-game-card-copy">
      ${badges}
      <h2><a href="${e(game.href)}">${e(game.title)}</a></h2>
      <p>${e(game.summary)}</p>
      <div class="sc-game-card-actions">
        <a class="sc-button" href="${e(game.href)}">${copy.detail}${icon('arrow', 18)}</a>
        ${quickLinks}
      </div>
    </div>
  </article>`;
}

function renderRoadmapShelf(items, copy, pCopy) {
  const activePlatforms = new Set();
  for (const game of items) {
    for (const ch of resolveGameDistribution(game).channels) {
      if (ch.href) activePlatforms.add(ch.platform);
    }
  }
  const chips = ECOSYSTEM_PLATFORMS.map(platform => {
    const meta = platformMeta(platform);
    const active = activePlatforms.has(platform);
    const state = active ? pCopy.statuses.live : pCopy.statuses.coming;
    return `<span class="sc-game-eco-chip${active ? ' is-active' : ''}" data-platform="${e(platform)}">${icon(meta.icon, 16)}<strong>${e(pCopy.platforms[platform] || platform)}</strong><small>${e(state)}</small></span>`;
  }).join('');

  return `<section class="sc-game-roadmap" aria-labelledby="sc-game-roadmap-title">
    <div class="sc-game-roadmap-copy">
      <h2 id="sc-game-roadmap-title">${copy.roadmapTitle}</h2>
      <p>${copy.roadmapIntro}</p>
    </div>
    <div class="sc-game-eco-list" aria-label="${e(copy.ecosystemLabel)}">${chips}</div>
  </section>`;
}

function renderChannelSection(channels, copy, pCopy) {
  const cards = channels.map(ch => {
    const meta = platformMeta(ch.platform);
    const c = channelCopyFor(ch, copy, pCopy);
    const statusText = ch.status && pCopy.statuses[ch.status] ? pCopy.statuses[ch.status] : '';
    const unavailableLabel = ch.status === 'closed' ? copy.closedAction : copy.comingSoonAction;
    const action = ch.href
      ? `<a class="sc-button${ch.primary ? '' : ' sc-button-secondary'}" href="${e(ch.href)}" target="_blank" rel="noopener noreferrer">${e(c.cta)}${icon('external', 16)}</a>`
      : `<span class="sc-game-channel-soon">${e(unavailableLabel)}</span>`;
    return `<article class="sc-game-channel-card sc-game-channel-${e(meta.tone)}${ch.primary ? ' is-primary' : ''}" data-channel-id="${e(ch.id || ch.platform)}">
      <div class="sc-game-channel-head">
        <span class="sc-game-channel-label">${icon(meta.icon, 18)}${e(channelLabel(ch, pCopy))}</span>
        ${statusText ? `<span class="sc-game-status-tag sc-game-status-${e(ch.status)}">${e(statusText)}</span>` : ''}
      </div>
      <h3>${e(c.title)}</h3>
      ${c.intro ? `<p class="sc-game-channel-intro">${e(c.intro)}</p>` : ''}
      <div class="sc-game-channel-action">${action}</div>
      ${c.steps ? `<p class="sc-game-channel-steps">${e(c.steps)}</p>` : ''}
    </article>`;
  }).join('');

  return `<section class="sc-game-channels" aria-labelledby="sc-game-channels-title">
    <div class="sc-game-channels-head">
      <h2 id="sc-game-channels-title">${copy.platformsTitle}</h2>
      <p>${copy.platformsIntro}</p>
    </div>
    <div class="sc-game-channel-grid">${cards}</div>
  </section>`;
}

export function renderGamePage(model) {
  const copy = gameCopy[model.locale] || gameCopy['zh-Hant'];
  const pCopy = gamePlatformCopy[model.locale] || gamePlatformCopy['zh-Hant'];
  const back = stationHref(model.locale, 'games');
  const top = `<header class="sc-game-heading"><p class="sc-game-kicker">${copy.kicker}</p><h1 class="sc-heading">${e(model.game?.title || copy.title)}</h1><p>${e(model.game?.summary || copy.intro)}</p></header>`;

  if (model.error) {
    return `<section class="sc-game-page sc-container">${top}<div class="sc-game-empty"><h2>${copy.failed}</h2><a class="sc-button" href="${back}">${copy.retry}</a></div></section>`;
  }

  if (model.mode === 'catalog') {
    const items = model.items || [];
    const singleClass = items.length === 1 ? ' sc-game-grid-single' : '';
    const countBadge = items.length ? `<span class="sc-game-count">${e(copy.count(items.length))}</span>` : '';
    return `<section class="sc-game-page sc-container">
      ${top}
      <div class="sc-game-section-bar">
        <h2 class="sc-game-section-title">${copy.featured}</h2>
        ${countBadge}
      </div>
      <div class="sc-game-grid${singleClass}">
        ${items.map(game => renderCatalogCard(game, copy, pCopy)).join('') || `<p class="sc-game-empty">${copy.empty}</p>`}
      </div>
      ${model.nextCursor ? `<a class="sc-button sc-button-secondary sc-game-more" href="${back}?cursor=${encodeURIComponent(model.nextCursor)}">${copy.next}</a>` : ''}
      ${renderRoadmapShelf(items, copy, pCopy)}
    </section>`;
  }

  const game = model.game;
  const dist = resolveGameDistribution(game);
  const hostCopy = gameHostCopy[model.locale] || gameHostCopy['zh-Hant'];
  const heroBadges = dist.channels.length
    ? `<div class="sc-game-badges sc-game-hero-badges">${channelPills(dist.channels, pCopy)}</div>`
    : '';
  const detailHeader = `<header class="sc-game-heading sc-game-detail-heading"><p class="sc-game-kicker">${copy.kicker}</p><h1 class="sc-heading">${e(game.title)}</h1><p>${e(game.summary)}</p>${heroBadges}</header>`;
  const channelsSection = dist.channels.length ? renderChannelSection(dist.channels, copy, pCopy) : '';

  const gallery = `<div class="sc-game-gallery">
    <h2>${copy.screen}</h2>
    <div class="sc-game-gallery-grid${dist.screenshots.length > 1 ? ' has-multi' : ''}">
      ${dist.screenshots.map((shot, index) => `<a class="sc-game-shot${index === 0 ? ' is-lead' : ''}" href="${e(shot.url)}" target="_blank" rel="noopener" aria-label="${e(copy.screen + ' ' + (index + 1))}"><img src="${e(shot.url)}" alt="${e(game.title + ' · ' + copy.alt + ' ' + (index + 1))}" width="${shot.width || 1280}" height="${shot.height || 900}" loading="${index ? 'lazy' : 'eager'}"></a>`).join('') || `<p class="sc-game-empty">${copy.screenPending}</p>`}
    </div>
  </div>`;

  const sidebar = dist.webRetired
    ? `<aside class="sc-game-save sc-game-info" aria-labelledby="sc-game-info-title">
        <span class="sc-game-save-icon">${icon('gamepad', 22)}</span>
        <h2 id="sc-game-info-title">${copy.releaseInfo}</h2>
        <dl class="sc-game-meta-list">
          <div><dt>${copy.availableOn}</dt><dd class="sc-game-badges">${channelPills(dist.channels, pCopy)}</dd></div>
          <div><dt>${copy.languagesLabel}</dt><dd>${copy.languageNative}</dd></div>
        </dl>
        <div class="sc-game-retired-note">
          <strong>${copy.webRetiredLabel}</strong>
          <p>${copy.webRetiredNote}</p>
        </div>
        <a class="sc-game-member" href="${stationHref(model.locale, 'member')}" data-astro-reload>${copy.member}</a>
      </aside>`
    : `<aside class="sc-game-save">
        <span class="sc-game-save-icon">${icon('shield', 22)}</span>
        <h2>${copy.save}</h2>
        <p>${copy.saveNote}</p>
        ${dist.supportsBrowserLaunch ? `<div class="sc-game-check" data-sc-game-entry><p data-sc-game-status role="status">${copy.checking}</p><a class="sc-button" data-sc-game-launch hidden></a><button class="sc-button sc-button-secondary" type="button" data-sc-game-retry>${copy.retry}</button><section data-sc-game-feedback hidden><p data-sc-game-host-error role="status"></p><button type="button" class="sc-button sc-button-secondary" data-sc-game-host-retry>${hostCopy.retry}</button></section><noscript><p>${copy.saveNote}</p><a href="/games/cat-life/?sc_entry=1">${copy.enter}</a></noscript></div>` : `<p>${copy.unavailableLaunch}</p>`}
        <a class="sc-game-member" href="${stationHref(model.locale, 'member')}" data-astro-reload>${copy.member}</a>
        <details><summary>${copy.moreSave}</summary><p>${copy.otherSave}</p></details>
      </aside>`;

  const deviceNote = dist.webRetired
    ? ''
    : `<section class="sc-game-device-note"><h2>${copy.devices}</h2><div class="sc-game-devices">${devicePills(game, copy)}</div><p>${copy.deviceNote}</p>${dist.supportsBrowserLaunch ? `<p>${copy.language}</p>` : ''}</section>`;

  return `<section class="sc-game-page sc-container">
    <a class="sc-game-back" href="${back}">${icon('arrow', 18)}${copy.back}</a>
    ${detailHeader}
    ${channelsSection}
    <div class="sc-game-detail">${gallery}${sidebar}</div>
    ${deviceNote}
  </section>`;
}
