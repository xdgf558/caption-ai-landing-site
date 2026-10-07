import { checkMusicDatabase, musicRuntime } from '../music/runtime.js';
import { stationHomeConfig } from '../data/station-home.js';

export const contentFailure = (code = 'CONTENT_DATABASE_UNAVAILABLE', status = 503) => Object.assign(new Error(code), { code, status });
export function resultRows(result, max = 51) {
  if (result?.success !== true || !Array.isArray(result.results) || result.results.length > max) throw contentFailure();
  return result.results;
}

// Only source constants select identifiers. Read the actual bound target and
// migration ledger; never install/replay schema or provision a binding here.
const schemaColumns = Object.freeze({
  station_track_publications: 'track_id,status,published_revision,published_at',
  station_track_revisions: 'track_id,revision,state,metadata_json,legacy_revision_id,site_audio_mode,duration_ms,cover_asset_id,lyrics_asset_id',
  station_track_routes: 'slug,track_id,role,origin',
  station_platform_links: 'id,track_id,provider,territories_json,status,url,verified_at,external_released_at,sort_order,version',
  station_games: 'id,slug,runtime_key,status,published_revision,published_at',
  station_game_revisions: 'id,revision,state,metadata_json,launch_url,supported_devices_json,screenshot_ids_json',
  station_clips: 'id,track_id,type,status,published_revision,published_at',
  station_clip_revisions: 'id,revision,state,metadata_json,media_asset_id,poster_asset_id,duration_ms,subtitles_json',
  station_media_assets: 'id,owner_clip_id,owner_game_id,kind,object_key,content_type,state,byte_size,duration_ms,width,height,sha256,etag',
  station_asset_rights: 'id,music_asset_id,media_asset_id,scope,status,basis,reviewer_id,reviewed_at',
  station_clip_publications: 'id,clip_id,channel,post_id,post_url,external_published_at',
  station_promotions: 'track_id,status,published_revision,published_at',
  station_promotion_revisions: 'track_id,revision,state,enabled,preview_enabled,preview_asset_id,selected_platform_ids_json,selected_clip_ids_json,sort_order',
  station_home_configs: 'id,status,published_revision,published_at',
  station_home_revisions: 'id,revision,state,featured_track_id,featured_game_id,selected_track_ids_json,selected_clip_ids_json,selected_update_ids_json',
  station_campaigns: 'id,track_id,clip_id,status,landing_path',
  station_route_migrations: 'old_path,action,new_path,reason,approved_at',
  station_analytics_events: 'event_id,event_name,session_id,track_id,clip_id,game_id,received_at'
});
export async function checkedContentRuntime(env) {
  let runtime;
  try { runtime = musicRuntime(env); }
  catch { throw contentFailure('CONTENT_NOT_CONFIGURED'); }
  if (typeof runtime.bucket.head !== 'function') throw contentFailure('CONTENT_NOT_CONFIGURED');
  let session;
  try {
    session = runtime.db.withSession('first-primary');
    await checkMusicDatabase(runtime.db);
    const probes = Object.entries(schemaColumns).map(([table, columns]) =>
      session.prepare('SELECT ' + columns + ' FROM ' + table + ' LIMIT 0'));
    const output = await session.batch([...probes,
      session.prepare("SELECT name FROM d1_migrations WHERE name='0012_station_redesign.sql' LIMIT 2"),
      session.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='music_asset_references' LIMIT 2")]);
    if (!Array.isArray(output) || output.length !== probes.length + 2) throw new Error('probe');
    output.forEach(row => resultRows(row, 1));
    if (output.at(-2).results.length !== 1) throw new Error('ledger');
    const view = output.at(-1).results[0]?.sql?.toLowerCase();
    if (!view || ['station_track_revisions', 'station_promotion_revisions', 'station_asset_rights'].some(name => !view.includes(name))) throw new Error('view');
  } catch { throw contentFailure('CONTENT_SCHEMA_UNAVAILABLE'); }
  return { ...runtime, session };
}

// Bound the whole request's metadata I/O. Late R2 bodies are disposed by resource
// readers. No request-scoped promise/snapshot survives at module scope.
export function requestDeadline(timeoutMs = 10000) {
  const end = Date.now() + timeoutMs;
  return async task => {
    const remaining = end - Date.now();
    if (remaining < 1) throw contentFailure('CONTENT_SERVICE_UNAVAILABLE');
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
        timer = setTimeout(() => reject(contentFailure('CONTENT_SERVICE_UNAVAILABLE')), remaining);
      })]);
    } finally { clearTimeout(timer); }
  };
}

