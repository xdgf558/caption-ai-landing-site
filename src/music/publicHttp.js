import { musicAccess, musicCapabilities } from './access.js';
import { buildPublicCatalog, projectPublicTrack, projectPublicTrackDetail } from './catalog.js';
import { ASSET_LIMITS } from './assetFormats.js';
import { isoTime, MUSIC_LOCALES, positiveInteger } from './policy.js';
import { validMusicId } from './publicationValidation.js';
import { checkAssetIdentity, checkStoredObject } from './resources.js';
import { musicRuntime, musicRuntimeFlags } from './runtime.js';
import { cancelBody } from './storage.js';
import { loadPublishedMusicRecord, loadPublicMusicCollectionSnapshot, loadPublicMusicSnapshot } from './publicStore.js';

const TRACK_PATH = /^\/api\/music\/tracks\/([^/]+)$/;
const TRACK_ASSET_PATH = /^\/api\/music\/tracks\/([^/]+)\/(cover|lyrics)$/;
const TRACK_ACCESS_PATH = /^\/api\/music\/tracks\/([^/]+)\/access$/;
const COLLECTION_PATH = /^\/api\/music\/collections\/([^/]+)$/;
const PUBLIC_JSON_HEADERS = Object.freeze({
  'Cache-Control': 'public, max-age=0, must-revalidate',
  'Content-Type': 'application/json; charset=utf-8',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff'
});
const NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff'
});
const PRIVATE_HEADERS = Object.freeze({ ...NO_STORE_HEADERS, 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' });

function route(pathname) {
  if (pathname === '/api/music/catalog') return { kind: 'catalog' };
  if (pathname === '/api/music/me/capabilities') return { kind: 'capabilities', private: true };
  let match = TRACK_ACCESS_PATH.exec(pathname);
  if (match) return { kind: 'access', trackId: match[1], private: true };
  match = TRACK_ASSET_PATH.exec(pathname);
  if (match) return { kind: match[2], trackId: match[1] };
  match = TRACK_PATH.exec(pathname);
  if (match) return { kind: 'track', trackId: match[1] };
  match = COLLECTION_PATH.exec(pathname);
  if (match) return { kind: 'collection', slug: match[1] };
  return null;
}

export const isMusicPublicPath = pathname => typeof pathname === 'string' && route(pathname) !== null;

function response(request, status, body, { privateResponse = false, headers = {} } = {}) {
  return new Response(request.method === 'HEAD' || status === 304 ? null : JSON.stringify(body), {
    status, headers: { ...(privateResponse ? PRIVATE_HEADERS : NO_STORE_HEADERS), ...headers }
  });
}

function errorResponse(request, status, code, currentRoute, headers = {}) {
  return response(request, status, { error: { code } }, { privateResponse: currentRoute?.private === true, headers });
}

function exactParam(url, key) {
  if ([...url.searchParams.keys()].some(candidate => candidate !== key) || url.searchParams.getAll(key).length !== 1) return null;
  return url.searchParams.get(key);
}

function localeInput(url) {
  const locale = exactParam(url, 'locale');
  return MUSIC_LOCALES.includes(locale) ? locale : null;
}

function versionInput(url) {
  const raw = exactParam(url, 'v');
  if (!/^[1-9][0-9]*$/.test(raw || '')) return null;
  const value = Number(raw);
  return positiveInteger(value) ? value : null;
}

function validSlug(value) {
  return typeof value === 'string' && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function normalizedTrackId(value) {
  return validMusicId(value) ? value.toLowerCase() : null;
}

function etagMatches(value, etag) {
  if (typeof value !== 'string') return false;
  return value.split(',').some(candidate => {
    const tag = candidate.trim();
    return tag === '*' || tag === etag || (tag.startsWith('W/') && tag.slice(2) === etag);
  });
}

async function jsonEtag(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return '"music-' + Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') + '"';
}

async function publicJson(request, body, locale, etag = null) {
  const encoded = JSON.stringify(body), current = etag || await jsonEtag(body);
  const headers = { ...PUBLIC_JSON_HEADERS, 'Content-Language': locale, ETag: current };
  if (etagMatches(request.headers.get('If-None-Match'), current)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : encoded, { status: 200, headers });
}

function publishedStatus(record) {
  if (!record.track) return { status: 404, code: 'NOT_FOUND' };
  if (['unpublished', 'archived'].includes(record.track.lifecycle)) return { status: 410, code: 'TRACK_UNAVAILABLE' };
  if (record.track.lifecycle !== 'published') return { status: 404, code: 'NOT_FOUND' };
  return null;
}

function publicAsset(record, kind, trackId) {
  const field = kind === 'cover' ? 'cover_asset_id' : 'lyrics_asset_id';
  const id = record.revision?.[field];
  if (id === null || id === undefined) return null;
  const matches = record.assets.filter(asset => asset.id === id);
  if (matches.length !== 1) throw new Error('asset');
  const asset = matches[0];
  checkAssetIdentity(asset);
  if (asset.state !== 'validated' || asset.owner_track_id !== trackId || asset.kind !== kind ||
    !Number.isSafeInteger(asset.byte_size) || asset.byte_size < 1 || asset.byte_size > ASSET_LIMITS[kind]) throw new Error('asset');
  return asset;
}

function publicationStorageReady(record) {
  try {
    for (const asset of record.assets) checkAssetIdentity(asset);
    return true;
  } catch { return false; }
}

async function assetResponse(request, runtime, record, kind, trackId, revisionNo) {
  const status = publishedStatus(record);
  if (status) return errorResponse(request, status.status, status.code, { kind });
  if (!publicationStorageReady(record)) return errorResponse(request, 404, 'NOT_FOUND', { kind });
  const track = projectPublicTrack(record, { locale: 'zh-Hant', now: record.now });
  if (!track) return errorResponse(request, 404, 'NOT_FOUND', { kind });
  if (track.audioVersion !== revisionNo) return errorResponse(request, 409, 'VERSION_CONFLICT', { kind });
  let asset;
  try { asset = publicAsset(record, kind, trackId); }
  catch { return errorResponse(request, 503, 'MEDIA_UNAVAILABLE', { kind }); }
  if (!asset) return errorResponse(request, 404, 'NOT_FOUND', { kind });
  let object;
  try {
    object = await runtime.bucket.get(asset.object_key, { onlyIf: { etagMatches: asset.etag } });
    checkStoredObject(object, asset);
  } catch {
    cancelBody(object);
    return errorResponse(request, 503, 'MEDIA_UNAVAILABLE', { kind });
  }
  const contentType = kind === 'lyrics' ? 'text/plain; charset=utf-8' : asset.content_type;
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Length': String(asset.byte_size),
    'Content-Type': contentType,
    'Cross-Origin-Resource-Policy': 'same-origin',
    ETag: `"${asset.etag}"`,
    'Last-Modified': new Date(Math.floor(record.track.published_at / 1000) * 1000).toUTCString(),
    'X-Content-Type-Options': 'nosniff'
  };
  if (request.method === 'HEAD') {
    cancelBody(object);
    return new Response(null, { status: 200, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

export async function handleMusicPublic(request, env, { clock = Date.now, timeoutMs = 1500 } = {}) {
  const url = new URL(request.url), currentRoute = route(url.pathname);
  if (!currentRoute) return errorResponse(request, 404, 'NOT_FOUND', currentRoute);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return errorResponse(request, 405, 'METHOD_NOT_ALLOWED', currentRoute, { Allow: 'GET, HEAD' });
  }

  const locale = ['catalog', 'capabilities', 'track', 'collection'].includes(currentRoute.kind) ? localeInput(url) : null;
  const revisionNo = ['cover', 'lyrics', 'access'].includes(currentRoute.kind) ? versionInput(url) : null;
  const trackId = currentRoute.trackId === undefined ? null : normalizedTrackId(currentRoute.trackId);
  if ((['catalog', 'capabilities', 'track', 'collection'].includes(currentRoute.kind) && !locale) ||
    (['cover', 'lyrics', 'access'].includes(currentRoute.kind) && !revisionNo) ||
    (currentRoute.trackId !== undefined && !trackId) ||
    (currentRoute.kind === 'collection' && !validSlug(currentRoute.slug))) {
    return errorResponse(request, 400, 'INVALID_INPUT', currentRoute);
  }
  if (!musicRuntimeFlags(env).public) return errorResponse(request, 503, 'MUSIC_PUBLIC_DISABLED', currentRoute);

  let runtime, now;
  try {
    runtime = musicRuntime(env);
    now = clock(); isoTime(now);
  } catch (error) {
    return errorResponse(request, 503, error?.code === 'MUSIC_NOT_CONFIGURED' ? error.code : 'MUSIC_DATABASE_UNAVAILABLE', currentRoute);
  }

  if (currentRoute.kind === 'capabilities') {
    return musicCapabilities(request, env, { locale, vipDeliveryEnabled: runtime.flags.vipDelivery,
      clock: () => now, timeoutMs });
  }

  try {
    if (currentRoute.kind === 'catalog' || currentRoute.kind === 'collection') {
      const snapshot = currentRoute.kind === 'catalog' ? await loadPublicMusicSnapshot(runtime.db, now)
        : await loadPublicMusicCollectionSnapshot(runtime.db, currentRoute.slug, now);
      const catalog = await buildPublicCatalog({ ...snapshot,
        records: snapshot.records.filter(publicationStorageReady), locale, now });
      if (currentRoute.kind === 'catalog') return publicJson(request, catalog.body, locale, catalog.etag);
      const collection = catalog.body.collections.find(item => item.slug === currentRoute.slug);
      if (!collection) return errorResponse(request, 404, 'NOT_FOUND', currentRoute);
      const tracks = new Map(catalog.body.tracks.map(track => [track.id, track]));
      const body = { schemaVersion: 2, catalogVersion: catalog.body.catalogVersion, locale,
        nextPolicyChangeAt: catalog.body.nextPolicyChangeAt, collection,
        tracks: collection.trackIds.map(id => tracks.get(id)).filter(Boolean) };
      return publicJson(request, body, locale);
    }

    const record = await loadPublishedMusicRecord(runtime.db, trackId, { includeSettings: true });
    Object.assign(record, { now });
    if (currentRoute.kind === 'access') {
      const status = publishedStatus(record);
      if (status) return errorResponse(request, status.status, status.code, currentRoute);
      if (!publicationStorageReady(record)) return errorResponse(request, 404, 'NOT_FOUND', currentRoute);
      return musicAccess(request, env, { record, revisionNo, variant: 'full',
        vipDeliveryEnabled: runtime.flags.vipDelivery, clock: () => now, timeoutMs });
    }
    if (currentRoute.kind === 'cover' || currentRoute.kind === 'lyrics') {
      return assetResponse(request, runtime, record, currentRoute.kind, trackId, revisionNo);
    }
    const status = publishedStatus(record);
    if (status) return errorResponse(request, status.status, status.code, currentRoute);
    if (!publicationStorageReady(record)) return errorResponse(request, 404, 'NOT_FOUND', currentRoute);
    const track = projectPublicTrackDetail(record, { locale, now });
    if (!track) return errorResponse(request, 404, 'NOT_FOUND', currentRoute);
    return publicJson(request, { schemaVersion: 2, catalogVersion: record.catalogVersion, locale, track }, locale);
  } catch (error) {
    const code = error?.code === 'MUSIC_NOT_CONFIGURED' ? error.code : 'MUSIC_DATABASE_UNAVAILABLE';
    return errorResponse(request, 503, code, currentRoute);
  }
}
