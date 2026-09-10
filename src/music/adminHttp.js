import { musicRuntime, checkMusicDatabase } from './runtime.js';
import { executeMusicPublication } from './publication.js';
import { createAdminMusicTrack, saveAdminMusicTrack, readAdminMusicTrack, listAdminMusicTracks,
  saveAdminMusicRights, archiveAdminMusicTrack, listAdminMusicAudit } from './admin.js';
import { editVersion, fail, fields, isObject, musicId, mutationKey, text } from './adminValidation.js';

export const isMusicAdminPath = path => path === '/admin/api/music' || path.startsWith('/admin/api/music/');
function response(request, status, body, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Vary': 'Cookie, Cf-Access-Jwt-Assertion', ...headers
  } });
}
export function musicAdminDenied(request, status) {
  return response(request, status, { ok: false,
    code: status === 503 ? 'ADMIN_AUTH_UNAVAILABLE' : status === 403 ? 'ADMIN_FORBIDDEN' : 'ADMIN_AUTH_REQUIRED' });
}
async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('UNSUPPORTED_MEDIA_TYPE', 415);
  if (request.headers.has('content-encoding')) fail('UNSUPPORTED_MEDIA_TYPE', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) fail('REQUEST_TOO_LARGE', 413);
  if (!request.body) fail('INVALID_INPUT', 400);
  const reader = request.body.getReader(); let timer;
  try {
    const consume = async () => {
      const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, body = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 65536) fail('REQUEST_TOO_LARGE', 413);
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
      let parsed;
      try { parsed = JSON.parse(body); } catch { fail('INVALID_INPUT', 400); }
      if (!isObject(parsed)) fail('INVALID_INPUT', 400);
      return parsed;
    };
    return await Promise.race([consume(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('REQUEST_TIMEOUT'), { code: 'REQUEST_TIMEOUT', status: 408 })), 3000);
    })]);
  } catch (error) {
    if (error.status) throw error;
    fail('INVALID_INPUT', 400);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {}).finally(() => reader.releaseLock());
  }
}

// The production Worker supplies its Access-JWT verifier, not an email header or a local bypass.
export async function handleMusicAdmin(request, env, authorize) {
  try {
    if (typeof authorize !== 'function') fail('ADMIN_AUTH_UNAVAILABLE', 503);
    const actorId = await authorize(request, env);
    if (typeof actorId !== 'string' || !actorId.trim() || actorId.length > 200) fail('ADMIN_AUTH_REQUIRED', 401);
    const url = new URL(request.url), path = url.pathname;
    if (url.href.length > 2048) fail('INVALID_INPUT', 400);
    const read = ['GET', 'HEAD'].includes(request.method);
    if (!read) {
      if (!['POST', 'PATCH', 'PUT'].includes(request.method)) fail('METHOD_NOT_ALLOWED', 405);
      if (request.headers.get('origin') !== url.origin ||
        request.headers.get('x-requested-with') !== 'StationCatMusicAdmin' ||
        ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))) fail('ORIGIN_MISMATCH', 403);
    }
    const query = Object.fromEntries(url.searchParams);
    if ([...url.searchParams].length !== Object.keys(query).length) fail('INVALID_INPUT', 400);
    const runtime = musicRuntime(env);
    const settings = await checkMusicDatabase(runtime.db);
    const context = { actorId, key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match') };
    let result;
    if (path === '/admin/api/music/status' && read) {
      fields(query, []);
      result = { ...settings, flags: runtime.flags,
        capabilities: { drafts: true, rightsReview: true, unpublish: true, archive: true,
          uploads: false, technicalReview: false, publish: false, collections: false, media: false } };
    } else if (path === '/admin/api/music/tracks') {
      if (read) {
        fields(query, ['before', 'status', 'q']);
        result = await listAdminMusicTracks(runtime.db, { before: query.before === undefined ? undefined : Number(query.before), status: query.status, q: query.q });
      } else if (request.method === 'POST') {
        fields(query, []); mutationKey(context.key);
        result = await createAdminMusicTrack(runtime.db, await readBody(request), context);
      } else fail('METHOD_NOT_ALLOWED', 405);
    } else if (path === '/admin/api/music/audit' && read) {
      fields(query, ['before']);
      result = await listAdminMusicAudit(runtime.db, query.before === undefined ? undefined : Number(query.before));
    } else {
      fields(query, []);
      const track = /^\/admin\/api\/music\/tracks\/([^/]+)(?:\/(publish|unpublish|archive))?$/.exec(path);
      const rights = /^\/admin\/api\/music\/revisions\/([^/]+)\/rights-review$/.exec(path);
      if (track) {
        const id = musicId(track[1]), action = track[2];
        if (!action && read) result = await readAdminMusicTrack(runtime.db, id);
        else {
          if (request.method !== (action ? 'POST' : 'PATCH')) fail('METHOD_NOT_ALLOWED', 405);
          mutationKey(context.key); editVersion(context.ifMatch);
          const input = await readBody(request);
          if (!action) result = await saveAdminMusicTrack(runtime.db, id, input, context);
          else if (action === 'archive') result = await archiveAdminMusicTrack(runtime.db, id, input, context);
          else {
            fields(input, action === 'publish' ? ['revisionId', 'reason', 'confirmedPolicyVersion'] : ['revisionId', 'reason']);
            musicId(input.revisionId); text(input.reason, 1000);
            // The complete cover/lyrics/evidence verifier is not wired yet. Never use the local fixture verifier.
            if (action === 'publish') fail('MUSIC_TECHNICAL_VERIFIER_UNAVAILABLE', 503);
            result = await executeMusicPublication(runtime.db, { ...input, trackId: id, action,
              ifMatch: context.ifMatch, idempotencyKey: context.key }, { actorId });
          }
        }
      } else if (rights) {
        if (request.method !== 'PUT') fail('METHOD_NOT_ALLOWED', 405);
        musicId(rights[1]); mutationKey(context.key); editVersion(context.ifMatch);
        result = await saveAdminMusicRights(runtime.db, rights[1], await readBody(request), context);
      } else fail('NOT_FOUND', 404);
    }
    return response(request, 200, { ok: true, ...result }, result.editVersion ? { ETag: `"edit-${result.editVersion}"` } : {});
  } catch (error) {
    const known = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 &&
      typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code);
    return response(request, known ? error.status : 503, { ok: false, code: known ? error.code : 'MUSIC_ADMIN_UNAVAILABLE' });
  }
}