const musicAssets = `COALESCE((SELECT json_group_array(json_object(
  'id',a.id,'owner_track_id',a.owner_track_id,'kind',a.kind,'state',a.state,'object_key',a.object_key,
  'format',a.format,'content_type',a.content_type,'byte_size',a.byte_size,'duration_ms',a.duration_ms,
  'sha256',a.sha256,'etag',a.etag,'derived_from_asset_id',a.derived_from_asset_id,
  'source_start_ms',a.source_start_ms,'source_end_ms',a.source_end_ms,
  'rights_status',w.status,'rights_basis',w.basis,'rights_reviewer',w.reviewer_id,'rights_at',w.reviewed_at,
  'retired',EXISTS(SELECT 1 FROM music_upload_cleanup x WHERE x.asset_id=a.id),
  'ambiguous',EXISTS(SELECT 1 FROM station_media_assets x WHERE x.id=a.id)))
  FROM music_assets a LEFT JOIN station_asset_rights w ON w.music_asset_id=a.id AND w.scope=a.kind
  WHERE a.owner_track_id=p.track_id AND a.id IN (r.cover_asset_id,r.lyrics_asset_id,pr.preview_asset_id,
    (SELECT derived_from_asset_id FROM music_assets WHERE id=pr.preview_asset_id AND owner_track_id=p.track_id))),
  '[]') AS assets_json`;
const platforms = `COALESCE((SELECT json_group_array(json_object(
  'id',a.id,'track_id',a.track_id,'provider',a.provider,'territories_json',a.territories_json,'status',a.status,
  'url',a.url,'verified_at',a.verified_at,'external_released_at',a.external_released_at,'sort_order',a.sort_order))
  FROM (SELECT * FROM station_platform_links WHERE track_id=p.track_id ORDER BY sort_order,id LIMIT 26) a),'[]') AS platforms_json`;
const trackSelect = `SELECT p.track_id AS id,p.published_at,p.published_revision,r.metadata_json,
  r.legacy_revision_id,r.site_audio_mode,r.duration_ms,r.cover_asset_id,r.lyrics_asset_id,c.slug,
  EXISTS(SELECT 1 FROM music_tracks old WHERE old.id=p.track_id AND old.lifecycle='published'
    AND old.published_revision_id=r.legacy_revision_id) AS existing_full_reference,
  pp.published_at AS promotion_at,pr.revision AS promotion_revision,pr.enabled,pr.preview_enabled,pr.preview_asset_id,
  pr.selected_platform_ids_json,pr.selected_clip_ids_json,pr.sort_order AS promotion_sort_order,
  ${musicAssets},${platforms}
  FROM station_track_publications p JOIN station_track_revisions r
    ON r.track_id=p.track_id AND r.revision=p.published_revision AND r.state='sealed'
  JOIN station_track_routes c ON c.track_id=p.track_id AND c.role='canonical'
  LEFT JOIN station_promotions pp ON pp.track_id=p.track_id AND pp.status='published' AND pp.published_at<=?
  LEFT JOIN station_promotion_revisions pr ON pr.track_id=pp.track_id AND pr.revision=pp.published_revision AND pr.state='sealed'
  WHERE p.status='published' AND p.published_at<=?`;

