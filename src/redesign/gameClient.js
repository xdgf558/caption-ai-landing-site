import '../../public/games/cat-life/src/js/state/saveStatus.js';
import { gameCopy } from './gameCopy.js';
export function mountGameEntry({ document = window.document, probe = window.CatGameSaveStatus, storage = () => window.localStorage, fetcher = window.fetch.bind(window) } = {}) {
  const root = document.querySelector('[data-sc-game-entry]');
  if (!root) return () => {};
  const locale = document.documentElement.lang, copy = gameCopy[locale] || gameCopy['zh-Hant'];
  const status = root.querySelector('[data-sc-game-status]'), launch = root.querySelector('[data-sc-game-launch]'), retry = root.querySelector('[data-sc-game-retry]');
  let revision = 0, disposed = false;
  async function check() {
    const current = ++revision; launch.hidden = true; launch.removeAttribute('href'); retry.disabled = true; status.textContent = copy.checking;
    let identity, slot;
    try {
      const account = await probe.session(fetcher);
      if (disposed || current !== revision) return;
      identity = account;
      try { identity = probe.select(storage(), account); slot = probe.inspect(storage(), identity.key); }
      catch { slot = { status: 'unavailable' }; }
    } catch { slot = { status: 'identity' }; }
    if (disposed || current !== revision) return;
    status.textContent = slot.status === 'missing' && identity.member ? copy.memberMissing : copy[slot.status];
    root.dataset.saveStatus = slot.status; retry.disabled = false;
    if (identity && ['valid', 'missing', 'corrupt', 'unsupported', 'unavailable'].includes(slot.status)) {
      launch.textContent = slot.status === 'valid' ? copy.continue : slot.status === 'missing' ? identity.member ? copy.enter : copy.start : copy.recover;
      launch.href = '/games/cat-life/?sc_entry=1&lang=' + encodeURIComponent(locale === 'zh-Hans' ? 'zh-CN' : locale);
      launch.hidden = false;
    }
  }
  const recheck = () => { check(); };
  retry.addEventListener('click', recheck);
  window.addEventListener('storage', recheck); window.addEventListener('focus', recheck);
  check();
  return () => { disposed = true; ++revision; retry.removeEventListener('click', recheck); window.removeEventListener('storage', recheck); window.removeEventListener('focus', recheck); };
}
