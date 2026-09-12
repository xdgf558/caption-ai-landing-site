import { primary, rows } from './adminStore.js';
import { fail } from './adminValidation.js';
import { validMusicId } from './publicationValidation.js';
import { musicRuntimeFlags } from './runtime.js';
import { checkMusicRateLimit, musicRateSourceHash } from './rateLimits.js';

export const MUSIC_ANALYTICS_VERSION = 'music-analytics-v1';
export const MUSIC_ANALYTICS_RETENTION = Object.freeze({ rawDays: 30, dailyDays: 365, attributionDays: 90 });
const DAY = 86400000, HOUR = 3600000, MINUTE = 60000;
const browserEvents = ['play_start','qualified_play','play_complete','preview_end','vip_cta_click'];
const sources = ['catalog','collection','detail','player','membership'];
const fields = ['eventId','eventType','playSessionId','anonymousSessionId','trackId','revisionNo','variant','occurredAt','listenedMs','entrySource'];
const enabled = value => value === true || value === 'true';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const unavailableMetrics = Object.freeze({
  membershipCenterOpen: { available: false, reason: 'NOT_INSTRUMENTED' },
  paidActivations: { available: false, reason: 'NO_VERIFIABLE_GRANT_ADAPTER' },
  renewals: { available: false, reason: 'NO_VERIFIABLE_GRANT_ADAPTER' }
});
function database(env) {
  if (!env.MUSIC_DB || env.MUSIC_DB === env.WAITLIST_DB) fail('MUSIC_ANALYTICS_UNAVAILABLE',503);
  return primary(env.MUSIC_DB);
}
export function musicAnalyticsConfiguration(env) {
  const flags = musicRuntimeFlags(env);
  const reason = !flags.public ? 'MUSIC_PUBLIC_DISABLED' : !flags.analytics ? 'MUSIC_ANALYTICS_DISABLED'
    : env.MUSIC_ANALYTICS_PRIVACY_VERSION !== MUSIC_ANALYTICS_VERSION ? 'PRIVACY_NOT_CONFIGURED'
    : !enabled(env.MUSIC_ANALYTICS_RETENTION_ENABLED) ? 'RETENTION_NOT_CONFIGURED' : null;
  return { available: !reason, reason, consentVersion: MUSIC_ANALYTICS_VERSION, retention: MUSIC_ANALYTICS_RETENTION };
}
async function bounded(task, timeoutMs = 2000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(task),new Promise((_,reject) => {
    timer = setTimeout(() => reject(new Error('timeout')),timeoutMs);
  })]); } finally { clearTimeout(timer); }
}
function expiredStatements(s, now, lead = 0) {
  // Fixed SQL/table names only. Sweep one hour early so an hourly job can meet
  // the maximum retention; reads always exclude records at/after their expiry.
  return [
    s.prepare('DELETE FROM music_analytics_events WHERE rowid IN (SELECT rowid FROM music_analytics_events WHERE received_at<=? ORDER BY received_at LIMIT 1000)').bind(now-30*DAY+lead),
    s.prepare('DELETE FROM music_analytics_daily WHERE rowid IN (SELECT rowid FROM music_analytics_daily WHERE day_start_ms<=? ORDER BY day_start_ms LIMIT 1000)').bind(now-365*DAY+lead),
    s.prepare('DELETE FROM music_membership_attributions WHERE rowid IN (SELECT rowid FROM music_membership_attributions WHERE observed_at<=? ORDER BY observed_at LIMIT 100)').bind(now-90*DAY+lead),
    s.prepare('DELETE FROM music_analytics_rates WHERE rowid IN (SELECT rowid FROM music_analytics_rates WHERE window_start<=? ORDER BY window_start LIMIT 1000)').bind(now-2*HOUR+lead)
  ];
}
function expiredQuery(s, now, lead = 0) {
  return s.prepare(`SELECT EXISTS(SELECT 1 FROM music_analytics_events WHERE received_at<=?1)
    OR EXISTS(SELECT 1 FROM music_analytics_daily WHERE day_start_ms<=?2)
    OR EXISTS(SELECT 1 FROM music_membership_attributions WHERE observed_at<=?3)
    OR EXISTS(SELECT 1 FROM music_analytics_rates WHERE window_start<=?4) AS pending`)
    .bind(now-30*DAY+lead,now-365*DAY+lead,now-90*DAY+lead,now-2*HOUR+lead);
}
async function retentionReady(s, now) {
  const result = (await s.batch([
    s.prepare('SELECT last_sweep_at FROM music_analytics_health WHERE id=1'),expiredQuery(s,now)
  ])).map(rows);
  const last = result[0][0]?.last_sweep_at;
  return integer(last) && last <= now && now-last <= 2*HOUR && result[1][0]?.pending === 0;
}
// Independent of the collection switch: withdrawing/turning collection off must
// not stop expiry of previously accepted data. Never touches objects or accounts.
export async function runMusicAnalyticsRetention(env, { clock = Date.now, rounds = 20 } = {}) {
  if (!enabled(env.MUSIC_ANALYTICS_RETENTION_ENABLED)) return { available: false, reason: 'RETENTION_DISABLED' };
  try {
    const now = clock(), s = database(env);
    if (!integer(now) || !Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error('input');
    for (let i=0;i<rounds;i++) {
      const result = (await s.batch([...expiredStatements(s,now,HOUR),expiredQuery(s,now,HOUR)])).map(rows);
      if (result.at(-1)[0]?.pending === 0) {
        rows(await s.prepare(`INSERT INTO music_analytics_health(id,last_sweep_at) VALUES(1,?)
          ON CONFLICT(id) DO UPDATE SET last_sweep_at=excluded.last_sweep_at RETURNING id`).bind(now).all());
        return { available: true, pending: false };
      }
    }
    return { available: false, reason: 'RETENTION_BACKLOG' };
  } catch { return { available: false, reason: 'RETENTION_UNAVAILABLE' }; }
}
async function admit(request, env, sessionId, count, now) {
  const window = Math.floor(now/MINUTE)*MINUTE, s = database(env);
  const subject = await musicRateSourceHash(request,env,'analytics',window);
  // Random session UUID is not an account/device identifier. IP is HMAC-only;
  // both source and global budgets stop rotating UUIDs from bypassing admission.
  const session = sessionId.replaceAll('-','').padEnd(64,'0');
  const statements = [['session',session],['source',subject],['global','0'.repeat(64)]].flatMap(([scope,key]) => [
    s.prepare(`INSERT INTO music_analytics_rates(scope,window_start,subject,hits) VALUES(?,?,?,?)
      ON CONFLICT(scope,window_start,subject) DO UPDATE SET hits=hits+excluded.hits RETURNING hits`)
      .bind(scope,window,key,count),
    s.prepare(`INSERT INTO music_analytics_admission_guard(singleton,passed) VALUES(1,changes())
      ON CONFLICT(singleton) DO UPDATE SET passed=excluded.passed`)
  ]);
  statements.push(s.prepare('DELETE FROM music_analytics_admission_guard'));
  try {
    const result = (await s.batch(statements)).map(rows);
    if (result.length !== 7 || [result[0],result[2],result[4]].some(r => r.length !== 1 || !integer(r[0].hits))) throw new Error('counter');
  } catch (error) {
    if (String(error?.message).includes('MUSIC_ANALYTICS_RATE_LIMITED')) {
      throw Object.assign(new Error('limited'),{ code:'MUSIC_ANALYTICS_RATE_LIMITED',status:429,
        retryAfter: Math.max(1,Math.ceil((window+MINUTE-now)/1000)) });
    }
    throw error;
  }
}
export function validateMusicEvents(input, now) {
  if (!exact(input,['consentVersion','events']) || input.consentVersion !== MUSIC_ANALYTICS_VERSION ||
    !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 20) fail('INVALID_INPUT',400);
  let session;
  return input.events.map(event => {
    if (['vip_grant_confirmed','vip_grant_reversed'].includes(event?.eventType)) fail('MUSIC_ANALYTICS_SERVER_EVENT_ONLY',403);
    if (!exact(event,fields) || !browserEvents.includes(event.eventType) ||
      !['eventId','playSessionId','anonymousSessionId','trackId'].every(key => validMusicId(event[key]) && event[key]===event[key].toLowerCase()) ||
      !integer(event.revisionNo) || event.revisionNo < 1 || !['full','preview'].includes(event.variant) ||
      !integer(event.occurredAt) || Math.abs(event.occurredAt-now)>5*MINUTE ||
      !integer(event.listenedMs) || event.listenedMs>DAY || !sources.includes(event.entrySource)) fail('INVALID_INPUT',400);
    session ??= event.anonymousSessionId;
    if (event.anonymousSessionId !== session) fail('INVALID_INPUT',400);
    return event;
  });
}
async function collect(request,env,input,now) {
  const events = validateMusicEvents(input,now);
  // Admission is its own transaction: malformed track batches and lost-receipt
  // retries also consume event units. No unmetered publication reads on failure.
  await admit(request,env,events[0].anonymousSessionId,events.length,now);
  const s = database(env);
  if (!await retentionReady(s,now)) fail('MUSIC_ANALYTICS_RETENTION_UNREADY',503);
  try {
    const results = (await s.batch(events.map(e => s.prepare(`INSERT INTO music_analytics_events
      (event_id,event_type,play_session_id,anonymous_session_id,track_id,revision_no,variant,occurred_at,received_at,listened_ms,entry_source,consent_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING event_id`)
      .bind(e.eventId,e.eventType,e.playSessionId,e.anonymousSessionId,e.trackId,e.revisionNo,e.variant,e.occurredAt,now,e.listenedMs,e.entrySource,MUSIC_ANALYTICS_VERSION)))).map(rows);
    return { accepted: results.reduce((sum,r) => sum+r.length,0) };
  } catch (error) {
    if (/MUSIC_ANALYTICS_(INVALID_TRACK|INVALID_EVENT|SESSION_CONFLICT|START_REQUIRED)/.test(String(error?.message))) fail('INVALID_EVENT',400);
    throw error;
  }
}
async function body(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || request.headers.has('content-encoding')) fail('UNSUPPORTED_MEDIA_TYPE',415);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared)>16384)) fail('REQUEST_TOO_LARGE',413);
  if (!request.body) fail('INVALID_INPUT',400);
  const reader = request.body.getReader(); let size=0;
  try {
    return await bounded(async () => {
      const decoder = new TextDecoder('utf-8',{ fatal:true }); let text='';
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength; if (size>16384) fail('REQUEST_TOO_LARGE',413);
        text += decoder.decode(value,{stream:true});
      }
      if (declared !== null && size!==Number(declared)) fail('INVALID_INPUT',400);
      try { return JSON.parse(text+decoder.decode()); } catch { fail('INVALID_INPUT',400); }
    },3000);
  } catch(error) {
    if(error?.status) throw error;
    fail(error?.message==='timeout' ? 'REQUEST_TIMEOUT' : 'INVALID_INPUT',error?.message==='timeout' ? 408 : 400);
  } finally { await bounded(()=>reader.cancel(),50).catch(() => {}); reader.releaseLock(); }
}
const headers = { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store',
  'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin' };