export async function listContentTracks(session, { now, locale, limit, q, cursor, sort = 'published' }) {
  if (sort !== 'published') {
    const query = `WITH visible AS (${trackSelect} AND (?='' OR instr(lower(COALESCE(
      json_extract(r.metadata_json,?),json_extract(r.metadata_json,'$.title.' || json_extract(r.metadata_json,'$.originalLocale')),'')),lower(?))>0
      OR instr(lower(COALESCE(json_extract(r.metadata_json,'$.creatorName'),'')),lower(?))>0)),
      releases AS (SELECT visible.*,(SELECT MIN(json_extract(value,'$.external_released_at')) FROM json_each(platforms_json)
        WHERE json_extract(value,'$.status')='live' AND json_type(value,'$.verified_at')='integer'
        AND json_extract(value,'$.verified_at') BETWEEN 0 AND ?
        AND json_type(value,'$.external_released_at')='integer'
        AND json_extract(value,'$.external_released_at') BETWEEN 0 AND ?) AS catalog_release_at FROM visible),
      ordered AS (SELECT releases.*,
        ${sort === 'default' ? 'CASE WHEN enabled=1 THEN 0 ELSE 1 END' : 'CASE WHEN catalog_release_at IS NULL THEN 1 ELSE 0 END'} AS catalog_group,
        ${sort === 'default' ? 'CASE WHEN enabled=1 THEN promotion_sort_order ELSE 0 END' : '0'} AS catalog_order,
        ${sort === 'default' ? 'published_at' : 'COALESCE(catalog_release_at,0)'} AS catalog_time FROM releases)
      SELECT * FROM ordered WHERE (? IS NULL OR catalog_group>? OR (catalog_group=? AND
        (catalog_order>? OR (catalog_order=? AND (catalog_time<? OR (catalog_time=? AND id>?))))))
      ORDER BY catalog_group,catalog_order,catalog_time DESC,id LIMIT ?`;
    return resultRows(await session.prepare(query).bind(now, now, q, '$.title."' + locale + '"', q, q, now, now,
      cursor?.group ?? null, cursor?.group ?? null, cursor?.group ?? null, cursor?.order ?? null,
      cursor?.order ?? null, cursor?.time ?? null, cursor?.time ?? null, cursor?.id ?? null, limit + 1).all());
  }
  const query = trackSelect + ` AND (?='' OR instr(lower(COALESCE(
    json_extract(r.metadata_json,?),json_extract(r.metadata_json,'$.title.' || json_extract(r.metadata_json,'$.originalLocale')),'')),lower(?))>0
    OR instr(lower(COALESCE(json_extract(r.metadata_json,'$.creatorName'),'')),lower(?))>0)
    AND (? IS NULL OR p.published_at<? OR (p.published_at=? AND p.track_id>?))
    ORDER BY p.published_at DESC,p.track_id LIMIT ?`;
  return resultRows(await session.prepare(query).bind(now, now, q, '$.title."' + locale + '"', q, q,
    cursor?.at ?? null, cursor?.at ?? null, cursor?.at ?? null, cursor?.id ?? null, limit + 1).all());
}
export async function contentTrack(session, now, { id, slug } = {}) {
  const query = trackSelect + (id ? ' AND p.track_id=?' :
    ' AND EXISTS(SELECT 1 FROM station_track_routes a WHERE a.track_id=p.track_id AND a.slug=?)') + ' LIMIT 2';
  const rows = resultRows(await session.prepare(query).bind(now, now, id || slug).all(), 1);
  return rows[0] || null;
}

const mediaJson = `json_object('id',a.id,'owner_clip_id',a.owner_clip_id,'owner_game_id',a.owner_game_id,
  'kind',a.kind,'state',a.state,'object_key',a.object_key,'content_type',a.content_type,'byte_size',a.byte_size,
  'duration_ms',a.duration_ms,'width',a.width,'height',a.height,'sha256',a.sha256,'etag',a.etag,
  'rights_status',w.status,'rights_basis',w.basis,'rights_reviewer',w.reviewer_id,'rights_at',w.reviewed_at,
  'ambiguous',EXISTS(SELECT 1 FROM music_assets x WHERE x.id=a.id))`;
const clipSelect = `SELECT c.id,c.track_id,c.type,c.published_at,c.published_revision,r.metadata_json,
  r.media_asset_id,r.poster_asset_id,r.duration_ms,r.subtitles_json,
  p.published_at AS parent_published_at,t.metadata_json AS parent_metadata_json,s.slug AS track_slug,
  COALESCE((SELECT json_group_array(${mediaJson}) FROM station_media_assets a
    LEFT JOIN station_asset_rights w ON w.media_asset_id=a.id AND w.scope=a.kind
    WHERE a.owner_clip_id=c.id AND a.id IN(r.media_asset_id,r.poster_asset_id)),'[]') AS assets_json,
  COALESCE((SELECT json_group_array(json_object('channel',a.channel,'post_url',a.post_url,'external_published_at',a.external_published_at))
    FROM (SELECT * FROM station_clip_publications WHERE clip_id=c.id ORDER BY external_published_at DESC,id LIMIT 11) a),'[]') AS publications_json
  FROM station_clips c JOIN station_clip_revisions r ON r.id=c.id AND r.revision=c.published_revision AND r.state='sealed'
  JOIN station_track_publications p ON p.track_id=c.track_id AND p.status='published' AND p.published_at<=?
  JOIN station_track_revisions t ON t.track_id=p.track_id AND t.revision=p.published_revision AND t.state='sealed'
  JOIN station_track_routes s ON s.track_id=p.track_id AND s.role='canonical'
  WHERE c.status='published' AND c.published_at<=?`;
