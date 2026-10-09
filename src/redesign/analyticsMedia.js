import { uuid } from './publicValidation.js';

// Receives the current native player's confirmed states. Listening requires
// continuous foreground advancement of BOTH clocks; seek and long gaps never
// create elapsed time. This observer cannot call play/pause/seek or own a URL.
export function createStationMediaMeasurement({kind,emit,clock=()=>performance.now(),visible=()=>globalThis.document?.visibilityState==='visible',enabled=()=>true}={}) {
  let session=null,sample=null;
  const resetSample=()=>{sample=null;};
  function observe(state){
    try{
      if(!enabled()){session=null;sample=null;return;}
      if(!uuid(state?.playbackId)||!uuid(state.trackId)||(kind==='clip'&&!uuid(state.clipId))){session=null;sample=null;return;}
      if(session?.id!==state.playbackId){session={id:state.playbackId,trackId:state.trackId,clipId:state.clipId??null,variant:state.variant,listened:0,started:false,qualified:false,completed:false,skipped:0,seekAnchor:null};sample=null;}
      const now=clock(),foreground=visible(),position=state.positionSec*1000;
      if(!Number.isFinite(position)||!Number.isFinite(now))return;
      const ids={trackId:session.trackId,clipId:session.clipId,playbackId:session.id};
      if(state.status==='playing'&&!session.started){session.started=emit(kind==='clip'?'clip_start':session.variant==='preview'?'preview_start':'full_audio_start',ids)!==false;session.skipped=Math.max(0,position);}
      if(!session.started){sample=null;return;}
      if(state.seeking&&session.seekAnchor===null)session.seekAnchor=sample?.position??position;
      if(!state.seeking&&session.seekAnchor!==null){session.skipped+=Math.max(0,position-session.seekAnchor);session.seekAnchor=null;}
      if(session.started&&sample&&foreground&&!state.seeking){
        const elapsed=now-sample.at,media=position-sample.position;
        if(elapsed>0&&elapsed<=2000&&media>0&&media<=elapsed*1.25+100){session.listened+=Math.min(elapsed,media);}
        else if(media>elapsed*1.25+100)session.skipped+=media;
      }
      // Detect forward seeks even across an explicit seeking/seeked boundary.
      const ended=state.status==='ended'&&state.nativeEnded===true&&session.started;
      if(kind==='music'&&session.variant==='preview'&&!session.qualified&&(session.listened>=10000||ended)){
        session.qualified=true;emit('preview_qualified',{...ids,listenedMs:Math.min(86400000,Math.floor(session.listened)),mediaEnded:ended});
      }
      // More than one second skipped (including a nonzero resumed start) is a
      // conservative 'major content skipped' rule, not a 90% completion ratio.
      if(kind==='clip'&&ended&&!session.completed&&session.skipped<=1000){session.completed=true;emit('clip_complete',{...ids,listenedMs:Math.min(86400000,Math.floor(session.listened)),mediaEnded:true});}
      sample=session.started&&foreground&&state.status==='playing'&&!state.seeking?{at:now,position}:null;
    }catch{sample=null;}
  }
  return {observe,resetSample,reset(){session=null;sample=null;}};
}