const response = (request,status,data,extra={}) => new Response(request.method==='HEAD' ? null : JSON.stringify(data),{ status,headers:{...headers,...extra} });
export const isMusicAnalyticsPath = path => ['/api/music/events','/api/music/analytics/config'].includes(path);
export async function handleMusicAnalytics(request,env,{ clock=Date.now }={}) {
  try {
    const url = new URL(request.url), config = url.pathname==='/api/music/analytics/config';
    if (!isMusicAnalyticsPath(url.pathname) || url.search) fail('INVALID_INPUT',400);
    if (config ? !['GET','HEAD'].includes(request.method) : request.method!=='POST') fail('METHOD_NOT_ALLOWED',405);
    const readiness = musicAnalyticsConfiguration(env);
    if (!readiness.available) return response(request,config ? 200 : 503,config ? readiness : {error:{code:readiness.reason}});
    const now = clock(); if (!integer(now)) throw new Error('clock');
    if (config) {
      const limited = await checkMusicRateLimit(request,env,'catalog',{clock});
      if (limited) throw limited;
      const ready = await bounded(() => retentionReady(database(env),now));
      return response(request,200,{...readiness,available:ready,reason:ready ? null : 'RETENTION_UNREADY'});
    }
    if (request.headers.get('origin') !== url.origin || request.headers.get('x-requested-with') !== 'StationCatMusicAnalytics' ||
      ['cross-site','same-site'].includes(request.headers.get('sec-fetch-site'))) fail('ORIGIN_MISMATCH',403);
    const input = await body(request);
    const result = await bounded(() => collect(request,env,input,now));
    return response(request,200,{ok:true,...result});
  } catch (error) {
    const known = Number.isInteger(error?.status) && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code || '');
    return response(request,known ? error.status : 503,{error:{code:known ? error.code : 'MUSIC_ANALYTICS_UNAVAILABLE'}},
      error?.retryAfter ? {'Retry-After':String(error.retryAfter)} : {});
  }
}
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) fail('INVALID_INPUT',400);
  const parsed = Date.parse(value+'T00:00:00Z');
  if (!integer(parsed) || new Date(parsed).toISOString().slice(0,10)!==value) fail('INVALID_INPUT',400);
  return parsed;
}
// Called only after the existing Access verifier. No session IDs, IPs, keys,
// event rows, secrets or original membership database queries leave this adapter.
export async function readMusicAnalytics(env,query={}, {clock=Date.now}={}) {
  const now=clock(), today=Math.floor(now/DAY)*DAY;
  const from=query.from===undefined ? today-6*DAY : date(query.from), to=query.to===undefined ? today : date(query.to);
  if (Object.keys(query).some(k=>!['from','to'].includes(k)) || to<from || to-from>=31*DAY || to>today || from<today-364*DAY) fail('INVALID_INPUT',400);
  const config=musicAnalyticsConfiguration(env), base={from:new Date(from).toISOString().slice(0,10),to:new Date(to).toISOString().slice(0,10),
    metrics:[],unavailableMetrics,retention:config.retention};
  if (!config.available) return {...base,available:false,reason:config.reason};
  try {
    return await bounded(async () => {
      const s=database(env);
      if (!await retentionReady(s,now)) return {...base,available:false,reason:'RETENTION_UNREADY'};
      const metrics=rows(await s.prepare(`SELECT metric,variant,access_kind AS accessKind,SUM(value) AS value FROM music_analytics_daily
        WHERE day_start_ms>=? AND day_start_ms<? AND day_start_ms>? AND metric IN ('play_start','qualified_play','play_complete','preview_end','vip_cta_click')
        GROUP BY metric,variant,access_kind ORDER BY metric,variant,access_kind`).bind(from,to+DAY,now-365*DAY).all());
      return {...base,available:metrics.length>0,reason:metrics.length ? null : 'NO_DATA',metrics};
    });
  } catch { return {...base,available:false,reason:'MUSIC_ANALYTICS_UNAVAILABLE'}; }
}
