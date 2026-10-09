import { primary, rows } from '../music/adminStore.js';
import { fail } from '../music/adminValidation.js';
import { publicAssetIdentity, previewIdentity, resourceReady } from './publicResources.js';
import { metadata, platformUrl, strictJson, idList, millis } from './publicValidation.js';
import { requestDeadline } from './publicStore.js';
import { snapshot, rowGuard, combineGuards } from './contentAdminStore.js';
import { effectivePolicy, policyFromRevision } from '../music/policy.js';

export function fieldFailure(code,field) { try { fail(code,422); } catch(e) { e.field=field; throw e; } }
export async function validateContentPublication(runtime,x,r,now) {
  const guards=[],seen=new Set(),run=requestDeadline(10000),s=primary(runtime.db);
  const add=(table,row)=>{ const key=table+':'+JSON.stringify(row); if(!seen.has(key)){seen.add(key);guards.push(rowGuard(table,row));} };
  const one=async(table,id)=>rows(await run(()=>s.prepare(`SELECT * FROM ${table} WHERE id=? LIMIT 2`).bind(id).all()))[0];
  const published=async(type,id,field)=>{
    let record; try{record=await run(()=>snapshot(runtime.db,type,id));}catch(e){if(e.status===404)fieldFailure('STATION_REFERENCE_NOT_PUBLIC',field);throw e;}
    if(record.h.status!=='published'||!record.published||!millis(record.h.published_at)||record.h.published_at>now) fieldFailure('STATION_REFERENCE_NOT_PUBLIC',field);
    add(record.d.table,record.h);add(record.d.revisions,record.published); return record;
  };
  async function asset(id,owner,kind,field,media=false) {
    if(!id) fieldFailure('STATION_ASSET_REQUIRED',field);
    const table=media?'station_media_assets':'music_assets',a=await one(table,id);
    const w=rows(await run(()=>s.prepare(`SELECT * FROM station_asset_rights WHERE ${media?'media_asset_id':'music_asset_id'}=? AND scope=? LIMIT 2`).bind(id,kind).all()))[0];
    if(!a||!w) fieldFailure('STATION_ASSET_RIGHTS_REQUIRED',field);
    const other=media?'music_assets':'station_media_assets';
    const ambiguous=Boolean(await one(other,id));
    const retired=!media && rows(await run(()=>s.prepare('SELECT asset_id FROM music_upload_cleanup WHERE asset_id=? LIMIT 1').bind(id).all())).length>0;
    const joined={...a,rights_status:w.status,rights_basis:w.basis,rights_reviewer:w.reviewer_id,rights_at:w.reviewed_at,ambiguous:Number(ambiguous),retired:Number(retired)};
    if(!publicAssetIdentity(joined,{ownerId:owner,kind,now,media})) fieldFailure('STATION_ASSET_NOT_READY',field);
    if(!await resourceReady(runtime,joined,run)) fieldFailure('STATION_ASSET_OBJECT_CHANGED',field);
    add(table,a);add('station_asset_rights',w);
    guards.push({condition:`NOT EXISTS(SELECT 1 FROM ${other} WHERE id=?)`,params:[id]});
    if(!media) guards.push({condition:'NOT EXISTS(SELECT 1 FROM music_upload_cleanup WHERE asset_id=?)',params:[id]});
    return joined;
  }
  async function trackContent(t,field) {
    if(!metadata(t.metadata_json,'zh-Hans',{artist:true})) fieldFailure('STATION_METADATA_REQUIRED',field+'.metadata');
    await asset(t.cover_asset_id,t.track_id,'cover',field+'.coverAssetId');
    if(t.lyrics_asset_id) await asset(t.lyrics_asset_id,t.track_id,'lyrics',field+'.lyricsAssetId');
    const related=idList(JSON.stringify(strictJson(t.metadata_json).relatedTrackIds??[]),6);
    for(const id of related) { if(id===t.track_id) fieldFailure('STATION_RELATED_SELF',field+'.relatedTrackIds');await published('tracks',id,field+'.relatedTrackIds'); }
    if(['free_full','existing_entitlement'].includes(t.site_audio_mode)) {
      const old=await one('music_tracks',t.track_id), legacy=await one('music_track_revisions',t.legacy_revision_id);
      if(!old||old.lifecycle!=='published'||old.published_revision_id!==legacy?.id||legacy.state!=='sealed'||legacy.track_id!==t.track_id||!legacy.audio_asset_id||legacy.technical_reviewed_at===null) fieldFailure('STATION_FULL_REFERENCE_NOT_CURRENT',field+'.legacyRevisionId');
      if(t.site_audio_mode==='free_full'&&effectivePolicy(policyFromRevision(legacy),now).effectiveAccess!=='free') fieldFailure('STATION_FULL_POLICY_MISMATCH',field+'.siteAudioMode');
      const a=await one('music_assets',legacy.audio_asset_id);
      if(a?.state!=='validated'||a.owner_track_id!==t.track_id||a.kind!=='audio'||!await resourceReady(runtime,a,run)) fieldFailure('STATION_FULL_ASSET_NOT_READY',field+'.legacyRevisionId');
      add('music_tracks',old);add('music_track_revisions',legacy);add('music_assets',a);
      guards.push({condition:'NOT EXISTS(SELECT 1 FROM music_upload_cleanup WHERE asset_id=?)',params:[a.id]});
    }
    const routes=rows(await run(()=>s.prepare("SELECT * FROM station_track_routes WHERE track_id=? AND role='canonical' LIMIT 2").bind(t.track_id).all()));
    if(routes.length!==1) fieldFailure('STATION_ROUTE_REQUIRED',field); add('station_track_routes',routes[0]);
  }
  async function clipContent(c,cr,field) {
    if(!metadata(cr.metadata_json,'zh-Hans')) fieldFailure('STATION_METADATA_REQUIRED',field+'.metadata');
    const parent=await published('tracks',c.track_id,field+'.trackId');
    // All parent revisions must be valid public website metadata. Audio mode is
    // never used as a new grant and is still rechecked by the old delivery API.
    if(!metadata(parent.published.metadata_json,'zh-Hans',{artist:true})) fieldFailure('STATION_REFERENCE_NOT_PUBLIC',field+'.trackId');
    await trackContent(parent.published,field+'.track');
    const media=await asset(cr.media_asset_id,c.id,c.type,field+'.mediaAssetId',true);
    await asset(cr.poster_asset_id,c.id,'poster',field+'.posterAssetId',true);
    if(cr.duration_ms!==media.duration_ms) fieldFailure('STATION_DURATION_MISMATCH',field+'.durationMs');
  }
  async function gameContent(g,gr,field) {
    if(g.slug==='cat-life'||g.runtime_key!=='cat-life'||gr.launch_url!=='/games/cat-life/'||!metadata(gr.metadata_json,'zh-Hans')) fieldFailure('STATION_RUNTIME_INVALID',field+'.launchUrl');
    const devices=strictJson(gr.supported_devices_json),screens=idList(gr.screenshot_ids_json,12);
    if(!devices.length||devices.some(v=>!['desktop','ios','android'].includes(v))||!screens.length) fieldFailure('STATION_GAME_DETAILS_REQUIRED',field+'.screenshotIds');
    for(const id of screens) await asset(id,g.id,'game_screenshot',field+'.screenshotIds',true);
  }
  async function promotionContent(id,p,field) {
    const t=await published('tracks',id,field+'.trackId');await trackContent(t.published,field+'.track');
    if(p.enabled!==1) {
      if(p.preview_enabled||p.preview_asset_id||idList(p.selected_platform_ids_json).length||idList(p.selected_clip_ids_json).length) fieldFailure('STATION_DISABLED_PROMOTION_REFERENCES',field);
      return;
    }
    if(p.preview_enabled) {
      const a=await asset(p.preview_asset_id,id,'preview',field+'.previewAssetId');
      const source=await one('music_assets',a.derived_from_asset_id);
      const retired=source && rows(await run(()=>s.prepare('SELECT asset_id FROM music_upload_cleanup WHERE asset_id=? LIMIT 1').bind(source.id).all())).length>0;
      const ambiguous=source&&Boolean(await one('station_media_assets',source.id));
      if(!previewIdentity(a,{...source,retired:Number(retired),ambiguous:Number(ambiguous)},id,now)) fieldFailure('STATION_PREVIEW_NOT_INDEPENDENT',field+'.previewAssetId');
      if(!await resourceReady(runtime,source,run)) fieldFailure('STATION_ASSET_OBJECT_CHANGED',field+'.previewAssetId');
      add('music_assets',source);guards.push({condition:'NOT EXISTS(SELECT 1 FROM music_upload_cleanup WHERE asset_id=?)',params:[source.id]});
      guards.push({condition:'NOT EXISTS(SELECT 1 FROM station_media_assets WHERE id=?)',params:[source.id]});
    }
    for(const id2 of idList(p.selected_platform_ids_json)) {
      const link=await one('station_platform_links',id2);
      if(link?.track_id!==id||link.status!=='live'||!millis(link.verified_at)||link.verified_at>now||!platformUrl(link.url,link.provider)) fieldFailure('STATION_PLATFORM_NOT_VERIFIED',field+'.selectedPlatformIds');
      add('station_platform_links',link);
    }
    for(const clipId of idList(p.selected_clip_ids_json,4)) {
      const c=await published('clips',clipId,field+'.selectedClipIds');
      if(c.h.track_id!==id) fieldFailure('STATION_REFERENCE_OWNER_MISMATCH',field+'.selectedClipIds');await clipContent(c.h,c.published,field+'.clips');
    }
  }
  if(x.type==='tracks') await trackContent(r,'track');
  else if(x.type==='clips') await clipContent(x.h,r,'clip');
  else if(x.type==='games') await gameContent(x.h,r,'game');
  else if(x.type==='promotions') await promotionContent(x.id,r,'promotion');
  else {
    const tracks=[...new Set([r.featured_track_id,...idList(r.selected_track_ids_json,3)].filter(Boolean))];
    for(const id of tracks) {
      const p=await published('promotions',id,'home.tracks');
      if(p.published.enabled!==1) fieldFailure('STATION_PROMOTION_NOT_ENABLED','home.tracks');await promotionContent(id,p.published,'home.promotion');
    }
    for(const id of idList(r.selected_clip_ids_json,4)) {
      const c=await published('clips',id,'home.selectedClipIds');
      const p=r.featured_track_id?await published('promotions',r.featured_track_id,'home.selectedClipIds'):null;
      if(c.h.track_id!==r.featured_track_id||c.h.type!=='short_video'||!p||!idList(p.published.selected_clip_ids_json,4).includes(id)) fieldFailure('STATION_HOME_CLIP_PARENT_REQUIRED','home.selectedClipIds');
      await clipContent(c.h,c.published,'home.clips');
    }
    if(r.featured_game_id){const g=await published('games',r.featured_game_id,'home.featuredGameId');await gameContent(g.h,g.published,'home.game');}
    if(idList(r.selected_update_ids_json,3).length) fieldFailure('STATION_UPDATES_UNAVAILABLE','home.selectedUpdateIds');
  }
  if(guards.length>90) fieldFailure('STATION_REFERENCE_BUDGET','references');
  return combineGuards(...guards);
}
