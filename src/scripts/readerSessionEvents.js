// Invalidation only: no identity, cookie, membership or authorization travels here.
export const READER_SESSION_EVENT = 'station-cat:reader-session-change';
const CHANNEL = 'station-cat-reader-session-v1';
const valid = value => value?.version === 1 && ['changing', 'changed'].includes(value.phase) &&
  typeof value.nonce === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value.nonce) &&
  Object.keys(value).length === 3;

export function notifyReaderSession(phase, host = globalThis) {
  if (!['changing', 'changed'].includes(phase)) return;
  let nonce;
  try { nonce = host.crypto.randomUUID(); } catch { nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  const data = { version: 1, phase, nonce };
  try { host.dispatchEvent(new host.CustomEvent(READER_SESSION_EVENT, { detail: data })); } catch {}
  try { const channel = new host.BroadcastChannel(CHANNEL); channel.postMessage(data); channel.close(); } catch {}
  // Ephemeral fallback, also reaches tabs without BroadcastChannel. No history is read on mount.
  try { host.localStorage.setItem(CHANNEL, JSON.stringify(data)); host.localStorage.removeItem(CHANNEL); } catch {}
}

export function watchReaderSession(callback, host = globalThis) {
  const seen = new Set();
  const receive = data => {
    if (!valid(data) || seen.has(data.nonce)) return;
    seen.add(data.nonce); if (seen.size > 64) seen.delete(seen.values().next().value);
    callback(data.phase);
  };
  const local = event => receive(event.detail);
  const storage = event => {
    if (event.key !== CHANNEL || !event.newValue) return;
    try { receive(JSON.parse(event.newValue)); } catch {}
  };
  host.addEventListener(READER_SESSION_EVENT, local); host.addEventListener('storage', storage);
  let channel;
  try { channel = new host.BroadcastChannel(CHANNEL); channel.onmessage = event => receive(event.data); } catch {}
  return () => {
    channel?.close(); host.removeEventListener(READER_SESSION_EVENT, local); host.removeEventListener('storage', storage);
    seen.clear();
  };
}

export async function withReaderSessionChange(operation, host = globalThis) {
  notifyReaderSession('changing', host);
  try { return await operation(); }
  finally { notifyReaderSession('changed', host); }
}
