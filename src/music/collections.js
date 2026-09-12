import { MUSIC_LOCALES } from './policy.js';
import { collectionType, albumTrackAccess, checkAlbum, guardAlbumTracks } from './albums.js';
import { editVersion, fail, fields, musicId, text } from './adminValidation.js';
import { mutate, primary, rows } from './adminStore.js';

const STATUSES = ['draft', 'published', 'archived'];
const COLLECTION_FIELDS = ['id', 'slug', 'original_locale', 'title_json', 'description_json', 'status', 'version', 'created_at', 'updated_at', 'collection_type', 'listening_mode', 'cover_track_id'];

function slug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 100) {
    fail('MUSIC_INVALID_SLUG');
  }
  return value;
}

function translations(value, originalLocale, max, required) {
  fields(value, MUSIC_LOCALES);
  const result = {};
  for (const locale of MUSIC_LOCALES) {
    if (value[locale] !== undefined) result[locale] = text(value[locale], max, true);
  }
  if (required && (!(originalLocale in result) || !result[originalLocale])) fail('MUSIC_INVALID_COLLECTION');
  return result;
}

function collectionInput(input, create = false) {
  fields(input, create
    ? ['slug', 'originalLocale', 'title', 'description', 'type', 'listeningMode', 'coverTrackId']
    : ['slug', 'originalLocale', 'title', 'description', 'status', 'reason', 'type', 'listeningMode', 'coverTrackId']);
  if (!MUSIC_LOCALES.includes(input.originalLocale)) fail('MUSIC_INVALID_COLLECTION');
  const clean = {
    slug: slug(input.slug),
    originalLocale: input.originalLocale,
    title: translations(input.title, input.originalLocale, 120, true),
    description: translations(input.description ?? {}, input.originalLocale, 500, false)
  };
  // Preserve the normalized shape of legacy commands for original-key replay.
  if (input.type !== undefined) { if (!['playlist','album'].includes(input.type)) fail('MUSIC_INVALID_COLLECTION'); clean.type = input.type; }
  if (input.listeningMode !== undefined) { if (!['mixed','free','vip'].includes(input.listeningMode)) fail('MUSIC_INVALID_COLLECTION'); clean.listeningMode = input.listeningMode; }
  if (input.coverTrackId !== undefined) clean.coverTrackId = input.coverTrackId === null ? null : musicId(input.coverTrackId);
  if (!create) {
    if (!STATUSES.includes(input.status)) fail('MUSIC_INVALID_COLLECTION');
    Object.assign(clean, { status: input.status, reason: text(input.reason, 1000) });
  }
  return clean;
}

function collectionTracksInput(input) {
  fields(input, ['trackIds', 'reason']);
  if (!Array.isArray(input.trackIds) || input.trackIds.length > 500) fail('MUSIC_INVALID_COLLECTION');
  const trackIds = input.trackIds.map(musicId);
  if (new Set(trackIds).size !== trackIds.length) fail('MUSIC_INVALID_COLLECTION');
  return { trackIds, reason: text(input.reason, 1000) };
}

function parseMap(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('map');
    return parsed;
  } catch {
    fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  }
}

function catalogVersion(row) {
  try {
    const value = JSON.parse(row?.value_json);
    if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) throw new Error('version');
    return value;
  } catch {
    fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  }
}

const TRACK_SELECT = `SELECT t.id AS track_id,t.slug,t.lifecycle,t.published_revision_id,t.published_at,r.metadata_json,
  p.track_id AS published_track_id,p.state AS published_state,p.access_mode,p.early_access_until,p.post_early_access_mode,p.policy_version,
  CASE WHEN a.id IS NOT NULL AND a.state='validated' AND a.kind='cover' AND a.owner_track_id=t.id THEN 1 ELSE 0 END AS published_cover_valid
  FROM music_tracks t LEFT JOIN music_track_revisions r ON r.id=COALESCE(t.draft_revision_id,t.published_revision_id)
  LEFT JOIN music_track_revisions p ON p.id=t.published_revision_id
  LEFT JOIN music_assets a ON a.id=p.cover_asset_id`;
