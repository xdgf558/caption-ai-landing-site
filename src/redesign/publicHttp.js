import { resolveMusicAccess } from '../music/access.js';
import { loadPublishedMusicRecord } from '../music/publicStore.js';
import { validateMusicMediaAsset } from '../music/storage.js';
import { checkMusicRateLimit } from '../music/rateLimits.js';
import { checkedContentRuntime, contentFailure, requestDeadline, contentTrack, contentClip, contentGame,
  listContentTracks, listContentClips, listContentGames, assetOwner } from './publicStore.js';
import { contentBase, uuid, slug, positive, millis, metadata, strictJson, requestInput, cursorFor } from './publicValidation.js';
import { promotion, projectTrack, projectClip, projectGame, publicHome } from './publicContent.js';
import { previewIdentity, resourceReady, streamContentAsset } from './publicResources.js';

export const isStationContentPath = pathname => pathname === contentBase || pathname.startsWith(contentBase + '/');
const messages = Object.freeze({
  NOT_FOUND: 'Content is unavailable.', INVALID_INPUT: 'Invalid request.',
  METHOD_NOT_ALLOWED: 'Use GET or HEAD.', CONTENT_DISABLED: 'Website content is not enabled.',
  CONTENT_NOT_CONFIGURED: 'Website content bindings are unavailable.',
  CONTENT_SCHEMA_UNAVAILABLE: 'Website content schema is not ready.',
  CONTENT_DATABASE_UNAVAILABLE: 'Website content is temporarily unavailable.',
  CONTENT_SERVICE_UNAVAILABLE: 'Website content is temporarily unavailable.',
  CONTENT_MEDIA_UNAVAILABLE: 'Media is temporarily unavailable.',
  PREVIEW_UNAVAILABLE: 'No public preview is enabled.', FULL_AUDIO_UNAVAILABLE: 'No current full audio is available.',
  VERSION_CONFLICT: 'Reload the current content version.', MUSIC_PUBLIC_DISABLED: 'Full audio delivery is not enabled.',
  VIP_DELIVERY_DISABLED: 'Member audio delivery is not enabled.', AUTH_REQUIRED: 'Sign in to play the full audio.',
  VIP_REQUIRED: 'An active membership is required.', MEMBERSHIP_EXPIRED: 'The membership has expired.',
  ACCOUNT_RESTRICTED: 'The account cannot access this resource.', MEMBERSHIP_UNAVAILABLE: 'Membership verification is temporarily unavailable.',
  MUSIC_RATE_LIMITED: 'Too many requests. Try again later.', MUSIC_RATE_LIMIT_UNAVAILABLE: 'Request admission is temporarily unavailable.',
  RANGE_NOT_SATISFIABLE: 'The requested byte range is unavailable.'
});
function route(pathname) {
  const path = pathname.slice(contentBase.length);
  if (['/tracks', '/clips', '/games', '/home'].includes(path)) return { kind: path.slice(1) };
  const track = /^\/tracks\/([^/]+)(?:\/(playback|audio|clips))?$/.exec(path);
  if (track) return { kind: track[2] || 'track', slug: track[1] };
  const game = /^\/games\/([^/]+)$/.exec(path);
  if (game) return { kind: 'game', slug: game[1] };
  const asset = /^\/assets\/([^/]+)$/.exec(path);
  if (asset) return { kind: 'asset', id: asset[1] };
  return null;
}
function json(request, body, { status = 200, privateResponse = false, requestId, headers = {} } = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': privateResponse ? 'private, no-store' : 'no-store',
    ...(privateResponse ? { Vary: 'Cookie' } : {}),
    'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Request-ID': requestId, ...headers
  } });
}
const error = (request, code, status, context, headers) => json(request, {
  code: Object.hasOwn(messages, code) ? code : 'CONTENT_SERVICE_UNAVAILABLE',
  message: messages[code] || messages.CONTENT_SERVICE_UNAVAILABLE, request_id: context.requestId
}, { ...context, status, headers });
async function page(request, runtime, rows, projector, options, context) {
  const { limit } = options, items = [];
  // One bounded source page; filtered rows may yield an empty page with a cursor.
  // Advance by the scanned source rows so invalid content cannot create a loop.
  for (const row of rows.slice(0, limit)) {
    const projection = await projector(runtime, row, options);
    if (projection) items.push(projection.dto);
  }
  return json(request, { schemaVersion: 1, locale: options.locale, items,
    nextCursor: rows.length > limit ? cursorFor(rows[limit - 1]) : null }, context);
}
async function playbackAsset(request, env, runtime, row, variant, options) {
  const { now, run, clock, timeoutMs } = options;
  if (!row || !uuid(row.id) || !slug(row.slug) || !positive(row.published_revision) || !millis(row.published_at) ||
    row.published_at > now || !metadata(row.metadata_json, options.locale, { artist: true })) throw contentFailure('NOT_FOUND', 404);
  if (variant === 'preview') {
    const promo = promotion(row, now);
    if (!promo?.previewEnabled) throw contentFailure('PREVIEW_UNAVAILABLE', 404);
    let assets;
    try {
      assets = strictJson(row.assets_json, 131072);
      if (!Array.isArray(assets) || assets.length > 4 || assets.some(asset => !asset || !uuid(asset.id)) ||
        new Set(assets.map(asset => asset.id.toLowerCase())).size !== assets.length) throw new TypeError('assets');
    } catch { throw contentFailure(); }
    const previews = assets.filter(asset => asset.id === promo.previewAssetId);
    const sources = assets.filter(asset => asset.id === previews[0]?.derived_from_asset_id);
    if (previews.length !== 1 || sources.length !== 1 || !previewIdentity(previews[0], sources[0], row.id, now)) {
      throw contentFailure('PREVIEW_UNAVAILABLE', 404);
    }
    if (!await resourceReady(runtime, previews[0], run)) throw contentFailure('CONTENT_MEDIA_UNAVAILABLE');
    return { asset: previews[0], promotionRevision: promo.revision };
  }
  if (!['free_full', 'existing_entitlement'].includes(row.site_audio_mode) || !uuid(row.legacy_revision_id)) {
    throw contentFailure('FULL_AUDIO_UNAVAILABLE', 404);
  }
  if (!runtime.flags.public) throw contentFailure('MUSIC_PUBLIC_DISABLED');
  const legacy = await run(() => loadPublishedMusicRecord(runtime.db, row.id));
  if (legacy.track?.lifecycle !== 'published') throw contentFailure('FULL_AUDIO_UNAVAILABLE', 404);
  if (legacy.revision?.id !== row.legacy_revision_id) throw contentFailure('VERSION_CONFLICT', 409);
  // site_audio_mode never grants free or member access. This is exactly the
  // existing finite reader membership/policy check, on every resource request.
  const decision = await run(() => resolveMusicAccess(request, env, { record: legacy,
    revisionNo: legacy.revision.revision_no, variant: 'full', vipDeliveryEnabled: runtime.flags.vipDelivery, clock, timeoutMs }));
  if (decision.status !== 200) throw contentFailure(decision.body.error?.code || 'FULL_AUDIO_UNAVAILABLE', decision.status);
  const matches = legacy.assets.filter(asset => asset.id === legacy.revision.audio_asset_id);
  let asset;
  try {
    if (matches.length !== 1) throw new Error('asset');
    asset = validateMusicMediaAsset(matches[0], 'audio', row.id);
  } catch { throw contentFailure('CONTENT_MEDIA_UNAVAILABLE'); }
  // A denied full request has not touched its R2 object, including HEAD/Range.
  if (!await resourceReady(runtime, asset, run)) throw contentFailure('CONTENT_MEDIA_UNAVAILABLE');
  return { asset };
}
export async function handleStationContent(request, env, { clock = Date.now, timeoutMs = 1500, deadlineMs = 10000 } = {}) {
  const url = new URL(request.url), currentRoute = route(url.pathname);
  const context = { requestId: crypto.randomUUID(), privateResponse: ['audio', 'playback'].includes(currentRoute?.kind) };
  if (!currentRoute) return error(request, 'NOT_FOUND', 404, context);
  if (!['GET', 'HEAD'].includes(request.method)) return error(request, 'METHOD_NOT_ALLOWED', 405, context, { Allow: 'GET, HEAD' });
  let input, variant = null, expectedRevision = null, expectedPromotion = null;
  try {
    const allowed = ['tracks', 'games'].includes(currentRoute.kind) ? ['locale', 'limit', 'cursor', ...(currentRoute.kind === 'tracks' ? ['q'] : [])] :
      currentRoute.kind === 'clips' ? ['locale', 'limit', 'cursor'] :
      ['audio', 'playback'].includes(currentRoute.kind) ? ['variant', ...(currentRoute.kind === 'audio' ? ['v', 'p'] : ['locale'])] :
      currentRoute.kind === 'asset' ? [] : ['locale'];
    input = requestInput(url, allowed);
    if ((currentRoute.slug && !slug(currentRoute.slug)) || (currentRoute.id && !uuid(currentRoute.id))) throw new TypeError('path');
    if (['audio', 'playback'].includes(currentRoute.kind)) {
      variant = url.searchParams.get('variant');
      if (!['preview', 'full'].includes(variant)) throw new TypeError('variant');
      if (currentRoute.kind === 'audio') {
        const version = url.searchParams.get('v'), promo = url.searchParams.get('p');
        if (!/^[1-9]\d*$/.test(version || '') || !positive(Number(version))) throw new TypeError('version');
        expectedRevision = Number(version);
        if (variant === 'preview') {
          if (!/^[1-9]\d*$/.test(promo || '') || !positive(Number(promo))) throw new TypeError('promotion');
          expectedPromotion = Number(promo);
        } else if (promo !== null) throw new TypeError('promotion');
      }
    }
  } catch { return error(request, 'INVALID_INPUT', 400, context); }
  if (env?.STATION_CONTENT_PUBLIC_ENABLED !== true && env?.STATION_CONTENT_PUBLIC_ENABLED !== 'true') return error(request, 'CONTENT_DISABLED', 503, context);
  try {
    if (!positive(deadlineMs) || deadlineMs > 10000 || !positive(timeoutMs) || timeoutMs > 5000) throw contentFailure();
    const run = requestDeadline(deadlineMs), runtime = await run(() => checkedContentRuntime(env));
    const now = clock();
    if (!millis(now)) throw contentFailure();
    const country = /^[A-Z]{2}$/.test(request.cf?.country || '') ? request.cf.country : null;
    const options = { ...input, now, country, run, clock, timeoutMs };
    const category = ['audio', 'playback'].includes(currentRoute.kind) ? 'audio' : currentRoute.kind === 'asset' ? 'artwork' : 'catalog';
    const limited = await run(() => checkMusicRateLimit(request, env, category, { clock, timeoutMs }));
    if (limited) return error(request, limited.code, limited.status, context, { 'Retry-After': String(limited.retryAfter) });
    if (currentRoute.kind === 'home') return json(request, { schemaVersion: 1, home: await publicHome(runtime, options) }, context);
    if (currentRoute.kind === 'tracks') return await page(request, runtime,
      await run(() => listContentTracks(runtime.session, options)), projectTrack, options, context);
    if (currentRoute.kind === 'games') return await page(request, runtime,
      await run(() => listContentGames(runtime.session, options)), projectGame, options, context);
    if (currentRoute.kind === 'clips') {
      const parent = currentRoute.slug ? await run(() => contentTrack(runtime.session, now, { slug: currentRoute.slug })) : null;
      if (currentRoute.slug && (!parent || !metadata(parent.metadata_json, input.locale, { artist: true }))) throw contentFailure('NOT_FOUND', 404);
      return await page(request, runtime, await run(() => listContentClips(runtime.session, { ...options, trackId: parent?.id || null })), projectClip, options, context);
    }
    if (currentRoute.kind === 'game') {
      const projected = await projectGame(runtime, await run(() => contentGame(runtime.session, now, { slug: currentRoute.slug })), options);
      if (!projected) throw contentFailure('NOT_FOUND', 404);
      return json(request, { schemaVersion: 1, locale: input.locale, game: projected.dto }, context);
    }
    if (currentRoute.kind === 'asset') {
      const id = currentRoute.id.toLowerCase(), owner = await run(() => assetOwner(runtime.session, id));
      if (!owner || !uuid(owner.id) || ['audio', 'preview', 'evidence'].includes(owner.kind)) throw contentFailure('NOT_FOUND', 404);
      const row = await run(() => owner.type === 'track' ? contentTrack(runtime.session, now, { id: owner.id }) :
        owner.type === 'clip' ? contentClip(runtime.session, now, owner.id) : contentGame(runtime.session, now, { id: owner.id }));
      const projected = owner.type === 'track' ? await projectTrack(runtime, row, options, { detailed: true }) :
        owner.type === 'clip' ? await projectClip(runtime, row, options) : await projectGame(runtime, row, options);
      const asset = projected?.ready.get(id);
      if (!asset) throw contentFailure('NOT_FOUND', 404);
      return await streamContentAsset(request, runtime, asset, row.published_at, run);
    }
    const row = await run(() => contentTrack(runtime.session, now, { slug: currentRoute.slug }));
    if (currentRoute.kind === 'track') {
      const projected = await projectTrack(runtime, row, options, { detailed: true });
      if (!projected) throw contentFailure('NOT_FOUND', 404);
      const related = [];
      for (const id of projected.meta.relatedTrackIds.filter(id => id !== row.id)) {
        const item = await projectTrack(runtime, await run(() => contentTrack(runtime.session, now, { id })), options);
        if (item) related.push(item.dto);
      }
      return json(request, { schemaVersion: 1, locale: input.locale, track: projected.dto, related }, context);
    }
    if (expectedRevision !== null && row && expectedRevision !== row.published_revision) throw contentFailure('VERSION_CONFLICT', 409);
    if (expectedPromotion !== null && row && row.promotion_revision !== expectedPromotion) throw contentFailure('VERSION_CONFLICT', 409);
    const playable = await playbackAsset(request, env, runtime, row, variant, options);
    if (currentRoute.kind === 'audio') return await streamContentAsset(request, runtime, playable.asset, row.published_at, run, { privateAudio: true });
    const audioPath = contentBase + '/tracks/' + row.slug + '/audio?variant=' + variant + '&v=' + row.published_revision +
      (variant === 'preview' ? '&p=' + playable.promotionRevision : '');
    return json(request, { trackId: row.id, variant, revision: row.published_revision,
      ...(variant === 'preview' ? { promotionRevision: playable.promotionRevision } : {}),
      durationMs: playable.asset.duration_ms, audioPath }, context);
  } catch (failure) {
    const known = Object.hasOwn(messages, failure?.code);
    return error(request, known ? failure.code : 'CONTENT_SERVICE_UNAVAILABLE',
      known && Number.isInteger(failure.status) ? failure.status : 503, context, known ? failure.headers : {});
  }
}
