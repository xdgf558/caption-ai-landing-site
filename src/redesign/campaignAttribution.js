import { primary, rows } from '../music/adminStore.js';
import { campaignEnabled, campaignInput, validCampaignRecord, campaignLandingPath, campaignLocales } from './campaignLinks.js';
import { campaignReadiness, campaignEligibility } from './campaignStore.js';

export function publicAttribution(value) {
  if(value?.kind==='campaign'){
    const r=value.record;return {enabled:true,kind:'campaign',campaignId:r.id,trackId:r.track_id,clipId:r.clip_id,source:r.source,medium:r.medium};
  }
  return {enabled:value?.enabled===true,kind:value?.kind==='unknown'?'unknown':'direct_or_unknown'};
}
export async function resolveCampaignAttribution(runtime,env,search,trackId,{clock=Date.now}={}) {
  if(!campaignEnabled(env.STATION_CAMPAIGNS_ENABLED))return {enabled:false,kind:'direct_or_unknown'};
  const input=campaignInput(search);
  if(input.kind==='none')return {enabled:true,kind:'direct_or_unknown'};
  if(input.kind==='unknown')return {enabled:true,kind:'unknown'};
  try {
    await campaignReadiness(runtime);const s=primary(runtime.db);
    const query=input.kind==='legacy'?'SELECT c.* FROM station_campaigns c JOIN station_campaign_legacy_sources a ON a.campaign_id=c.id WHERE a.source_key=? LIMIT 2':'SELECT * FROM station_campaigns WHERE id=? LIMIT 2';
    const result=rows(await s.prepare(query).bind(input.kind==='legacy'?input.key:input.id).all());
    const r=result[0];
    if(result.length!==1||r.status!=='active'||r.track_id!==trackId||!validCampaignRecord(r)||
      (input.kind==='utm'&&(r.source!==input.source||r.medium!==input.medium||r.content_value!==input.content)))return {enabled:true,kind:'unknown'};
    const eligible=await campaignEligibility(runtime,trackId,r.clip_id,clock());
    if(!campaignLocales.some(l=>campaignLandingPath(l,eligible.slug)===r.landing_path))return {enabled:true,kind:'unknown'};
    return {enabled:true,kind:'campaign',record:r};
  } catch { // Failures also replace a previous active context with unknown.
    // Collection remains a separately gated T18 concern; no dimensions are invented.
    return {enabled:true,kind:'unknown'};
  }
}
