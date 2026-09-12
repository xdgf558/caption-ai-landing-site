import { effectivePolicy, policyFromRevision } from './policy.js';
import { editVersion, fail, fields, musicId, text } from './adminValidation.js';
import { mutate, primary, rows } from './adminStore.js';

const ITEM_FIELDS = ['slot_kind','position','track_id','collection_id'];
const TRACK_FIELDS = ['id','lifecycle','published_revision_id','state','access_mode','early_access_until','post_early_access_mode','policy_version'];
const COLLECTION_FIELDS = ['id','status','version'];

function parseMap(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('map');
    return parsed;
  } catch {
    fail('MUSIC_DATABASE_UNAVAILABLE', 503);
  }
}

function idList(value, limit) {
  if (!Array.isArray(value) || value.length > limit) fail('MUSIC_INVALID_FEATURED');
  const result = value.map(musicId);
  if (new Set(result).size !== result.length) fail('MUSIC_INVALID_FEATURED');
  return result;
}

function featuredInput(input) {
  fields(input, ['primaryTrackId','secondaryTrackIds','collectionIds','reason']);
  const primaryTrackId = input.primaryTrackId === null ? null : musicId(input.primaryTrackId);
  const secondaryTrackIds = idList(input.secondaryTrackIds, 6);
  const collectionIds = idList(input.collectionIds, 6);
  if (primaryTrackId && secondaryTrackIds.includes(primaryTrackId)) fail('MUSIC_INVALID_FEATURED');
  return { primaryTrackId, secondaryTrackIds, collectionIds, reason:text(input.reason,1000) };
}

const itemOrder = "CASE slot_kind WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END,position";
async function loadFeatured(db) {
  const session = primary(db);
  const result = (await session.batch([
    session.prepare('SELECT id,version,updated_at FROM music_featured_home WHERE id=1'),
    session.prepare(`SELECT slot_kind,position,track_id,collection_id FROM music_featured_items ORDER BY ${itemOrder} LIMIT 14`),
    session.prepare("SELECT value_json,updated_at FROM music_settings WHERE key='catalogVersion'")
  ])).map(rows);
  if (result[0].length !== 1 || result[1].length > 13 || result[2].length !== 1) fail('MUSIC_DATABASE_UNAVAILABLE',503);
  let catalogVersion;
  try { catalogVersion = JSON.parse(result[2][0].value_json); }
  catch { fail('MUSIC_DATABASE_UNAVAILABLE',503); }
  if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 0 || catalogVersion >= Number.MAX_SAFE_INTEGER) fail('MUSIC_DATABASE_UNAVAILABLE',503);
  return { home:result[0][0], items:result[1], catalogVersion, catalogSetting:result[2][0] };
}

async function targetTracks(db, ids) {
  if (!ids.length) return [];
  return rows(await primary(db).prepare(`SELECT t.id,t.lifecycle,t.published_revision_id,r.state,r.access_mode,r.early_access_until,
    r.post_early_access_mode,r.policy_version,r.metadata_json
    FROM music_tracks t LEFT JOIN music_track_revisions r ON r.id=t.published_revision_id
    WHERE t.id IN (SELECT CAST(value AS TEXT) FROM json_each(?)) ORDER BY t.id`).bind(JSON.stringify(ids)).all());
}

async function targetCollections(db, ids) {
  if (!ids.length) return [];
  return rows(await primary(db).prepare(`SELECT id,status,version,collection_type,title_json
    FROM music_collections WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?)) ORDER BY id`).bind(JSON.stringify(ids)).all());
}

const title = row => {
  const map = parseMap(row.metadata_json ?? row.title_json);
  const values = row.metadata_json ? map.title : map;
  return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
};

export async function readAdminMusicFeatured(db) {
  const snapshot = await loadFeatured(db);
  const trackIds = snapshot.items.map(item => item.track_id).filter(Boolean);
  const collectionIds = snapshot.items.map(item => item.collection_id).filter(Boolean);
  const [tracks,collections] = await Promise.all([targetTracks(db,trackIds),targetCollections(db,collectionIds)]);
  const trackViews = tracks.map(row => {
    let access = null;
    try { if (row.lifecycle === 'published' && row.state === 'sealed') access = effectivePolicy(policyFromRevision(row),Date.now()).effectiveAccess; }
    catch { access = null; }
    return { id:row.id, lifecycle:row.lifecycle, effectiveAccess:access, title:title(row) };
  });
  const collectionViews = collections.map(row => ({ id:row.id, status:row.status, type:row.collection_type,
    editVersion:row.version, title:title(row) }));
  const primary = snapshot.items.find(item => item.slot_kind === 'primary')?.track_id ?? null;
  return { editVersion:snapshot.home.version, primaryTrackId:primary,
    secondaryTrackIds:snapshot.items.filter(item => item.slot_kind === 'secondary').map(item => item.track_id),
    collectionIds:snapshot.items.filter(item => item.slot_kind === 'collection').map(item => item.collection_id),
    tracks:trackViews, collections:collectionViews };
}