function configured(clean, current = {collection_type:'playlist',listening_mode:'mixed',cover_track_id:null}) {
  const c = { ...current, collection_type:clean.type ?? current.collection_type,
    listening_mode:clean.listeningMode ?? current.listening_mode,
    cover_track_id:clean.coverTrackId === undefined ? current.cover_track_id : clean.coverTrackId };
  if (c.collection_type !== 'album' && (c.listening_mode !== 'mixed' || c.cover_track_id)) fail('MUSIC_INVALID_COLLECTION');
  return c;
}

async function loadCollection(db, id) {
  const session = primary(db);
  const result = (await session.batch([
    session.prepare('SELECT * FROM music_collections WHERE id=?').bind(id),
    session.prepare(`${TRACK_SELECT} JOIN music_collection_tracks ct ON ct.track_id=t.id
      WHERE ct.collection_id=? ORDER BY ct.position LIMIT 501`).bind(id),
    session.prepare("SELECT value_json,updated_at FROM music_settings WHERE key='catalogVersion'")
  ])).map(rows);
  const collection = result[0][0];
  if (!collection) fail('NOT_FOUND', 404);
  if (result[1].length > 500 || result[2].length !== 1) fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  return { collection, tracks: result[1], catalogVersion: catalogVersion(result[2][0]), catalogSetting: result[2][0] };
}

function collectionView(snapshot) {
  const c = snapshot.collection;
  return {
    type: collectionType(c), listeningMode:c.listening_mode, coverTrackId:c.cover_track_id,
    id: c.id,
    slug: c.slug,
    originalLocale: c.original_locale,
    title: parseMap(c.title_json),
    description: parseMap(c.description_json),
    status: c.status,
    editVersion: c.version,
    tracks: snapshot.tracks.map((row, position) => ({
      id: row.track_id,
      slug: row.slug,
      lifecycle: row.lifecycle,
      position,
      effectiveAccess: albumTrackAccess(row,Date.now()), hasPublishedCover:!!row.published_cover_valid,
      title: row.metadata_json ? parseMap(row.metadata_json).title ?? null : null
    }))
  };
}

function snapshotCondition(snapshot, includeCatalog = false) {
  const row = snapshot.collection;
  const encoded = JSON.stringify(Object.fromEntries(COLLECTION_FIELDS.map(field => [field, row[field]])));
  const order = JSON.stringify(snapshot.tracks.map(track => track.track_id));
  const conditions = [
    `EXISTS (SELECT 1 FROM music_collections WHERE json_object(${COLLECTION_FIELDS.map(field => `'${field}',${field}`).join(',')})=?)`,
    `COALESCE((SELECT json_group_array(track_id) FROM
      (SELECT track_id FROM music_collection_tracks WHERE collection_id=? ORDER BY position)),'[]')=?`
  ];
  const params = [encoded, row.id, order];
  if (includeCatalog) {
    conditions.push("EXISTS (SELECT 1 FROM music_settings WHERE key='catalogVersion' AND value_json=? AND updated_at=?)");
    params.push(snapshot.catalogSetting.value_json, snapshot.catalogSetting.updated_at);
  }
  return { condition: conditions.join(' AND '), params };
}

function catalogWrite(session, snapshot, now) {
  return session.prepare("UPDATE music_settings SET value_json=?,updated_at=? WHERE key='catalogVersion'")
    .bind(String(snapshot.catalogVersion + 1), now);
}

export async function listAdminMusicCollections(db, { before = Number.MAX_SAFE_INTEGER, status = '', q = '', type = '' } = {}) {
  if (!Number.isSafeInteger(before) || before < 1 || !['', ...STATUSES].includes(status) || !['','playlist','album'].includes(type)) fail('INVALID_INPUT', 400);
  text(q, 120, true);
  const result = rows(await primary(db).prepare(`SELECT c.rowid AS cursor,c.id,c.slug,c.original_locale,c.title_json,c.status,c.version,c.collection_type,c.listening_mode,
    (SELECT COUNT(*) FROM music_collection_tracks ct WHERE ct.collection_id=c.id) AS track_count
    FROM music_collections c WHERE c.rowid<? AND (?='' OR c.status=?) AND (?='' OR c.collection_type=?)
    AND (?='' OR instr(lower(c.slug),lower(?))>0 OR instr(lower(c.title_json),lower(?))>0)
    ORDER BY c.rowid DESC LIMIT 51`).bind(before, status, status, type, type, q, q, q).all());
  const items = result.slice(0, 50).map(row => ({ id: row.id, slug: row.slug, originalLocale: row.original_locale,
    type:row.collection_type, listeningMode:row.listening_mode, title: parseMap(row.title_json), status: row.status, editVersion: row.version, trackCount: row.track_count }));
  return { items, nextBefore: result.length > 50 ? result[49].cursor : null };
}

