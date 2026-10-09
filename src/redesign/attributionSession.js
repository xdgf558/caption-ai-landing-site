import { campaignId, campaignToken } from './campaignLinks.js';
import { uuid } from './publicValidation.js';

export const attributionSessionKey='stationcat.attribution.v1';
export const attributionIdleMs=30*60*1000;
const clone=value=>JSON.parse(JSON.stringify(value));
export function normalizedAttribution(value) {
  if(value?.kind==='campaign'&&campaignId(value.campaignId)&&uuid(value.trackId)&&
    (value.clipId===null||uuid(value.clipId))&&campaignToken(value.source)&&campaignToken(value.medium))return {
    kind:'campaign',campaignId:value.campaignId,trackId:value.trackId,clipId:value.clipId,source:value.source,medium:value.medium};
  return {kind:value?.kind==='direct_or_unknown'?'direct_or_unknown':'unknown',campaignId:null,trackId:null,clipId:null,source:null,medium:null};
}
export function createAttributionSession({storage,clock=Date.now,makeId=()=>crypto.randomUUID(),allowed=()=>true,idleMs=attributionIdleMs}={}) {
  if(!Number.isSafeInteger(idleMs)||idleMs<5*60*1000||idleMs>120*60*1000)throw new TypeError('Invalid session inactivity window');
  let state=null,scope='memory',loaded=false;
  const clear=()=>{state=null;try{storage?.removeItem(attributionSessionKey);}catch{}};
  const permit=()=>{try{if(allowed())return true;}catch{}clear();return false;};
  const id=()=>{const value=makeId();if(!uuid(value))throw new TypeError('Invalid anonymous identifier');return value;};
  const valid=s=>s&&s.version===1&&uuid(s.sessionId)&&uuid(s.context?.id)&&Number.isSafeInteger(s.startedAt)&&Number.isSafeInteger(s.lastActivity)&&s.startedAt<=s.lastActivity&&
    s.startedAt>=0&&s.lastActivity<=clock()&&clock()-s.lastActivity<idleMs&&
    (s.firstCampaign===null||campaignId(s.firstCampaign))&&JSON.stringify(normalizedAttribution(s.context))===JSON.stringify(Object.fromEntries(Object.entries(s.context).filter(([k])=>k!=='id')));
  function load(){if(loaded)return;loaded=true;try{const raw=storage?.getItem(attributionSessionKey);if(raw&&raw.length<=2048){const parsed=JSON.parse(raw);if(valid(parsed))state={version:1,sessionId:parsed.sessionId,startedAt:parsed.startedAt,lastActivity:parsed.lastActivity,firstCampaign:parsed.firstCampaign,context:{id:parsed.context.id,...normalizedAttribution(parsed.context)}};}else if(raw)storage.removeItem(attributionSessionKey);scope=storage?'session_storage':'memory';}catch{scope='memory';}}
  const save=()=>{if(scope==='session_storage'){try{storage.setItem(attributionSessionKey,JSON.stringify(state));}catch{scope='memory';}}};
  function current(){if(!permit())return null;load();const now=clock();if(!state||now<state.lastActivity||now-state.lastActivity>=idleMs)state={version:1,sessionId:id(),startedAt:now,lastActivity:now,firstCampaign:null,context:{id:id(),...normalizedAttribution({kind:'direct_or_unknown'})}};return state;}
  return {
    enter(value){const s=current();if(!s)return {enabled:false};const a=normalizedAttribution(value);
      if(a.kind==='campaign'){
        if(!s.firstCampaign)s.firstCampaign=a.campaignId;
        if(s.context.kind!=='campaign'||s.context.campaignId!==a.campaignId)s.context={id:id(),...a};
      }else if(a.kind==='unknown'&&s.context.kind!=='unknown')s.context={id:id(),...a};
      // Clean internal navigation and lyrics do not replay a landing URL or reset
      // the active context. First lawful source belongs to the visit session.
      s.lastActivity=clock();save();return this.snapshot();
    },
    touch(){const s=current();if(s){s.lastActivity=clock();save();}return this.snapshot();},
    snapshot(){if(!permit()||!state)return {enabled:false};return clone({enabled:true,scope,idleMs,...state});},
    clear
  };
}

// Context only. No events, referrers, full URLs, account identifiers or network
// requests are collected here. T18 will use immutable snapshots at event time.
export function mountCampaignAttribution(value,{root=document,storage=()=>window.sessionStorage,privacy=()=>navigator.globalPrivacyControl===true}={}) {
  if(value?.enabled!==true)return ()=>{};
  let store;try{store=storage();}catch{}
  const allowed=()=>{if(privacy())return false;try{return !store||store.getItem('stationcat.music.analytics.disabled.v1')!=='1';}catch{return true;}};
  const manager=createAttributionSession({storage:store,allowed});
  const changed=snapshot=>root.dispatchEvent(new CustomEvent('station:attribution-context',{detail:snapshot}));
  try{changed(manager.enter(value));}catch{return ()=>{};}
  const touch=()=>{try{changed(manager.touch());}catch{}};
  root.addEventListener('pointerdown',touch,{passive:true});root.addEventListener('keydown',touch);
  return ()=>{root.removeEventListener('pointerdown',touch);root.removeEventListener('keydown',touch);};
}
