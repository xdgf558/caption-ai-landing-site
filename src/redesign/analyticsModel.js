import { uuid } from './publicValidation.js';
import { campaignId } from './campaignLinks.js';

export const STATION_EVENT_VERSION = 'station-events-v1';
export const STATION_EVENT_RETENTION = Object.freeze({rawDays:90, rateHours:2});
export const stationEventNames = Object.freeze(['track_view','preview_start','full_audio_start','preview_qualified','platform_click','clip_start','clip_complete','game_launch_request','game_ready','save_success']);
export const eventFields = Object.freeze(['eventId','name','occurredAt','sessionId','contextId','sessionScope','attributionKind','campaignId','firstCampaignId','trackId','clipId','gameId','platformLinkId','playbackId','interactionId','launchId','saveOperationId','deviceClass','listenedMs','mediaEnded']);
const id = value => uuid(value) && value===value.toLowerCase();
const nullableId = value => value===null || id(value);
export const eventEnabled = value => value===true || value==='true';
export function eventConfiguration(env) {
  const reason = !eventEnabled(env.STATION_EVENTS_ENABLED) ? 'EVENTS_DISABLED'
    : !eventEnabled(env.STATION_CONTENT_PUBLIC_ENABLED) ? 'CONTENT_DISABLED'
    : env.STATION_EVENTS_PRIVACY_VERSION!==STATION_EVENT_VERSION ? 'PRIVACY_NOT_CONFIGURED'
    : !eventEnabled(env.STATION_EVENTS_RETENTION_ENABLED) ? 'RETENTION_NOT_CONFIGURED' : null;
  return {available:!reason,reason,consentVersion:STATION_EVENT_VERSION,retention:STATION_EVENT_RETENTION};
}
export const eventPageConfiguration = env => ({enabled:eventConfiguration(env).available});
const invalid = () => {throw Object.assign(new Error('INVALID_EVENT'),{code:'INVALID_EVENT',status:400});};
export function validateStationEvents(input) {
  if(!input || Object.keys(input).sort().join(',')!=='consentVersion,events' || input.consentVersion!==STATION_EVENT_VERSION || !Array.isArray(input.events) || input.events.length<1 || input.events.length>20)invalid();
  let session;
  return input.events.map(e=>{
    if(!e || Object.keys(e).length!==eventFields.length || Object.keys(e).some(k=>!eventFields.includes(k)) || !stationEventNames.includes(e.name) ||
      !['eventId','sessionId','contextId'].every(k=>id(e[k])) || !['trackId','clipId','gameId','platformLinkId','playbackId','interactionId','launchId','saveOperationId'].every(k=>nullableId(e[k])) ||
      !['session_storage','memory'].includes(e.sessionScope) || !['campaign','direct_or_unknown','unknown'].includes(e.attributionKind) ||
      !(e.campaignId===null || campaignId(e.campaignId)) || !(e.firstCampaignId===null || campaignId(e.firstCampaignId)) ||
      (e.attributionKind==='campaign') !== (e.campaignId!==null) || !['mobile','desktop','unknown'].includes(e.deviceClass) ||
      !Number.isSafeInteger(e.occurredAt) || e.occurredAt<0 || !Number.isSafeInteger(e.listenedMs) || e.listenedMs<0 || e.listenedMs>86400000 || typeof e.mediaEnded!=='boolean')invalid();
    session??=e.sessionId;if(session!==e.sessionId)invalid();
    const game=e.name.startsWith('game_') || e.name==='save_success', clip=e.name.startsWith('clip_'), play=clip || ['preview_start','preview_qualified','full_audio_start'].includes(e.name), click=e.name==='platform_click';
    if(game ? !e.gameId || !e.launchId || e.trackId!==null || e.clipId!==null : !e.trackId || e.gameId!==null || e.launchId!==null)invalid();
    if((e.playbackId!==null)!==play || (e.clipId!==null)!==clip || (e.platformLinkId!==null)!==click || (e.interactionId!==null)!==click || (e.saveOperationId!==null)!==(e.name==='save_success'))invalid();
    if(!['preview_qualified','clip_complete'].includes(e.name) && (e.listenedMs!==0 || e.mediaEnded))invalid();
    if(e.name==='preview_qualified' && e.listenedMs<10000 && !e.mediaEnded)invalid();
    if(e.name==='clip_complete' && !e.mediaEnded)invalid();
    return {...e};
  });
}
