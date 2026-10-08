import { GAME_PROTOCOL, GAME_ID, GAME_PATH, GAME_START_TIMEOUT_MS, GAME_STOP_TIMEOUT_MS, gameLaunchId } from './gameProtocol.js';
// One frame per gesture. A ready message, never iframe load, confirms startup.
export function createStationGameSession({ origin, locale, createFrame, mount, pauseMedia, view = () => {},
  uuid = () => crypto.randomUUID(), clock = () => performance.now(), timer = setTimeout, clearTimer = clearTimeout,
  startTimeoutMs = GAME_START_TIMEOUT_MS, stopTimeoutMs = GAME_STOP_TIMEOUT_MS } = {}) {
  let frame = null, handlers = null, deadline = null, status = 'idle', error = null, launchId = null, startedAt = 0, elapsedMs = null, destroyed = false, finishStop = null;
  const snapshot = () => ({ status, error, launchId, elapsedMs });
  const emit = () => { if (!destroyed) view(snapshot()); };
  function retire() {
    clearTimer(deadline); deadline = null; handlers?.abort(); handlers = null; finishStop = null;
    const previous = frame; frame = null; launchId = null;
    if (previous) { previous.src = 'about:blank'; previous.remove(); }
  }
  function stop(next = 'idle', code = null, immediate = false) {
    if (!frame || immediate) { retire(); status = next; error = code; emit(); return; }
    if (status === 'stopping') return;
    clearTimer(deadline); status = 'stopping'; emit();
    const previous = frame, id = launchId;
    finishStop = () => {
      if (frame !== previous || launchId !== id) return;
      retire(); status = next; error = code; emit();
    };
    // Allow a cooperative runtime to save through its existing guarded path,
    // stop ticks/BGM/queued sync, then acknowledge before removal.
    deadline = timer(() => finishStop?.(), stopTimeoutMs);
    try { previous.contentWindow.postMessage({ protocol: GAME_PROTOCOL, type: 'exit', game_id: GAME_ID, launch_id: id }, origin); }
    catch { finishStop(); }
  }
  function launch() {
    if (destroyed || !['idle', 'error'].includes(status)) return false;
    retire(); error = null; elapsedMs = null;
    try {
      pauseMedia();
      const id = uuid(); if (!gameLaunchId(id)) throw new Error('Invalid launch ID');
      launchId = id; startedAt = clock(); frame = createFrame(); handlers = new AbortController();
      const current = frame;
      current.addEventListener('error', () => { if (frame === current) stop('error', 'load'); }, { signal: handlers.signal });
      const url = new URL(GAME_PATH, origin);
      url.searchParams.set('sc_entry', '1'); url.searchParams.set('sc_launch_id', id);
      url.searchParams.set('lang', locale === 'zh-Hans' ? 'zh-CN' : locale);
      status = 'loading'; emit(); current.src = url.href;
      deadline = timer(() => { if (frame === current && status === 'loading') stop('error', 'timeout'); }, startTimeoutMs);
      mount(current);
      return true;
    } catch { retire(); status = 'error'; error = 'load'; emit(); return false; }
  }
  function receive(event) {
    const data = event.data;
    if (destroyed || !frame || event.origin !== origin || event.source !== frame.contentWindow ||
      !data || typeof data !== 'object' || data.protocol !== GAME_PROTOCOL || data.game_id !== GAME_ID || data.launch_id !== launchId) return false;
    if (data.type === 'stopped' && status === 'stopping') { finishStop?.(); return true; }
    if (status === 'stopping') return false;
    if (data.type === 'ready' && status === 'loading') {
      clearTimer(deadline); deadline = null; elapsedMs = Math.max(0, clock() - startedAt); status = 'ready'; emit(); return true;
    }
    if (data.type === 'recovery' && ['loading', 'ready', 'recovery'].includes(status)) {
      clearTimer(deadline); deadline = null; status = 'recovery'; emit(); return true;
    }
    if (data.type === 'failed') { stop('error', 'load'); return true; }
    return false;
  }
  return { snapshot, launch, receive, close(options = {}) { stop('idle', null, options.immediate); },
    destroy() { if (destroyed) return; stop('idle', null, true); destroyed = true; } };
}