export async function saveAdminMusicFeatured(db, input, context) {
  const clean = featuredInput(input), version = editVersion(context.ifMatch);
  return mutate(db,{ ...context, route:'/admin/api/music/featured', command:{...clean,version}, conflictCode:'MUSIC_FEATURED_CONFLICT' },async (session,now) => {
    const snapshot = await loadFeatured(db);
    if (snapshot.home.version !== version) fail('MUSIC_FEATURED_CONFLICT',409);
    const trackIds = [...new Set([clean.primaryTrackId,...clean.secondaryTrackIds].filter(Boolean))].sort();
    const collectionIds = [...clean.collectionIds].sort();
    const [tracks,collections] = await Promise.all([targetTracks(db,trackIds),targetCollections(db,collectionIds)]);
    if (tracks.length !== trackIds.length || tracks.some(row => row.lifecycle !== 'published' || row.state !== 'sealed')) {
      fail('MUSIC_FEATURED_TRACK_UNAVAILABLE',409);
    }
    const primaryTrack = tracks.find(row => row.id === clean.primaryTrackId);
    if (primaryTrack && effectivePolicy(policyFromRevision(primaryTrack),now).effectiveAccess !== 'free') {
      fail('MUSIC_FEATURED_PRIMARY_NOT_FREE',409);
    }
    if (collections.length !== collectionIds.length || collections.some(row => row.status !== 'published')) {
      fail('MUSIC_FEATURED_COLLECTION_UNAVAILABLE',409);
    }
    const oldItems = JSON.stringify(snapshot.items.map(row => Object.fromEntries(ITEM_FIELDS.map(field => [field,row[field]]))));
    const guard = {
      condition:`EXISTS (SELECT 1 FROM music_featured_home WHERE id=1 AND version=? AND updated_at=?) AND
        COALESCE((SELECT json_group_array(json_object('slot_kind',slot_kind,'position',position,'track_id',track_id,'collection_id',collection_id)) FROM
          (SELECT slot_kind,position,track_id,collection_id FROM music_featured_items ORDER BY ${itemOrder})),'[]')=? AND
        EXISTS (SELECT 1 FROM music_settings WHERE key='catalogVersion' AND value_json=? AND updated_at=?)`,
      params:[version,snapshot.home.updated_at,oldItems,snapshot.catalogSetting.value_json,snapshot.catalogSetting.updated_at]
    };
    if (trackIds.length) {
      const encodedIds = JSON.stringify(trackIds), stable = tracks.map(row => Object.fromEntries(TRACK_FIELDS.map(field => [field,row[field]])));
      guard.condition += ` AND COALESCE((SELECT json_group_array(json_object('id',id,'lifecycle',lifecycle,
        'published_revision_id',published_revision_id,'state',state,'access_mode',access_mode,'early_access_until',early_access_until,
        'post_early_access_mode',post_early_access_mode,'policy_version',policy_version)) FROM
        (SELECT t.id,t.lifecycle,t.published_revision_id,r.state,r.access_mode,r.early_access_until,r.post_early_access_mode,r.policy_version
          FROM music_tracks t LEFT JOIN music_track_revisions r ON r.id=t.published_revision_id
          WHERE t.id IN (SELECT CAST(value AS TEXT) FROM json_each(?)) ORDER BY t.id)),'[]')=?`;
      guard.params.push(encodedIds,JSON.stringify(stable));
    }
    if (collectionIds.length) {
      const encodedIds = JSON.stringify(collectionIds), stable = collections.map(row => Object.fromEntries(COLLECTION_FIELDS.map(field => [field,row[field]])));
      guard.condition += ` AND COALESCE((SELECT json_group_array(json_object('id',id,'status',status,'version',version)) FROM
        (SELECT id,status,version FROM music_collections WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?)) ORDER BY id)),'[]')=?`;
      guard.params.push(encodedIds,JSON.stringify(stable));
    }
    const items = [
      ...(clean.primaryTrackId ? [{slot:'primary',position:0,trackId:clean.primaryTrackId,collectionId:null}] : []),
      ...clean.secondaryTrackIds.map((trackId,position) => ({slot:'secondary',position,trackId,collectionId:null})),
      ...clean.collectionIds.map((collectionId,position) => ({slot:'collection',position,trackId:null,collectionId}))
    ];
    const writes = [{ statement:session.prepare('DELETE FROM music_featured_items'), expected:snapshot.items.length }];
    for (const item of items) writes.push(session.prepare(`INSERT INTO music_featured_items(slot_kind,position,track_id,collection_id)
      VALUES(?,?,?,?)`).bind(item.slot,item.position,item.trackId,item.collectionId));
    writes.push(session.prepare('UPDATE music_featured_home SET version=version+1,updated_at=? WHERE id=1 AND version=?').bind(now,version));
    writes.push(session.prepare("UPDATE music_settings SET value_json=?,updated_at=? WHERE key='catalogVersion'")
      .bind(String(snapshot.catalogVersion+1),now));
    return { ...guard, writes, action:'music.featured.update', targetId:'home',
      summary:{ primaryTrackId:clean.primaryTrackId, secondaryTrackIds:clean.secondaryTrackIds,
        collectionIds:clean.collectionIds, reason:clean.reason },
      result:{ editVersion:version+1, catalogVersion:snapshot.catalogVersion+1 } };
  });
}
