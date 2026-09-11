// Panels own presentation/history only. They never receive an audio, queue or access API.
export function createMusicPanelHistory(host, onChange) {
  const owner = `music-${Math.random().toString(36).slice(2)}`;
  const read = () => {
    const marker = host.history.state?.musicPanel;
    return marker?.owner === owner && ['detail', 'filter', 'queue', 'menu'].includes(marker.kind) ? marker.kind : null;
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
      if (disposed || !['detail', 'filter', 'queue', 'menu'].includes(kind)) return;
      if (pendingBack) { pendingOpen = kind; return; }
      if (!read()) base = JSON.stringify(host.history.state?.musicLibrary);
      host.history[read() ? 'replaceState' : 'pushState'](write(kind), '', host.location.href);
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
  const dialogs = { detail: $('[data-detail-dialog]'), filter: $('[data-filter-dialog]'), queue: $('[data-queue-dialog]'), menu: doc.querySelector('[data-menu-dialog]') };
  const dock = $('[data-player-dock]'), detail = $('[data-track-detail]'), filter = $('[data-filter-panel]');
  const nav = doc.querySelector('[data-music-nav-content]'), navHome = nav?.parentElement;
  const previous = $('[data-previous]'), next = $('[data-next]'), transport = previous.parentElement;
  const openers = new Map();
  let active = null, oldOverflow = null, disposed = false;
  const toggles = { detail: '[data-detail-toggle]', filter: '[data-filter-toggle]', queue: '[data-queue-toggle]', menu: '[data-music-menu-toggle]' };
  const focusable = node => node?.isConnected && !node.disabled && node.getClientRects().length && !node.closest('[inert]');
  const restore = kind => {
    const candidates = [openers.get(kind), ...doc.querySelectorAll(toggles[kind]), $('[data-music-search]')];
    candidates.find(focusable)?.focus({ preventScroll: true });
  };
  const measure = () => {
    const height = dock.hidden ? 0 : Math.ceil(dock.getBoundingClientRect().height);
    doc.documentElement.style.setProperty('--music-dock-height', `${height}px`);
  };
  const switchPanel = kind => {
    if (disposed) return;
    if (!dialogs[kind] || (kind !== 'queue' && !mobile.matches) || (kind === 'detail' && detail.hidden)) kind = null;
    if (active === kind) return;
    const last = active;
    if (active) {
      active = null;
      dialogs[last].close();
      if (last === 'detail') $('[data-dock-home]').after(dock);
      doc.querySelectorAll(toggles[last]).forEach(node => node.setAttribute('aria-expanded', 'false'));
    }
    if (kind) {
      if (oldOverflow === null) { oldOverflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden'; }
      active = kind;
      if (kind === 'detail') $('[data-detail-dock]').append(dock);
      dialogs[kind].showModal();
      dialogs[kind].querySelector('[autofocus]')?.focus({ preventScroll: true });
      doc.querySelectorAll(toggles[kind]).forEach(node => node.setAttribute('aria-expanded', 'true'));
    } else {
      if (oldOverflow !== null) { doc.body.style.overflow = oldOverflow; oldOverflow = null; }
      if (last) restore(last);
    }
    measure();
  };
  const history = createMusicPanelHistory(host, switchPanel);
  const open = (kind, opener = doc.activeElement) => {
    if (kind === 'detail' && !mobile.matches) { $('[data-track-title]')?.focus({ preventScroll: true }); return; }
    if (!dialogs[kind] || (kind !== 'queue' && !mobile.matches) || (kind === 'detail' && detail.hidden)) return;
    openers.set(kind, opener);
    history.open(kind);
  };
  const adapt = () => {
    history.reset();
    root.dataset.mobile = String(mobile.matches);
    doc.body.dataset.musicMobile = String(mobile.matches);
    (mobile.matches ? $('[data-detail-target]') : $('[data-detail-home]')).append(detail);
    (mobile.matches ? $('[data-filter-target]') : $('[data-filter-home]')).append(filter);
    if (nav) (mobile.matches ? doc.querySelector('[data-nav-target]') : navHome).append(nav);
    if (mobile.matches) $('[data-queue-steps]').append(previous, next);
    else { transport.prepend(previous); transport.append(next); }
    measure();
  };
  on(mobile, 'change', adapt);
  for (const [kind, dialog] of Object.entries(dialogs)) {
    on(dialog, 'cancel', event => { event.preventDefault(); history.close(); });
    on(dialog, 'click', event => { if (event.target === dialog) history.close(); });
    dialog?.querySelectorAll('[data-panel-close]').forEach(button => on(button, 'click', () => history.close()));
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
  for (const kind of ['detail', 'filter', 'menu']) {
    doc.querySelectorAll(toggles[kind]).forEach(button => on(button, 'click', () => open(kind, button)));
  }
  const observer = typeof host.ResizeObserver === 'function' ? new host.ResizeObserver(measure) : null;
  observer?.observe(dock);
  on(host, 'resize', measure);
  on(host.visualViewport, 'resize', measure);
  adapt();
  return { open, close: () => history.close(), refresh() { if (active === 'detail' && detail.hidden) history.reset(); measure(); }, destroy() {
    history.destroy(); disposed = true; abort.abort(); observer?.disconnect();
    $('[data-detail-home]').append(detail); $('[data-filter-home]').append(filter);
    if (nav) navHome.append(nav);
    transport.prepend(previous); transport.append(next);
    delete root.dataset.mobile; delete doc.body.dataset.musicMobile;
    doc.documentElement.style.removeProperty('--music-dock-height');
  } };
}
