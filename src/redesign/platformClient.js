import { uuid, platformUrl } from './publicValidation.js';
import { musicCopy } from './musicCopy.js';

// T18 can supply an observer. Neither synchronous failures nor an unresolved
// or rejected promise owns navigation. No private URL or identity is observed.
export function observeStationPlatform(observer, payload) {
  if (!uuid(payload?.trackId) || !uuid(payload.linkId) || !['netease', 'qishui', 'apple_music', 'youtube', 'spotify'].includes(payload.provider)) return;
  try { Promise.resolve(observer?.({ trackId: payload.trackId, linkId: payload.linkId, provider: payload.provider })).catch(() => {}); } catch {}
}
export async function copyStationPlatform(href, provider, navigator = globalThis.navigator) {
  const url = platformUrl(href, provider);
  if (!url) return { status: 'invalid' };
  try { await navigator.clipboard.writeText(url); return { status: 'copied' }; }
  catch { return { status: 'manual' }; }
}
export function mountStationPlatforms(root, locale, { observer, navigator = globalThis.navigator } = {}) {
  if (!root || !musicCopy[locale]) return () => {};
  const handlers = new AbortController(), versions = new WeakMap(), copy = musicCopy[locale];
  let disposed = false;
  root.querySelectorAll('[data-sc-platform-copy]').forEach(button => { button.hidden = false; });
  root.addEventListener('click', event => {
    const anchor = event.target.closest('a[data-sc-platform-link]');
    if (anchor && root.contains(anchor) && platformUrl(anchor.getAttribute('href'), anchor.dataset.provider)) {
      observeStationPlatform(observer, { trackId: anchor.dataset.trackId, linkId: anchor.dataset.linkId, provider: anchor.dataset.provider });
      return; // Native HTTPS anchor; never preventDefault(), await, or redirect.
    }
    const button = event.target.closest('[data-sc-platform-copy]');
    if (!button || !root.contains(button)) return;
    const row = button.closest('[data-sc-platform-row]'), input = row.querySelector('[data-sc-platform-url]'), result = row.querySelector('[data-sc-platform-result]');
    const version = (versions.get(button) || 0) + 1; versions.set(button, version);
    result.hidden = false; result.textContent = copy.platformCopying;
    void copyStationPlatform(input.value, row.dataset.provider, navigator).then(state => {
      if (disposed || !button.isConnected || versions.get(button) !== version) return;
      result.textContent = state.status === 'copied' ? copy.platformCopied : copy.platformManual;
      if (state.status !== 'copied') { input.focus(); input.select(); }
    });
  }, { signal: handlers.signal });
  return () => { disposed = true; handlers.abort(); };
}
