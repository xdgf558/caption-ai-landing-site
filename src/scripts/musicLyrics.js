export const LYRICS_BYTES = 128 * 1024;
const timestamp = /^\[(\d{1,4}):([0-5]\d)(?:\.(\d{1,3}))?\]/;

export function parseMusicLyrics(value, kind = 'txt') {
  if (typeof value !== 'string' || value.includes('\0') || new TextEncoder().encode(value).length > LYRICS_BYTES) throw new Error('INVALID_LYRICS');
  const lines = value.replace(/^\uFEFF/, '').split(/\r\n?|\n/);
  if (lines.length > 5000) throw new Error('INVALID_LYRICS');
  if (kind !== 'lrc') return { kind: 'txt', text: lines.join('\n'), lines: [], warnings: 0 };
  let offsetMs = 0, warnings = 0;
  const timed = [];
  for (const raw of lines) {
    let line = raw.trim();
    const offset = /^\[offset:([+-]?\d{1,9})\]$/i.exec(line);
    if (offset) { offsetMs = Number(offset[1]); continue; }
    if (/^\[(ar|ti|al|by|length|re|ve):[^\]]*\]$/i.test(line) || !line) continue;
    const times = [];
    let match;
    while ((match = timestamp.exec(line))) {
      times.push((Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] || '').padEnd(3, '0')));
      line = line.slice(match[0].length);
    }
    if (!times.length || line.startsWith('[')) { warnings++; continue; }
    for (const startMs of times) timed.push({ startMs, text: line.trim() });
    // Multi-tag lines also have a bounded expansion budget.
    if (timed.length > 5000) throw new Error('INVALID_LYRICS');
  }
  if (!timed.length) return { kind: 'txt', text: lines.join('\n'), lines: [], warnings };
  // Positive LRC offset advances the display (subtract it from timestamps).
  const merged = new Map();
  for (const row of timed) {
    const startMs = row.startMs - offsetMs;
    const texts = merged.get(startMs) || [];
    if (!texts.includes(row.text)) texts.push(row.text);
    merged.set(startMs, texts);
  }
  return { kind: 'lrc', text: '', warnings, lines: [...merged].sort((a, b) => a[0] - b[0]).map(([startMs, texts]) => ({ startMs, text: texts.join('\n') })) };
}

export function currentLyricIndex(lines, mediaSeconds, previewSourceStartSec = 0) {
  if (!Number.isFinite(mediaSeconds) || !Number.isFinite(previewSourceStartSec)) return -1;
  const ms = (Math.max(0, mediaSeconds) + Math.max(0, previewSourceStartSec)) * 1000;
  let low = 0, high = lines.length;
  while (low < high) { const mid = (low + high) >>> 1; if (lines[mid].startMs <= ms) low = mid + 1; else high = mid; }
  return low - 1;
}

export async function fetchMusicLyrics(track, { fetcher = globalThis.fetch.bind(globalThis), signal } = {}) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(track.id) || !Number.isSafeInteger(track.audioVersion) || track.audioVersion < 1) throw new Error('INVALID_TRACK');
  const response = await fetcher(`/api/music/tracks/${track.id}/lyrics?v=${track.audioVersion}`, { signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim() !== 'text/plain' || !response.body) {
    await response.body?.cancel(); throw new Error('LYRICS_UNAVAILABLE');
  }
  if (Number(response.headers.get('content-length')) > LYRICS_BYTES) { await response.body.cancel(); throw new Error('INVALID_LYRICS'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > LYRICS_BYTES) throw new Error('INVALID_LYRICS');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
    return parseMusicLyrics(new TextDecoder('utf-8', { fatal: true }).decode(bytes), track.lyricsKind);
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
