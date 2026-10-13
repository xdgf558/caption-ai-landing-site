import { primary, rows, mutate, removedTrackKey, trackRemovalGuard } from '../../src/music/adminStore.js';
import { musicId, fail } from '../../src/music/adminValidation.js';
import { rowGuard, combineGuards } from '../../src/redesign/contentAdminStore.js';

// Maintenance-only, never imported into a Worker or exposed as an HTTP route.
// The caller must establish operator authorization and preserve the target
// snapshot before execution. No schema, revision, audit or R2 deletion occurs.
function unreferenced(id) {
  const checks=[
    ['music_collection_tracks','track_id=?'],['music_collections','cover_track_id=?'],
    ['music_featured_items','track_id=?'],['station_platform_links','track_id=?'],
    ['station_promotions','track_id=?'],['station_clips','track_id=?'],
    ['station_campaigns','track_id=?'],['station_publish_jobs',"object_id=? AND status='pending'"],
    ['station_home_revisions',"featured_track_id=? OR EXISTS(SELECT 1 FROM json_each(selected_track_ids_json) WHERE value=?)"],
  ];
  return {condition:checks.map(([t,c])=>`NOT EXISTS(SELECT 1 FROM ${t} WHERE ${c})`).join(' AND '),
    params:checks.flatMap(([,c])=>Array(c.split('?').length-1).fill(id))};
}
const validVersion=n=>Number.isSafeInteger(n)&&n>0;
export async function removeArchivedTrack(db,id,expected,context) {
  id=musicId(id);
  if(!validVersion(expected.legacyVersion)||!validVersion(expected.websiteVersion))fail('INVALID_INPUT',400);
  return mutate(db,{...context,route:`maintenance/tracks/${id}/remove`,command:{id,expected}},async(s,now)=>{
    const track=rows(await s.prepare('SELECT * FROM music_tracks WHERE id=?').bind(id).all())[0];
    const site=rows(await s.prepare('SELECT * FROM station_track_publications WHERE track_id=?').bind(id).all())[0];
    if(!track||!site)fail('NOT_FOUND',404);
    if(track.edit_version!==expected.legacyVersion||site.edit_version!==expected.websiteVersion)fail('MUSIC_EDIT_CONFLICT',409);
    if(track.lifecycle!=='archived'||track.draft_revision_id!==null||track.published_revision_id!==null||
      !['draft','archived'].includes(site.status)||site.published_revision!==null||site.scheduled_at!==null)fail('TRACK_REMOVAL_REQUIRES_ARCHIVED',409);
    const references=unreferenced(id);
    if(!rows(await s.prepare(`SELECT (${references.condition}) AS clear`).bind(...references.params).all())[0].clear)fail('TRACK_REMOVAL_REFERENCED',409);
    const marker={version:1,trackId:id,removedAt:now,actorId:context.actorId,previousWebsiteStatus:site.status,
      legacyVersion:track.edit_version+1,websiteVersion:site.edit_version+1};
    return {...combineGuards(rowGuard('music_tracks',track),rowGuard('station_track_publications',site),trackRemovalGuard(id),references),
      writes:[
        s.prepare('INSERT INTO music_settings(key,value_json,updated_at) VALUES(?,?,?)').bind(removedTrackKey(id),JSON.stringify(marker),now),
        s.prepare('UPDATE music_tracks SET edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?').bind(now,id,track.edit_version),
        s.prepare("UPDATE station_track_publications SET status='archived',edit_version=edit_version+1,updated_at=? WHERE track_id=? AND edit_version=?").bind(now,id,site.edit_version),
      ],action:'station.content.remove',targetId:id,summary:{type:'tracks',recoverable:true,legacyVersion:marker.legacyVersion,websiteVersion:marker.websiteVersion},
      result:{id,removed:true,recoverable:true}};
  });
}
export async function restoreArchivedTrack(db,id,context) {
  id=musicId(id);
  return mutate(db,{...context,route:`maintenance/tracks/${id}/restore`,command:{id}},async(s,now)=>{
    const saved=rows(await s.prepare('SELECT * FROM music_settings WHERE key=?').bind(removedTrackKey(id)).all())[0];
    if(!saved)fail('NOT_FOUND',404);
    const marker=JSON.parse(saved.value_json);
    if(marker.version!==1||marker.trackId!==id||!['draft','archived'].includes(marker.previousWebsiteStatus)||
      !validVersion(marker.legacyVersion)||!validVersion(marker.websiteVersion))fail('INVALID_INPUT',400);
    const track=rows(await s.prepare('SELECT * FROM music_tracks WHERE id=?').bind(id).all())[0];
    const site=rows(await s.prepare('SELECT * FROM station_track_publications WHERE track_id=?').bind(id).all())[0];
    if(!track||!site||track.lifecycle!=='archived'||track.edit_version!==marker.legacyVersion||
      site.status!=='archived'||site.edit_version!==marker.websiteVersion||site.published_revision!==null||site.scheduled_at!==null)fail('MUSIC_EDIT_CONFLICT',409);
    return {...combineGuards(rowGuard('music_settings',saved),rowGuard('music_tracks',track),rowGuard('station_track_publications',site)),writes:[
      s.prepare('DELETE FROM music_settings WHERE key=?').bind(saved.key),
      s.prepare('UPDATE music_tracks SET edit_version=edit_version+1,updated_at=? WHERE id=? AND edit_version=?').bind(now,id,track.edit_version),
      s.prepare('UPDATE station_track_publications SET status=?,edit_version=edit_version+1,updated_at=? WHERE track_id=? AND edit_version=?').bind(marker.previousWebsiteStatus,now,id,site.edit_version),
    ],action:'station.content.restore',targetId:id,summary:{type:'tracks',published:false},result:{id,removed:false,published:false}};
  });
}
