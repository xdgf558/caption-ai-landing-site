import { isReaderMembershipActive, membershipTimestamp } from '../readerMembership.js';
import { isoTime } from './policy.js';

// Same opaque cookie as the existing reader login. No account/privilege input is accepted.
const SESSION_COOKIE = 'station_cat_reader_session';
const unavailable = () => Object.assign(new Error('MEMBERSHIP_UNAVAILABLE'), { code: 'MEMBERSHIP_UNAVAILABLE' });

function sessionToken(request) {
  const matches = (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .filter(value => value.slice(0, value.indexOf('=')) === SESSION_COOKIE);
  if (matches.length !== 1) return null;
  const token = matches[0].slice(matches[0].indexOf('=') + 1);
  return /^[A-Za-z0-9_-]{1,512}$/.test(token) ? token : null;
}

const snapshot = (now, patch = {}) => ({
  status: 200, code: null, authenticated: false, membershipStatus: 'none',
  validUntil: null, serverNow: isoTime(now), ...patch
});

// One primary query provides a consistent auth + membership snapshot, including revocation.
async function queryMembership(db, token) {
  if (typeof db?.withSession !== 'function') throw unavailable();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await db.withSession('first-primary').prepare(`SELECT
    s.account_id AS session_account_id, s.created_at AS session_created_at,
    s.expires_at AS session_expires_at, s.revoked_at AS session_revoked_at,
    a.id AS account_id, a.status AS account_status,
    m.account_id AS membership_account_id, m.membership_level, m.started_at, m.expires_at
    FROM reader_sessions s
    INNER JOIN reader_accounts a ON a.id = s.account_id
    LEFT JOIN reader_memberships m ON m.account_id = a.id
    WHERE s.session_hash = ? LIMIT 2`).bind(hash).all();
  if (result?.success !== true || !Array.isArray(result.results) || result.results.length > 1) throw unavailable();
  if (result.results.length && (!result.results[0] || typeof result.results[0] !== 'object' || Array.isArray(result.results[0]))) {
    throw unavailable();
  }
  return result.results[0] || null;
}

function interpret(row, now) {
  if (!row) return snapshot(now);
  if (!Number.isSafeInteger(row.account_id) || row.account_id < 1 || row.session_account_id !== row.account_id) throw unavailable();
  if (row.session_revoked_at !== null) return snapshot(now);
  const created = membershipTimestamp(row.session_created_at);
  const sessionEnd = membershipTimestamp(row.session_expires_at);
  if (!Number.isFinite(created) || !Number.isFinite(sessionEnd) || sessionEnd <= created) throw unavailable();
  if (created > now || sessionEnd <= now) return snapshot(now);
  if (row.account_status !== 'active') return snapshot(now, { status: 403, code: 'ACCOUNT_RESTRICTED' });
  if (row.membership_account_id === null) return snapshot(now, { authenticated: true });
  // reader_memberships supports exactly one finite site-wide 'member' period, not arbitrary grants.
  if (row.membership_account_id !== row.account_id || row.membership_level !== 'member') throw unavailable();
  const start = membershipTimestamp(row.started_at);
  const end = membershipTimestamp(row.expires_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw unavailable();
  if (end <= now) return snapshot(now, { authenticated: true, membershipStatus: 'expired', validUntil: isoTime(end) });
  if (!isReaderMembershipActive(row, now)) return snapshot(now, { authenticated: true });
  return snapshot(now, { authenticated: true, membershipStatus: 'active',
    // Recheck before either the session or membership ceases to authorize; this is not a new expiry ledger.
    validUntil: isoTime(Math.min(end, sessionEnd)) });
}

export async function readMusicMembership(request, env, { clock = Date.now, timeoutMs = 1500 } = {}) {
  isoTime(clock());
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw unavailable();
  const token = sessionToken(request);
  if (!token) return snapshot(clock());
  let timer;
  try {
    const row = await Promise.race([
      queryMembership(env?.WAITLIST_DB, token),
      new Promise((_, reject) => { timer = setTimeout(() => reject(unavailable()), timeoutMs); })
    ]);
    // A slow query must not authorize using the time from before the request started.
    return interpret(row, clock());
  } catch {
    return snapshot(clock(), { status: 503, code: 'MEMBERSHIP_UNAVAILABLE', membershipStatus: 'unavailable' });
  } finally { clearTimeout(timer); }
}
