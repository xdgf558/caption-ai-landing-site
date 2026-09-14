import { mountMusicPlayerMotion } from './musicPlayerMotion.js';

// Panels own presentation/history only. They never receive an audio, queue or access API.
export function createMusicPanelHistory(host, onChange) {
  const owner = `music-${Math.random().toString(36).slice(2)}`;
  const read = () => {
    const marker = host.history.state?.musicPanel;
    return marker?.owner === owner && ['now', 'detail', 'filter', 'queue', 'menu', 'share'].includes(marker.kind) ? marker.kind : null;
  };
  const write = kind => {
    const state = { ...host.history.state };
    if (kind) state.musicPanel = { owner, kind }; else delete state.musicPanel;
    return state;
  };
  let base = null, pendingBack = false, pendingOpen = null, disposed = false;
  const pop = () => {
    pendingBack = false;
    onChange(read());
    const next = pendingOpen; pendingOpen = null;
    if (next) queueMicrotask(() => { if (!disposed) api.open(next); });
  };
  host.addEventListener('popstate', pop);
  const api = {
    open(kind) {
      if (disposed || !['now', 'detail', 'filter', 'queue', 'menu', 'share'].includes(kind)) return;
      if (pendingBack) { pendingOpen = kind; return; }
      if (!read()) base = JSON.stringify(host.history.state?.musicLibrary);
      if (read() === kind) return;
      const childOfPlayer = read() === 'now' && ['detail', 'queue'].includes(kind);
      // A lyrics action may explicitly select the playing song before opening
      // details. The parent player already contains that browse selection.
      if (childOfPlayer) base = JSON.stringify(host.history.state?.musicLibrary);
      host.history[read() && kind !== 'share' && !childOfPlayer ? 'replaceState' : 'pushState'](write(kind), '', host.location.href);
      onChange(kind);
    },
    close() {
      onChange(null);
      if (pendingBack || !read()) return;
      // Filters commit immediately. Closing them must keep the edited browse state.
      if (base === JSON.stringify(host.history.state?.musicLibrary)) { pendingBack = true; host.history.back(); }
      else host.history.replaceState(write(null), '', host.location.href);
    },
    reset() { pendingOpen = null; if (read()) host.history.replaceState(write(null), '', host.location.href); onChange(null); },
    destroy() { this.reset(); disposed = true; host.removeEventListener('popstate', pop); }
  };
  return api;
}

