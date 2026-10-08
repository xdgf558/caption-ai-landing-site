import { createStationGameSession } from './gameSession.js';
import { getStationMusicSession, peekStationMusicSession } from './musicPlayerView.js';
import { gameHostCopy } from './gameHostCopy.js';
export function mountStationGameHost() {
  const entry = document.querySelector('[data-sc-game-entry]'), shell = document.querySelector('[data-station-shell]');
  const dialog = document.querySelector('[data-sc-game-dialog]');
  if (!entry || entry.dataset.hostMounted || !shell || !dialog?.showModal) return () => {};
  entry.dataset.hostMounted = 'true';
  const locale = document.documentElement.lang, copy = gameHostCopy[locale];
  const launch = entry.querySelector('[data-sc-game-launch]'), exit = dialog.querySelector('[data-sc-game-exit]');
  const host = dialog.querySelector('[data-sc-game-host]'), label = dialog.querySelector('[data-sc-game-runtime-status]');
  const feedback = entry.querySelector('[data-sc-game-feedback]'), retry = entry.querySelector('[data-sc-game-host-retry]');
  const handlers = new AbortController(); let disposed = false, focused = false, active = false, restoreFocus = false;
  const listen = (target, type, fn, options = {}) => target.addEventListener(type, fn, { ...options, signal: handlers.signal });
  function focusReturnedEntry() {
    if (!disposed && restoreFocus && !active && !launch.hidden && launch.isConnected) {
      restoreFocus = false; launch.focus();
    }
  }
  function release() {
    shell.dataset.gameRuntime = 'false'; active = false;
    peekStationMusicSession()?.setGameActive(false);
    if (dialog.open) dialog.close();
    if (focused && !disposed) {
      focused = false;
      restoreFocus = true;
      if (launch.isConnected && !launch.hidden) launch.focus(); else document.getElementById('station-main')?.focus();
    }
  }
  const session = createStationGameSession({ origin: location.origin, locale,
    createFrame() {
      const frame = document.createElement('iframe'); frame.title = copy.frame;
      frame.setAttribute('referrerpolicy', 'same-origin'); return frame;
    },
    mount(frame) { host.replaceChildren(frame); },
    pauseMedia() {
      // All pauses/cancellations happen before constructing the game instance.
      window.dispatchEvent(new CustomEvent('station:game-enter'));
      getStationMusicSession(locale)?.setGameActive(true);
      document.querySelectorAll('audio, video').forEach(node => node.pause());
      shell.dataset.gameRuntime = 'true'; active = true; dialog.showModal(); focused = true;
    },
    view(state) {
      dialog.dataset.gameState = state.status; dialog.dataset.launchId = state.launchId || '';
      dialog.dataset.readyAfterMs = state.elapsedMs === null ? '' : String(Math.round(state.elapsedMs));
      label.textContent = ({ loading: copy.loading, stopping: copy.stopping, recovery: copy.recovery })[state.status] || '';
      host.setAttribute('aria-busy', String(state.status === 'loading'));
      exit.disabled = state.status === 'stopping'; retry.disabled = state.status === 'stopping';
      if (['idle', 'error'].includes(state.status)) {
        release();
        feedback.hidden = state.status !== 'error';
        entry.querySelector('[data-sc-game-host-error]').textContent = state.error === 'timeout' ? copy.timeout : copy.failed;
        if (state.status === 'error' && !disposed) { restoreFocus = false; retry.focus(); }
        if (state.status === 'idle' && !disposed) void peekStationMusicSession()?.restore();
      } else feedback.hidden = true;
    }
  });
  listen(entry, 'click', event => {
    if (event.target.closest('[data-sc-game-launch]') !== launch || !launch.href || launch.hidden ||
      event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); session.launch();
  });
  listen(retry, 'click', () => { if (!launch.hidden && launch.href) session.launch(); });
  listen(exit, 'click', () => session.close());
  listen(dialog, 'cancel', event => { event.preventDefault(); session.close(); });
  listen(dialog, 'close', () => {
    if (active) session.close({ immediate: true });
    requestAnimationFrame(focusReturnedEntry);
  });
  listen(window, 'message', event => session.receive(event));
  listen(entry, 'station:game-entry-checked', () => {
    requestAnimationFrame(focusReturnedEntry);
  });
  listen(document, 'pointerdown', () => { restoreFocus = false; });
  listen(document, 'keydown', () => { restoreFocus = false; });
  // Scripted/native background play cannot overlap an active game either.
  listen(document, 'play', event => { if (active && event.target.matches('audio, video')) event.target.pause(); }, { capture: true });
  listen(window, 'pagehide', () => { session.close({ immediate: true }); release(); });
  listen(window, 'pageshow', event => { if (event.persisted) { session.close({ immediate: true }); release(); } });
  return () => {
    if (disposed) return; disposed = true; handlers.abort(); session.destroy(); release(); delete entry.dataset.hostMounted;
  };
}
