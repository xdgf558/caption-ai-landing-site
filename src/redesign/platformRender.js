import { stationPlatformLinks } from './platformView.js';
import { musicCopy, providerName } from './musicCopy.js';

const e = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Native details and a readonly URL remain usable with no JavaScript or no
// clipboard permission. The optional button enhances manual selection.
export function renderPlatformBackup(track, locale) {
  const links = stationPlatformLinks(track), copy = musicCopy[locale];
  if (!links.length) return '';
  return `<details class="sc-platform-backup" data-sc-platform-backup><summary>${e(copy.platformBackup)}</summary><p>${e(copy.platformHelp)}</p><ul>${links.map(link =>
    `<li data-sc-platform-row data-track-id="${e(track.id)}" data-link-id="${e(link.id)}" data-provider="${link.provider}"><label><span>${e(providerName(link.provider, locale))}</span><input type="text" readonly value="${e(link.href)}" aria-label="${e(providerName(link.provider, locale) + ' · ' + copy.platformUrl)}" data-sc-platform-url></label><button type="button" class="sc-button sc-button-secondary" data-sc-platform-copy hidden>${e(copy.platformCopy)}</button><p data-sc-platform-result role="status" hidden></p></li>`).join('')}</ul></details>`;
}