export async function listContentClips(session, { now, limit, cursor, trackId = null }) {
  return resultRows(await session.prepare(clipSelect + ` AND (? IS NULL OR c.track_id=?)
    AND (? IS NULL OR c.published_at<? OR (c.published_at=? AND c.id>?))
    ORDER BY c.published_at DESC,c.id LIMIT ?`).bind(now, now, trackId, trackId,
    cursor?.at ?? null, cursor?.at ?? null, cursor?.at ?? null, cursor?.id ?? null, limit + 1).all());
}
export async function contentClip(session, now, id) {
  return resultRows(await session.prepare(clipSelect + ' AND c.id=? LIMIT 2').bind(now, now, id).all(), 1)[0] || null;
}
const gameSelect = `SELECT g.id,g.slug,g.runtime_key,g.published_at,g.published_revision,r.metadata_json,
  r.launch_url,r.supported_devices_json,r.screenshot_ids_json,
  COALESCE((SELECT json_group_array(${mediaJson}) FROM (SELECT * FROM station_media_assets
    WHERE owner_game_id=g.id AND kind='game_screenshot'
    AND id IN(SELECT value FROM json_each(r.screenshot_ids_json)) ORDER BY id LIMIT 11) a
    LEFT JOIN station_asset_rights w ON w.media_asset_id=a.id AND w.scope=a.kind
    ),'[]') AS assets_json
  FROM station_games g JOIN station_game_revisions r ON r.id=g.id AND r.revision=g.published_revision AND r.state='sealed'
  WHERE g.status='published' AND g.published_at<=? AND g.slug<>'cat-life'`;
export async function listContentGames(session, { now, limit, cursor }) {
  return resultRows(await session.prepare(gameSelect + `
    AND (? IS NULL OR g.published_at<? OR (g.published_at=? AND g.id>?))
    ORDER BY g.published_at DESC,g.id LIMIT ?`).bind(now,
    cursor?.at ?? null, cursor?.at ?? null, cursor?.at ?? null, cursor?.id ?? null, limit + 1).all());
}
export async function contentGame(session, now, { id, slug } = {}) {
  return resultRows(await session.prepare(gameSelect + (id ? ' AND g.id=?' : ' AND g.slug=?') + ' LIMIT 2')
    .bind(now, id || slug).all(), 1)[0] || null;
}
export async function publishedHome(session, now) {
  return resultRows(await session.prepare(`SELECT h.id,h.published_at,h.published_revision,r.featured_track_id,r.featured_game_id,
    r.selected_track_ids_json,r.selected_clip_ids_json,r.selected_update_ids_json
    FROM station_home_configs h JOIN station_home_revisions r
      ON r.id=h.id AND r.revision=h.published_revision AND r.state='sealed'
    WHERE h.id=? AND h.status='published' AND h.published_at<=? LIMIT 2`).bind(stationHomeConfig.id, now).all(), 1)[0] || null;
}
export async function assetOwner(session, id) {
  const results = await session.batch([
    session.prepare('SELECT owner_track_id AS owner,kind FROM music_assets WHERE id=? LIMIT 2').bind(id),
    session.prepare('SELECT owner_clip_id,owner_game_id,kind FROM station_media_assets WHERE id=? LIMIT 2').bind(id)
  ]);
  const [music, media] = results.map(result => resultRows(result, 1));
  if (music.length + media.length !== 1) return null;
  return music[0] ? { type: 'track', id: music[0].owner, kind: music[0].kind } :
    { type: media[0].owner_game_id ? 'game' : 'clip', id: media[0].owner_game_id || media[0].owner_clip_id, kind: media[0].kind };
}
