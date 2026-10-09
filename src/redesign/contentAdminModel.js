import { fields, fail, musicId, editVersion, isObject } from '../music/adminValidation.js';
import { metadata, strictJson, idList, slug, platformUrl, plain, millis, positive } from './publicValidation.js';
import { stationHomeConfig } from '../data/station-home.js';

export const contentModels = Object.freeze({
  tracks: { table:'station_track_publications', revisions:'station_track_revisions', key:'track_id', columns:['metadata_json','legacy_revision_id','site_audio_mode','duration_ms','cover_asset_id','lyrics_asset_id'] },
  promotions: { table:'station_promotions', revisions:'station_promotion_revisions', key:'track_id', columns:['enabled','preview_enabled','preview_asset_id','selected_platform_ids_json','selected_clip_ids_json','sort_order'] },
  clips: { table:'station_clips', revisions:'station_clip_revisions', key:'id', columns:['metadata_json','media_asset_id','poster_asset_id','duration_ms','subtitles_json'] },
  games: { table:'station_games', revisions:'station_game_revisions', key:'id', columns:['metadata_json','launch_url','supported_devices_json','screenshot_ids_json'] },
  home: { table:'station_home_configs', revisions:'station_home_revisions', key:'id', columns:['featured_track_id','featured_game_id','selected_track_ids_json','selected_clip_ids_json','selected_update_ids_json'] }
});
export function model(type) { if (!Object.hasOwn(contentModels,type)) fail('NOT_FOUND',404); return contentModels[type]; }
export function objectId(type,id) { id=musicId(id); if(type==='home' && id!==stationHomeConfig.id) fail('NOT_FOUND',404); return id; }
export const nullableId = id => id===null ? null : musicId(id);
export function integer(n,min=0,max=1000000) { if(!Number.isSafeInteger(n)||n<min||n>max) fail('INVALID_INPUT',400); return n; }
export function date(n,{optional=false,now=Date.now()}={}) { if(optional && n===null) return null; if(!millis(n)||n>now) fail('INVALID_INPUT',400); return n; }
export function cleanText(value,max,empty=false) { if(!plain(value,max)||(!empty&&!value.trim())) fail('INVALID_INPUT',400); return value; }
export const ids = (value,max=25) => { try { return idList(JSON.stringify(value),max).map(musicId); } catch { fail('INVALID_INPUT',400); } };
export function cleanMetadata(value,type) {
  if(!isObject(value)) fail('INVALID_INPUT',400);
  fields(value,['originalLocale','title','summary','story','creatorName','relatedTrackIds','instrumental','language','genres','moods']);
  if(!metadata(JSON.stringify(value),value.originalLocale,{artist:type==='tracks'})) fail('INVALID_INPUT',400);
  return Object.fromEntries(['originalLocale','title','summary','story','creatorName','relatedTrackIds'].filter(k=>value[k]!==undefined).map(k=>[k,strictJson(JSON.stringify(value[k]))]));
}
export function draftData(type,input) {
  model(type);
  const ref = key => nullableId(input[key]??null);
  if(type==='tracks') {
    fields(input,['metadata','legacyRevisionId','siteAudioMode','durationMs','coverAssetId','lyricsAssetId']);
    const mode=input.siteAudioMode??'none'; if(!['none','preview','free_full','existing_entitlement'].includes(mode)) fail('INVALID_INPUT',400);
    if(['free_full','existing_entitlement'].includes(mode)&&!input.legacyRevisionId) fail('STATION_FULL_REFERENCE_REQUIRED',422);
    return {metadata_json:JSON.stringify(cleanMetadata(input.metadata,type)),legacy_revision_id:ref('legacyRevisionId'),site_audio_mode:mode,
      duration_ms:input.durationMs==null?null:integer(input.durationMs,1,86400000),cover_asset_id:ref('coverAssetId'),lyrics_asset_id:ref('lyricsAssetId')};
  }
  if(type==='promotions') {
    fields(input,['enabled','previewEnabled','previewAssetId','selectedPlatformIds','selectedClipIds','sortOrder']);
    if(typeof input.enabled!=='boolean'||typeof input.previewEnabled!=='boolean') fail('INVALID_INPUT',400);
    if(!input.enabled) return {enabled:0,preview_enabled:0,preview_asset_id:null,selected_platform_ids_json:'[]',selected_clip_ids_json:'[]',sort_order:integer(input.sortOrder??0)};
    if(input.previewEnabled&&!input.previewAssetId) fail('STATION_PREVIEW_REQUIRED',422);
    return {enabled:Number(input.enabled),preview_enabled:Number(input.previewEnabled),preview_asset_id:input.previewEnabled?ref('previewAssetId'):null,
      selected_platform_ids_json:JSON.stringify(ids(input.selectedPlatformIds??[])),selected_clip_ids_json:JSON.stringify(ids(input.selectedClipIds??[],4)),sort_order:integer(input.sortOrder??0)};
  }
  if(type==='clips') {
    fields(input,['metadata','mediaAssetId','posterAssetId','durationMs','subtitles']);
    const subtitles=input.subtitles??{}; if(!isObject(subtitles)||JSON.stringify(subtitles).length>8000||Object.keys(subtitles).some(k=>!['zh-Hant','zh-Hans','en','ja'].includes(k)||!plain(subtitles[k],2000))) fail('INVALID_INPUT',400);
    return {metadata_json:JSON.stringify(cleanMetadata(input.metadata,type)),media_asset_id:ref('mediaAssetId'),poster_asset_id:ref('posterAssetId'),duration_ms:input.durationMs==null?null:integer(input.durationMs,1,1800000),subtitles_json:JSON.stringify(subtitles)};
  }
  if(type==='games') {
    fields(input,['metadata','launchUrl','supportedDevices','screenshotIds']);
    if(input.launchUrl!=null&&input.launchUrl!=='/games/cat-life/') fail('STATION_RUNTIME_INVALID',422);
    const devices=input.supportedDevices??[]; if(!Array.isArray(devices)||devices.length>3||new Set(devices).size!==devices.length||devices.some(v=>!['desktop','ios','android'].includes(v))) fail('INVALID_INPUT',400);
    return {metadata_json:JSON.stringify(cleanMetadata(input.metadata,type)),launch_url:input.launchUrl??null,supported_devices_json:JSON.stringify(devices),screenshot_ids_json:JSON.stringify(ids(input.screenshotIds??[],12))};
  }
  fields(input,['featuredTrackId','featuredGameId','selectedTrackIds','selectedClipIds','selectedUpdateIds']);
  if((input.selectedUpdateIds??[]).length) fail('STATION_UPDATES_UNAVAILABLE',422);
  return {featured_track_id:ref('featuredTrackId'),featured_game_id:ref('featuredGameId'),selected_track_ids_json:JSON.stringify(ids(input.selectedTrackIds??[],3)),selected_clip_ids_json:JSON.stringify(ids(input.selectedClipIds??[],4)),selected_update_ids_json:'[]'};
}
export function viewData(type,r) {
  if(!r) return null;
  const meta=()=>strictJson(r.metadata_json), list=k=>strictJson(r[k]);
  if(type==='tracks') return {metadata:meta(),legacyRevisionId:r.legacy_revision_id,siteAudioMode:r.site_audio_mode,durationMs:r.duration_ms,coverAssetId:r.cover_asset_id,lyricsAssetId:r.lyrics_asset_id};
  if(type==='promotions') return {enabled:r.enabled===1,previewEnabled:r.preview_enabled===1,previewAssetId:r.preview_asset_id,selectedPlatformIds:list('selected_platform_ids_json'),selectedClipIds:list('selected_clip_ids_json'),sortOrder:r.sort_order};
  if(type==='clips') return {metadata:meta(),mediaAssetId:r.media_asset_id,posterAssetId:r.poster_asset_id,durationMs:r.duration_ms,subtitles:list('subtitles_json')};
  if(type==='games') return {metadata:meta(),launchUrl:r.launch_url,supportedDevices:list('supported_devices_json'),screenshotIds:list('screenshot_ids_json')};
  return {featuredTrackId:r.featured_track_id,featuredGameId:r.featured_game_id,selectedTrackIds:list('selected_track_ids_json'),selectedClipIds:list('selected_clip_ids_json'),selectedUpdateIds:[]};
}
export function platformData(input,now) {
  fields(input,['trackId','provider','territories','status','url','verifiedAt','releasedAt','sortOrder']);
  const trackId=musicId(input.trackId), provider=input.provider;
  if(!['netease','qishui','apple_music','youtube','spotify'].includes(provider)||!['planned','live','unavailable','removed'].includes(input.status)) fail('INVALID_INPUT',400);
  const territories=input.territories??['*']; if(!Array.isArray(territories)||!territories.length||territories.length>250||territories.some(v=>v!=='*'&&!/^[A-Z]{2}$/.test(v))||new Set(territories).size!==territories.length||(territories.includes('*')&&territories.length!==1)) fail('INVALID_INPUT',400);
  let url=input.url??null; if(url!==null) {url=platformUrl(url,provider); if(!url) fail('STATION_PLATFORM_URL_INVALID',422);}
  const verifiedAt=date(input.verifiedAt??null,{optional:true,now}), releasedAt=date(input.releasedAt??null,{optional:true,now});
  if(input.status==='live'&&(!url||verifiedAt===null)) fail('STATION_PLATFORM_VERIFICATION_REQUIRED',422);
  return {track_id:trackId,provider,territories_json:JSON.stringify([...territories].sort()),status:input.status,url,verified_at:verifiedAt,external_released_at:releasedAt,sort_order:integer(input.sortOrder??0)};
}
export function requestedVersion(context) { return editVersion(context.ifMatch); }
export function cleanSlug(value) { if(!slug(value)) fail('INVALID_INPUT',400); return value; }
export function revisionNumber(value) { if(!positive(value)) fail('INVALID_INPUT',400); return value; }