export async function readAdminMusicCollection(db, id) {
  return collectionView(await loadCollection(db, musicId(id)));
}

export async function createAdminMusicCollection(db, input, context) {
  const clean = collectionInput(input, true);
  return mutate(db, { ...context, route: '/admin/api/music/collections', command: clean,
    conflictCode: 'MUSIC_COLLECTION_CONFLICT' }, async (session, now) => {
    const id = crypto.randomUUID(), config = configured(clean);
    if (config.cover_track_id) fail('MUSIC_ALBUM_COVER_INVALID'); // Add members before selecting a cover.
    return {
      condition: 'NOT EXISTS (SELECT 1 FROM music_collections WHERE slug=?)',
      params: [clean.slug],
      writes: [session.prepare(`INSERT INTO music_collections
        (id,slug,original_locale,title_json,description_json,status,version,created_at,updated_at,collection_type,listening_mode,cover_track_id)
        VALUES(?,?,?,?,?,'draft',1,?,?,?,?,NULL)`).bind(id, clean.slug, clean.originalLocale,
        JSON.stringify(clean.title), JSON.stringify(clean.description), now, now, config.collection_type, config.listening_mode)],
      action: 'music.collection.create',
      targetId: id,
      summary: { status: 'draft', type:config.collection_type, listeningMode:config.listening_mode },
      result: { collectionId: id, editVersion: 1, status: 'draft', catalogVersion: null }
    };
  });
}

export async function saveAdminMusicCollection(db, id, input, context) {
  id = musicId(id);
  const clean = collectionInput(input), version = editVersion(context.ifMatch);
  return mutate(db, { ...context, route: `/admin/api/music/collections/${id}`, command: { ...clean, version },
    conflictCode: 'MUSIC_COLLECTION_CONFLICT' }, async (session, now) => {
    const snapshot = await loadCollection(db, id), current = snapshot.collection;
    if (current.version !== version) fail('MUSIC_COLLECTION_CONFLICT', 409);
    if (current.status === 'archived') fail('MUSIC_COLLECTION_ARCHIVED', 409);
    if (clean.slug !== current.slug || (clean.type !== undefined && clean.type !== current.collection_type)) fail('MUSIC_COLLECTION_IDENTITY', 409);
    const config = configured(clean,current);
    checkAlbum(config,snapshot.tracks,now,clean.status === 'published');
    if (current.status === 'published' && clean.status === 'archived') fail('MUSIC_COLLECTION_UNPUBLISH_FIRST', 409);
    if (clean.status === 'published' && !snapshot.tracks.some(track => track.lifecycle === 'published')) {
      fail('MUSIC_COLLECTION_EMPTY');
    }
    const affectsCatalog = current.status === 'published' || clean.status === 'published';
    const guard = snapshotCondition(snapshot, affectsCatalog);
    if (config.collection_type === 'album') guardAlbumTracks(guard,snapshot.tracks);
    if (clean.status === 'published') {
      guard.condition += ` AND EXISTS (SELECT 1 FROM music_collection_tracks ct JOIN music_tracks t ON t.id=ct.track_id
        WHERE ct.collection_id=? AND t.lifecycle='published')`;
      guard.params.push(id);
    }
    const writes = [session.prepare(`UPDATE music_collections SET original_locale=?,title_json=?,description_json=?,status=?,
      version=version+1,updated_at=?,listening_mode=?,cover_track_id=? WHERE id=? AND version=?`).bind(clean.originalLocale, JSON.stringify(clean.title),
      JSON.stringify(clean.description), clean.status, now, config.listening_mode, config.cover_track_id, id, version)];
    if (affectsCatalog) writes.push(catalogWrite(session, snapshot, now));
    const action = current.status !== clean.status
      ? `music.collection.${clean.status === 'draft' ? 'unpublish' : clean.status === 'published' ? 'publish' : 'archive'}`
      : 'music.collection.update';
    return { ...guard, writes, action, targetId: id,
      summary: { oldStatus: current.status, newStatus: clean.status, type:config.collection_type, listeningMode:config.listening_mode, coverTrackId:config.cover_track_id, trackCount: snapshot.tracks.length, reason: clean.reason },
      result: { collectionId: id, editVersion: version + 1, status: clean.status,
        catalogVersion: affectsCatalog ? snapshot.catalogVersion + 1 : snapshot.catalogVersion } };
  });
}

