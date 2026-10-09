import { STATION_EVENT_VERSION, eventFields, stationEventNames } from './analyticsModel.js';
import { createAttributionSession } from './attributionSession.js';
import { uuid } from './publicValidation.js';
import { readMusicResponse } from './musicResponse.js';

export const eventConsentKey='stationcat.events.consent.v1';
export const eventOptOutKey='stationcat.music.analytics.disabled.v1';
const DAY=86400000, clone=value=>JSON.parse(JSON.stringify(value));
// The queue exists only in memory. No stored payloads, URLs, cookies, account
// identifiers or saved games; retries keep the exact event UUID and snapshot.
export function createStationEvents({fetcher=globalThis.fetch.bind(globalThis),storage=()=>globalThis.sessionStorage,
  clock=Date.now,makeId=()=>crypto.randomUUID(),schedule=setTimeout,cancel=clearTimeout,
  privacy=()=>globalThis.navigator?.globalPrivacyControl===true,deviceClass=()=> 'unknown',attribution={kind:'direct_or_unknown'},onChange=()=>{}}={}) {
  let store,consent=null,config=null,status='checking',destroyed=false,timer=null,sending=null,configAbort=null,epoch=0,retry=0;
  let pending=[],flight=[],scope='memory',blockedUntil=0;
  try{store=storage();scope=store?'session_storage':'memory';}catch{}
  const manager=createAttributionSession({storage:store,clock,makeId,allowed:()=>!!consent&&!privacy()&&!declined()});
  function declined(){try{return store?.getItem(eventOptOutKey)==='1';}catch{return false;}}
  function emit(){try{onChange(snapshot());}catch{}}
  function snapshot(){return {status,enabled:allowed(false),queued:pending.length+flight.length,scope,config:config?{available:config.available,runtimeGameId:config.runtimeGameId}:null};}
  function reset(){epoch++;if(timer!==null)cancel(timer);timer=null;sending?.abort();sending=null;pending=[];flight=[];retry=0;blockedUntil=0;}
  function stop(next){reset();consent=null;status=next;manager.clear();try{store?.removeItem(eventConsentKey);}catch{}emit();}
  function allowed(notify=true){
    if(destroyed||!consent||!config?.available)return false;
    if(privacy()||declined()||clock()>=consent.expiresAt){if(notify)stop(privacy()?'privacy':'declined');return false;}
    return true;
  }
  function later(delay=1000){if(timer!==null||sending||!pending.length&&!flight.length||!allowed())return;timer=schedule(()=>{timer=null;void flush();},Math.max(delay,blockedUntil-clock()));}
  async function flush(){
    if(sending||!pending.length&&!flight.length||!allowed())return;
    if(clock()<blockedUntil){later();return;}
    if(timer!==null)cancel(timer);timer=null;
    const own=epoch,controller=new AbortController();sending=controller;
    if(!flight.length){
      const session=pending[0].sessionId;
      while(flight.length<20&&pending[0]?.sessionId===session)flight.push(pending.shift());
    }
    const timeout=schedule(()=>controller.abort(),5000);let retryAfter=0;
    try{
      const response=await fetcher('/api/station/events',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',keepalive:true,signal:controller.signal,
        headers:{'Content-Type':'application/json','X-Requested-With':'StationCatEvents'},body:JSON.stringify({consentVersion:STATION_EVENT_VERSION,events:flight})});
      await response.body?.cancel();
      if(own!==epoch||destroyed)return;
      if(response.status===429){const seconds=Number(response.headers.get('Retry-After'));if(Number.isInteger(seconds)&&seconds>0&&seconds<=60)retryAfter=seconds*1000;}
      if([408,429].includes(response.status)||response.status>=500)throw new Error('retryable');
      flight=[];retry=0;
    }catch{
      if(own!==epoch||destroyed)return;
      if(retry<2)retry++;else {retry=0;flight=[];}
    }finally{cancel(timeout);if(own===epoch){sending=null;const delay=retry?Math.max(2**retry*1000,retryAfter):1000;blockedUntil=retry?clock()+delay:0;later(delay);}}
  }
  function enqueue(name,details={},immediate=false){
    try{
      if(!allowed()||!stationEventNames.includes(name)||pending.length+flight.length>=100)return false;
      const s=manager.touch();if(!s.enabled)return false;
      const e={eventId:makeId(),name,occurredAt:clock(),sessionId:s.sessionId,contextId:s.context.id,sessionScope:s.scope,
        attributionKind:s.context.kind,campaignId:s.context.campaignId,firstCampaignId:s.firstCampaign,deviceClass:deviceClass(),
        trackId:null,clipId:null,gameId:null,platformLinkId:null,playbackId:null,interactionId:null,launchId:null,saveOperationId:null,listenedMs:0,mediaEnded:false};
      // Producers can supply only the event-specific IDs and measurements, not
      // replace timestamps, sessions, consent or attribution with arbitrary data.
      for(const key of ['trackId','clipId','gameId','platformLinkId','playbackId','interactionId','launchId','saveOperationId','listenedMs','mediaEnded'])if(Object.hasOwn(details,key))e[key]=details[key];
      if(!uuid(e.eventId)||Object.keys(e).length!==eventFields.length)return false;
      pending.push(clone(e));if(immediate)void flush();else later();emit();return true;
    }catch{return false;}
  }
  function accept(){
    if(destroyed||!config?.available||privacy())return false;
    reset();consent={version:STATION_EVENT_VERSION,expiresAt:clock()+DAY};
    try{store?.removeItem(eventOptOutKey);store?.setItem(eventConsentKey,JSON.stringify(consent));}catch{scope='memory';}
    // Explicit choice still works without storage. Its scope stays this page.
    manager.enter(attribution);status='enabled';emit();return true;
  }
  function withdraw(){
    try{store?.setItem(eventOptOutKey,'1');}catch{}
    stop('declined');return true;
  }
  async function refresh(){
    if(destroyed)return;
    if(privacy()){stop('privacy');return;}
    configAbort?.abort();const controller=new AbortController();configAbort=controller;
    const timeout=schedule(()=>controller.abort(),5000);
    try{
      const response=await fetcher('/api/station/events/config',{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      const value=JSON.parse(await readMusicResponse(response,4096));
      if(destroyed||configAbort!==controller)return;
      if(!response.ok||value.consentVersion!==STATION_EVENT_VERSION||typeof value.available!=='boolean'||(value.runtimeGameId!==undefined&&value.runtimeGameId!==null&&!uuid(value.runtimeGameId)))throw new Error('config');
      config=value;
      if(!value.available){stop('unavailable');return;}
      if(privacy()||declined()){stop(privacy()?'privacy':'declined');return;}
      if(consent&&clock()>=consent.expiresAt){consent=null;reset();manager.clear();try{store?.removeItem(eventConsentKey);}catch{}}
      if(!consent){try{const saved=JSON.parse(store?.getItem(eventConsentKey)||'null');if(saved&&Object.keys(saved).sort().join(',')==='expiresAt,version'&&saved.version===STATION_EVENT_VERSION&&Number.isSafeInteger(saved.expiresAt)&&saved.expiresAt>clock()&&saved.expiresAt<=clock()+DAY)consent=saved;}catch{scope='memory';}}
      if(consent){manager.enter(attribution);status='enabled';}else status='choice';emit();
    }catch{if(!destroyed&&configAbort===controller){config=null;stop('unavailable');}}
    finally{cancel(timeout);}
  }
  return {refresh,accept,withdraw,enqueue,flush,snapshot,
    enter(value){attribution=value;try{manager.enter(value);}catch{}},
    destroy(){destroyed=true;configAbort?.abort();reset();},
    inspectQueue:()=>clone([...flight,...pending])};
}
