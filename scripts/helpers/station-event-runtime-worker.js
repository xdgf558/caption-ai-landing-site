import worker from '../../src/worker.js';
// Local test entry only. No fixture routing is exported by production Worker.
export default {async fetch(request,env,ctx){
 const url=new URL(request.url),match=/^\/fixture-event-(off|collection-only|content-only|privacy-off|retention-off|empty|wrong)(?=\/)/.exec(url.pathname);let local=env;
 if(match){url.pathname=url.pathname.slice(match[0].length);local={...env,
  ...(match[1]==='off'||match[1]==='content-only'?{STATION_EVENTS_ENABLED:'false'}:{}),
  ...(match[1]==='collection-only'?{STATION_CONTENT_PUBLIC_ENABLED:'false'}:{}),
  ...(match[1]==='privacy-off'?{STATION_EVENTS_PRIVACY_VERSION:''}:{}),
  ...(match[1]==='retention-off'?{STATION_EVENTS_RETENTION_ENABLED:'false'}:{}),
  ...(match[1]==='empty'?{MUSIC_DB:env.EMPTY_DB}:{}),...(match[1]==='wrong'?{MUSIC_DB:env.WAITLIST_DB}:{})};request=new Request(url,request);}
 return worker.fetch(request,local,ctx);
},scheduled:worker.scheduled};