export async function saveAdminMusicCollectionTracks(db, id, input, context) {
  id = musicId(id);
  const clean = collectionTracksInput(input), version = editVersion(context.ifMatch);
  return mutate(db, { ...context, route: `/admin/api/music/collections/${id}/tracks`, command: { ...clean, version },
    conflictCode: 'MUSIC_COLLECTION_CONFLICT' }, async (session, now) => {
    const snapshot = await loadCollection(db, id), current = snapshot.collection;
    if (current.version !== version) fail('MUSIC_COLLECTION_CONFLICT', 409);
    if (current.status === 'archived') fail('MUSIC_COLLECTION_ARCHIVED', 409);
    const encodedIds = JSON.stringify(clean.trackIds);
    const selected = clean.trackIds.length ? rows(await primary(db).prepare(`SELECT id,lifecycle FROM music_tracks
      WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id`).bind(encodedIds).all()) : [];
    if (selected.length !== clean.trackIds.length || selected.some(track => track.lifecycle === 'archived')) {
      fail('MUSIC_COLLECTION_TRACK_INVALID');
    }
    if (current.status === 'published' && !selected.some(track => track.lifecycle === 'published')) {
      fail('MUSIC_COLLECTION_EMPTY');
    }
    const guard = snapshotCondition(snapshot, current.status === 'published');
    if (current.collection_type === 'album') {
      const albumTracks = clean.trackIds.length ? rows(await primary(db).prepare(`${TRACK_SELECT}
        WHERE t.id IN (SELECT value FROM json_each(?)) ORDER BY t.id LIMIT 501`).bind(encodedIds).all()) : [];
      if (albumTracks.length !== clean.trackIds.length) fail('MUSIC_COLLECTION_TRACK_INVALID');
      checkAlbum(current,albumTracks,now);
      guardAlbumTracks(guard,albumTracks);
    }
    guard.condition += ` AND COALESCE((SELECT json_group_array(json_object('id',id,'lifecycle',lifecycle)) FROM
      (SELECT id,lifecycle FROM music_tracks WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id)),'[]')=?`;
    guard.params.push(encodedIds, JSON.stringify(selected));
    const writes = [
      { statement: session.prepare('DELETE FROM music_collection_tracks WHERE collection_id=?').bind(id), expected: snapshot.tracks.length },
      { statement: session.prepare(`INSERT INTO music_collection_tracks(collection_id,track_id,position)
          SELECT ?,CAST(value AS TEXT),CAST(key AS INTEGER) FROM json_each(?)`).bind(id, encodedIds), expected: clean.trackIds.length },
      session.prepare('UPDATE music_collections SET version=version+1,updated_at=? WHERE id=? AND version=?').bind(now, id, version)
    ];
    if (current.status === 'published') writes.push(catalogWrite(session, snapshot, now));
    return { ...guard, writes, action: 'music.collection.tracks', targetId: id,
      summary: { trackIds: clean.trackIds, reason: clean.reason },
      result: { collectionId: id, editVersion: version + 1, status: current.status, trackCount: clean.trackIds.length,
        catalogVersion: current.status === 'published' ? snapshot.catalogVersion + 1 : snapshot.catalogVersion } };
  });
}
