import { musicShareCardPath, musicShareCardData, MUSIC_SHARE_FORMATS, MUSIC_SHARE_MAX_PNG } from '../music/shareCard.js';
import { readPlayerCatalog } from './musicPlayerCatalog.js';

async function bytes(response, limit, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) { void response.body?.cancel().catch(() => {}); throw new Error('SHARE_RESPONSE_INVALID'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('SHARE_RESPONSE_INVALID');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let length = 0, chunks = [];
  try {
    if (signal.aborted) throw new Error('SHARE_RESPONSE_ABORTED');
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error('SHARE_RESPONSE_ABORTED');
      if (done) break;
      length += value.length; if (length > limit) throw new Error('SHARE_RESPONSE_INVALID'); chunks.push(value);
    }
    if (!length || (declared !== null && Number(declared) !== length)) throw new Error('SHARE_RESPONSE_INVALID');
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
export function validateMusicSharePng(data, format) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10], size = MUSIC_SHARE_FORMATS[format];
  if (!size || data.length < 24 || signature.some((value, i) => data[i] !== value) || String.fromCharCode(...data.subarray(12, 16)) !== 'IHDR') throw new Error('SHARE_RESPONSE_INVALID');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(16) !== size[0] || view.getUint32(20) !== size[1]) throw new Error('SHARE_RESPONSE_INVALID');
}

// An export observer only: no audio, queue, account or storage API is accepted.
export function createMusicShareCards({ fetcher = globalThis.fetch, origin = globalThis.location.origin, locale,
  urls = globalThis.URL, timeoutMs = 12000, onChange = () => {} } = {}) {
  let epoch = 0, controller = null, objectUrl = null, disposed = false;
  let state = { status: 'idle', format: 'poster', data: null, blob: null, imageUrl: null, code: null };
  const emit = () => onChange({ ...state });
  const clear = () => {
    epoch++; controller?.abort(); controller = null;
    if (objectUrl) urls.revokeObjectURL(objectUrl); objectUrl = null;
    state = { ...state, blob: null, imageUrl: null, data: null, code: null };
  };
  return {
    async prepare(track, format = 'poster') {
      if (disposed) return;
      clear(); const generation = epoch;
      state = { ...state, status: 'loading', format }; emit();
      controller = new AbortController(); const active = controller, timer = setTimeout(() => {
        active.abort();
        if (!disposed && generation === epoch) { state = { ...state, status: 'error', code: 'SHARE_CARD_UNAVAILABLE' }; emit(); }
      }, timeoutMs);
      try {
        musicShareCardPath(track.id, track.audioVersion, locale, format);
        const options = { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: active.signal };
        // Read the current public revision; stale queue/catalog rows are not publication proof.
        const detail = await fetcher(`/api/music/tracks/${track.id}?locale=${locale}`, options);
        if (!detail.ok) { void detail.body?.cancel().catch(() => {}); throw new Error(detail.status === 404 || detail.status === 410 ? 'SHARE_TRACK_UNAVAILABLE' : 'SHARE_CARD_UNAVAILABLE'); }
        const body = JSON.parse(new TextDecoder().decode(await bytes(detail, 65536, active.signal)));
        const fresh = readPlayerCatalog({ schemaVersion: body.schemaVersion, tracks: [body.track] })[0];
        if (fresh.id !== track.id) throw new Error('SHARE_RESPONSE_INVALID');
        if (disposed || generation !== epoch || active.signal.aborted) return;
        const response = await fetcher(musicShareCardPath(fresh.id, fresh.audioVersion, locale, format), options);
        if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error(response.status === 429 ? 'SHARE_RATE_LIMITED' : response.status === 404 || response.status === 410 ? 'SHARE_TRACK_UNAVAILABLE' : 'SHARE_CARD_UNAVAILABLE'); }
        if (response.headers.get('content-type')?.split(';')[0] !== 'image/png') { void response.body?.cancel().catch(() => {}); throw new Error('SHARE_RESPONSE_INVALID'); }
        const png = await bytes(response, MUSIC_SHARE_MAX_PNG, active.signal); validateMusicSharePng(png, format);
        if (disposed || generation !== epoch || active.signal.aborted) return;
        const blob = new Blob([png], { type: 'image/png' }); objectUrl = urls.createObjectURL(blob);
        state = { status: 'ready', format, data: musicShareCardData(fresh, origin, locale), blob, imageUrl: objectUrl, code: null }; emit();
      } catch (error) {
        if (disposed || generation !== epoch) return;
        state = { ...state, status: 'error', code: active.signal.aborted ? 'SHARE_CARD_UNAVAILABLE' : error.message }; emit();
      } finally { clearTimeout(timer); if (controller === active) controller = null; }
    },
    snapshot: () => ({ ...state }),
    close() { clear(); state = { ...state, status: 'idle' }; emit(); },
    destroy() { disposed = true; clear(); },
    imageFailed() { clear(); state = { ...state, status: 'error', code: 'SHARE_RESPONSE_INVALID' }; emit(); }
  };
}

// File already exists when the user clicks: invoke native share synchronously.
export async function shareMusicCardFile(blob, title, { navigator = globalThis.navigator, FileClass = globalThis.File } = {}) {
  try {
    const file = new FileClass([blob], 'station-cat-music.png', { type: 'image/png' });
    if (!navigator?.canShare?.({ files: [file] }) || !navigator?.share) return 'unavailable';
    await navigator.share({ files: [file], title }); return 'shared';
  } catch (error) { return error?.name === 'AbortError' ? 'cancelled' : 'unavailable'; }
}
