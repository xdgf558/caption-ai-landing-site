// The return fragment requests fresh reads, never authorizes playback or payment.
// Completed automatic polling does not freeze the UI: a later manual or account
// refresh may confirm (or revoke) membership without starting another poll loop.
export function musicReturnStatus(status, { checking, capabilities } = {}) {
  if (checking) return status === 'checking' ? 'checking' : 'refreshing';
  if (capabilities?.membershipStatus === 'active') return 'ready';
  if (capabilities?.authenticated === false) return 'login';
  return ['ready', 'login'].includes(status) ? 'timeout' : status;
}

export function createMusicReturnSync(access, { now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  document = globalThis.document, onChange = () => {} } = {}) {
  let disposed = false, used = false, active = false, end = 0, index = 0, timer = null, deadlineTimer = null, controller = null;
  const delays = [2000, 4000, 8000, 10000];
  const finish = status => {
    if (!active) return;
    active = false; clearTimer(timer); clearTimer(deadlineTimer); controller?.abort(); controller = null; onChange(status);
  };
  const poll = async () => {
    if (!active || disposed) return;
    if (now() >= end) { finish('timeout'); return; }
    if (!access.snapshot().checking && access.snapshot().capabilities?.membershipStatus === 'active') { finish('ready'); return; }
    if (document?.hidden) { timer = setTimer(poll, Math.min(1000, end - now())); return; }
    controller = new AbortController();
    try { await access.refresh('music-return', { signal: controller.signal }); } catch { /* show bounded pending state */ }
    if (!active || disposed) return;
    if (now() >= end) { finish('timeout'); return; }
    const value = access.snapshot();
    if (value.capabilities?.membershipStatus === 'active') { finish('ready'); return; }
    if (value.capabilities?.authenticated === false) { finish('login'); return; }
    timer = setTimer(poll, Math.min(delays[Math.min(index++, delays.length - 1)], end - now()));
  };
  return {
    start() {
      if (used || disposed) return;
      used = true; active = true; end = now() + 60000; onChange('checking');
      deadlineTimer = setTimer(() => finish('timeout'), 60000); void poll();
    },
    destroy() { finish('stopped'); disposed = true; }
  };
}
