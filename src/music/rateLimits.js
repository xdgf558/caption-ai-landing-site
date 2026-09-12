import { primary, rows } from './adminStore.js';
import { isoTime } from './policy.js';

const WINDOW_MS = 60000;
const DEADLINE_EXCEEDED = Symbol('music rate deadline');
export const RATE_RETENTION_MS = 10 * WINDOW_MS;
export const DEFAULT_MUSIC_RATE_LIMITS = Object.freeze({
  catalog: Object.freeze({ source: 120, global: 6000 }),
  artwork: Object.freeze({ source: 240, global: 12000 }),
  audio: Object.freeze({ source: 120, global: 6000 })
});

export function musicRateLimits(env) {
  const raw = env.MUSIC_RATE_LIMITS_JSON;
  const limits = raw === undefined ? DEFAULT_MUSIC_RATE_LIMITS : JSON.parse(raw);
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) ||
    Object.keys(limits).sort().join(',') !== 'artwork,audio,catalog') throw new Error('limits');
  for (const group of Object.values(limits)) {
    if (!group || Object.keys(group).sort().join(',') !== 'global,source' ||
      !Number.isSafeInteger(group.source) || group.source < 1 || group.source > 10000 ||
      !Number.isSafeInteger(group.global) || group.global < group.source || group.global > 100000) throw new Error('limits');
  }
  return limits;
}
function secret(env) {
  const value = env.MUSIC_RATE_LIMIT_SECRET;
  if (typeof value !== 'string' || value.length < 32 || value.length > 1024) throw new Error('secret');
  return value;
}
function sourceIp(request) {
  // Cloudflare's edge supplies this header. Never use a cookie, query or X-Forwarded-For.
  const value = request.headers.get('CF-Connecting-IP');
  if (typeof value !== 'string' || value.length > 45) throw new Error('source');
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const parts = value.split('.');
    if (parts.some(p => Number(p)>255 || String(Number(p))!==p)) throw new Error('source');
    return value;
  }
  if (!value.includes(':') || !/^[0-9a-f:.]+$/i.test(value)) throw new Error('source');
  return new URL(`http://[${value}]/`).hostname;
}
export async function musicRateSourceHash(request,env,category,window) {
  const encoder = new TextEncoder(), key = await crypto.subtle.importKey('raw',encoder.encode(secret(env)),
    { name: 'HMAC',hash: 'SHA-256' },false,['sign']);
  const digest = await crypto.subtle.sign('HMAC',key,encoder.encode(`${category}:${window}:${sourceIp(request)}`));
  return Array.from(new Uint8Array(digest),b => b.toString(16).padStart(2,'0')).join('');
}
async function bounded(task,timeoutMs) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(task),new Promise((_,reject) => {
      timer = setTimeout(() => reject(DEADLINE_EXCEEDED),timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// A single conditional UPSERT serializes source and global admission on the D1 primary.
// JSON, HEAD, conditional responses and audio ranges all consume one request admission.
export async function checkMusicRateLimit(request,env,category,{ clock = Date.now,timeoutMs = 5000, ceiling = null } = {}) {
  let stage = 'configuration';
  try {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('timeout');
    const limits = musicRateLimits(env); let group = limits[category];
    if (!group || !env.MUSIC_DB || env.MUSIC_DB === env.WAITLIST_DB) throw new Error('binding');
    // Expensive derived artwork shares the existing atomic counter, with a stricter
    // admission ceiling. This can only reduce admission; it never resets a window.
    if (ceiling) {
      if (!Number.isSafeInteger(ceiling.source) || ceiling.source < 1 || !Number.isSafeInteger(ceiling.global) || ceiling.global < ceiling.source) throw new Error('ceiling');
      group = { source: Math.min(group.source, ceiling.source), global: Math.min(group.global, ceiling.global) };
    }
    const now = clock(); isoTime(now); const window = Math.floor(now/WINDOW_MS)*WINDOW_MS;
    stage = 'source';
    const hash = await musicRateSourceHash(request,env,category,window);
    stage = 'database';
    const s = primary(env.MUSIC_DB);
    const results = await bounded(() => s.batch([
      s.prepare(`DELETE FROM music_rate_sources WHERE rowid IN
        (SELECT rowid FROM music_rate_sources WHERE window_start<? ORDER BY window_start LIMIT 100)`)
        .bind(window - RATE_RETENTION_MS),
      s.prepare(`DELETE FROM music_rate_windows WHERE rowid IN
        (SELECT w.rowid FROM music_rate_windows w WHERE w.window_start<? AND NOT EXISTS
          (SELECT 1 FROM music_rate_sources s WHERE s.category=w.category AND s.window_start=w.window_start)
          ORDER BY w.window_start LIMIT 30)`).bind(window - RATE_RETENTION_MS),
      s.prepare(`INSERT INTO music_rate_sources(category,window_start,source_hash,hits)
        SELECT ?1,?2,?3,1 WHERE COALESCE((SELECT hits FROM music_rate_windows WHERE category=?1 AND window_start=?2),0)<?4
        ON CONFLICT(category,window_start,source_hash) DO UPDATE SET hits=hits+1 WHERE hits<?5
        RETURNING hits`).bind(category,window,hash,group.global,group.source)
    ]),timeoutMs);
    stage = 'result';
    if (!Array.isArray(results) || results.length !== 3) throw new Error('results');
    const parsed = results.map(rows), accepted = parsed[2];
    if (accepted.length > 1 || (accepted.length === 1 &&
      (!Number.isSafeInteger(accepted[0].hits) || accepted[0].hits < 1 || accepted[0].hits > group.source))) throw new Error('counter');
    return accepted.length ? null : { status: 429,code: 'MUSIC_RATE_LIMITED',retryAfter: Math.max(1,Math.ceil((window+WINDOW_MS-now)/1000)) };
  } catch (error) {
    // Only fixed enums enter logs. Never serialize the request, hash, SQL or error.
    // The deadline does not cancel D1: a late commit may still consume a slot.
    try {
      console.warn('music_rate_limit_failure', {
        version: 1, category: ['catalog','artwork','audio'].includes(category) ? category : 'unknown',
        stage, reason: error === DEADLINE_EXCEEDED ? 'deadline_exceeded' : 'operation_failed'
      });
    } catch { /* Logging failure must not change the denial response. */ }
    return { status: 503,code: 'MUSIC_RATE_LIMIT_UNAVAILABLE',retryAfter: 5 };
  }
}

export async function readMusicRateDiagnostics(env,{ clock = Date.now } = {}) {
  const limits = musicRateLimits(env); secret(env);
  const now = clock(); isoTime(now); const window = Math.floor(now/WINDOW_MS)*WINDOW_MS, s = primary(env.MUSIC_DB);
  rows(await s.prepare('SELECT source_hash,hits FROM music_rate_sources LIMIT 0').all());
  const counts = rows(await s.prepare('SELECT category,hits FROM music_rate_windows WHERE window_start=? ORDER BY category').bind(window).all());
  return { limits,windowStart: window,windowMs: WINDOW_MS,retentionMs: RATE_RETENTION_MS,
    acceptedRequests: Object.fromEntries(Object.keys(limits).map(k => [k,counts.find(r => r.category === k)?.hits ?? 0])),
    retentionMode: 'bounded-pruning-on-request' };
}
