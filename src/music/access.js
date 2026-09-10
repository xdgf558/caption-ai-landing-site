import { readerLibraryPaths } from '../data/reader-library-client.js';
import { projectPublicTrack } from './catalog.js';
import { MUSIC_LOCALES, isoTime, positiveInteger } from './policy.js';
import { readMusicMembership } from './membership.js';

// Response contracts only. M2 must wire routes and recheck each media request before touching R2.
function response(request, status, body) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie'
  } });
}
const errorBody = code => ({ error: { code } });
const validMethod = request => request.method === 'GET' || request.method === 'HEAD';

export async function musicCapabilities(request, env, {
  locale = 'zh-Hant', vipDeliveryEnabled = false, clock = Date.now, timeoutMs = 1500
} = {}) {
  if (!validMethod(request)) return response(request, 405, errorBody('METHOD_NOT_ALLOWED'));
  if (!MUSIC_LOCALES.includes(locale)) return response(request, 400, errorBody('INVALID_INPUT'));
  const membership = await readMusicMembership(request, env, { clock, timeoutMs });
  const enabled = vipDeliveryEnabled === true;
  const path = membership.status === 200 ? readerLibraryPaths[locale] : null;
  const body = {
    authenticated: membership.authenticated, membershipStatus: membership.membershipStatus,
    canPlayVipFull: enabled && membership.membershipStatus === 'active', validUntil: membership.validUntil,
    lifetime: false, serverNow: membership.serverNow, membershipCenterPath: path,
    loginPath: membership.authenticated ? null : path, musicVipDeliveryEnabled: enabled
  };
  if (membership.code) body.error = { code: membership.code };
  return response(request, membership.status, body);
}

export async function musicAccess(request, env, {
  record, revisionNo, variant, vipDeliveryEnabled = false, clock = Date.now, timeoutMs = 1500
} = {}) {
  const result = await resolveMusicAccess(request, env, {
    record, revisionNo, variant, vipDeliveryEnabled, clock, timeoutMs
  });
  return response(request, result.status, result.body);
}

// Shared by the lightweight access endpoint and media delivery. It never reads media storage.
export async function resolveMusicAccess(request, env, {
  record, revisionNo, variant, vipDeliveryEnabled = false, clock = Date.now, timeoutMs = 1500
} = {}) {
  const result = (status, body) => ({ status, body });
  if (!validMethod(request)) return result(405, errorBody('METHOD_NOT_ALLOWED'));
  if (!['full', 'preview'].includes(variant)) return result(400, errorBody('INVALID_VARIANT'));
  if (!positiveInteger(revisionNo)) return result(400, errorBody('INVALID_INPUT'));
  let now;
  try { now = clock(); isoTime(now); }
  catch { return result(503, errorBody('MEMBERSHIP_UNAVAILABLE')); }
  if (['unpublished', 'archived'].includes(record?.track?.lifecycle)) {
    return result(410, errorBody('TRACK_UNAVAILABLE'));
  }
  const track = projectPublicTrack(record, { locale: 'zh-Hant', now });
  if (!track) return result(404, errorBody('NOT_FOUND'));
  if (track.audioVersion !== revisionNo) return result(409, errorBody('VERSION_CONFLICT'));
  const access = { effectiveAccess: track.effectiveAccess,
    canPlayFull: track.effectiveAccess === 'free', canPreview: track.previewAvailable, reason: null };
  const denied = (status, code) => result(status, { ...access, reason: code, ...errorBody(code) });
  if (variant === 'preview') {
    return access.canPreview ? result(200, access) : denied(404, 'PREVIEW_UNAVAILABLE');
  }
  if (access.canPlayFull) return result(200, access);
  if (vipDeliveryEnabled !== true) return denied(503, 'VIP_DELIVERY_DISABLED');
  const membership = await readMusicMembership(request, env, { clock, timeoutMs });
  if (membership.code) return denied(membership.status, membership.code);
  if (!membership.authenticated) return denied(401, 'AUTH_REQUIRED');
  if (membership.membershipStatus === 'expired') return denied(403, 'MEMBERSHIP_EXPIRED');
  if (membership.membershipStatus !== 'active') return denied(403, 'VIP_REQUIRED');
  return result(200, { ...access, canPlayFull: true });
}
