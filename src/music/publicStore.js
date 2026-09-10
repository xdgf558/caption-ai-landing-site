import { publicationError } from './publicationValidation.js';

const unavailable = () => { throw publicationError('MUSIC_DATABASE_UNAVAILABLE', 503); };

function rows(result) {
  if (result?.success !== true || !Array.isArray(result.results)) unavailable();
  return result.results;
}

function primary(db) {
  if (typeof db?.withSession !== 'function') unavailable();
  const session = db.withSession('first-primary');
  if (typeof session?.prepare !== 'function' || typeof session?.batch !== 'function') unavailable();
  return session;
}

function catalogSettings(values) {
  if (values.length !== 2) unavailable();
  try {
    const catalogVersion = JSON.parse(values.find(row => row.key === 'catalogVersion')?.value_json);
    const previewLimitMs = JSON.parse(values.find(row => row.key === 'previewLimitMs')?.value_json);
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 0 || catalogVersion >= Number.MAX_SAFE_INTEGER ||
      !Number.isSafeInteger(previewLimitMs) || previewLimitMs < 15000 || previewLimitMs > 45000) unavailable();
    return { catalogVersion, previewLimitMs };
  } catch (error) {
    if (error?.code === 'MUSIC_DATABASE_UNAVAILABLE') throw error;
    unavailable();
  }
}

function recordsFromRows(tracks, revisions, assets) {
  const revisionByTrack = new Map();
  for (const revision of revisions) {
    if (revisionByTrack.has(revision.track_id)) unavailable();
    revisionByTrack.set(revision.track_id, revision);
  }
  const assetsByTrack = new Map();
  for (const asset of assets) {
    const list = assetsByTrack.get(asset.owner_track_id) || [];
    list.push(asset); assetsByTrack.set(asset.owner_track_id, list);
  }
  return tracks.map(track => ({ track, revision: revisionByTrack.get(track.id) || null,
    assets: assetsByTrack.get(track.id) || [] }));
}

function collectionFromRow(row) {
  const { items_json, ...collection } = row;
  let items;
  try { items = JSON.parse(items_json); } catch { items = null; }
  return { collection, items };
}

export async function loadPublishedMusicRecord(db, trackId, { includeSettings = false } = {}) {
  try {
    const session = primary(db);
    const statements = [
      session.prepare('SELECT * FROM music_tracks WHERE id=? LIMIT 2').bind(trackId),
      session.prepare(`SELECT * FROM music_track_revisions
        WHERE id=(SELECT published_revision_id FROM music_tracks WHERE id=?) LIMIT 2`).bind(trackId),
      session.prepare(`SELECT a.* FROM music_assets a
        JOIN music_track_revisions r ON r.id=(SELECT published_revision_id FROM music_tracks WHERE id=?)
        WHERE a.id IN (r.audio_asset_id,r.preview_asset_id,r.cover_asset_id,r.lyrics_asset_id)
        ORDER BY a.id LIMIT 5`).bind(trackId)];
    if (includeSettings) statements.push(session.prepare(
      "SELECT key,value_json FROM music_settings WHERE key IN ('catalogVersion','previewLimitMs') ORDER BY key"));
    const result = (await session.batch(statements)).map(rows);
    if (result[0].length > 1 || result[1].length > 1 || result[2].length > 4) unavailable();
    return { track: result[0][0] || null, revision: result[1][0] || null, assets: result[2],
      ...(includeSettings ? catalogSettings(result[3]) : {}) };
  } catch (error) {
    if (error?.code === 'MUSIC_DATABASE_UNAVAILABLE') throw error;
    unavailable();
  }
}