export function mountMusicPanels(root, { host = window } = {}) {
  const doc = root.ownerDocument, abort = new AbortController();
  const $ = selector => root.querySelector(selector), on = (node, name, fn) => node?.addEventListener(name, fn, { signal: abort.signal });
  const mobile = host.matchMedia('(max-width: 48rem)');
  // Some mobile browsers mark modal autofocus as focus-visible after a tap.
  // Keep focus in the dialog, but show its ring only for keyboard navigation.
  on(doc, 'pointerdown', () => { root.dataset.panelInput = 'pointer'; });
  on(doc, 'keydown', event => { if (event.key === 'Tab') root.dataset.panelInput = 'keyboard'; });
  const nightPage = doc.body.classList.contains('station-music-page');
  const desktopPanel = kind => nightPage && kind === 'detail';
  const dialogs = { now: $('[data-now-dialog]'), detail: $('[data-detail-dialog]'), filter: $('[data-filter-dialog]'), queue: $('[data-queue-dialog]'), menu: doc.querySelector('[data-menu-dialog]'), share: $('[data-share-card-dialog]') };
  const dock = $('[data-player-dock]'), detail = $('[data-track-detail]'), filter = $('[data-filter-panel]');
  const nav = doc.querySelector('[data-music-nav-content]'), navHome = nav?.parentElement;
  const previous = $('[data-previous]'), next = $('[data-next]'), transport = previous.parentElement;
  const openers = new Map();
  const playerMotion = mountMusicPlayerMotion(root, { host });
  let active = null, unlockPage = null, disposed = false;
  let closingTimer = null;
  const reducedMotion = host.matchMedia('(prefers-reduced-motion: reduce)');
  const motionTarget = kind => dialogs[kind]?.querySelector('.t-modal');
  const cancelClosing = () => {
    if (closingTimer !== null) host.clearTimeout(closingTimer);
    closingTimer = null;
    const target = motionTarget(active);
    if (target?.classList.contains('is-closing')) {
      if (active === 'now') playerMotion.reset();
      target.classList.remove('is-closing'); target.classList.add('is-open');
    }
  };
  const lockPage = () => {
    if (unlockPage) return;
    const x = host.scrollX, y = host.scrollY;
    const saved = [];
    const set = (style, property, value) => {
      saved.push([style, property, style.getPropertyValue(property), style.getPropertyPriority(property)]);
      style.setProperty(property, value);
    };
    set(doc.documentElement.style, 'overflow', 'hidden');
    set(doc.body.style, 'overflow', 'hidden');
    // iOS can still pan the document behind a modal with overflow alone.
    // Keep the same lock while moving between player, lyrics, queue and share.
    const fixed = mobile.matches;
    if (fixed) {
      set(doc.body.style, 'position', 'fixed');
      set(doc.body.style, 'top', `${-y}px`);
      set(doc.body.style, 'left', `${-x}px`);
      set(doc.body.style, 'width', '100%');
    }
    unlockPage = () => {
      for (const [style, property, value, priority] of saved.reverse()) {
        if (value) style.setProperty(property, value, priority); else style.removeProperty(property);
      }
      if (fixed) host.scrollTo({ left: x, top: y, behavior: 'instant' });
      unlockPage = null;
    };
  };
  const toggles = { now: '[data-now-toggle]', detail: '[data-detail-toggle]', filter: '[data-filter-toggle]', queue: '[data-queue-toggle]', menu: '[data-music-menu-toggle]', share: '[data-share-music="track"]' };
  const focusable = node => node?.isConnected && !node.disabled && node.getClientRects().length && !node.closest('[inert]');
  const restore = kind => {
    const candidates = [openers.get(kind), ...doc.querySelectorAll(toggles[kind]), $('[data-music-search]')];
    candidates.find(focusable)?.focus({ preventScroll: true });
  };
  const measure = () => {
    if (active === 'now') return;
    const height = dock.hidden ? 0 : Math.ceil(dock.getBoundingClientRect().height);
    doc.documentElement.style.setProperty('--music-dock-height', `${height}px`);
  };
  const switchPanel = kind => {
    if (disposed) return;
    cancelClosing();
    if (!dialogs[kind] || (!['queue', 'share'].includes(kind) && !mobile.matches && !desktopPanel(kind)) || (kind === 'detail' && detail.hidden) || (kind === 'now' && dock.hidden)) kind = null;
    if (active === kind) return;
    const last = active;
    if (kind === 'now') playerMotion.capture();
    playerMotion.reset();
    if (active) {
      active = null;
      dialogs[last].close();
      motionTarget(last)?.classList.remove('is-open', 'is-closing');
      if (last === 'detail' || last === 'now') $('[data-dock-home]').after(dock);
      if (last === 'now' && mobile.matches) $('[data-queue-steps]').append(previous, next);
      doc.querySelectorAll(toggles[last]).forEach(node => node.setAttribute('aria-expanded', 'false'));
    }
    if (kind) {
      lockPage();
      active = kind;
      if (kind === 'detail') $('[data-detail-dock]').append(dock);
      if (kind === 'now') {
        $('[data-now-target]').append(dock);
        $('[data-main-play]').before(previous); transport.append(next);
      }
      dialogs[kind].showModal();
      const target = motionTarget(kind);
      if (target) {
        target.classList.remove('is-open', 'is-closing');
        void target.offsetWidth;
        target.classList.add('is-open');
      }
      if (kind === 'now') playerMotion.open();
      dialogs[kind].querySelector('[autofocus]')?.focus({ preventScroll: true });
      doc.querySelectorAll(toggles[kind]).forEach(node => node.setAttribute('aria-expanded', 'true'));
    } else {
      unlockPage?.();
      if (last) restore(last);
    }
    root.dataset.activePanel = active || '';
    measure();
  };
  const history = createMusicPanelHistory(host, switchPanel);
  const close = () => {
    if (closingTimer !== null) return;
    const target = motionTarget(active);
    if (!target || reducedMotion.matches) { history.close(); return; }
    // Delay only explicit dismissals. Back, resize and teardown stay immediate.
    const value = host.getComputedStyle(target).getPropertyValue('--modal-close-dur').trim();
    const ms = Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    target.classList.remove('is-open'); target.classList.add('is-closing');
    if (active === 'now') playerMotion.close();
    closingTimer = host.setTimeout(() => {
      closingTimer = null;
      target.classList.remove('is-closing');
      history.close();
    }, Number.isFinite(ms) ? ms : 150);
  };
  const open = (kind, opener = doc.activeElement) => {
    if (kind === 'detail' && !mobile.matches && !nightPage) { $('[data-track-title]')?.focus({ preventScroll: true }); return; }
    if (!dialogs[kind] || (!['queue', 'share'].includes(kind) && !mobile.matches && !desktopPanel(kind)) || (kind === 'detail' && detail.hidden) || (kind === 'now' && dock.hidden)) return;
    openers.set(kind, opener);
    cancelClosing();
    history.open(kind);
  };
  const adapt = () => {
    history.reset();
    root.dataset.mobile = String(mobile.matches);
    doc.body.dataset.musicMobile = String(mobile.matches);
    (mobile.matches || nightPage ? $('[data-detail-target]') : $('[data-detail-home]')).append(detail);
    (mobile.matches ? $('[data-filter-target]') : $('[data-filter-home]')).append(filter);
    if (nav) (mobile.matches ? doc.querySelector('[data-nav-target]') : navHome).append(nav);
    if (mobile.matches) $('[data-queue-steps]').append(previous, next);
    else { $('[data-main-play]').before(previous); transport.append(next); }
    measure();
  };
  on(mobile, 'change', adapt);
  for (const [kind, dialog] of Object.entries(dialogs)) {
    on(dialog, 'cancel', event => { event.preventDefault(); close(); });
    on(dialog, 'click', event => { if (event.target === dialog) close(); });
    dialog?.querySelectorAll('[data-panel-close]').forEach(button => on(button, 'click', close));
    on(dialog, 'keydown', event => {
      if (event.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll('button, a[href], input, select, summary, [tabindex]')]
        .filter(node => focusable(node) && node.tabIndex >= 0);
      const boundary = event.shiftKey ? items[0] : items.at(-1);
      if (doc.activeElement === boundary || !dialog.contains(doc.activeElement)) {
        event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0])?.focus();
      }
    });
  }
  on($('[data-now-close]'), 'click', close);
  for (const kind of ['now', 'detail', 'filter', 'menu']) {
    doc.querySelectorAll(toggles[kind]).forEach(button => on(button, 'click', () => open(kind, button)));
  }
  const observer = typeof host.ResizeObserver === 'function' ? new host.ResizeObserver(measure) : null;
  observer?.observe(dock);
  on(host, 'resize', measure);
  on(host.visualViewport, 'resize', measure);
  adapt();
  return { open, close, setCover: playerMotion.setCover, refresh() { if ((active === 'detail' && detail.hidden) || (active === 'now' && dock.hidden)) history.reset(); measure(); }, destroy() {
    history.destroy(); playerMotion.destroy(); unlockPage?.(); disposed = true; abort.abort(); observer?.disconnect();
    $('[data-detail-home]').append(detail); $('[data-filter-home]').append(filter);
    if (nav) navHome.append(nav);
    $('[data-main-play]').before(previous); transport.append(next);
    delete root.dataset.mobile; delete root.dataset.activePanel; delete root.dataset.panelInput; delete doc.body.dataset.musicMobile;
    doc.documentElement.style.removeProperty('--music-dock-height');
  } };
}
