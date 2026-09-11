// Optional first-party measurements only. This module never controls the audio,
// reads identity, changes membership, or writes stationcat.music.v2.
export const MUSIC_ANALYTICS_SESSION_KEY = 'stationcat.music.analytics.v1';
export const MUSIC_ANALYTICS_CONSENT_VERSION = 'music-analytics-v1';
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const positive = value => Number.isFinite(value) && value>0;

export function createMusicAnalytics(player, { fetcher=globalThis.fetch.bind(globalThis), storage=()=>globalThis.sessionStorage,
  randomId=()=>globalThis.crypto.randomUUID(), clock=Date.now, monotonic=()=>globalThis.performance.now(),
  schedule=globalThis.setTimeout, cancel=globalThis.clearTimeout, privacySignal=()=>globalThis.navigator?.globalPrivacyControl===true,
  onChange=()=>{} }={}) {
  let config=null, consent=null, destroyed=false, status='checking', epoch=0, timer=null, sending=null, configAbort=null;
  let pending=[], flight=[], session=null, previous=player.snapshot(), sample=null, retry=0;
  const emit=()=>{ try { onChange({status,enabled:!!consent && config?.available===true}); } catch {} };
  const removeConsent=()=>{ try { storage().removeItem(MUSIC_ANALYTICS_SESSION_KEY); } catch {} };
  const reset=({abortFlight=true}={})=>{
    epoch++; if(timer!==null) cancel(timer); timer=null;
    if(abortFlight) sending?.abort(); sending=null; pending=[]; flight=[]; retry=0; session=null; sample=null;
  };
  const stop=(next,clear=true)=>{ reset(); consent=null; if(clear) removeConsent(); status=next; emit(); };
  const allowed=()=>{
    if (!consent || !config?.available || destroyed) return false;
    if (privacySignal() || clock()>=consent.expiresAt) { stop(privacySignal() ? 'privacy-signal' : 'declined'); return false; }
    return true;
  };
  const later=(delay=1000)=>{
    if(timer!==null || sending || (!pending.length && !flight.length) || !allowed()) return;
    timer=schedule(()=>{timer=null; void flush();},delay);
  };
  async function flush() {
    if(sending || (!pending.length && !flight.length) || !allowed()) return;
    const own=epoch, controller=new AbortController(); sending=controller;
    if(!flight.length) flight=pending.splice(0,20);
    const timeout=schedule(()=>controller.abort(),5000); let retryAfter=0;
    try {
      const response=await fetcher('/api/music/events',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',keepalive:true,
        signal:controller.signal,headers:{'Content-Type':'application/json','X-Requested-With':'StationCatMusicAnalytics'},
        body:JSON.stringify({consentVersion:MUSIC_ANALYTICS_CONSENT_VERSION,events:flight})});
      if (own!==epoch || destroyed) return;
      if (!response.ok) {
        const seconds=Number(response.headers.get('Retry-After'));
        if(response.status===429 && Number.isInteger(seconds) && seconds>0 && seconds<=60) retryAfter=seconds*1000;
        if ([408,429].includes(response.status) || response.status>=500) throw new Error('retryable');
        flight=[]; retry=0; return;
      }
      flight=[]; retry=0;
    } catch {
      if(own!==epoch || destroyed) return;
      if(retry<2) retry++; else {retry=0;flight=[];}
    } finally {
      cancel(timeout);
      if(own===epoch) { sending=null; later(retry ? Math.max(2**retry*1000,retryAfter) : 1000); }
    }
  }
  const enqueue=(type,data)=>{
    if(!allowed() || pending.length+flight.length>=100) return;
    const eventId=randomId(); if(!uuid(eventId)) return;
    pending.push({eventId,eventType:type,anonymousSessionId:consent.anonymousSessionId,occurredAt:clock(),...data}); later();
  };
  const milestone=type=>{
    if(!session || session.sent.has(type)) return;
    session.sent.add(type);
    enqueue(type,{playSessionId:session.id,trackId:session.trackId,revisionNo:session.revisionNo,variant:session.variant,
      listenedMs:type==='play_start' ? 0 : Math.floor(session.listened),entrySource:'player'});
  };
  function observe(state) {
    try {
      const now=monotonic(), key=`${state.sourceGeneration}:${state.playbackGeneration}:${state.activeTrackId}:${state.activeAudioVersion}:${state.activeVariant}`;
      if(!allowed()) { previous=state; sample=null; return; }
      if(session && (session.key!==key || (['ended','error'].includes(previous.status) && state.status==='loading'))) { session=null; sample=null; }
      // A status transition to playing is published only after a current native
      // playing event. Consenting halfway through a running song is not a start.
      if(!session && state.status==='playing' && previous.status!=='playing' && uuid(state.activeTrackId) &&
        Number.isSafeInteger(state.activeAudioVersion) && state.activeAudioVersion>0 && positive(state.durationSec)) {
        const id=randomId(); if(!uuid(id)) return;
        session={id,key,trackId:state.activeTrackId,revisionNo:state.activeAudioVersion,variant:state.activeVariant,
          duration:state.durationSec*1000,listened:0,sent:new Set()}; milestone('play_start');
      }
      if(session && sample && !state.seeking && state.status==='playing' && previous.status==='playing') {
        const elapsed=now-sample.time, media=(state.currentTimeSec-sample.position)*1000;
        // Both clocks must advance continuously. Long gaps undercount deliberately;
        // hidden-tab timer throttling is not proof of uninterrupted listening.
        if(elapsed>0 && elapsed<=2000 && media>0 && media<=elapsed*1.25+100) {
          session.listened=Math.min(session.duration,session.listened+Math.min(elapsed,media));
        }
      }
      if(session && session.listened>=Math.min(30000,session.duration*.5)) milestone('qualified_play');
      if(session && state.status==='ended' && previous.status==='playing') {
        if(session.listened>=session.duration*.9) milestone('play_complete');
        if(session.variant==='preview') milestone('preview_end');
      }
      sample=session && state.status==='playing' && !state.seeking ? {time:now,position:state.currentTimeSec} : null;
      previous=state;
    } catch { stop('unavailable'); previous=state; }
  }
  const unsubscribe=player.subscribe(observe);
  async function refresh() {
    if(destroyed) return;
    configAbort?.abort(); const controller=new AbortController(); configAbort=controller;
    // Refresh does not split a pause/resume session. The server rechecks its
    // switches on every POST; failed configuration reads stop this collector.
    sample=null;
    if(!config) { status='checking'; emit(); }
    if(privacySignal()) stop('privacy-signal');
    const timeout=schedule(()=>controller.abort(),5000);
    try {
      const response=await fetcher('/api/music/analytics/config',{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
      const value=await response.json();
      if(destroyed || configAbort!==controller) return;
      if(!response.ok || value.consentVersion!==MUSIC_ANALYTICS_CONSENT_VERSION || typeof value.available!=='boolean') throw new Error('config');
      config=value;
      if(!config.available) { stop('unavailable'); return; }
      if(privacySignal()) { stop('privacy-signal'); return; }
      let saved;
      try { saved=JSON.parse(storage().getItem(MUSIC_ANALYTICS_SESSION_KEY)||'null'); } catch { stop('storage-unavailable'); return; }
      if(saved && Object.keys(saved).sort().join(',')==='anonymousSessionId,expiresAt,version' &&
        saved.version===MUSIC_ANALYTICS_CONSENT_VERSION && uuid(saved.anonymousSessionId) &&
        Number.isSafeInteger(saved.expiresAt) && saved.expiresAt>clock() && saved.expiresAt<=clock()+86400000) {
        consent=saved; status='enabled'; emit();
      } else { stop('declined'); }
    } catch { if(!destroyed && configAbort===controller) stop('unavailable'); }
    finally { cancel(timeout); }
  }
  return {
    refresh,
    accept() {
      if(destroyed || !config?.available || privacySignal()) return false;
      try {
        const next={version:MUSIC_ANALYTICS_CONSENT_VERSION,anonymousSessionId:randomId(),expiresAt:clock()+86400000};
        if(!uuid(next.anonymousSessionId)) throw new Error('id');
        storage().setItem(MUSIC_ANALYTICS_SESSION_KEY,JSON.stringify(next));
        reset(); consent=next; previous=player.snapshot(); status='enabled'; emit(); return true;
      } catch { stop('storage-unavailable'); return false; }
    },
    withdraw() { stop('declined'); },
    cta(track,variant) {
      try {
        if(!allowed() || !track || !uuid(track.id) || !Number.isSafeInteger(track.audioVersion) || !['full','preview'].includes(variant)) return;
        const id=randomId(); if(!uuid(id)) return;
        enqueue('vip_cta_click',{playSessionId:id,trackId:track.id,revisionNo:track.audioVersion,variant,listenedMs:0,entrySource:'detail'});
        // Start the bounded request before normal link navigation. No await, no
        // navigation delay; only already consented, already in-flight work survives.
        void flush();
      } catch { stop('unavailable'); }
    },
    snapshot:()=>({status,enabled:!!consent && config?.available===true,queued:pending.length+flight.length}),
    destroy() { destroyed=true; configAbort?.abort(); reset({abortFlight:false}); unsubscribe(); }
  };
}