export async function loadPublicMusicSnapshot(db, now) {
  try {
    const session = primary(db);
    const result = (await session.batch([
      session.prepare("SELECT key,value_json FROM music_settings WHERE key IN ('catalogVersion','previewLimitMs') ORDER BY key"),
      session.prepare(`SELECT * FROM music_tracks WHERE lifecycle='published' AND published_at<=?
        ORDER BY published_at DESC,id LIMIT 500`).bind(now),
      session.prepare(`SELECT r.* FROM music_track_revisions r JOIN
        (SELECT published_revision_id FROM music_tracks WHERE lifecycle='published' AND published_at<=?
          ORDER BY published_at DESC,id LIMIT 500) t ON t.published_revision_id=r.id
        ORDER BY r.track_id`).bind(now),
      session.prepare(`SELECT a.* FROM music_assets a JOIN music_track_revisions r
        ON a.id IN (r.audio_asset_id,r.preview_asset_id,r.cover_asset_id,r.lyrics_asset_id) JOIN
        (SELECT published_revision_id FROM music_tracks WHERE lifecycle='published' AND published_at<=?
          ORDER BY published_at DESC,id LIMIT 500) t ON t.published_revision_id=r.id
        ORDER BY a.owner_track_id,a.id LIMIT 2001`).bind(now),
      session.prepare(`SELECT c.*,
        COALESCE(json_group_array(json_object('collection_id',ct.collection_id,'track_id',ct.track_id,'position',ct.position))
          FILTER (WHERE ct.track_id IS NOT NULL),'[]') AS items_json
        FROM music_collections c LEFT JOIN music_collection_tracks ct ON ct.collection_id=c.id
        WHERE c.status='published' GROUP BY c.id ORDER BY c.slug LIMIT 500`)
    ])).map(rows);
    if (result[1].length > 500 || result[2].length > 500 || result[3].length > 2000 || result[4].length > 500) unavailable();
    const settings = catalogSettings(result[0]);
    const collections = result[4].map(collectionFromRow);
    return { ...settings, records: recordsFromRows(result[1], result[2], result[3]), collections };
  } catch (error) {
    if (error?.code === 'MUSIC_DATABASE_UNAVAILABLE') throw error;
    unavailable();
  }
}

export async function loadPublicMusicCollectionSnapshot(db, slug, now) {
  try {
    const session = primary(db);
    const result = (await session.batch([
      session.prepare("SELECT key,value_json FROM music_settings WHERE key IN ('catalogVersion','previewLimitMs') ORDER BY key"),
      session.prepare(`SELECT c.*,
        COALESCE(json_group_array(json_object('collection_id',ct.collection_id,'track_id',ct.track_id,'position',ct.position))
          FILTER (WHERE ct.track_id IS NOT NULL),'[]') AS items_json
        FROM music_collections c LEFT JOIN music_collection_tracks ct ON ct.collection_id=c.id
        WHERE c.slug=? AND c.status='published' GROUP BY c.id LIMIT 2`).bind(slug),
      session.prepare(`SELECT t.* FROM music_tracks t JOIN music_collection_tracks ct ON ct.track_id=t.id
        JOIN music_collections c ON c.id=ct.collection_id
        WHERE c.slug=? AND c.status='published' AND t.lifecycle='published' AND t.published_at<=?
        ORDER BY ct.position LIMIT 501`).bind(slug, now),
      session.prepare(`SELECT r.* FROM music_track_revisions r JOIN music_tracks t ON t.published_revision_id=r.id
        JOIN music_collection_tracks ct ON ct.track_id=t.id JOIN music_collections c ON c.id=ct.collection_id
        WHERE c.slug=? AND c.status='published' AND t.lifecycle='published' AND t.published_at<=?
        ORDER BY ct.position LIMIT 501`).bind(slug, now),
      session.prepare(`SELECT a.* FROM music_assets a JOIN music_track_revisions r
        ON a.id IN (r.audio_asset_id,r.preview_asset_id,r.cover_asset_id,r.lyrics_asset_id)
        JOIN music_tracks t ON t.published_revision_id=r.id JOIN music_collection_tracks ct ON ct.track_id=t.id
        JOIN music_collections c ON c.id=ct.collection_id
        WHERE c.slug=? AND c.status='published' AND t.lifecycle='published' AND t.published_at<=?
        ORDER BY ct.position,a.id LIMIT 2001`).bind(slug, now)
    ])).map(rows);
    if (result[1].length > 1 || result[2].length > 500 || result[3].length > 500 || result[4].length > 2000) unavailable();
    return { ...catalogSettings(result[0]), records: recordsFromRows(result[2], result[3], result[4]),
      collections: result[1].length ? [collectionFromRow(result[1][0])] : [] };
  } catch (error) {
    if (error?.code === 'MUSIC_DATABASE_UNAVAILABLE') throw error;
    unavailable();
  }
}
