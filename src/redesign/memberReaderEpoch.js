// A presentation guard only. The existing server still owns every cookie,
// financial mutation and permission check. This cannot cancel committed writes.
export function createMemberReaderEpoch({ enabled = true, onInvalidate = () => {}, onMismatch = () => {} } = {}) {
  let generation = 0, id = null;
  const api = {
    capture: () => generation,
    current: version => !enabled || version === generation,
    invalidate() { if (!enabled) return; ++generation; id = null; onInvalidate(); },
    begin() { api.invalidate(); return generation; },
    bind(version, session) {
      if (!api.current(version)) return false;
      if (enabled && (session?.ok !== true || typeof session.authenticated !== 'boolean' ||
        (session.authenticated && (!Number.isSafeInteger(session.account?.id) || session.account.id <= 0)))) {
        api.invalidate(); return false;
      }
      id = session.authenticated ? session.account.id : null; return true;
    },
    accept(version, data, { ownerRequired = true } = {}) {
      if (!enabled) return true;
      if (!api.current(version)) return false;
      const owner = data?.account?.id ?? data?.account?.accountId;
      if (data?.authenticated !== true || id === null || (ownerRequired || data.account) && owner !== id) {
        api.invalidate(); onMismatch(); return false;
      }
      return true;
    },
  };
  return api;
}
