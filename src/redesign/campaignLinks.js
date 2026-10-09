import { localizedPath, slug, uuid } from './publicValidation.js';

export const stationCampaignOrigin = 'https://wwwstationcat.org';
export const campaignEnabled = value => value === true || value === 'true';
export const campaignToken = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value);
export const campaignId = value => campaignToken(value) && !['unknown','direct_or_unknown'].includes(value);
export const campaignLocales = Object.freeze(['zh-Hant','zh-Hans','en','ja']);
const keys = ['utm_source','utm_medium','utm_campaign','utm_content'];

export function campaignLandingPath(locale, trackSlug) {
  if (!campaignLocales.includes(locale) || !slug(trackSlug)) throw new TypeError('Invalid campaign destination');
  return localizedPath(locale, 'music/tracks', trackSlug);
}
export function validCampaignRecord(row) {
  if (!row || !campaignId(row.id) || !campaignToken(row.source) || !campaignToken(row.medium) || !uuid(row.track_id) ||
      (row.clip_id !== null && !uuid(row.clip_id)) || row.content_value !== (row.clip_id || 'track')) return false;
  const match = /^\/(?:((?:en|ja|zh-hans))\/)?music\/tracks\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/.exec(row.landing_path);
  return Boolean(match && slug(match[2]));
}
// This is the only composer for copy, QR, stored landing paths and normalized shares.
// Neither a request Host nor a caller-supplied redirect/URL can select the origin.
export function campaignUrl(row) {
  const landingPath=row?.landing_path;
  if (!validCampaignRecord(row) || typeof landingPath !== 'string') throw new TypeError('Invalid campaign');
  const url = new URL(landingPath, stationCampaignOrigin);
  if (url.origin !== stationCampaignOrigin || url.search || url.hash ||
      !/^\/(?:en\/|ja\/|zh-hans\/)?music\/tracks\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(url.pathname)) throw new TypeError('Invalid campaign destination');
  for (const [index, value] of [row.source,row.medium,row.id,row.content_value].entries()) url.searchParams.set(keys[index],value);
  return url.href;
}
export function campaignParameters(row) { return new URL(campaignUrl(row)).searchParams; }

// Raw strings never become report dimensions. All four values must match one registered row.
// A mixed src/UTM tuple, duplicate, unknown UTM key or oversize query fails as one unit.
export function campaignInput(search) {
  if (typeof search !== 'string' || search.length > 2048) return { kind:'unknown' };
  const params = new URLSearchParams(search);
  if ([...params].length > 40) return { kind:'unknown' };
  const present = keys.some(key=>params.has(key)), legacy=params.has('src');
  if ([...params.keys()].some(key=>/^utm_/i.test(key)&&!keys.includes(key))) return { kind:'unknown' };
  if (present && legacy) return { kind:'unknown' };
  if (legacy) {
    const values=params.getAll('src');
    return values.length===1 && campaignToken(values[0]) ? {kind:'legacy',key:values[0]} : {kind:'unknown'};
  }
  if (!present) return {kind:'none'};
  const values=keys.map(key=>params.getAll(key));
  if (values.some(v=>v.length!==1||!campaignToken(v[0])) || !campaignId(values[2][0])) return {kind:'unknown'};
  return {kind:'utm',source:values[0][0],medium:values[1][0],id:values[2][0],content:values[3][0]};
}
export function campaignRedirectSearch(attribution) {
  if (attribution?.kind==='campaign') return campaignParameters(attribution.record).toString();
  return attribution?.kind==='unknown' ? 'utm_campaign=unknown' : '';
}
